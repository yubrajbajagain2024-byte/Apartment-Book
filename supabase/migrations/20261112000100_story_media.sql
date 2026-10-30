-- =============================================================================
-- UniBuzz - migration 59: a story's photo and video
-- Follows migration 58 (20261110000100_stories.sql), whose table, trigger and sweep it builds on; its file name sorts
-- after every migration on other branches (20261112000000 on admin-analytics-business). Uses migration 28's Vault
-- entries (snaps_project_url, snaps_service_key) and pg_net when they are there, as purge_snaps() does.
-- Rollback: supabase/rollbacks/20261112000100_story_media.down.sql. Safe to run more than once.
--
-- The database keeps a story's media to the story, as it keeps the story to its audience:
--   * A photo lives in uploads/stories/<author>/<file>, a folder kept to its owner the way Buzz's folder is
--     (uploads_public_read). The app shows it from the address on the story row, which only the story's audience reads.
--     stories_before_insert() takes a photo from nowhere else: not another folder, not another person's, not another
--     host, and not a file that was never uploaded (story_photo_ok()).
--   * A video must be the author's own finished upload (public.media, status ready), as on Buzz; its size and length
--     come from that record, and its poster is a Mux still of that video or the record's own.
--   * When a story goes (its author deletes it, the account goes, or it expires), its photo file is deleted through the
--     Storage API (stories_after_delete(), pg_net with the Vault entries above), unless another story still shows it.
--     Without pg_net or those entries the row still goes and the file stays.
--   * stories_sweep() deletes a story once it expires (58 waited a further day), every ten minutes rather than hourly,
--     so a photo outlives its story by ten minutes at most.
-- Stories shared before this migration keep their photos where they are; they expire within a day.
-- =============================================================================

-- --- The folder -----------------------------------------------------------------------------------------------------
-- Writing to uploads/stories/<you>/… is already allowed by the own-folder rules (migration 12); reading it through the
-- API is now the owner's alone, as for buzz/. Public addresses keep working: the bucket is public.
drop policy if exists "uploads_public_read" on storage.objects;
create policy "uploads_public_read" on storage.objects
  for select using (
    bucket_id = 'uploads'
    and (
      ((storage.foldername(name))[1] is distinct from 'buzz' and (storage.foldername(name))[1] is distinct from 'stories')
      or to_jsonb(objects) ->> 'owner_id' = auth.uid()::text
      or to_jsonb(objects) ->> 'owner' = auth.uid()::text
    )
  );

-- --- The photo check ------------------------------------------------------------------------------------------------
-- Is this the public address of a file the author uploaded to their stories folder in this project? The project's
-- address is the one Vault keeps for purge_snaps() when there is one; otherwise any Supabase project's address shape.
-- Reads Vault and storage.objects as the definer: no API role may call it.
create or replace function public.story_photo_ok(p_url text, p_author uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text;
  v_prefix text;
  v_path text;
begin
  if p_url is null or p_author is null or char_length(p_url) > 2000 then
    return false;
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1' into v_base using 'snaps_project_url';
  end if;
  if v_base is not null and v_base <> '' then
    v_prefix := rtrim(v_base, '/') || '/storage/v1/object/public/uploads/';
    if left(p_url, char_length(v_prefix)) <> v_prefix then
      return false;
    end if;
  else
    v_prefix := substring(p_url from '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/uploads/');
    if v_prefix is null then
      return false;
    end if;
  end if;
  v_path := substr(p_url, char_length(v_prefix) + 1);
  -- One file directly in the author's own folder: no subfolder, no query string, no way out of it.
  if v_path !~ ('^stories/' || p_author::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$') then
    return false;
  end if;
  return exists (select 1 from storage.objects o where o.bucket_id = 'uploads' and o.name = v_path);
end;
$$;
revoke all on function public.story_photo_ok(text, uuid) from public, anon, authenticated;

-- --- The row on its way in: 58's stamps, then the media -------------------------------------------------------------
create or replace function public.stories_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pb text;
  v_media public.media%rowtype;
  v_poster text;
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    new.created_at := now();
    new.expires_at := now() + interval '24 hours';
    if new.audience = 'campus' then
      new.university_id := public.verified_university(new.author_id);
      if new.university_id is null then
        raise exception 'Only a verified student can share with their campus.' using errcode = '42501';
      end if;
    end if;
    if new.kind = 'photo' then
      if not public.story_photo_ok(new.image_url, new.author_id) then
        raise exception 'Upload the photo to your story first.' using errcode = '22023';
      end if;
    elsif new.kind = 'video' then
      v_pb := case when jsonb_typeof(new.video -> 'playback_id') = 'string' then new.video ->> 'playback_id' end;
      if v_pb is null or v_pb !~ '^[A-Za-z0-9]{8,120}$' then
        raise exception 'That video isn''t ready yet.' using errcode = '22023';
      end if;
      select * into v_media from public.media m
      where m.playback_id = v_pb and m.owner_id = new.author_id and m.status = 'ready'
      order by m.created_at desc
      limit 1;
      if v_media.id is null then
        raise exception 'That video isn''t ready yet.' using errcode = '22023';
      end if;
      -- The cover the author chose (a Mux still of this video at any moment), else the record's own poster.
      v_poster := case when jsonb_typeof(new.video -> 'poster_url') = 'string' then new.video ->> 'poster_url' end;
      if v_poster is null or char_length(v_poster) > 300 or v_poster !~ ('^https://image\.mux\.com/' || v_pb || '/[A-Za-z0-9._?=&-]+$') then
        v_poster := v_media.poster_url;
      end if;
      new.video := jsonb_build_object(
        'media_id', v_media.id,
        'playback_id', v_pb,
        'poster_url', v_poster,
        'width', v_media.width,
        'height', v_media.height,
        'duration_seconds', v_media.duration_seconds);
    end if;
  end if;
  return new;
end;
$$;

-- --- The photo file goes with its story -----------------------------------------------------------------------------
-- After a story's row is deleted, for whatever reason, its photo is deleted from Storage when it is in the author's
-- stories folder of this project (pg_net sends the request once the deleting transaction commits; a rolled-back delete
-- sends nothing). A legacy service_role key is a JWT and goes in both headers; a new sb_secret_ key only as the apikey.
create or replace function public.stories_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
  v_prefix text;
  v_path text;
begin
  if old.kind <> 'photo' or old.image_url is null then
    return null;
  end if;
  -- Another story still showing the same file keeps it (the app gives each story its own; a client need not).
  if exists (select 1 from public.stories s where s.image_url = old.image_url) then
    return null;
  end if;
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute 'select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1' into v_url using 'snaps_project_url';
  execute 'select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1' into v_key using 'snaps_service_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return null;
  end if;
  v_prefix := rtrim(v_url, '/') || '/storage/v1/object/public/uploads/';
  if left(old.image_url, char_length(v_prefix)) <> v_prefix then
    return null;
  end if;
  v_path := substr(old.image_url, char_length(v_prefix) + 1);
  if v_path !~ ('^stories/' || old.author_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$') then
    return null;
  end if;
  perform net.http_delete(
    url := rtrim(v_url, '/') || '/storage/v1/object/uploads/' || v_path,
    headers := case
      when v_key like 'sb\_%' then jsonb_build_object('apikey', v_key)
      else jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key)
    end
  );
  return null;
end;
$$;
revoke all on function public.stories_after_delete() from public, anon, authenticated;
create index if not exists stories_image_url_idx on public.stories (image_url) where image_url is not null;
drop trigger if exists stories_after_delete on public.stories;
create trigger stories_after_delete
  after delete on public.stories
  for each row execute function public.stories_after_delete();

-- --- The sweep: at expiry, every ten minutes ------------------------------------------------------------------------
-- An expired story is already invisible to every reader (58's select policy); deleting it then also deletes its photo.
create or replace function public.stories_sweep(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.stories s where s.expires_at <= p_now;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.stories_sweep(timestamptz) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'stories-sweep';
    perform cron.schedule('stories-sweep', '*/10 * * * *', 'select public.stories_sweep()');
  end if;
end;
$$;

notify pgrst, 'reload schema';

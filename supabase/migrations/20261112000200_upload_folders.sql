-- =============================================================================
-- UniBuzz - migration 60: a person's uploads are theirs alone to list; a post's photos come from, and go with, the post
-- Follows migration 59 (20261112000100_story_media.sql), whose rule for stories this extends to every folder and to
-- posts. Uses migration 28's Vault entries (snaps_project_url, snaps_service_key) and pg_net when they are there, as 59
-- and purge_snaps() do. Rollback: supabase/rollbacks/20261112000200_upload_folders.down.sql. Safe to run more than once.
--
-- The uploads bucket is public: a file is served to anyone who has its address, which is random and never guessable.
-- Its folders were another matter. The API's read rule let anyone, signed in or not, list a person's folders by their
-- id (uploads/posts/<id>/, apartments/<id>/, …): every photo they ever posted, a Friends-only or Selected-people post's
-- included, and the photos of posts long deleted. Migration 59 closed stories/ that way; this closes the rest.
--   * Through the API, a file in the uploads bucket is read (listed, inspected) by the person who uploaded it alone
--     (uploads_read_own). Nothing in the apps lists anyone else's folder; deleting one's account lists one's own.
--     Addresses keep working.
--   * A post's photos must be files its author uploaded to posts/<author>/ in this project (own_upload_ok(), the rule
--     59 wrote for stories, for any folder), on the way in and when a post is edited: a post cannot show, or claim, a
--     file from another folder, another person or another host. Rows written by the server (no auth.uid()) are not
--     checked, as before: the seeds and the e2e scripts write such rows.
--   * When a post goes (deleted by its author, or with its account) or a photo is taken out of it, each such photo
--     that lives in posts/<author>/ of this project and that no other post or story shows is deleted through the
--     Storage API (pg_net with the Vault entries above), the way 59 deletes a story's. Without pg_net or those
--     entries the row changes and the files stay.
-- Photos of posts made before this migration stay where they are, and go with their post from now on.
-- =============================================================================

-- --- The folders ----------------------------------------------------------------------------------------------------
drop policy if exists "uploads_public_read" on storage.objects;
drop policy if exists "uploads_read_own" on storage.objects;
create policy "uploads_read_own" on storage.objects
  for select using (
    bucket_id = 'uploads'
    and (to_jsonb(objects) ->> 'owner_id' = auth.uid()::text or to_jsonb(objects) ->> 'owner' = auth.uid()::text)
  );

-- --- The photo check, for any folder --------------------------------------------------------------------------------
-- Is this the public address of a file p_owner uploaded to their own folder of this kind (posts, stories, …) in this
-- project? The project's address is the one Vault keeps for purge_snaps() when there is one; otherwise any Supabase
-- project's address shape. Reads Vault and storage.objects as the definer: no API role may call it.
create or replace function public.own_upload_ok(p_url text, p_owner uuid, p_kind text)
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
  if p_url is null or p_owner is null or p_kind !~ '^[a-z]+$' or char_length(p_url) > 2000 then
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
  -- One file directly in the owner's own folder: no subfolder, no query string, no way out of it.
  if v_path !~ ('^' || p_kind || '/' || p_owner::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$') then
    return false;
  end if;
  return exists (select 1 from storage.objects o where o.bucket_id = 'uploads' and o.name = v_path);
end;
$$;
revoke all on function public.own_upload_ok(text, uuid, text) from public, anon, authenticated;

-- --- A post's photos on the way in --------------------------------------------------------------------------------
create or replace function public.feed_posts_photos_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  if auth.uid() is null or coalesce(cardinality(new.images), 0) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.images = old.images then
    return new;
  end if;
  foreach v_url in array new.images loop
    -- A photo already on the post was checked when it arrived (or came before this rule).
    if tg_op = 'UPDATE' and v_url = any (old.images) then
      continue;
    end if;
    if not public.own_upload_ok(v_url, auth.uid(), 'posts') then
      raise exception 'Upload the photo to your post first.' using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.feed_posts_photos_before_write() from public, anon, authenticated;
drop trigger if exists feed_posts_photos_before_write on public.feed_posts;
create trigger feed_posts_photos_before_write
  before insert or update of images on public.feed_posts
  for each row execute function public.feed_posts_photos_before_write();

-- --- A post's photos go with it -------------------------------------------------------------------------------------
-- After a post is deleted, for whatever reason, or a photo is taken out of it, each photo no longer shown that is in
-- the author's posts folder of this project is deleted from Storage, unless another post or a story still shows it
-- (pg_net sends the request once the transaction commits; a rolled-back change sends nothing). A legacy service_role
-- key is a JWT and goes in both headers; a new sb_secret_ key only as the apikey.
create or replace function public.feed_posts_photos_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gone text[];
  v_photo text;
  v_url text;
  v_key text;
  v_prefix text;
  v_path text;
begin
  v_gone := case when tg_op = 'DELETE' then old.images else array(select unnest(old.images) except select unnest(new.images)) end;
  if coalesce(cardinality(v_gone), 0) = 0 then
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
  foreach v_photo in array v_gone loop
    if left(v_photo, char_length(v_prefix)) <> v_prefix then
      continue;
    end if;
    v_path := substr(v_photo, char_length(v_prefix) + 1);
    if v_path !~ ('^posts/' || old.author_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$') then
      continue;
    end if;
    if exists (select 1 from public.feed_posts p where p.id <> old.id and p.images @> array[v_photo])
       or exists (select 1 from public.stories s where s.image_url = v_photo) then
      continue;
    end if;
    perform net.http_delete(
      url := rtrim(v_url, '/') || '/storage/v1/object/uploads/' || v_path,
      headers := case
        when v_key like 'sb\_%' then jsonb_build_object('apikey', v_key)
        else jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key)
      end
    );
  end loop;
  return null;
end;
$$;
revoke all on function public.feed_posts_photos_after_change() from public, anon, authenticated;
create index if not exists feed_posts_images_gin on public.feed_posts using gin (images);
drop trigger if exists feed_posts_photos_after_change on public.feed_posts;
create trigger feed_posts_photos_after_change
  after delete or update of images on public.feed_posts
  for each row execute function public.feed_posts_photos_after_change();

notify pgrst, 'reload schema';

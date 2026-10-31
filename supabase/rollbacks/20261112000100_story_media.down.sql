-- =============================================================================
-- Rollback of 20261112000100_story_media.sql (a story's photo and video).
-- Run as one transaction. Restores migration 11's read rule on the uploads bucket, migration 58's insert trigger and
-- sweep (verbatim) with its hourly schedule, and removes the photo check and the file deletion. Photos already in
-- uploads/stories/ stay there, readable as other uploads are.
-- =============================================================================
drop trigger if exists stories_after_delete on public.stories;
drop function if exists public.stories_after_delete();
drop index if exists public.stories_image_url_idx;

drop policy if exists "uploads_public_read" on storage.objects;
create policy "uploads_public_read" on storage.objects
  for select using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] is distinct from 'buzz' or to_jsonb(objects) ->> 'owner_id' = auth.uid()::text or to_jsonb(objects) ->> 'owner' = auth.uid()::text)
  );

create or replace function public.stories_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  end if;
  return new;
end;
$$;

drop function if exists public.story_photo_ok(text, uuid);

create or replace function public.stories_sweep(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.stories s where s.expires_at < p_now - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.stories_sweep(timestamptz) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'stories-sweep';
    perform cron.schedule('stories-sweep', '17 * * * *', 'select public.stories_sweep()');
  end if;
end;
$$;
notify pgrst, 'reload schema';

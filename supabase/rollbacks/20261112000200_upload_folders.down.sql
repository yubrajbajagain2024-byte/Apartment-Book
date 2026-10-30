-- =============================================================================
-- Rollback of 20261112000200_upload_folders.sql (a person's uploads theirs to list; a post's photos from, and with, the post).
-- Run as one transaction. Restores migration 59's read rule on the uploads bucket (every folder listed by anyone but
-- buzz/ and stories/), and removes the photo check and the file deletion on posts. Photos already in posts/ stay.
-- =============================================================================
drop trigger if exists feed_posts_photos_after_change on public.feed_posts;
drop function if exists public.feed_posts_photos_after_change();
drop index if exists public.feed_posts_images_gin;
drop trigger if exists feed_posts_photos_before_write on public.feed_posts;
drop function if exists public.feed_posts_photos_before_write();
drop function if exists public.own_upload_ok(text, uuid, text);

drop policy if exists "uploads_read_own" on storage.objects;
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
notify pgrst, 'reload schema';

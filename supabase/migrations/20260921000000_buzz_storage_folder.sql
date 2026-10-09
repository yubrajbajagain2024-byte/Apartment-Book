-- =============================================================================
-- Apartment Book - migration 12: the "buzz" upload folder is anonymous only
-- The original own-folder rules allow uploads/<anything>/<my id>/…, which
-- includes buzz/<my id>/…. Buzz threads never accept such files, but nothing
-- should be able to put a user id under buzz/ in the first place.
-- Safe to run more than once.
-- =============================================================================
drop policy if exists "uploads_insert_own_folder" on storage.objects;
create policy "uploads_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] is distinct from 'buzz'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "uploads_update_own_folder" on storage.objects;
create policy "uploads_update_own_folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] is distinct from 'buzz'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

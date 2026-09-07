-- =============================================================================
-- Apartment Book - migration 3: photo-first
--  * per-photo metadata (width, height, tiny blur placeholder) so feeds can
--    reserve the right space and blur-up while the full photo loads
--  * uploads up to 25 MB so phone and camera photos keep their original quality
-- Safe to run more than once.
-- =============================================================================

alter table public.apartments
  add column if not exists image_meta jsonb not null default '[]'::jsonb;
alter table public.items
  add column if not exists image_meta jsonb not null default '[]'::jsonb;
alter table public.roommate_posts
  add column if not exists image_meta jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'apartments_image_meta_is_array') then
    alter table public.apartments add constraint apartments_image_meta_is_array check (jsonb_typeof(image_meta) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_image_meta_is_array') then
    alter table public.items add constraint items_image_meta_is_array check (jsonb_typeof(image_meta) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'roommate_posts_image_meta_is_array') then
    alter table public.roommate_posts add constraint roommate_posts_image_meta_is_array check (jsonb_typeof(image_meta) = 'array');
  end if;
end $$;

-- Originals are stored untouched; allow large photos (25 MB).
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
where id = 'uploads';

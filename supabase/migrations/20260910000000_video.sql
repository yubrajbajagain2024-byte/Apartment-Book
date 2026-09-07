-- =============================================================================
-- Apartment Book - migration 5: video
--  * media table: one row per uploaded video (provider-agnostic; Mux today)
--  * listings carry a snapshot of their videos + has_video for ranking/filters
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  kind text not null default 'video' check (kind in ('video')),
  provider text not null default 'mux',
  provider_upload_id text,
  provider_asset_id text,
  playback_id text,
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'ready', 'failed')),
  error text,
  duration_seconds numeric(10, 2),
  width integer,
  height integer,
  aspect_ratio text,
  poster_url text,
  size_bytes bigint,
  original_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_owner_id_fkey foreign key (owner_id) references public.profiles (id) on delete cascade
);
create index if not exists media_owner_idx on public.media (owner_id, created_at desc);
create index if not exists media_asset_idx on public.media (provider_asset_id);
create index if not exists media_upload_idx on public.media (provider_upload_id);

drop trigger if exists media_set_updated_at on public.media;
create trigger media_set_updated_at before update on public.media for each row execute function public.set_updated_at();

alter table public.media enable row level security;
drop policy if exists "media_select" on public.media;
create policy "media_select" on public.media
  for select using (status = 'ready' or owner_id = auth.uid());
drop policy if exists "media_insert_own" on public.media;
create policy "media_insert_own" on public.media
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "media_update_own" on public.media;
create policy "media_update_own" on public.media
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "media_delete_own" on public.media;
create policy "media_delete_own" on public.media
  for delete to authenticated using (owner_id = auth.uid());

-- Listings: videos snapshot [{media_id, playback_id, poster_url, width, height, duration_seconds}]
alter table public.apartments
  add column if not exists videos jsonb not null default '[]'::jsonb,
  add column if not exists has_video boolean not null default false;
alter table public.roommate_posts
  add column if not exists videos jsonb not null default '[]'::jsonb,
  add column if not exists has_video boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'apartments_videos_is_array') then
    alter table public.apartments add constraint apartments_videos_is_array check (jsonb_typeof(videos) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'roommate_posts_videos_is_array') then
    alter table public.roommate_posts add constraint roommate_posts_videos_is_array check (jsonb_typeof(videos) = 'array');
  end if;
end $$;

-- has_video is derived from the snapshot; the feed ranks has_video first.
create or replace function public.set_has_video()
returns trigger
language plpgsql
as $$
begin
  new.has_video := jsonb_typeof(new.videos) = 'array' and jsonb_array_length(new.videos) > 0;
  return new;
end;
$$;

drop trigger if exists apartments_set_has_video on public.apartments;
create trigger apartments_set_has_video before insert or update of videos on public.apartments
  for each row execute function public.set_has_video();
drop trigger if exists roommate_posts_set_has_video on public.roommate_posts;
create trigger roommate_posts_set_has_video before insert or update of videos on public.roommate_posts
  for each row execute function public.set_has_video();

create index if not exists apartments_feed_video_idx on public.apartments (status, has_video desc, created_at desc);
create index if not exists roommate_posts_feed_video_idx on public.roommate_posts (is_active, has_video desc, created_at desc);

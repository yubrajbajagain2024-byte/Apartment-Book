-- =============================================================================
-- CampConnect - migration 41: videos on Marketplace items
-- A Marketplace post now reads like a roommate post (the seller, the words, the
-- price, then large swipeable photos and videos), so an item can carry a video
-- as apartments and roommate posts have since migration 5: the same snapshot
-- [{media_id, playback_id, poster_url, width, height, duration_seconds}] the
-- shared upload (apps/web /api/video/uploads) hands back, at most one per item
-- (the sell form offers one), and has_video kept by the same trigger.
--
-- Additive only: every existing item gets an empty list; nothing reads the new
-- columns until the app does. The app writes `videos` only when one was added,
-- so selling with photos keeps working on a database without this migration.
-- Rollback: supabase/rollbacks/20261103000000_item_videos.down.sql.
-- =============================================================================

alter table public.items
  add column if not exists videos jsonb not null default '[]'::jsonb,
  add column if not exists has_video boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_videos_shape') then
    alter table public.items add constraint items_videos_shape check (jsonb_typeof(videos) = 'array' and jsonb_array_length(videos) <= 1);
  end if;
end $$;

-- has_video follows the snapshot (public.set_has_video, migration 5).
drop trigger if exists items_set_has_video on public.items;
create trigger items_set_has_video before insert or update of videos on public.items
  for each row execute function public.set_has_video();

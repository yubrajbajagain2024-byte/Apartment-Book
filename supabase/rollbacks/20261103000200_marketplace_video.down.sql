-- Rollback of migration 43 (supabase/migrations/20261103000200_marketplace_video.sql).
-- Drops the item video columns. Refuses while any item still has a video, so a
-- rollback never deletes someone's upload silently: clear those first on purpose.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'videos')
     and exists (select 1 from public.items where jsonb_array_length(videos) > 0) then
    raise exception 'items with videos exist: clear them before rolling back migration 43';
  end if;
end $$;

drop trigger if exists items_set_has_video on public.items;
alter table public.items drop constraint if exists items_videos_shape;
alter table public.items drop column if exists has_video;
alter table public.items drop column if exists videos;

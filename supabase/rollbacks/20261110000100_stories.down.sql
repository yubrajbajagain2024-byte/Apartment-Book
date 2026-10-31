-- =============================================================================
-- Rollback of 20261110000100_stories.sql (Stories).
-- Run as one transaction. Removes the sweep's schedule, the functions, the trigger and the three tables with every
-- story, picked viewer and view in them (photo files stay in the uploads bucket, as the migration's header says).
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'stories-sweep';
  end if;
end;
$$;
drop function if exists public.stories_sweep(timestamptz);
drop function if exists public.mark_story_seen(uuid);
drop function if exists public.set_story_viewers(uuid, uuid[]);
drop trigger if exists stories_before_insert on public.stories;
drop function if exists public.stories_before_insert();
drop table if exists public.story_views;
drop table if exists public.story_viewers;
drop table if exists public.stories;
drop function if exists public.can_see_story(uuid, uuid, text, uuid);
drop function if exists public.can_see_story_as(uuid, uuid, uuid, text, uuid);
notify pgrst, 'reload schema';

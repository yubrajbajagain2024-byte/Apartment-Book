-- Rollback of 20261113000000_events.sql (migration 61): every object it added, newest first; the campuses lose their
-- time zone column. Events, organizations, feeds, saves and interests are data this migration alone holds: rolling back
-- deletes them. Run as one transaction together with
--   delete from public._migrations where name = '20261113000000_events.sql';
drop function if exists public.events_console_counts();
drop function if exists public.events_console_set_organization(uuid, boolean, text, text);
drop function if exists public.events_console_organizations(jsonb);
drop function if exists public.events_console_feed_delete(uuid);
drop function if exists public.events_console_feed_save(jsonb);
drop function if exists public.events_console_feeds();
drop function if exists public.events_console_set_event(uuid, text, text);
drop function if exists public.events_console_events(jsonb);
drop function if exists public.record_event_click(uuid, text);

drop table if exists public.event_engagement;
drop table if exists public.event_interests;
drop table if exists public.event_saves;
drop table if exists public.events;
drop table if exists public.event_feeds;
drop table if exists public.organization_follows;
drop table if exists public.organization_members;
drop table if exists public.organizations;

drop function if exists public.event_saves_count();
drop function if exists public.events_before_write();
drop function if exists public.organization_follows_count();
drop function if exists public.organization_members_guard();
drop function if exists public.organizations_after_insert();
drop function if exists public.organizations_before_write();
drop function if exists public.events_console_write();
drop function if exists public.organization_can_edit(uuid);
drop function if exists public.organization_role(uuid);
drop function if exists public.events_staff();

alter table public.universities drop constraint if exists universities_timezone_check;
alter table public.universities drop column if exists timezone;

notify pgrst, 'reload schema';

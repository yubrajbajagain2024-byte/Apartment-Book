-- Rollback of migration 44 (supabase/migrations/20261103000300_discover.sql).
-- Drops Discover's rankings, readers, refresh job and the hashtags column. Nothing
-- anyone wrote is lost: the rankings and the tags are worked out from the posts.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'discover-refresh';
  end if;
end $$;

drop function if exists public.discover_feed(uuid, integer, integer);
drop function if exists public.discover_accounts(uuid, integer, integer);
drop function if exists public.discover_topics(integer);
drop function if exists public.discover_search_topics(text, integer);
drop function if exists public.discover_topic(text);
drop function if exists public.discover_topic_posts(text, text, integer, integer);
drop function if exists public.discover_search_posts(text, integer, integer);
drop function if exists public.discover_refresh();

drop table if exists public.discover_post_ranks;
drop table if exists public.discover_topic_ranks;
drop table if exists public.discover_account_ranks;

drop index if exists public.feed_posts_created_idx;
drop index if exists public.feed_posts_body_search_idx;
-- Its GIN index goes with it.
alter table public.feed_posts drop column if exists hashtags;
drop function if exists public.extract_hashtags(text);

notify pgrst, 'reload schema';

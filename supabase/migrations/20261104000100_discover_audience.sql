-- =============================================================================
-- UniBuzz - Discover ranks public posts only
-- Follows 20261103000300_discover.sql (Discover) and 20261104000000_post_details.sql (who can see a post). Discover's
-- readers run as the caller, so the audience policy on feed_posts already decides every post they return; but
-- discover_refresh() runs with the definer's rights and fills ranking tables that everyone may read: the hot posts,
-- the trending topics (their #tags and counts) and the accounts to follow. Since post_details a post can be for one
-- campus, for friends or for chosen people, so those must not feed public rankings: a friends-only post's #tag would
-- otherwise trend for everyone. This is Discover's discover_refresh() with that one condition added (the column check
-- keeps it working on a database without post_details), rebuilt at once.
-- Rollback: supabase/rollbacks/20261104000100_discover_audience.down.sql.
-- =============================================================================

create or replace function public.discover_refresh()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post_ok text := 'true';
  v_person_ok text := 'true';
  v_posts integer;
  v_topics integer;
  v_accounts integer;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'feed_posts' and column_name = 'hidden_at') then
    v_post_ok := 'p.hidden_at is null';
  end if;
  -- Only posts everyone may see feed these public rankings (20261104000000_post_details): a campus, friends-only or
  -- chosen-people post never trends, nor do its tags or its likes lift its author among the accounts to follow.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'feed_posts' and column_name = 'audience') then
    v_post_ok := v_post_ok || ' and p.audience = ''global''';
  end if;
  if to_regprocedure('public.is_suspended(uuid)') is not null then
    v_post_ok := v_post_ok || ' and not public.is_suspended(p.author_id)';
    v_person_ok := 'not public.is_suspended(pr.id)';
  end if;

  -- The posts and reels in play, with their engagement: the newest 20,000 of the last 90 days.
  drop table if exists pg_temp.discover_candidates;
  execute format($sql$
    create temporary table discover_candidates on commit drop as
    select p.id, p.kind, p.author_id, p.university_id, p.created_at, p.hashtags,
      (select count(*) from public.post_likes l where l.target_type = 'post' and l.target_id = p.id) as likes,
      (select count(*) from public.post_comments c where c.target_type = 'post' and c.target_id = p.id) as comments,
      (select count(*) from public.post_views v where v.target_type = 'post' and v.target_id = p.id) as views
    from public.feed_posts p
    join public.profiles a on a.id = p.author_id
    where p.created_at > now() - interval '90 days'
      and a.role not in ('business_owner', 'business_staff')
      and %s
    order by p.created_at desc
    limit 20000
  $sql$, v_post_ok);

  -- Hot, as Reddit ranks it: each tenfold of engagement is worth 12.5 hours of freshness. A comment counts as two likes,
  -- a view a tenth of one.
  delete from public.discover_post_ranks;
  insert into public.discover_post_ranks (post_id, kind, university_id, score, rank)
  select id, kind, university_id, score, row_number() over (order by score desc, created_at desc, id)
  from (
    select c.id, c.kind, c.university_id, c.created_at,
      log(1 + c.likes + 2 * c.comments + 0.1 * c.views) + extract(epoch from c.created_at) / 45000 as score
    from pg_temp.discover_candidates c
  ) s;
  get diagnostics v_posts = row_count;

  -- Trending: each use of a tag counts for less every 3 days (e-folding) and for more the more its post is liked; the
  -- sum is multiplied by the square root of how many different people use the tag, so one account cannot make a trend.
  delete from public.discover_topic_ranks;
  insert into public.discover_topic_ranks (tag, posts, authors, score, rank, last_used_at)
  select tag, posts, authors, score, row_number() over (order by score desc, last_used_at desc, tag), last_used_at
  from (
    select t.tag, count(*)::integer as posts, count(distinct c.author_id)::integer as authors, max(c.created_at) as last_used_at,
      sum((1 + log(1 + c.likes + 2 * c.comments)) * exp(-extract(epoch from now() - c.created_at) / 259200.0)) * sqrt(count(distinct c.author_id)) as score
    from pg_temp.discover_candidates c
    cross join lateral unnest(c.hashtags) as t(tag)
    group by t.tag
    order by score desc
    limit 10000
  ) s;
  get diagnostics v_topics = row_count;

  -- Accounts to follow: students with followers, with a post in 90 days, or new (the newest 200, so a young campus still
  -- has people to show). Followers count most, then new followers, then engagement on their last 30 days of posts.
  delete from public.discover_account_ranks;
  execute format($sql$
    insert into public.discover_account_ranks (user_id, university_id, followers, score, rank)
    select id, university_id, followers, score, row_number() over (order by score desc, created_at desc, id)
    from (
      select pr.id, pr.university_id, pr.created_at, coalesce(f.followers, 0)::integer as followers,
        2 * log(1 + coalesce(f.followers, 0)) + 3 * log(1 + coalesce(f.recent, 0)) + log(1 + coalesce(e.engagement, 0)) + 0.5 * log(1 + coalesce(e.posts, 0)) as score
      from public.profiles pr
      left join (
        select followee_id, count(*) as followers, count(*) filter (where created_at > now() - interval '30 days') as recent
        from public.follows group by followee_id
      ) f on f.followee_id = pr.id
      left join (
        select author_id, count(*) as posts, sum(likes + 2 * comments) as engagement
        from pg_temp.discover_candidates where created_at > now() - interval '30 days' group by author_id
      ) e on e.author_id = pr.id
      where pr.role not in ('business_owner', 'business_staff')
        and %s
        and (f.followee_id is not null
          or exists (select 1 from pg_temp.discover_candidates c where c.author_id = pr.id)
          or pr.id in (select n.id from public.profiles n order by n.created_at desc limit 200))
      order by score desc, pr.created_at desc
      limit 5000
    ) s
  $sql$, v_person_ok);
  get diagnostics v_accounts = row_count;

  drop table if exists pg_temp.discover_candidates;
  return jsonb_build_object('posts', v_posts, 'topics', v_topics, 'accounts', v_accounts);
end;
$$;

revoke all on function public.discover_refresh() from public, anon, authenticated;

-- The rankings as they should be now, not in up to ten minutes.
select public.discover_refresh();

notify pgrst, 'reload schema';

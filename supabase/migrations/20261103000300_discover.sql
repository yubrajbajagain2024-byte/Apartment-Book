-- =============================================================================
-- UniBuzz - migration 44: Discover
-- The app's Discover tab (Instagram's search tab): find people, topics and posts
-- on every campus, and, with an empty search box, see what is popular across
-- all of them: trending posts and reels, trending topics, accounts to follow.
--
--   * feed_posts.hashtags: a post's #tags, lowercased, exactly the words the
--     apps colour as tags (captionParts in packages/shared/src/format.ts). A
--     generated column, so Postgres keeps it for every insert and edit, and a
--     GIN index behind topic pages. Posts get a word index for search too.
--   * The ranking is worked out every 10 minutes by discover_refresh() (pg_cron)
--     into three small tables, so a read is a short scan however busy the app
--     gets: discover_post_ranks (posts and reels of the last 90 days: likes,
--     comments and views against age, Reddit's "hot"), discover_topic_ranks
--     (every tag of those posts; trending = recent use, weighted by engagement
--     and by how many different people use it) and discover_account_ranks
--     (students, by followers, new followers and engagement on recent posts).
--   * Every reader runs as the caller (security invoker) and joins the live
--     rows, so the rules already on feed_posts and profiles decide what each
--     person sees: blocks either way, posts hidden by moderators, suspended
--     authors, business sessions. Nothing here is a second copy of those rules.
--     Signed-out visitors may read Discover, as they may read the posts.
--
-- Additive only: no existing column, row or rule changes. The apps fall back to
-- newest-first lists on a database without this migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Hashtags and post search
-- -----------------------------------------------------------------------------
-- The #tags of a text, lowercased, each once, sorted: a # at the start or after
-- anything but a letter, digit, "_" or "#", then 1 to 60 letters, digits or "_",
-- the apps' rule (captionParts), so "#a#b" is the one tag "a".
create or replace function public.extract_hashtags(p_body text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.tag order by t.tag), '{}'::text[])
  from (
    select lower(m[1]) as tag
    from regexp_matches(coalesce(p_body, ''), '(?:^|[^[:alnum:]_#])#([[:alnum:]_]{1,60})', 'g') as m
  ) t;
$$;
-- Every insert or edit of a post works out its tags, whoever makes it.
grant execute on function public.extract_hashtags(text) to anon, authenticated, service_role;

alter table public.feed_posts add column if not exists hashtags text[] generated always as (public.extract_hashtags(body)) stored;
create index if not exists feed_posts_hashtags_idx on public.feed_posts using gin (hashtags);
-- Whole words or the start of one, in any language: the simple configuration has no stemming and no stop words.
create index if not exists feed_posts_body_search_idx on public.feed_posts using gin (to_tsvector('simple', body));
-- The refresh reads the last 90 days of posts, both kinds together.
create index if not exists feed_posts_created_idx on public.feed_posts (created_at desc);

-- -----------------------------------------------------------------------------
-- 2. The rankings, rebuilt by discover_refresh()
-- -----------------------------------------------------------------------------
create table if not exists public.discover_post_ranks (
  post_id uuid primary key references public.feed_posts (id) on delete cascade,
  kind text not null,
  university_id uuid,
  score double precision not null,
  rank integer not null
);
create index if not exists discover_post_ranks_rank_idx on public.discover_post_ranks (rank);
create index if not exists discover_post_ranks_campus_idx on public.discover_post_ranks (university_id, rank);

create table if not exists public.discover_topic_ranks (
  tag text primary key,
  posts integer not null,
  authors integer not null,
  score double precision not null,
  rank integer not null,
  last_used_at timestamptz not null
);
create index if not exists discover_topic_ranks_rank_idx on public.discover_topic_ranks (rank);
create index if not exists discover_topic_ranks_prefix_idx on public.discover_topic_ranks (tag text_pattern_ops);

create table if not exists public.discover_account_ranks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  university_id uuid,
  followers integer not null,
  score double precision not null,
  rank integer not null
);
create index if not exists discover_account_ranks_rank_idx on public.discover_account_ranks (rank);
create index if not exists discover_account_ranks_campus_idx on public.discover_account_ranks (university_id, rank);

-- Scores of public things: anyone may read them (the readers below join the live rows), nobody may write them, and a
-- business session sees none, as it sees no student posts.
do $$
declare
  t text;
begin
  foreach t in array array['discover_post_ranks', 'discover_topic_ranks', 'discover_account_ranks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_no_business_session', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using ((select public.student_side_ok()))', t || '_no_business_session', t);
  end loop;
end $$;

-- Rebuilds the three rankings. Every 10 minutes (pg_cron, below); returns how many rows each got, for
-- cron.job_run_details. Moderation came to production from CampConnect Admin (supabase/applied-outside-repo): where its
-- hidden_at column and is_suspended() exist, hidden posts and suspended accounts are left out here as well as by the
-- rules every read goes through.
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

-- -----------------------------------------------------------------------------
-- 3. Readers (as the caller: the rules on feed_posts and profiles apply)
-- -----------------------------------------------------------------------------
-- Discover's grid: posts and reels from every campus (or one), hottest first.
create or replace function public.discover_feed(p_university_id uuid default null, p_limit integer default 24, p_offset integer default 0)
returns table (post_id uuid, kind text)
language sql
stable
security invoker
set search_path = public
as $$
  select r.post_id, r.kind
  from public.discover_post_ranks r
  join public.feed_posts p on p.id = r.post_id
  where p_university_id is null or r.university_id = p_university_id
  order by r.rank
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Accounts to follow, from every campus (or one): never you, someone you follow, someone either of you blocked, or a
-- business. What a profile row shows, plus the university's name and the follower count.
create or replace function public.discover_accounts(p_university_id uuid default null, p_limit integer default 20, p_offset integer default 0)
returns table (id uuid, full_name text, avatar_url text, email_domain text, university_name text, followers integer)
language sql
stable
security invoker
set search_path = public
as $$
  select pr.id, pr.full_name, pr.avatar_url, u.email_domain, u.name, r.followers
  from public.discover_account_ranks r
  join public.profiles pr on pr.id = r.user_id
  left join public.universities u on u.id = pr.university_id
  where (p_university_id is null or r.university_id = p_university_id)
    and pr.id is distinct from auth.uid()
    and pr.role not in ('business_owner', 'business_staff')
    and not public.is_blocked_either_way(pr.id)
    and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = pr.id)
  order by r.rank
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Trending topics, everywhere.
create or replace function public.discover_topics(p_limit integer default 12)
returns table (tag text, posts integer)
language sql
stable
security invoker
set search_path = public
as $$
  select r.tag, r.posts
  from public.discover_topic_ranks r
  order by r.rank
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

-- Topics starting with what was typed ("#" and anything but letters, digits and "_" ignored), the exact one first.
create or replace function public.discover_search_topics(p_q text, p_limit integer default 10)
returns table (tag text, posts integer)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (select lower(regexp_replace(coalesce(p_q, ''), '[^[:alnum:]_]', '', 'g')) as v)
  select r.tag, r.posts
  from public.discover_topic_ranks r, q
  where q.v <> '' and r.tag like replace(q.v, '_', '\_') || '%'
  order by (r.tag = q.v) desc, r.rank
  limit least(greatest(coalesce(p_limit, 10), 1), 30);
$$;

-- A topic page's header: the tag as stored (without "#", lowercased) and how many posts the caller can see carry it.
create or replace function public.discover_topic(p_tag text)
returns table (tag text, posts bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (select lower(regexp_replace(btrim(coalesce(p_tag, '')), '^#+', '')) as v)
  select q.v, (select count(*) from public.feed_posts p where p.hashtags @> array[q.v])
  from q
  where q.v <> '';
$$;

-- A topic page's grid: its posts and reels, hottest first ('top') or newest first ('recent'). Posts older than the
-- rankings' 90 days follow the ranked ones, newest first.
create or replace function public.discover_topic_posts(p_tag text, p_order text default 'top', p_limit integer default 24, p_offset integer default 0)
returns table (post_id uuid, kind text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.kind
  from public.feed_posts p
  left join public.discover_post_ranks r on r.post_id = p.id
  where p.hashtags @> array[lower(regexp_replace(btrim(coalesce(p_tag, '')), '^#+', ''))]
  order by case when p_order = 'recent' then null else r.score end desc nulls last, p.created_at desc, p.id
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Posts whose words start with every word typed (up to 8), hottest first among the newest 1,000 that match.
create or replace function public.discover_search_posts(p_q text, p_limit integer default 24, p_offset integer default 0)
returns table (post_id uuid, kind text)
language sql
stable
security invoker
set search_path = public
as $$
  with words as (
    select string_agg(w || ':*', ' & ') as query
    from (select w from regexp_split_to_table(lower(coalesce(p_q, '')), '[^[:alnum:]]+') as w where w <> '' limit 8) x
  ), hits as (
    select p.id, p.kind, p.created_at
    from public.feed_posts p, words
    where words.query is not null and to_tsvector('simple', p.body) @@ to_tsquery('simple', words.query)
    order by p.created_at desc
    limit 1000
  )
  select h.id, h.kind
  from hits h
  left join public.discover_post_ranks r on r.post_id = h.id
  order by r.score desc nulls last, h.created_at desc, h.id
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'discover_feed(uuid, integer, integer)', 'discover_accounts(uuid, integer, integer)', 'discover_topics(integer)',
    'discover_search_topics(text, integer)', 'discover_topic(text)', 'discover_topic_posts(text, text, integer, integer)',
    'discover_search_posts(text, integer, integer)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Every 10 minutes where pg_cron is installed (Supabase: Database → Extensions → pg_cron). Without it, run
--    `select public.discover_refresh()` every few minutes some other way. Filled once now, so Discover opens ranked.
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available: run public.discover_refresh() every few minutes another way (%).', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'discover-refresh';
    perform cron.schedule('discover-refresh', '*/10 * * * *', 'select public.discover_refresh()');
  end if;
end $$;

select public.discover_refresh();

notify pgrst, 'reload schema';

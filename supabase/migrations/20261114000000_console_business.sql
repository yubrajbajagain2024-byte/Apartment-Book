-- =============================================================================
-- UniBuzz - migration 62: the staff console's Analytics and Business sections (CampConnect Admin on the website)
-- Follows 20261110000000_business_hours.sql (57). Needs 39 (businesses, payments), 41 (the staff console's checks and
-- audit log), 49 and 56 (the business audit log and team notices) and 50 (ads, events): db:setup applies them first,
-- in file order. Rollback: supabase/rollbacks/20261114000000_console_business.down.sql. Safe to run more than once.
--
--   * Who may call: every console_analytics_* function asks what every admin-only console function asks
--     (ts_require_admin: an admin of the staff, not suspended, in a session signed in with a second factor on an
--     account that still has one). Moderators and everyone else get 'not found', staff without the second factor
--     'mfa_required'. The Business functions also need the UniBuzz admin role on the account (profiles.role, set by
--     grant_role()), because the console reuses Business v2's review functions (approve, reject, pause and resume an
--     ad, review and verify a business, students' reports) and those ask is_admin(). A staff admin without the role is
--     told so ('forbidden').
--   * Analytics (numbers only: no function here returns who did anything):
--       console_analytics_overview  students and sign-ups, active students, engagement per day, campuses, the last hour
--       console_analytics_ads       impressions, reach, clicks, saves and inquiries of ads; placements; top ads; review
--       console_analytics_revenue   payments booked and voided, revenue earned day by day, by placement, category and
--                                   business; the review pipeline
--     Days are Central time days (America/Chicago, where UniBuzz's campuses are), ranges 1 to 365 days ending today.
--     Buzz counts as numbers of buzzes and replies, never as people: the anonymity firewall of migration 41 stays.
--   * Active students: user_activity (migration 23) keeps one time per student, and only for those who show their
--     activity status, so its history cannot be rebuilt. platform_activity_snapshot() keeps a count per campus and day
--     (platform_activity_daily: dau, wau, mau; numbers, never who), every 15 minutes with pg_cron where it is
--     installed. "Engaged" students are counted from what they wrote (posts, reels, comments, likes, messages,
--     follows, listings, items), which needs no new record at all.
--   * Business management, on top of Business v2 (none of its rules change):
--       console_business_overview, console_businesses, console_business     the advertisers and their accounts
--       console_add_business_note                                          the team's internal notes (never shown
--                                                                          to the business)
--       console_ads, console_ad                                            every campaign, with its money, quote,
--                                                                          numbers, problems and history
--       console_create_ad                                                  a draft prepared for a business: it
--                                                                          stays the business's to submit, because
--                                                                          spending is its owner's or admins' call
--       console_update_ad_terms                                            dates and budget of an ad in review,
--                                                                          scheduled, running or paused, with a
--                                                                          reason the business reads; payments
--                                                                          already recorded are never rewritten
--       console_record_ad_payment, console_void_ad_payment                 a further payment for an approved ad (for
--                                                                          the rest of it), and voiding one (the ad
--                                                                          ends when no payment is left)
--       console_payments                                                   the ledger, across businesses
--       console_ad_rates, console_set_ad_rate                              the rate card: a daily price per campus
--                                                                          for each placement, and a minimum
--     Approving an ad still records its payment through admin_approve_ad (migration 56): the rate card only suggests
--     the amount (console_ad_quote). There is still no payment provider.
--   * Records: what the business may read (an ad drafted, rescheduled, a payment recorded or voided) goes to its
--     business_audit_log and notifications, as Business v2's own reviews do (without the reviewer's name, migration
--     56); what is the team's alone (notes, rate changes, the note on a further payment) goes to the team's own log:
--     CampConnect Admin's staff_audit_log where it exists, the staff console's audit_log otherwise (console_audit). Buzz is counted by when students could see it, never by when it was written.
--   * New tables (ad_rates, business_admin_notes, platform_activity_daily) have row-level security on and no grants:
--     only these functions read or write them.
--
-- Errors: 'ts:<code>:<message>' (migration 41's convention). Times in JSON are epoch milliseconds, keys camelCase,
-- money in cents (US dollars unless a currency is named).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helpers
-- -----------------------------------------------------------------------------
-- The UniBuzz admin who runs businesses and ads: an admin of the staff with a second factor (ts_require_admin) who also
-- has the admin role that Business v2's own functions ask for.
create or replace function public.console_require_business_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.ts_require_admin();
  if public.role_of(auth.uid()) is distinct from 'admin' then
    perform public.ts_fail('forbidden', 'Business tools also need the UniBuzz admin role on your account. The database owner grants it with grant_role().');
  end if;
end;
$$;

-- The day boundaries the console counts by.
create or replace function public.console_tz()
returns text
language sql
immutable
as $$
  select 'America/Chicago'::text;
$$;

create or replace function public.console_day_start(p_day date)
returns timestamptz
language sql
stable
as $$
  select (p_day::timestamp at time zone public.console_tz());
$$;

create or replace function public.console_day_series(p_from date, p_to date)
returns table (day date)
language sql
stable
as $$
  select d::date from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d;
$$;

create or replace function public.console_days(p_days integer)
returns integer
language sql
immutable
as $$
  select least(greatest(coalesce(p_days, 30), 1), 365);
$$;

-- A search box's text as an ILIKE pattern that matches it literally anywhere; null when empty.
create or replace function public.console_like(p text)
returns text
language sql
immutable
as $$
  select case when nullif(btrim(coalesce(p, '')), '') is null then null
    else '%' || replace(replace(replace(left(btrim(p), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
$$;

-- { id, name } of a campus, or 'not found'.
create or replace function public.console_campus_json(p_university uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_university is null then
    return null;
  end if;
  select jsonb_build_object('id', u.id, 'name', u.name) into v from public.universities u where u.id = p_university;
  if v is null then
    perform public.ts_fail('not_found', 'No such campus.');
  end if;
  return v;
end;
$$;

-- The team's own record of what it did here (notes, rate changes, the note on a further payment): CampConnect Admin's
-- log (staff_audit_log through staff_log(), applied to production outside this folder) where it exists, as
-- ts_role_of() takes its staff list; the staff console's audit_log (migration 41) on a database built from this repo
-- alone. Never the business's log.
create or replace function public.console_audit(p_action text, p_target_type text, p_target_id text, p_note text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_details jsonb := case when jsonb_typeof(p_details) = 'object' then p_details else '{}'::jsonb end;
begin
  if to_regprocedure('public.staff_log(text,text,text,jsonb)') is not null then
    execute 'select public.staff_log($1, $2, $3, $4)'
      using p_action, p_target_type, p_target_id, v_details || case when p_note is null then '{}'::jsonb else jsonb_build_object('note', p_note) end;
  else
    perform public.ts_audit(auth.uid(), 'admin', p_action, p_target_type, p_target_id, null, null, null, p_note, v_details);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
-- The rate card: what a day of one placement costs on one campus, and the least an ad in it costs. No row = no price
-- set for that placement (the console then suggests none).
create table if not exists public.ad_rates (
  placement text primary key check (placement in ('for_you', 'reels', 'housing')),
  daily_cents integer not null check (daily_cents between 0 and 1000000),
  minimum_cents integer not null default 0 check (minimum_cents between 0 and 10000000),
  currency text not null default 'USD' check (currency = 'USD'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.ad_rates enable row level security;
revoke all on table public.ad_rates from public, anon, authenticated;

-- The UniBuzz team's notes about an advertiser (a call, a contract, a warning). Never shown to the business, never in
-- its audit log. Append-only from the API's side: the functions below only add.
create table if not exists public.business_admin_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 2 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists business_admin_notes_business_idx on public.business_admin_notes (business_id, created_at desc);
alter table public.business_admin_notes enable row level security;
revoke all on table public.business_admin_notes from public, anon, authenticated;

-- Active students per campus and Central-time day: numbers only. dau = active since the day began, wau and mau = in
-- the 7 and 30 days before the snapshot. Only students who show their activity status leave a time to count
-- (migration 23), so these are lower bounds.
create table if not exists public.platform_activity_daily (
  day date not null,
  university_id uuid not null references public.universities (id) on delete cascade,
  dau integer not null default 0 check (dau >= 0),
  wau integer not null default 0 check (wau >= 0),
  mau integer not null default 0 check (mau >= 0),
  recorded_at timestamptz not null default now(),
  primary key (day, university_id)
);
alter table public.platform_activity_daily enable row level security;
revoke all on table public.platform_activity_daily from public, anon, authenticated;

-- Counts every campus that has students, as of p_now. A day's dau only grows (a student hiding their status later
-- removes their time, not the count already taken).
create or replace function public.platform_activity_snapshot(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (p_now at time zone public.console_tz())::date;
  v_start timestamptz := public.console_day_start((p_now at time zone public.console_tz())::date);
  v_n integer;
begin
  insert into public.platform_activity_daily as s (day, university_id, dau, wau, mau, recorded_at)
  select v_day, p.university_id,
    count(a.user_id) filter (where a.last_active_at >= v_start and a.last_active_at <= p_now),
    count(a.user_id) filter (where a.last_active_at > p_now - interval '7 days' and a.last_active_at <= p_now),
    count(a.user_id) filter (where a.last_active_at > p_now - interval '30 days' and a.last_active_at <= p_now),
    p_now
  from public.profiles p
  join public.universities u on u.id = p.university_id
  left join public.user_activity a on a.user_id = p.id
  where p.role = 'student'
  group by p.university_id
  on conflict (day, university_id) do update
    set dau = greatest(s.dau, excluded.dau), wau = excluded.wau, mau = excluded.mau, recorded_at = excluded.recorded_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Analytics: the platform
-- -----------------------------------------------------------------------------
create or replace function public.console_analytics_overview(p_days integer default 30, p_university uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := public.console_tz();
  v_days integer;
  v_today date;
  v_first date;
  v_start timestamptz;
  v_prev_start timestamptz;
  v_today_start timestamptz;
  v_floor timestamptz;
  v_campus jsonb;
  v_base bigint;
  v_students bigint;
  v_signups bigint;
  v_signups_prev bigint;
  v_growth jsonb;
  v_eng_totals jsonb;
  v_eng_prev jsonb;
  v_eng_days jsonb;
  v_engaged jsonb;
  v_online bigint;
  v_dau bigint;
  v_wau bigint;
  v_mau bigint;
  v_dau_days jsonb;
  v_since date;
  v_campuses jsonb;
  v_last_hour jsonb;
  v_totals jsonb;
begin
  perform public.ts_require_admin();
  v_days := public.console_days(p_days);
  v_today := (now() at time zone v_tz)::date;
  v_first := v_today - (v_days - 1);
  v_start := public.console_day_start(v_first);
  v_prev_start := public.console_day_start(v_first - v_days);
  v_today_start := public.console_day_start(v_today);
  v_floor := least(v_prev_start, now() - interval '30 days');
  v_campus := public.console_campus_json(p_university);

  -- Every count of people below is of students (of the campus, when one is asked for): business accounts and the UniBuzz
  -- team are not the network's users. Each is an "in (select … from profiles)" the planner turns into a join.

  -- Students and sign-ups (accounts that exist today; a deleted account leaves no trace to count).
  select count(*) filter (where p.created_at < v_start), count(*), count(*) filter (where p.created_at >= v_start),
         count(*) filter (where p.created_at >= v_prev_start and p.created_at < v_start)
  into v_base, v_students, v_signups, v_signups_prev
  from public.profiles p
  where p.role = 'student' and (p_university is null or p.university_id = p_university);

  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(x.day, 'YYYY-MM-DD'), 'signups', x.n, 'total', x.total) order by x.day), '[]'::jsonb)
  into v_growth
  from (
    select d.day, coalesce(s.n, 0) as n, v_base + sum(coalesce(s.n, 0)) over (order by d.day) as total
    from public.console_day_series(v_first, v_today) d
    left join (
      select (p.created_at at time zone v_tz)::date as day, count(*) as n
      from public.profiles p
      where p.role = 'student' and p.created_at >= v_start and (p_university is null or p.university_id = p_university)
      group by 1
    ) s on s.day = d.day
  ) x;

  -- Engagement: what students wrote, by kind and day. Buzz is counted as content only (who is null), so no number
  -- here moves with one anonymous author.
  with ev as (
    select 'posts'::text as k, f.author_id as who, f.created_at as at from public.feed_posts f
      where f.kind = 'post' and f.created_at >= v_floor and f.author_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))
    union all
    select 'reels', f.author_id, f.created_at from public.feed_posts f
      where f.kind = 'reel' and f.created_at >= v_floor and f.author_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))
    union all
    select 'comments', c.user_id, c.created_at from public.post_comments c
      where c.created_at >= v_floor and c.user_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))
    union all
    select 'likes', l.user_id, l.created_at from public.post_likes l
      where l.created_at >= v_floor and l.user_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))
    union all
    select 'messages', m.sender_id, m.created_at from public.messages m
      where m.created_at >= v_floor and m.sender_id is not null and m.sender_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))
    union all
    select 'follows', f.follower_id, f.created_at from public.follows f
      where f.created_at >= v_floor and f.follower_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))
    union all
    select 'listings', a.owner_id, a.created_at from public.apartments a
      where a.created_at >= v_floor and a.owner_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))
    union all
    select 'items', i.seller_id, i.created_at from public.items i
      where i.created_at >= v_floor and i.seller_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))
    union all
    -- Buzz by when students could first see it (visible_at, after Buzz's publication delay) and only while it shows:
    -- its created_at is the real time and never leaves the database (migration 42), or a live count would date a buzz.
    select 'buzzes', null::uuid, b.visible_at from public.buzz_posts b
      where b.status = 'active' and b.visible_at <= now() and b.visible_at >= v_floor
        and (p_university is null or b.university_id = p_university)
    union all
    select 'buzzReplies', null::uuid, c.visible_at from public.buzz_comments c
      join public.buzz_posts b on b.id = c.post_id
      where c.status = 'active' and c.visible_at <= now() and c.visible_at >= v_floor
        and (p_university is null or b.university_id = p_university)
  ),
  tagged as (
    select ev.k, ev.who, ev.at, (ev.at at time zone v_tz)::date as day from ev
  ),
  keys as (
    select k from unnest(array['posts', 'reels', 'comments', 'likes', 'messages', 'follows', 'listings', 'items', 'buzzes', 'buzzReplies']) k
  ),
  per_day as (
    select t.day,
      count(*) filter (where t.k = 'posts') as posts, count(*) filter (where t.k = 'reels') as reels,
      count(*) filter (where t.k = 'comments') as comments, count(*) filter (where t.k = 'likes') as likes,
      count(*) filter (where t.k = 'messages') as messages, count(*) filter (where t.k = 'follows') as follows,
      count(*) filter (where t.k = 'buzzes') as buzzes, count(distinct t.who) as engaged
    from tagged t where t.day >= v_first group by t.day
  )
  select
    (select jsonb_object_agg(keys.k, (select count(*) from tagged t where t.k = keys.k and t.day >= v_first)) from keys),
    (select jsonb_object_agg(keys.k, (select count(*) from tagged t where t.k = keys.k and t.at >= v_prev_start and t.day < v_first)) from keys),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'day', to_char(d.day, 'YYYY-MM-DD'), 'posts', coalesce(p.posts, 0), 'reels', coalesce(p.reels, 0),
        'comments', coalesce(p.comments, 0), 'likes', coalesce(p.likes, 0), 'messages', coalesce(p.messages, 0),
        'follows', coalesce(p.follows, 0), 'buzzes', coalesce(p.buzzes, 0), 'engaged', coalesce(p.engaged, 0)) order by d.day), '[]'::jsonb)
     from public.console_day_series(v_first, v_today) d left join per_day p on p.day = d.day),
    jsonb_build_object(
      'today', (select count(distinct t.who) from tagged t where t.at >= v_today_start),
      'last7', (select count(distinct t.who) from tagged t where t.at > now() - interval '7 days'),
      'last30', (select count(distinct t.who) from tagged t where t.at > now() - interval '30 days'),
      'inRange', (select count(distinct t.who) from tagged t where t.day >= v_first),
      'inPrevRange', (select count(distinct t.who) from tagged t where t.at >= v_prev_start and t.day < v_first))
  into v_eng_totals, v_eng_prev, v_eng_days, v_engaged;

  -- Active (opened the app or the site), from the students who show their activity status.
  select count(*) filter (where a.last_active_at > now() - interval '15 minutes'),
         count(*) filter (where a.last_active_at >= v_today_start),
         count(*) filter (where a.last_active_at > now() - interval '7 days'),
         count(*) filter (where a.last_active_at > now() - interval '30 days')
  into v_online, v_dau, v_wau, v_mau
  from public.user_activity a
  where a.user_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university));

  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'dau', case when d.day = v_today then v_dau else x.dau end) order by d.day), '[]'::jsonb)
  into v_dau_days
  from public.console_day_series(v_first, v_today) d
  left join (
    select s.day, sum(s.dau)::bigint as dau from public.platform_activity_daily s
    where s.day >= v_first and (p_university is null or s.university_id = p_university)
    group by s.day
  ) x on x.day = d.day;
  select min(s.day) into v_since from public.platform_activity_daily s;

  if p_university is null then
    with st as (
      select p.university_id as u, count(*) as students, count(*) filter (where p.created_at >= v_start) as signups
      from public.profiles p where p.role = 'student' and p.university_id is not null group by 1
    ),
    act as (
      select p.university_id as u, count(*) as mau
      from public.user_activity a join public.profiles p on p.id = a.user_id
      where p.role = 'student' and a.last_active_at > now() - interval '30 days' group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', un.id, 'name', un.name, 'students', st.students, 'signups', st.signups, 'mau', coalesce(act.mau, 0))
             order by st.students desc, un.name), '[]'::jsonb)
    into v_campuses
    from st join public.universities un on un.id = st.u left join act on act.u = st.u;
  else
    v_campuses := '[]'::jsonb;
  end if;

  v_last_hour := jsonb_build_object(
    'signups', (select count(*) from public.profiles p where p.role = 'student' and p.created_at > now() - interval '1 hour'
                and (p_university is null or p.university_id = p_university)),
    'posts', (select count(*) from public.feed_posts f where f.created_at > now() - interval '1 hour' and f.author_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))),
    'messages', (select count(*) from public.messages m where m.created_at > now() - interval '1 hour' and m.sender_id is not null
                 and m.sender_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university))),
    'impressions', (select count(*) from public.business_events e where e.event = 'impression' and e.ad_id is not null
                    and e.created_at > now() - interval '1 hour' and (p_university is null or e.viewer_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university)))),
    'clicks', (select count(*) from public.business_events e where e.event = 'click' and e.ad_id is not null
               and e.created_at > now() - interval '1 hour' and (p_university is null or e.viewer_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university)))));

  v_totals := jsonb_build_object(
    'students', v_students,
    'businessAccounts', (select count(*) from public.profiles p where p.role in ('business_owner', 'business_staff')),
    'businesses', (select count(*) from public.businesses b where b.status = 'approved'
                   and (p_university is null or cardinality(b.university_ids) = 0 or p_university = any (b.university_ids))));

  return jsonb_build_object(
    'range', jsonb_build_object('days', v_days, 'from', to_char(v_first, 'YYYY-MM-DD'), 'to', to_char(v_today, 'YYYY-MM-DD')),
    'timeZone', v_tz,
    'generatedAt', public.ts_ms(now()),
    'campus', v_campus,
    'totals', v_totals,
    'growth', jsonb_build_object('signups', v_signups, 'signupsPrev', v_signups_prev, 'perDay', v_growth),
    'active', jsonb_build_object(
      'now', jsonb_build_object('online15m', v_online, 'dau', v_dau, 'wau', v_wau, 'mau', v_mau),
      'perDay', v_dau_days,
      'since', to_char(v_since, 'YYYY-MM-DD')),
    'engaged', v_engaged,
    'engagement', jsonb_build_object('totals', v_eng_totals, 'prev', v_eng_prev, 'perDay', v_eng_days),
    'campuses', v_campuses,
    'lastHour', v_last_hour);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Analytics: ads
-- -----------------------------------------------------------------------------
-- Ad events only (impressions, clicks, saves and inquiries that name an ad), except profile visits, which no ad
-- carries. A campus filter counts the students of that campus who saw or tapped.
create or replace function public.console_analytics_ads(p_days integer default 30, p_university uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := public.console_tz();
  v_days integer;
  v_today date;
  v_first date;
  v_start timestamptz;
  v_prev_start timestamptz;
  v_campus jsonb;
  v_cur jsonb;
  v_prev jsonb;
  v_per_day jsonb;
  v_placements jsonb;
  v_top jsonb;
  v_status jsonb;
  v_review jsonb;
begin
  perform public.ts_require_admin();
  v_days := public.console_days(p_days);
  v_today := (now() at time zone v_tz)::date;
  v_first := v_today - (v_days - 1);
  v_start := public.console_day_start(v_first);
  v_prev_start := public.console_day_start(v_first - v_days);
  v_campus := public.console_campus_json(p_university);

  with ev as (
    select e.event, e.ad_id, e.placement, e.viewer_id, e.created_at, (e.created_at at time zone v_tz)::date as day
    from public.business_events e
    where e.created_at >= v_prev_start and (p_university is null or e.viewer_id in (select st.id from public.profiles st where st.role = 'student' and (p_university is null or st.university_id = p_university)))
  ),
  sums as (
    select (e.created_at >= v_start) as cur,
      count(*) filter (where e.event = 'impression' and e.ad_id is not null) as impressions,
      count(distinct e.viewer_id) filter (where e.event = 'impression' and e.ad_id is not null) as reach,
      count(*) filter (where e.event = 'click' and e.ad_id is not null) as clicks,
      count(*) filter (where e.event = 'save' and e.ad_id is not null) as saves,
      count(*) filter (where e.event = 'inquiry' and e.ad_id is not null) as inquiries,
      count(*) filter (where e.event = 'profile_visit') as profile_visits
    from ev e group by 1
  ),
  per_day as (
    select e.day,
      count(*) filter (where e.event = 'impression') as impressions,
      count(distinct e.viewer_id) filter (where e.event = 'impression') as reach,
      count(*) filter (where e.event = 'click') as clicks
    from ev e where e.created_at >= v_start and e.ad_id is not null group by e.day
  ),
  by_placement as (
    select coalesce(e.placement, 'other') as placement,
      count(*) filter (where e.event = 'impression') as impressions, count(*) filter (where e.event = 'click') as clicks
    from ev e where e.created_at >= v_start and e.ad_id is not null group by 1
  ),
  by_ad as (
    select e.ad_id,
      count(*) filter (where e.event = 'impression') as impressions,
      count(distinct e.viewer_id) filter (where e.event = 'impression') as reach,
      count(*) filter (where e.event = 'click') as clicks
    from ev e where e.created_at >= v_start and e.ad_id is not null group by e.ad_id
  )
  select
    (select jsonb_build_object('impressions', coalesce(s.impressions, 0), 'reach', coalesce(s.reach, 0), 'clicks', coalesce(s.clicks, 0),
       'saves', coalesce(s.saves, 0), 'inquiries', coalesce(s.inquiries, 0), 'profileVisits', coalesce(s.profile_visits, 0))
     from (select true as cur) t left join sums s on s.cur = t.cur),
    (select jsonb_build_object('impressions', coalesce(s.impressions, 0), 'reach', coalesce(s.reach, 0), 'clicks', coalesce(s.clicks, 0),
       'saves', coalesce(s.saves, 0), 'inquiries', coalesce(s.inquiries, 0), 'profileVisits', coalesce(s.profile_visits, 0))
     from (select false as cur) t left join sums s on s.cur = t.cur),
    (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'impressions', coalesce(p.impressions, 0),
       'reach', coalesce(p.reach, 0), 'clicks', coalesce(p.clicks, 0)) order by d.day), '[]'::jsonb)
     from public.console_day_series(v_first, v_today) d left join per_day p on p.day = d.day),
    (select coalesce(jsonb_agg(jsonb_build_object('placement', b.placement, 'impressions', b.impressions, 'clicks', b.clicks)
       order by b.impressions desc, b.placement), '[]'::jsonb) from by_placement b),
    (select coalesce(jsonb_agg(x.j order by x.impressions desc, x.clicks desc), '[]'::jsonb) from (
       select jsonb_build_object('id', a.id, 'name', a.name, 'businessId', b.id, 'businessName', b.name,
         'status', public.ad_effective_status(a.status, a.starts_at, a.ends_at), 'placements', to_jsonb(a.placements),
         'impressions', s.impressions, 'reach', s.reach, 'clicks', s.clicks,
         'paidCents', (select coalesce(sum(p.amount_cents), 0) from public.listing_promotions p where p.ad_id = a.id and p.status = 'active'),
         'currency', a.currency) as j, s.impressions, s.clicks
       from by_ad s join public.ads a on a.id = s.ad_id join public.businesses b on b.id = a.business_id
       order by s.impressions desc, s.clicks desc limit 10) x)
  into v_cur, v_prev, v_per_day, v_placements, v_top;

  select jsonb_build_object(
      'draft', count(*) filter (where x.s = 'draft'), 'pending_review', count(*) filter (where x.s = 'pending_review'),
      'scheduled', count(*) filter (where x.s = 'scheduled'), 'active', count(*) filter (where x.s = 'active'),
      'paused', count(*) filter (where x.s = 'paused'), 'completed', count(*) filter (where x.s = 'completed'),
      'rejected', count(*) filter (where x.s = 'rejected'))
  into v_status
  from (
    select public.ad_effective_status(a.status, a.starts_at, a.ends_at) as s from public.ads a
    where p_university is null or cardinality(a.university_ids) = 0 or p_university = any (a.university_ids)
  ) x;

  select jsonb_build_object(
      'pending', (select count(*) from public.ads a where a.status = 'pending_review'),
      'oldestPendingAt', (select public.ts_ms(min(a.submitted_at)) from public.ads a where a.status = 'pending_review'),
      'decided', count(*),
      'medianHoursToDecision', round((percentile_cont(0.5) within group (order by extract(epoch from (a.reviewed_at - a.submitted_at)) / 3600))::numeric, 1))
  into v_review
  from public.ads a
  where a.reviewed_at >= v_start and a.submitted_at is not null and a.reviewed_at >= a.submitted_at;

  return jsonb_build_object(
    'range', jsonb_build_object('days', v_days, 'from', to_char(v_first, 'YYYY-MM-DD'), 'to', to_char(v_today, 'YYYY-MM-DD')),
    'timeZone', v_tz,
    'generatedAt', public.ts_ms(now()),
    'campus', v_campus,
    'totals', v_cur,
    'prev', v_prev,
    'perDay', v_per_day,
    'byPlacement', v_placements,
    'topAds', v_top,
    'adsByStatus', v_status,
    'review', v_review);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Analytics: revenue
-- -----------------------------------------------------------------------------
-- Revenue earned between two times: each payment in force spread evenly over the period it paid for (US dollars).
create or replace function public.console_recognized_cents(p_from timestamptz, p_to timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(sum(
      p.amount_cents * extract(epoch from (least(p.ends_at, p_to) - greatest(p.starts_at, p_from)))
      / nullif(extract(epoch from (p.ends_at - p.starts_at)), 0))), 0)::bigint
  from public.listing_promotions p
  where p.status = 'active' and p.currency = 'USD' and p.starts_at < p_to and p.ends_at > p_from;
$$;

-- Booked: payments recorded in the range (whatever happened to them later). Voided: payments cancelled in the range.
-- Earned: booked money spread over the days it paid for, payments in force only. All in US dollars; other currencies
-- are listed apart.
create or replace function public.console_analytics_revenue(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := public.console_tz();
  v_days integer;
  v_today date;
  v_first date;
  v_start timestamptz;
  v_prev_start timestamptz;
  v_totals jsonb;
  v_prev jsonb;
  v_per_day jsonb;
  v_placements jsonb;
  v_categories jsonb;
  v_businesses jsonb;
  v_other jsonb;
  v_pipeline jsonb;
begin
  perform public.ts_require_admin();
  v_days := public.console_days(p_days);
  v_today := (now() at time zone v_tz)::date;
  v_first := v_today - (v_days - 1);
  v_start := public.console_day_start(v_first);
  v_prev_start := public.console_day_start(v_first - v_days);

  select jsonb_build_object(
      'bookedCents', coalesce(sum(p.amount_cents) filter (where p.created_at >= v_start), 0),
      'payments', count(*) filter (where p.created_at >= v_start),
      'advertisers', count(distinct p.business_id) filter (where p.created_at >= v_start),
      'avgPaymentCents', coalesce(round(avg(p.amount_cents) filter (where p.created_at >= v_start)), 0),
      'voidedCents', (select coalesce(sum(v.amount_cents), 0) from public.listing_promotions v
                      where v.currency = 'USD' and v.status = 'cancelled' and v.cancelled_at >= v_start),
      'recognizedCents', public.console_recognized_cents(v_start, now())),
    jsonb_build_object(
      'bookedCents', coalesce(sum(p.amount_cents) filter (where p.created_at < v_start), 0),
      'payments', count(*) filter (where p.created_at < v_start),
      'voidedCents', (select coalesce(sum(v.amount_cents), 0) from public.listing_promotions v
                      where v.currency = 'USD' and v.status = 'cancelled' and v.cancelled_at >= v_prev_start and v.cancelled_at < v_start),
      'recognizedCents', public.console_recognized_cents(v_prev_start, v_start))
  into v_totals, v_prev
  from public.listing_promotions p
  where p.currency = 'USD' and p.created_at >= v_prev_start;
  v_totals := v_totals || jsonb_build_object('netCents', (v_totals ->> 'bookedCents')::bigint - (v_totals ->> 'voidedCents')::bigint,
    'activeAdvertisers', (select count(distinct a.business_id) from public.ads a where public.ad_effective_status(a.status, a.starts_at, a.ends_at) = 'active'));
  v_prev := v_prev || jsonb_build_object('netCents', (v_prev ->> 'bookedCents')::bigint - (v_prev ->> 'voidedCents')::bigint);

  with days as (
    select d.day, public.console_day_start(d.day) as s, least(public.console_day_start(d.day + 1), now()) as e
    from public.console_day_series(v_first, v_today) d
  ),
  booked as (
    select (p.created_at at time zone v_tz)::date as day, sum(p.amount_cents) as cents
    from public.listing_promotions p where p.currency = 'USD' and p.created_at >= v_start group by 1
  ),
  voided as (
    select (p.cancelled_at at time zone v_tz)::date as day, sum(p.amount_cents) as cents
    from public.listing_promotions p where p.currency = 'USD' and p.status = 'cancelled' and p.cancelled_at >= v_start group by 1
  ),
  earned as (
    select days.day, sum(p.amount_cents * extract(epoch from (least(p.ends_at, days.e) - greatest(p.starts_at, days.s)))
                         / nullif(extract(epoch from (p.ends_at - p.starts_at)), 0)) as cents
    from days join public.listing_promotions p
      on p.status = 'active' and p.currency = 'USD' and p.starts_at < days.e and p.ends_at > days.s
    group by days.day
  )
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(days.day, 'YYYY-MM-DD'), 'bookedCents', coalesce(b.cents, 0),
           'voidedCents', coalesce(v.cents, 0), 'recognizedCents', coalesce(round(r.cents), 0)) order by days.day), '[]'::jsonb)
  into v_per_day
  from days left join booked b on b.day = days.day left join voided v on v.day = days.day left join earned r on r.day = days.day;

  -- A payment for an ad in several placements counts a share in each; v1's promotions count as a listing or a post.
  select coalesce(jsonb_agg(jsonb_build_object('placement', x.k, 'bookedCents', round(x.c)) order by x.c desc, x.k), '[]'::jsonb)
  into v_placements
  from (
    select coalesce(pl.placement, case when p.apartment_id is not null then 'listing' when p.deal_id is not null then 'post' else 'other' end) as k,
      sum(p.amount_cents::numeric / greatest(coalesce(cardinality(a.placements), 0), 1)) as c
    from public.listing_promotions p
    left join public.ads a on a.id = p.ad_id
    left join lateral unnest(a.placements) as pl(placement) on true
    where p.currency = 'USD' and p.created_at >= v_start
    group by 1
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'bookedCents', x.c) order by x.c desc, x.category), '[]'::jsonb)
  into v_categories
  from (
    select coalesce(b.category, 'deleted') as category, sum(p.amount_cents) as c
    from public.listing_promotions p left join public.businesses b on b.id = p.business_id
    where p.currency = 'USD' and p.created_at >= v_start group by 1
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'bookedCents', x.c, 'payments', x.n) order by x.c desc, x.name), '[]'::jsonb)
  into v_businesses
  from (
    select b.id, b.name, sum(p.amount_cents) as c, count(*) as n
    from public.listing_promotions p join public.businesses b on b.id = p.business_id
    where p.currency = 'USD' and p.created_at >= v_start
    group by b.id, b.name order by sum(p.amount_cents) desc, b.name limit 10
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'bookedCents', x.c) order by x.currency), '[]'::jsonb)
  into v_other
  from (
    select p.currency, sum(p.amount_cents) as c from public.listing_promotions p
    where p.currency <> 'USD' and p.created_at >= v_start group by 1
  ) x;

  select jsonb_build_object('pendingAds', count(*), 'pendingBudgetCents', coalesce(sum(a.budget_cents) filter (where a.currency = 'USD'), 0))
  into v_pipeline
  from public.ads a where a.status = 'pending_review';

  return jsonb_build_object(
    'range', jsonb_build_object('days', v_days, 'from', to_char(v_first, 'YYYY-MM-DD'), 'to', to_char(v_today, 'YYYY-MM-DD')),
    'timeZone', v_tz,
    'generatedAt', public.ts_ms(now()),
    'currency', 'USD',
    'totals', v_totals,
    'prev', v_prev,
    'perDay', v_per_day,
    'byPlacement', v_placements,
    'byCategory', v_categories,
    'topBusinesses', v_businesses,
    'otherCurrencies', v_other,
    'pipeline', v_pipeline);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Pricing
-- -----------------------------------------------------------------------------
-- What the rate card says an ad costs: for each placement, its daily rate x the ad's days x its campuses (every
-- campus for v1's promotions), at least the highest minimum among them. Null cents when a placement has no rate, the
-- ad has no dates, or it is not in US dollars. (The helpers here take ids, not rows: a row type in a signature would
-- make Business v2's own rollback depend on this migration.)
create or replace function public.console_ad_quote(p_ad uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.ads;
  v_days integer;
  v_campuses integer;
  v_lines jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_total bigint := 0;
  v_min integer := 0;
  r record;
begin
  select * into a from public.ads where id = p_ad;
  if a.id is null or a.starts_at is null or a.ends_at is null or a.ends_at <= a.starts_at or a.currency <> 'USD' then
    return null;
  end if;
  v_days := greatest(ceil(extract(epoch from (a.ends_at - a.starts_at)) / 86400)::integer, 1);
  v_campuses := case when cardinality(a.university_ids) = 0 then (select count(*) from public.universities)::integer else cardinality(a.university_ids) end;
  for r in
    select p.placement, x.daily_cents, x.minimum_cents
    from unnest(a.placements) as p(placement) left join public.ad_rates x on x.placement = p.placement
    order by p.placement
  loop
    if r.daily_cents is null then
      v_missing := array_append(v_missing, r.placement);
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('placement', r.placement, 'dailyCents', r.daily_cents,
        'cents', r.daily_cents::bigint * v_days * v_campuses));
      v_total := v_total + r.daily_cents::bigint * v_days * v_campuses;
      v_min := greatest(v_min, r.minimum_cents);
    end if;
  end loop;
  return jsonb_build_object(
    'cents', case when cardinality(v_missing) = 0 and cardinality(a.placements) > 0 then greatest(v_total, v_min) end,
    'days', v_days, 'campuses', v_campuses, 'minimumCents', v_min, 'lines', v_lines, 'missing', to_jsonb(v_missing));
end;
$$;

create or replace function public.console_ad_rates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.console_require_business_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'placement', p.placement, 'dailyCents', r.daily_cents, 'minimumCents', r.minimum_cents, 'currency', coalesce(r.currency, 'USD'),
        'updatedAt', public.ts_ms(r.updated_at), 'updatedBy', (select pr.full_name from public.profiles pr where pr.id = r.updated_by))
      order by p.ord), '[]'::jsonb)
    from unnest(array['for_you', 'reels', 'housing']) with ordinality as p(placement, ord)
    left join public.ad_rates r on r.placement = p.placement
  );
end;
$$;

-- Sets a placement's rate (null daily price: no rate). Audited in the staff console's log; businesses never see it.
create or replace function public.console_set_ad_rate(p_placement text, p_daily_cents integer, p_minimum_cents integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_old jsonb;
begin
  perform public.console_require_business_admin();
  if p_placement is null or p_placement not in ('for_you', 'reels', 'housing') then
    perform public.ts_fail('validation_failed', 'Pick a placement: For You, Reels or Housing.');
  end if;
  if p_daily_cents is not null and (p_daily_cents < 0 or p_daily_cents > 1000000) then
    perform public.ts_fail('validation_failed', 'A daily rate is between $0 and $10,000.');
  end if;
  if coalesce(p_minimum_cents, 0) < 0 or coalesce(p_minimum_cents, 0) > 10000000 then
    perform public.ts_fail('validation_failed', 'A minimum is between $0 and $100,000.');
  end if;
  select jsonb_build_object('dailyCents', r.daily_cents, 'minimumCents', r.minimum_cents) into v_old from public.ad_rates r where r.placement = p_placement;
  if p_daily_cents is null then
    delete from public.ad_rates where placement = p_placement;
  else
    insert into public.ad_rates (placement, daily_cents, minimum_cents, updated_at, updated_by)
    values (p_placement, p_daily_cents, coalesce(p_minimum_cents, 0), now(), v_me)
    on conflict (placement) do update set daily_cents = excluded.daily_cents, minimum_cents = excluded.minimum_cents,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  end if;
  perform public.console_audit('ad_rate.set', 'ad_rate', p_placement, null,
    jsonb_build_object('from', v_old, 'to', case when p_daily_cents is null then null
      else jsonb_build_object('dailyCents', p_daily_cents, 'minimumCents', coalesce(p_minimum_cents, 0)) end));
  return public.console_ad_rates();
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Campaigns
-- -----------------------------------------------------------------------------
create or replace function public.console_payment_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'amountCents', p.amount_cents, 'currency', p.currency, 'reference', p.payment_reference, 'status', p.status,
    'startsAt', public.ts_ms(p.starts_at), 'endsAt', public.ts_ms(p.ends_at), 'createdAt', public.ts_ms(p.created_at),
    'cancelledAt', public.ts_ms(p.cancelled_at),
    'recordedBy', (select pr.full_name from public.profiles pr where pr.id = p.created_by),
    'subject', case when p.ad_id is not null then 'ad' when p.apartment_id is not null then 'listing' when p.deal_id is not null then 'post' else 'removed' end,
    'ad', (select jsonb_build_object('id', a.id, 'name', a.name) from public.ads a where a.id = p.ad_id),
    'business', (select jsonb_build_object('id', b.id, 'name', b.name) from public.businesses b where b.id = p.business_id))
  from public.listing_promotions p where p.id = p_id;
$$;

-- One ad as the console's lists show it.
create or replace function public.console_ad_row_json(p_ad uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'status', public.ad_effective_status(a.status, a.starts_at, a.ends_at), 'pausedBy', a.paused_by,
    'vertical', a.vertical, 'objective', a.objective, 'placements', to_jsonb(a.placements), 'universityIds', to_jsonb(a.university_ids),
    'startsAt', public.ts_ms(a.starts_at), 'endsAt', public.ts_ms(a.ends_at), 'budgetCents', a.budget_cents, 'currency', a.currency,
    'paidCents', (select coalesce(sum(p.amount_cents), 0) from public.listing_promotions p where p.ad_id = a.id and p.status = 'active'),
    'quote', public.console_ad_quote(a.id),
    'impressions', (select count(*) from public.business_events e where e.ad_id = a.id and e.event = 'impression'),
    'clicks', (select count(*) from public.business_events e where e.ad_id = a.id and e.event = 'click'),
    'openReports', (select count(*) from public.business_reports r where r.ad_id = a.id and r.status = 'open'),
    'fairHousingFlags', to_jsonb(a.fair_housing_flags),
    'submittedAt', public.ts_ms(a.submitted_at), 'createdAt', public.ts_ms(a.created_at),
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'status', b.status, 'category', b.category)
                 from public.businesses b where b.id = a.business_id))
  from public.ads a where a.id = p_ad;
$$;

-- Every ad, or those with one (displayed) status, of one business or matching a search (ad or business name, or the
-- first characters of the ad's id). Waiting for review first, oldest submission first; then newest.
create or replace function public.console_ads(
  p_status text default 'pending_review', p_q text default null, p_business uuid default null, p_limit integer default 30, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_like text := public.console_like(p_q);
  v_prefix text := lower(btrim(coalesce(p_q, '')));
  v_status text := coalesce(nullif(p_status, ''), 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rows uuid[];
  v_items jsonb;
  v_counts jsonb;
begin
  perform public.console_require_business_admin();
  if v_status not in ('all', 'draft', 'pending_review', 'scheduled', 'active', 'paused', 'completed', 'rejected') then
    perform public.ts_fail('validation_failed', 'Unknown status.');
  end if;
  v_rows := array(
    select a.id from public.ads a join public.businesses b on b.id = a.business_id
    where (p_business is null or a.business_id = p_business)
      and (v_like is null or a.name ilike v_like or b.name ilike v_like or (char_length(v_prefix) >= 4 and a.id::text like v_prefix || '%'))
      and (v_status = 'all' or public.ad_effective_status(a.status, a.starts_at, a.ends_at) = v_status)
    order by (a.status = 'pending_review') desc, case when a.status = 'pending_review' then a.submitted_at end asc nulls last, a.created_at desc, a.id
    limit v_limit + 1 offset v_offset
  );
  select coalesce(jsonb_agg(public.console_ad_row_json(v_rows[i]) order by i), '[]'::jsonb) into v_items
  from generate_subscripts(v_rows, 1) i where i <= v_limit;
  select jsonb_build_object('all', count(*),
      'draft', count(*) filter (where x.s = 'draft'), 'pending_review', count(*) filter (where x.s = 'pending_review'),
      'scheduled', count(*) filter (where x.s = 'scheduled'), 'active', count(*) filter (where x.s = 'active'),
      'paused', count(*) filter (where x.s = 'paused'), 'completed', count(*) filter (where x.s = 'completed'),
      'rejected', count(*) filter (where x.s = 'rejected'))
  into v_counts
  from (
    select public.ad_effective_status(a.status, a.starts_at, a.ends_at) as s
    from public.ads a join public.businesses b on b.id = a.business_id
    where (p_business is null or a.business_id = p_business)
      and (v_like is null or a.name ilike v_like or b.name ilike v_like or (char_length(v_prefix) >= 4 and a.id::text like v_prefix || '%'))
  ) x;
  return jsonb_build_object('items', v_items, 'nextOffset', case when coalesce(cardinality(v_rows), 0) > v_limit then v_offset + v_limit end, 'counts', v_counts);
end;
$$;

-- One ad in full: what students see, the money, the quote, its numbers, what still stops it, and its history.
create or replace function public.console_ad(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.ads;
begin
  perform public.console_require_business_admin();
  select * into a from public.ads where id = p_id;
  if a.id is null then
    perform public.ts_fail('not_found', 'No such ad.');
  end if;
  return public.console_ad_row_json(a.id) || jsonb_build_object(
    'headline', a.headline, 'caption', a.caption, 'media', a.media, 'cta', a.cta, 'ctaUrl', a.cta_url,
    'promoted', case
      when a.promoted_apartment_id is not null then jsonb_build_object('type', 'listing', 'id', a.promoted_apartment_id,
        'title', (select x.title from public.apartments x where x.id = a.promoted_apartment_id))
      when a.promoted_deal_id is not null then jsonb_build_object('type', 'post', 'id', a.promoted_deal_id,
        'title', (select d.title from public.deals d where d.id = a.promoted_deal_id))
      when a.promoted_snapshot is not null then jsonb_build_object('type', 'removed', 'id', null, 'title', a.promoted_snapshot ->> 'title')
    end,
    'statusReason', a.status_reason, 'reviewNote', a.review_note, 'needsReviewReason', a.needs_review_reason,
    'fairHousingCheckedAt', public.ts_ms(a.fair_housing_checked_at), 'reviewedAt', public.ts_ms(a.reviewed_at),
    'startedAt', public.ts_ms(a.started_at), 'completedAt', public.ts_ms(a.completed_at), 'updatedAt', public.ts_ms(a.updated_at),
    'draftedByTeam', exists (select 1 from public.business_audit_log l where l.business_id = a.business_id and l.target_id = a.id and l.action = 'ad_drafted_by_admin'),
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'status', b.status, 'category', b.category, 'logoUrl', b.logo_url,
                   'verified', b.verified_partner) from public.businesses b where b.id = a.business_id),
    'payments', (select coalesce(jsonb_agg(public.console_payment_json(p.id) order by p.created_at desc), '[]'::jsonb)
                 from public.listing_promotions p where p.ad_id = a.id),
    'stats', (select jsonb_build_object(
                'impressions', count(*) filter (where e.event = 'impression'),
                'reach', count(distinct e.viewer_id) filter (where e.event = 'impression'),
                'clicks', count(*) filter (where e.event = 'click'), 'saves', count(*) filter (where e.event = 'save'),
                'inquiries', count(*) filter (where e.event = 'inquiry'))
              from public.business_events e where e.ad_id = a.id),
    'problems', case when a.status in ('draft', 'pending_review', 'rejected') then to_jsonb(public.ad_problems(a.id)) else '[]'::jsonb end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'actorKind', l.actor_kind,
                   'actorName', case when l.actor_kind = 'system' then 'UniBuzz' else (select pr.full_name from public.profiles pr where pr.id = l.actor_id) end,
                   'detail', l.detail, 'createdAt', public.ts_ms(l.created_at)) order by l.id desc), '[]'::jsonb)
                from (select * from public.business_audit_log l where l.business_id = a.business_id and l.target_type = 'ad' and l.target_id = a.id
                      order by l.id desc limit 30) l));
end;
$$;

-- A draft prepared by the UniBuzz team for an approved business (a business that asked for help, or sent its copy by
-- email). Everything an ad's trigger checks is checked as for the business's own drafts; it has no photos of its own
-- (the business adds them, or it promotes one of the business's posts or listings). The owner and admins are told,
-- and it stays theirs to change and to submit.
create or replace function public.console_create_ad(p_business uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  b public.businesses;
  v_in jsonb := case when jsonb_typeof(p_input) = 'object' then p_input else '{}'::jsonb end;
  v_name text := btrim(coalesce(v_in ->> 'name', ''));
  v_objective text := coalesce(nullif(v_in ->> 'objective', ''), 'awareness');
  v_cta text := coalesce(nullif(v_in ->> 'cta', ''), 'learn_more');
  v_cta_url text := nullif(btrim(coalesce(v_in ->> 'ctaUrl', '')), '');
  v_headline text := nullif(btrim(coalesce(v_in ->> 'headline', '')), '');
  v_caption text := btrim(coalesce(v_in ->> 'caption', ''));
  v_note text := nullif(left(btrim(coalesce(v_in ->> 'note', '')), 1000), '');
  v_placements text[];
  v_campuses uuid[];
  v_deal uuid := public.ts_uuid(v_in ->> 'promotedDealId');
  v_apartment uuid := public.ts_uuid(v_in ->> 'promotedApartmentId');
  v_budget integer;
  v_starts timestamptz;
  v_ends timestamptz;
  v_id uuid;
begin
  perform public.console_require_business_admin();
  select * into b from public.businesses where id = p_business;
  if b.id is null then
    perform public.ts_fail('not_found', 'No such business.');
  end if;
  if b.status <> 'approved' then
    perform public.ts_fail('conflict', 'Only an approved business can run ads. Review the business first.');
  end if;
  if char_length(v_name) not between 2 and 80 then
    perform public.ts_fail('validation_failed', 'Name the ad (2 to 80 characters).');
  end if;
  if v_objective not in ('awareness', 'traffic', 'engagement', 'messages') then
    perform public.ts_fail('validation_failed', 'Pick an objective.');
  end if;
  if char_length(coalesce(v_headline, '')) > 80 or char_length(v_caption) > 2200 then
    perform public.ts_fail('validation_failed', 'The headline is 80 characters at most, the caption 2,200.');
  end if;
  if v_cta_url is not null and (char_length(v_cta_url) > 2000 or v_cta_url !~* '^https://') then
    perform public.ts_fail('validation_failed', 'The button''s link must start with https://.');
  end if;
  if jsonb_typeof(v_in -> 'placements') = 'array' then
    v_placements := array(select jsonb_array_elements_text(v_in -> 'placements'));
  else
    v_placements := '{}';
  end if;
  if jsonb_typeof(v_in -> 'universityIds') = 'array' then
    v_campuses := array(select public.ts_uuid(x) from jsonb_array_elements_text(v_in -> 'universityIds') x);
  else
    v_campuses := '{}';
  end if;
  if cardinality(v_campuses) = 0 or array_position(v_campuses, null) is not null then
    perform public.ts_fail('validation_failed', 'Choose at least one campus.');
  end if;
  begin
    v_budget := coalesce((v_in ->> 'budgetCents')::integer, 0);
    v_starts := public.ts_from_ms((v_in ->> 'startsAt')::bigint);
    v_ends := public.ts_from_ms((v_in ->> 'endsAt')::bigint);
  exception when others then
    perform public.ts_fail('validation_failed', 'Check the budget and the dates.');
  end;
  if v_budget < 0 or v_budget > 10000000 then
    perform public.ts_fail('validation_failed', 'A budget is between $0 and $100,000.');
  end if;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    perform public.ts_fail('validation_failed', 'The end comes after the start.');
  end if;
  if v_ends is not null and v_ends <= now() then
    perform public.ts_fail('validation_failed', 'The end must be in the future.');
  end if;
  begin
    insert into public.ads (business_id, created_by, name, objective, placements, university_ids, headline, caption, media, cta, cta_url,
      promoted_deal_id, promoted_apartment_id, budget_cents, currency, starts_at, ends_at)
    values (b.id, v_me, v_name, v_objective, v_placements, v_campuses, v_headline, v_caption, '[]'::jsonb, v_cta, v_cta_url,
      v_deal, v_apartment, v_budget, 'USD', v_starts, v_ends)
    returning id into v_id;
  exception
    when check_violation or invalid_parameter_value or insufficient_privilege or foreign_key_violation then
      perform public.ts_fail('validation_failed', sqlerrm);
  end;
  perform public.business_audit_write(b.id, 'admin', 'ad_drafted_by_admin', 'ad', v_id, jsonb_build_object('name', v_name, 'note', v_note));
  perform public.business_notify_team(b.id, 'ad', 'The UniBuzz team drafted an ad for you',
    coalesce(v_note, format('"%s" is in your Ads Manager as a draft. Check it, add photos if you like, and submit it when it is right.', v_name)),
    '/ads/' || v_id, jsonb_build_object('ad_id', v_id, 'status', 'draft'), array['owner', 'admin']);
  return public.console_ad(v_id);
end;
$$;

-- The dates and budget of an ad in review, scheduled, running or paused (a draft or a rejected ad is the business's to
-- edit). The reason is the business's to read. A scheduled or running ad starts, or waits, by its new start. Payments
-- already recorded keep the period they paid for: the ledger is never rewritten, so revenue already reported stays as
-- it was (more days for the same money is a make-good; a further payment pays for an extension). Nothing the ad shows
-- changes, so nothing goes back to review.
create or replace function public.console_update_ad_terms(
  p_ad uuid, p_starts_at bigint, p_ends_at bigint, p_budget_cents integer, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
  v_starts timestamptz;
  v_ends timestamptz;
  v_budget integer;
  v_status text;
begin
  perform public.console_require_business_admin();
  if v_reason is null or char_length(v_reason) < 5 then
    perform public.ts_fail('validation_failed', 'Say why the dates or budget change (the business reads it).');
  end if;
  select * into a from public.ads where id = p_ad for update;
  if a.id is null then
    perform public.ts_fail('not_found', 'No such ad.');
  end if;
  if a.status not in ('pending_review', 'scheduled', 'active', 'paused') or public.ad_effective_status(a.status, a.starts_at, a.ends_at) = 'completed' then
    perform public.ts_fail('conflict', 'Only an ad in review, scheduled, running or paused can be rescheduled here. A draft is the business''s to edit.');
  end if;
  v_starts := coalesce(public.ts_from_ms(p_starts_at), a.starts_at);
  v_ends := coalesce(public.ts_from_ms(p_ends_at), a.ends_at);
  v_budget := coalesce(p_budget_cents, a.budget_cents);
  if v_starts is null or v_ends is null then
    perform public.ts_fail('validation_failed', 'An ad needs a start and an end.');
  end if;
  if v_ends <= v_starts then
    perform public.ts_fail('validation_failed', 'The end comes after the start.');
  end if;
  if v_ends <= now() then
    perform public.ts_fail('validation_failed', 'The end must be in the future. To stop an ad now, pause it.');
  end if;
  if v_ends - v_starts > interval '366 days' then
    perform public.ts_fail('validation_failed', 'An ad runs for a year at most.');
  end if;
  if v_budget < 0 or v_budget > 10000000 then
    perform public.ts_fail('validation_failed', 'A budget is between $0 and $100,000.');
  end if;
  if v_starts = a.starts_at and v_ends = a.ends_at and v_budget = a.budget_cents then
    return public.console_ad(p_ad);
  end if;
  v_status := case when a.status in ('scheduled', 'active') then case when v_starts <= now() then 'active' else 'scheduled' end else a.status end;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads
  set starts_at = v_starts, ends_at = v_ends, budget_cents = v_budget, status = v_status,
      started_at = case when v_status = 'active' then coalesce(started_at, now()) else started_at end
  where id = p_ad;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'admin', 'ad_terms_changed', jsonb_build_object('reason', v_reason,
    'from', jsonb_build_object('starts_at', a.starts_at, 'ends_at', a.ends_at, 'budget_cents', a.budget_cents),
    'to', jsonb_build_object('starts_at', v_starts, 'ends_at', v_ends, 'budget_cents', v_budget)));
  perform public.business_notify_team(a.business_id, 'ad', 'The UniBuzz team updated your ad''s dates or budget', v_reason,
    '/ads/' || a.id, jsonb_build_object('ad_id', a.id, 'status', v_status), array['owner', 'admin', 'editor']);
  return public.console_ad(p_ad);
end;
$$;

-- A further payment for an approved ad (an extension, a second invoice), in the ad's currency, for a business in good
-- standing and an ad that can still run. An ad in review is paid when it is approved (admin_approve_ad). The payment
-- covers the rest of the ad, from when it is recorded (or the ad's start, if later) to its end, so the revenue it earns
-- is never spread over days already reported. The note is the team's: it goes to the staff console's audit log, never
-- to the business's.
create or replace function public.console_record_ad_payment(p_ad uuid, p_amount_cents integer, p_currency text, p_reference text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
  v_reference text := btrim(coalesce(p_reference, ''));
  v_currency text := upper(coalesce(nullif(btrim(p_currency), ''), 'USD'));
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_id uuid;
begin
  perform public.console_require_business_admin();
  select * into a from public.ads where id = p_ad for update;
  if a.id is null then
    perform public.ts_fail('not_found', 'No such ad.');
  end if;
  if a.status = 'pending_review' then
    perform public.ts_fail('conflict', 'An ad in review is paid when it is approved: approve it with its payment.');
  end if;
  if a.status not in ('scheduled', 'active', 'paused') or public.ad_effective_status(a.status, a.starts_at, a.ends_at) = 'completed' then
    perform public.ts_fail('conflict', 'Only an approved ad that has not ended takes a further payment.');
  end if;
  if not public.business_approved(a.business_id) then
    perform public.ts_fail('conflict', 'This business is not approved, so its ads cannot run: review the business first.');
  end if;
  -- The post or listing it promoted is gone: it stopped for good (migration 56) and cannot run again.
  if a.promoted_snapshot is not null and a.promoted_apartment_id is null and a.promoted_deal_id is null then
    perform public.ts_fail('conflict', 'What this ad promoted was removed, so it cannot run again.');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 10000000 then
    perform public.ts_fail('validation_failed', 'Enter the amount received (up to $100,000).');
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    perform public.ts_fail('validation_failed', 'A currency is three letters, like USD.');
  end if;
  if v_currency <> a.currency then
    perform public.ts_fail('validation_failed', format('This ad is paid in %s.', a.currency));
  end if;
  if char_length(v_reference) < 3 or char_length(v_reference) > 200 then
    perform public.ts_fail('validation_failed', 'Enter the payment reference (invoice or receipt number).');
  end if;
  insert into public.listing_promotions (business_id, apartment_id, deal_id, ad_id, starts_at, ends_at, amount_cents, currency, payment_reference, created_by)
  values (a.business_id, a.promoted_apartment_id, a.promoted_deal_id, a.id, greatest(a.starts_at, now()), a.ends_at, p_amount_cents, v_currency, v_reference, auth.uid())
  returning id into v_id;
  perform public.business_audit_write(a.business_id, 'admin', 'payment_recorded', 'payment', v_id,
    jsonb_build_object('ad_id', a.id, 'name', a.name, 'amount_cents', p_amount_cents, 'currency', v_currency, 'payment_reference', v_reference));
  perform public.console_audit('ad.payment_recorded', 'payment', v_id::text, v_note,
    jsonb_build_object('adId', a.id, 'businessId', a.business_id, 'amountCents', p_amount_cents, 'currency', v_currency, 'reference', v_reference));
  perform public.business_notify_team(a.business_id, 'ad', 'Payment recorded',
    format('A payment for "%s" is on record: %s.', a.name, v_reference), '/billing/' || v_id,
    jsonb_build_object('ad_id', a.id, 'payment_id', v_id), array['owner', 'admin', 'analyst']);
  return public.console_ad(p_ad);
end;
$$;

-- Voids a payment in force (refunded, or recorded by mistake), with a reason the business reads. An ad left with no
-- payment in force ends: "Sponsored" always means paid. A voided payment earns nothing, for any day (a void is a full
-- refund). The ad's row is locked before the payment's, in the order console_record_ad_payment takes them, so two
-- voids of one ad's payments, or a void and a further payment, see each other.
create or replace function public.console_void_ad_payment(p_payment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.listing_promotions;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 900), '');
  v_ended boolean := false;
begin
  perform public.console_require_business_admin();
  if v_reason is null or char_length(v_reason) < 5 then
    perform public.ts_fail('validation_failed', 'Say why the payment is voided (the business reads it).');
  end if;
  select * into p from public.listing_promotions where id = p_payment;
  if p.id is null then
    perform public.ts_fail('not_found', 'No such payment.');
  end if;
  if p.ad_id is not null then
    perform 1 from public.ads where id = p.ad_id for update;
  end if;
  select * into p from public.listing_promotions where id = p_payment for update;
  if p.status <> 'active' then
    perform public.ts_fail('conflict', 'This payment is already voided.');
  end if;
  update public.listing_promotions set status = 'cancelled', cancelled_at = now() where id = p.id;
  if p.ad_id is not null and not exists (select 1 from public.listing_promotions x where x.ad_id = p.ad_id and x.status = 'active') then
    perform set_config('app.ad_transition', 'on', true);
    update public.ads set status = 'completed', completed_at = now(), status_reason = 'The payment was voided: ' || v_reason
    where id = p.ad_id and status in ('pending_review', 'scheduled', 'active', 'paused');
    v_ended := found;
    perform set_config('app.ad_transition', '', true);
  end if;
  perform public.business_audit_write(p.business_id, 'admin', 'payment_voided', 'payment', p.id,
    jsonb_build_object('ad_id', p.ad_id, 'amount_cents', p.amount_cents, 'currency', p.currency, 'payment_reference', p.payment_reference,
      'reason', v_reason, 'ad_ended', v_ended));
  if p.business_id is not null then
    perform public.business_notify_team(p.business_id, 'ad', 'A payment was voided', v_reason, '/billing/' || p.id,
      jsonb_build_object('ad_id', p.ad_id, 'payment_id', p.id), array['owner', 'admin', 'analyst']);
  end if;
  return jsonb_build_object('payment', public.console_payment_json(p.id), 'adEnded', v_ended);
end;
$$;

-- The ledger across businesses, newest first: recorded in the last p_days (null: ever), in force or voided, matching a
-- business or ad name or a reference.
create or replace function public.console_payments(
  p_days integer default null, p_status text default null, p_q text default null, p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_like text := public.console_like(p_q);
  v_since timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rows uuid[];
  v_items jsonb;
  v_totals jsonb;
begin
  perform public.console_require_business_admin();
  if p_status is not null and p_status not in ('active', 'cancelled') then
    perform public.ts_fail('validation_failed', 'Unknown status.');
  end if;
  if p_days is not null then
    v_since := public.console_day_start((now() at time zone public.console_tz())::date - (public.console_days(p_days) - 1));
  end if;
  v_rows := array(
    select p.id from public.listing_promotions p
    left join public.businesses b on b.id = p.business_id
    left join public.ads a on a.id = p.ad_id
    where (v_since is null or p.created_at >= v_since) and (p_status is null or p.status = p_status)
      and (v_like is null or b.name ilike v_like or a.name ilike v_like or p.payment_reference ilike v_like)
    order by p.created_at desc, p.id
    limit v_limit + 1 offset v_offset
  );
  select coalesce(jsonb_agg(public.console_payment_json(v_rows[i]) order by i), '[]'::jsonb) into v_items
  from generate_subscripts(v_rows, 1) i where i <= v_limit;
  select jsonb_build_object('count', count(*),
      'bookedCents', coalesce(sum(p.amount_cents) filter (where p.currency = 'USD'), 0),
      'inForceCents', coalesce(sum(p.amount_cents) filter (where p.currency = 'USD' and p.status = 'active'), 0),
      'voidedCents', coalesce(sum(p.amount_cents) filter (where p.currency = 'USD' and p.status = 'cancelled'), 0))
  into v_totals
  from public.listing_promotions p
  left join public.businesses b on b.id = p.business_id
  left join public.ads a on a.id = p.ad_id
  where (v_since is null or p.created_at >= v_since) and (p_status is null or p.status = p_status)
    and (v_like is null or b.name ilike v_like or a.name ilike v_like or p.payment_reference ilike v_like);
  return jsonb_build_object('items', v_items, 'nextOffset', case when coalesce(cardinality(v_rows), 0) > v_limit then v_offset + v_limit end, 'totals', v_totals);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Advertisers
-- -----------------------------------------------------------------------------
-- What needs the team today, at a glance.
create or replace function public.console_business_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month timestamptz := public.console_day_start(date_trunc('month', (now() at time zone public.console_tz()))::date);
begin
  perform public.console_require_business_admin();
  return jsonb_build_object(
    'businesses', (select jsonb_build_object('pending', count(*) filter (where b.status = 'pending'),
        'pendingConfirmed', count(*) filter (where b.status = 'pending' and public.account_confirmed(b.owner_id)),
        'approved', count(*) filter (where b.status = 'approved'), 'rejected', count(*) filter (where b.status = 'rejected'),
        'suspended', count(*) filter (where b.status = 'suspended'), 'verified', count(*) filter (where b.verified_partner))
      from public.businesses b),
    'ads', (select jsonb_build_object('inReview', count(*) filter (where x.s = 'pending_review'), 'running', count(*) filter (where x.s = 'active'),
        'scheduled', count(*) filter (where x.s = 'scheduled'), 'pausedByTeam', count(*) filter (where x.s = 'paused' and x.paused_by = 'admin'),
        'oldestInReviewAt', public.ts_ms(min(x.submitted_at) filter (where x.s = 'pending_review')))
      from (select public.ad_effective_status(a.status, a.starts_at, a.ends_at) as s, a.paused_by, a.submitted_at from public.ads a) x),
    'reports', (select jsonb_build_object('open', count(*)) from public.business_reports r where r.status = 'open'),
    'revenue', jsonb_build_object(
      'monthToDateCents', (select coalesce(sum(p.amount_cents), 0) from public.listing_promotions p where p.currency = 'USD' and p.created_at >= v_month),
      'last30Cents', (select coalesce(sum(p.amount_cents), 0) from public.listing_promotions p where p.currency = 'USD' and p.created_at > now() - interval '30 days'),
      'earnedMonthToDateCents', public.console_recognized_cents(v_month, now())),
    'endingSoon', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'businessId', b.id, 'businessName', b.name,
        'endsAt', public.ts_ms(a.ends_at)) order by a.ends_at), '[]'::jsonb)
      from public.ads a join public.businesses b on b.id = a.business_id
      where a.status in ('scheduled', 'active') and a.ends_at > now() and a.ends_at <= now() + interval '3 days'),
    'generatedAt', public.ts_ms(now()));
end;
$$;

-- Every business (advertiser), or those with one standing, matching a search (business name, owner's name or email,
-- the first characters of the id). Waiting for review first, then newest.
create or replace function public.console_businesses(p_q text default null, p_status text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_like text := public.console_like(p_q);
  v_prefix text := lower(btrim(coalesce(p_q, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_n integer;
  v_counts jsonb;
begin
  perform public.console_require_business_admin();
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected', 'suspended') then
    perform public.ts_fail('validation_failed', 'Unknown standing.');
  end if;
  with page as (
    select b.*, p.full_name as owner_name, p.username as owner_username, u.email::text as owner_email
    from public.businesses b
    join public.profiles p on p.id = b.owner_id
    left join auth.users u on u.id = b.owner_id
    where (p_status is null or b.status = p_status)
      and (v_like is null or b.name ilike v_like or p.full_name ilike v_like or u.email::text ilike v_like
           or (char_length(v_prefix) >= 4 and b.id::text like v_prefix || '%'))
    order by case b.status when 'pending' then 0 else 1 end, b.created_at desc, b.id
    limit v_limit + 1 offset v_offset
  ),
  numbered as (select page.*, row_number() over (order by case page.status when 'pending' then 0 else 1 end, page.created_at desc, page.id) as n from page)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'name', x.name, 'category', x.category, 'status', x.status, 'verified', x.verified_partner, 'logoUrl', x.logo_url,
      'city', x.city, 'createdAt', public.ts_ms(x.created_at),
      'owner', jsonb_build_object('id', x.owner_id, 'name', x.owner_name, 'username', x.owner_username, 'email', x.owner_email,
        'confirmed', public.account_confirmed(x.owner_id)),
      'members', (select count(*) from public.business_members m where m.business_id = x.id),
      'adsRunning', (select count(*) from public.ads a where a.business_id = x.id and public.ad_effective_status(a.status, a.starts_at, a.ends_at) = 'active'),
      'adsInReview', (select count(*) from public.ads a where a.business_id = x.id and a.status = 'pending_review'),
      'paidCents', (select coalesce(sum(p.amount_cents), 0) from public.listing_promotions p where p.business_id = x.id and p.status = 'active' and p.currency = 'USD'),
      'openReports', (select count(*) from public.business_reports r where r.business_id = x.id and r.status = 'open'))
    order by x.n) filter (where x.n <= v_limit), '[]'::jsonb),
    count(*)
  into v_items, v_n
  from numbered x;
  select jsonb_build_object('all', count(*), 'pending', count(*) filter (where b.status = 'pending'),
      'approved', count(*) filter (where b.status = 'approved'), 'rejected', count(*) filter (where b.status = 'rejected'),
      'suspended', count(*) filter (where b.status = 'suspended'))
  into v_counts from public.businesses b;
  return jsonb_build_object('items', v_items, 'nextOffset', case when v_n > v_limit then v_offset + v_limit end, 'counts', v_counts);
end;
$$;

-- One advertiser in full: its profile and standing, the owner and team, its ads with their numbers, its payments, the
-- students' reports (never who reported), the team's notes and the latest of its audit log.
create or replace function public.console_business(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.businesses;
begin
  perform public.console_require_business_admin();
  select * into b from public.businesses where id = p_id;
  if b.id is null then
    perform public.ts_fail('not_found', 'No such business.');
  end if;
  return jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'category', b.category, 'description', b.description, 'website', b.website,
      'phone', b.phone, 'contactEmail', b.contact_email, 'address', b.address, 'city', b.city, 'logoUrl', b.logo_url,
      'universityIds', to_jsonb(b.university_ids), 'status', b.status, 'verified', b.verified_partner, 'verifiedAt', public.ts_ms(b.verified_at),
      'verificationNote', b.verification_note, 'reviewNote', b.review_note, 'reviewedAt', public.ts_ms(b.reviewed_at),
      'createdAt', public.ts_ms(b.created_at), 'updatedAt', public.ts_ms(b.updated_at)),
    'owner', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'username', p.username, 'email', u.email::text,
                'confirmed', public.account_confirmed(p.id))
              from public.profiles p left join auth.users u on u.id = p.id where p.id = b.owner_id),
    'team', (select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', p.full_name, 'username', p.username, 'email', u.email::text,
                'role', m.role, 'joinedAt', public.ts_ms(m.created_at)) order by case m.role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end, m.created_at), '[]'::jsonb)
             from public.business_members m join public.profiles p on p.id = m.user_id left join auth.users u on u.id = m.user_id
             where m.business_id = b.id),
    'pendingInvites', (select count(*) from public.business_invites i where i.business_id = b.id and i.accepted_at is null and i.expires_at > now()),
    'ads', (select coalesce(jsonb_agg(public.console_ad_row_json(a.id) order by a.created_at desc), '[]'::jsonb) from public.ads a where a.business_id = b.id),
    'payments', (select coalesce(jsonb_agg(public.console_payment_json(p.id) order by p.created_at desc), '[]'::jsonb)
                 from public.listing_promotions p where p.business_id = b.id),
    'reports', jsonb_build_object(
      'open', (select count(*) from public.business_reports r where r.business_id = b.id and r.status = 'open'),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status,
                   'adId', r.ad_id, 'dealId', r.deal_id, 'createdAt', public.ts_ms(r.created_at)) order by r.created_at desc), '[]'::jsonb)
                 from (select * from public.business_reports r where r.business_id = b.id order by r.created_at desc limit 10) r)),
    'stats30d', (select jsonb_build_object(
        'impressions', count(*) filter (where e.event = 'impression'), 'reach', count(distinct e.viewer_id) filter (where e.event = 'impression'),
        'clicks', count(*) filter (where e.event = 'click'), 'inquiries', count(*) filter (where e.event = 'inquiry'),
        'profileVisits', count(*) filter (where e.event = 'profile_visit'))
      from public.business_events e where e.business_id = b.id and e.created_at > now() - interval '30 days'),
    'totals', jsonb_build_object(
      'paidCents', (select coalesce(sum(p.amount_cents), 0) from public.listing_promotions p where p.business_id = b.id and p.status = 'active' and p.currency = 'USD'),
      'voidedCents', (select coalesce(sum(p.amount_cents), 0) from public.listing_promotions p where p.business_id = b.id and p.status = 'cancelled' and p.currency = 'USD'),
      'listings', (select count(*) from public.apartments a where a.business_id = b.id),
      'posts', (select count(*) from public.deals d where d.business_id = b.id)),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'authorName', p.full_name, 'createdAt', public.ts_ms(n.created_at))
                order by n.created_at desc), '[]'::jsonb)
              from public.business_admin_notes n left join public.profiles p on p.id = n.author_id where n.business_id = b.id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'actorKind', l.actor_kind,
                'actorName', case when l.actor_kind = 'system' then 'UniBuzz' else (select pr.full_name from public.profiles pr where pr.id = l.actor_id) end,
                'targetType', l.target_type, 'targetId', l.target_id, 'detail', l.detail, 'createdAt', public.ts_ms(l.created_at)) order by l.id desc), '[]'::jsonb)
              from (select * from public.business_audit_log l where l.business_id = b.id order by l.id desc limit 20) l));
end;
$$;

-- A note for the team's eyes only; returns the business's notes.
create or replace function public.console_add_business_note(p_business uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform public.console_require_business_admin();
  if not exists (select 1 from public.businesses b where b.id = p_business) then
    perform public.ts_fail('not_found', 'No such business.');
  end if;
  if char_length(v_body) < 2 or char_length(v_body) > 2000 then
    perform public.ts_fail('validation_failed', 'A note is 2 to 2,000 characters.');
  end if;
  insert into public.business_admin_notes (business_id, author_id, body) values (p_business, v_me, v_body) returning id into v_id;
  perform public.console_audit('business.note', 'business', p_business::text, null, jsonb_build_object('noteId', v_id));
  return (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'authorName', p.full_name, 'createdAt', public.ts_ms(n.created_at))
            order by n.created_at desc), '[]'::jsonb)
          from public.business_admin_notes n left join public.profiles p on p.id = n.author_id where n.business_id = p_business);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Every 15 minutes where pg_cron is installed (it is on production). The last run of each hour is at :59, so a
--    day's count is taken a minute before it ends. Without pg_cron, call platform_activity_snapshot() another way;
--    only the history of active students depends on it.
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available: run public.platform_activity_snapshot() every 15 minutes another way (%).', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'platform-activity';
    perform cron.schedule('platform-activity', '14,29,44,59 * * * *', 'select public.platform_activity_snapshot()');
  end if;
end $$;

-- Today's count from the start, so the chart has a first point.
select public.platform_activity_snapshot();

-- -----------------------------------------------------------------------------
-- 10. Who may call what
-- -----------------------------------------------------------------------------
-- Internal: the database's own functions only.
revoke all on function public.console_require_business_admin() from public, anon, authenticated;
revoke all on function public.console_campus_json(uuid) from public, anon, authenticated;
revoke all on function public.console_audit(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.platform_activity_snapshot(timestamptz) from public, anon, authenticated;
revoke all on function public.console_recognized_cents(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.console_ad_quote(uuid) from public, anon, authenticated;
revoke all on function public.console_payment_json(uuid) from public, anon, authenticated;
revoke all on function public.console_ad_row_json(uuid) from public, anon, authenticated;

-- The console: signed-in sessions only; each function checks the caller itself.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.console_analytics_overview(integer, uuid)', 'public.console_analytics_ads(integer, uuid)', 'public.console_analytics_revenue(integer)',
    'public.console_ad_rates()', 'public.console_set_ad_rate(text, integer, integer)',
    'public.console_ads(text, text, uuid, integer, integer)', 'public.console_ad(uuid)', 'public.console_create_ad(uuid, jsonb)',
    'public.console_update_ad_terms(uuid, bigint, bigint, integer, text)', 'public.console_record_ad_payment(uuid, integer, text, text, text)',
    'public.console_void_ad_payment(uuid, text)', 'public.console_payments(integer, text, text, integer, integer)',
    'public.console_business_overview()', 'public.console_businesses(text, text, integer, integer)', 'public.console_business(uuid)',
    'public.console_add_business_note(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- The pure helpers are the console's own too (an open console_day_series would let anyone ask for millions of rows).
revoke all on function public.console_tz() from public, anon, authenticated;
revoke all on function public.console_day_start(date) from public, anon, authenticated;
revoke all on function public.console_day_series(date, date) from public, anon, authenticated;
revoke all on function public.console_days(integer) from public, anon, authenticated;
revoke all on function public.console_like(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

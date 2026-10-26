-- =============================================================================
-- Migration 42: Buzz v2, UniVerse's anonymous Buzz (server/src/routes/buzz.ts, services/buzz/*), ported to the
-- database. Runs after migration 41 (20261103000000_trust_safety.sql) and calls its ts_* functions. Safe to re-run.
--
--   * The Buzz tables stay closed to the API (row-level security, no policies, no grants to anon / authenticated, never
--     in the realtime publication): everything goes through the functions below.
--       buzz_posts (threads) and buzz_comments (replies) gain UniVerse's columns: scope (Campus | Global, separate
--       feeds), status (active | held | hidden | removed | deleted: the moderation states, deletes are soft), locked,
--       auto_hide_immune, up/down and ELIGIBLE vote counts, support_link, prompt_id, deleted_at, and the reply depth.
--       New: buzz_polls (+ options, votes), buzz_hidden_threads, buzz_prompts (UniVerse's 60 Daily Campus Prompts),
--       buzz_milestones, buzz_gate (who accepted which version of the Buzz guidelines), buzz_notification_refs (which
--       buzz each anonymous notification is about, so deleting or removing it takes its notifications too).
--   * Existing data is converted in place, every run (each step only touches what still needs it): threads without a
--     campus become Global (they used to show everywhere), counts are recomputed from the votes (old votes count as
--     eligible), reply depths from the reply tree, "hide this person in this thread" rows aimed at the thread's own
--     author become hidden threads (that is what they did), and the old "Someone replied to your Buzz post"
--     notifications (they quoted the reply) become anonymous buzz_reply ones that quote only the recipient's own buzz.
--     Reports keep naming a reply 'buzz_comment', the type CampConnect Admin's report queue reads.
--   * CampConnect Admin (applied to production outside this repo, see supabase/applied-outside-repo) moderates Buzz too:
--       - Its hide and restore set and clear hidden_at. Buzz follows (buzz_v2_follow_hidden): a hidden item is removed
--         (out of every feed, a placeholder in its thread, still its author's), a restore brings back what it was. A
--         removal or an auto-hide here sets hidden_at in turn, so its hidden list and its restore see Buzz's too.
--       - Its suspensions stop Buzz writes: posts and replies through ts_posting_status() (migration 41), votes through
--         its own triggers, poll votes through the same trigger added here.
--   * ONE serializer (buzz_root_json / buzz_reply_json) builds every Buzz object field by field; nothing else ever turns
--     a Buzz row into JSON. No identity in any of it: the author appears only as a per-thread alias (emoji + "Anon Noun"
--     + colour from sha256(salt || thread || ':' || author), UniVerse's 64 nouns x 12 colours, a " 2" suffix on an
--     in-thread collision by order of first post), isOp and isMine. Times are the jittered publication time floored to
--     the minute. Held items never reach anyone but their author; hidden / removed / deleted ones reach others as
--     placeholders (no text, title, media or poll).
--   * Publication jitter stays: a thread shows a random 0-180 s after it was written, a reply 0-45 s, never before its
--     thread or the reply it answers; only the jittered time ever leaves the database, floored to the minute (also in
--     Hot ranking, cutoffs and notifications). So there is no realtime push on Buzz writes either.
--   * Clients (signed in, guidelines accepted): buzz_v2_feed, _meta, _thread, _replies, _vote, _poll_vote, _delete,
--     _hide_thread, _hide_author, _mine, _karma, _report, _share_snapshot; buzz_v2_gate / _accept_gate /
--     _posting_status work before acceptance. Writes come only from the website's moderated write API (service role):
--     buzz_v2_create, buzz_v2_reply (held content always gets a queue item). Trust & Safety reaches Buzz only through
--     buzz_v2_snapshot, buzz_v2_author_of (the ONLY way from a buzz to its author), buzz_v2_set_status (the write API's AI
--     second pass may also hide with it), buzz_v2_set_locked and buzz_v2_staff_context.
--   * No block filter and no public-graph input anywhere (blocking someone must not make their buzzes vanish), and
--     nothing here touches profiles, follows, posts or any public counter.
--   * Account deletion detaches (author -> null) and the alias stays the same: the row keeps its per-thread digest.
--   * The old functions (buzz_feed, buzz_get, buzz_comments_list, buzz_create, buzz_reply, buzz_vote, buzz_comment_vote,
--     buzz_delete, buzz_delete_comment, buzz_mute, buzz_unmute) keep their signatures and answer old app builds with
--     'buzz:update_required:Update UniBuzz to use the new Buzz.'
--   * Due polls are closed (and their authors told) when the author opens Buzz and every 10 minutes with pg_cron.
--
-- Errors: 'buzz:<code>:<message>' with BuzzErrorCode codes (packages/shared/src/buzz/types.ts). Whatever depends on who
-- owns something is the generic 'buzz:not_found:That buzz isn't available.' for everyone else.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Settings
-- -----------------------------------------------------------------------------
-- Campuses with fewer profiles than this are "small": the composer warns, and they are never named next to a buzz.
alter table public.buzz_secrets add column if not exists min_campus_named int not null default 50;

-- A short campus name for "Search Texas State buzz" and the Global feed's campus badge (display coalesce(short_name, name)).
alter table public.universities add column if not exists short_name text;
update public.universities set short_name = 'Texas State' where name = 'Texas State University' and short_name is null;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.buzz_prompts (
  id uuid primary key default gen_random_uuid(),
  idx int not null,
  text text not null,
  constraint buzz_prompts_idx_key unique (idx)
);
-- UniVerse's Daily Campus Prompts (server/src/db/seeds/03-buzz.ts), in order: today's is prompts[day % count].
insert into public.buzz_prompts (idx, text) values
  (0, 'What is the most underrated spot on campus?'),
  (1, 'Confess a study habit that should not work but does.'),
  (2, 'What did you think college would be like vs. what it is?'),
  (3, 'Best cheap meal within walking distance?'),
  (4, 'What class changed how you think?'),
  (5, 'One thing you wish you knew freshman year.'),
  (6, 'Where do you go when you need to be alone for an hour?'),
  (7, 'What is the pettiest reason you dropped a class?'),
  (8, 'Describe your roommate situation in five words.'),
  (9, 'What campus rule makes zero sense?'),
  (10, 'What is your unpopular opinion about the dining halls?'),
  (11, 'Which building is secretly the best to study in?'),
  (12, 'What small thing made your week?'),
  (13, 'How are you actually doing today?'),
  (14, 'What is a hobby you picked up here and kept?'),
  (15, 'What is the worst group project story you have?'),
  (16, 'Best place to cry on campus (asking for a friend)?'),
  (17, 'What is something you are proud of that nobody knows?'),
  (18, 'Overheard something wild on campus lately?'),
  (19, 'What is your go-to late-night snack?'),
  (20, 'Which professor habit is oddly charming?'),
  (21, 'What is the most chaotic thing that happened in one of your classes?'),
  (22, 'What would you tell your first-week self?'),
  (23, 'What is your walk-to-class soundtrack right now?'),
  (24, 'What do you do between back-to-back classes?'),
  (25, 'What is the best free thing on campus?'),
  (26, 'What is your most irrational campus fear?'),
  (27, 'How do you make friends after week 5?'),
  (28, 'What is a class you took for fun that was worth it?'),
  (29, 'What is your bus stop horror story?'),
  (30, 'What is the best thing about living where you live?'),
  (31, 'Which vending machine is the most reliable?'),
  (32, 'What do you miss about home this week?'),
  (33, 'What is the weirdest thing you have seen someone bring to a lecture?'),
  (34, 'What is your midterm-week coping mechanism?'),
  (35, 'Is it normal to feel behind? (asking honestly)'),
  (36, 'What is a campus tradition you did not get at first but love now?'),
  (37, 'What would you change about registration?'),
  (38, 'What is your unpopular library opinion?'),
  (39, 'What is the nicest thing a stranger did for you on campus?'),
  (40, 'Best place to watch a sunset near campus?'),
  (41, 'What is your go-to order at the closest coffee spot?'),
  (42, 'What are you looking forward to this semester?'),
  (43, 'What is your biggest campus pet peeve?'),
  (44, 'What is the most useful thing in your backpack?'),
  (45, 'What is a small win from this week?'),
  (46, 'What is a skill you learned purely from being broke?'),
  (47, 'What was your best campus job?'),
  (48, 'What would make the gym less terrifying?'),
  (49, 'What is your favorite corner of the union?'),
  (50, 'What is a myth about your major?'),
  (51, 'What is the best way to survive an 8am?'),
  (52, 'Where do you actually get work done?'),
  (53, 'What is your rainy-day campus routine?'),
  (54, 'What advice would you give an exchange student?'),
  (55, 'What is your worst laundry-room story?'),
  (56, 'What is something you changed your mind about this year?'),
  (57, 'What do you wish there were more of on campus?'),
  (58, 'How do you deal with homesickness?'),
  (59, 'What is your favorite campus sound?')
on conflict (idx) do update set text = excluded.text where public.buzz_prompts.text is distinct from excluded.text;

-- Threads.
alter table public.buzz_posts
  add column if not exists scope text not null default 'campus',
  add column if not exists status text not null default 'active',
  add column if not exists locked boolean not null default false,
  add column if not exists auto_hide_immune boolean not null default false,
  add column if not exists upvotes int not null default 0,
  add column if not exists downvotes int not null default 0,
  add column if not exists eligible_votes int not null default 0,
  add column if not exists eligible_score int not null default 0,
  add column if not exists support_link boolean not null default false,
  add column if not exists prompt_id uuid,
  add column if not exists deleted_at timestamptz,
  -- CampConnect Admin's reversible hide (its migration 15 adds the first two where it runs), and what the item was.
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_reason text,
  add column if not exists hidden_from_status text;
-- The stored alias is no longer an alias: old rows keep their "Student 12345" (it identifies a detached author inside
-- one thread), new rows store nothing, a detached row stores its frozen digest (section 5).
alter table public.buzz_posts alter column alias set default '';
alter table public.buzz_posts drop constraint if exists buzz_posts_scope_check;
alter table public.buzz_posts add constraint buzz_posts_scope_check check (scope in ('campus', 'global'));
alter table public.buzz_posts drop constraint if exists buzz_posts_status_check;
alter table public.buzz_posts add constraint buzz_posts_status_check check (status in ('active', 'held', 'hidden', 'removed', 'deleted'));
-- Titles are optional now (old rows had 3-160 characters; new ones are cut at 100 by buzz_v2_create, bodies at 500).
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.buzz_posts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%btrim(title)%'
  loop
    execute format('alter table public.buzz_posts drop constraint %I', r.conname);
  end loop;
end
$$;
alter table public.buzz_posts drop constraint if exists buzz_posts_title_length;
alter table public.buzz_posts add constraint buzz_posts_title_length check (char_length(title) <= 160);
alter table public.buzz_posts drop constraint if exists buzz_posts_prompt_id_fkey;
alter table public.buzz_posts add constraint buzz_posts_prompt_id_fkey foreign key (prompt_id) references public.buzz_prompts (id) on delete set null;
create index if not exists buzz_posts_scope_feed_idx on public.buzz_posts (scope, status, visible_at desc);
create index if not exists buzz_posts_campus_feed_idx on public.buzz_posts (university_id, scope, status, visible_at desc);
create index if not exists buzz_posts_author_idx on public.buzz_posts (author_id, created_at desc);

-- Replies.
alter table public.buzz_comments
  add column if not exists status text not null default 'active',
  add column if not exists auto_hide_immune boolean not null default false,
  add column if not exists upvotes int not null default 0,
  add column if not exists downvotes int not null default 0,
  add column if not exists eligible_votes int not null default 0,
  add column if not exists eligible_score int not null default 0,
  add column if not exists support_link boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists depth int not null default 1,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_reason text,
  add column if not exists hidden_from_status text;
alter table public.buzz_comments alter column alias set default '';
alter table public.buzz_comments drop constraint if exists buzz_comments_status_check;
alter table public.buzz_comments add constraint buzz_comments_status_check check (status in ('active', 'held', 'hidden', 'removed', 'deleted'));
create index if not exists buzz_comments_author_idx on public.buzz_comments (author_id, created_at desc);
create index if not exists buzz_comments_parent_idx on public.buzz_comments (parent_id);

-- Votes: does this one count toward the community thresholds (account a day old, allowed to post, trusted)?
alter table public.buzz_votes add column if not exists eligible boolean not null default true;
alter table public.buzz_comment_votes add column if not exists eligible boolean not null default true;

-- "Hide this anon in this thread". legacy = written by the old functions (converted in section 4).
alter table public.buzz_mutes add column if not exists legacy boolean not null default true;

-- Rate limits now cover votes too.
alter table public.buzz_rate_log drop constraint if exists buzz_rate_log_kind_check;
alter table public.buzz_rate_log add constraint buzz_rate_log_kind_check check (kind in ('thread', 'reply', 'vote'));

create table if not exists public.buzz_polls (
  post_id uuid primary key references public.buzz_posts (id) on delete cascade,
  -- Minute-aligned and counted from the jittered publication, so closesAt minus the duration says nothing finer.
  closes_at timestamptz not null,
  closed_notified boolean not null default false
);
create index if not exists buzz_polls_due_idx on public.buzz_polls (closes_at) where not closed_notified;

create table if not exists public.buzz_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.buzz_polls (post_id) on delete cascade,
  idx int not null,
  text text not null check (char_length(text) between 1 and 60),
  vote_count int not null default 0,
  constraint buzz_poll_options_post_idx_key unique (post_id, idx)
);

create table if not exists public.buzz_poll_votes (
  post_id uuid not null references public.buzz_polls (post_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  option_id uuid not null references public.buzz_poll_options (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.buzz_hidden_threads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  thread_id uuid not null references public.buzz_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

create table if not exists public.buzz_milestones (
  target_type text not null check (target_type in ('buzz', 'buzz_reply')),
  target_id uuid not null,
  milestone int not null,
  -- UTC days since 1970 (UniVerse keeps the day; nothing reads it back).
  day int not null,
  primary key (target_type, target_id, milestone)
);

create table if not exists public.buzz_gate (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now()
);

-- What each anonymous Buzz notification is about (its data says only the thread, to its recipient).
create table if not exists public.buzz_notification_refs (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  entity_type text not null check (entity_type in ('buzz', 'buzz_reply')),
  entity_id uuid not null,
  thread_id uuid not null
);
create index if not exists buzz_notification_refs_entity_idx on public.buzz_notification_refs (entity_type, entity_id);
create index if not exists buzz_notification_refs_thread_idx on public.buzz_notification_refs (thread_id);

-- Closed to the API, and never in the realtime publication (a change there would reach every subscriber, and its
-- timing would date the write).
do $$
declare
  t text;
begin
  foreach t in array array['buzz_posts', 'buzz_comments', 'buzz_votes', 'buzz_comment_votes', 'buzz_mutes', 'buzz_rate_log', 'buzz_secrets',
                           'buzz_prompts', 'buzz_polls', 'buzz_poll_options', 'buzz_poll_votes', 'buzz_hidden_threads', 'buzz_milestones',
                           'buzz_gate', 'buzz_notification_refs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
       and not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
  -- The replies' arrival counter: its current value would date every reply write to the moment.
  execute format('revoke all on sequence %s from public, anon, authenticated', pg_get_serial_sequence('public.buzz_comments', 'seq'));
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Small helpers
-- -----------------------------------------------------------------------------
-- The version of the Buzz guidelines everyone must accept before reading Buzz. Bump it here AND in
-- BUZZ_GUIDELINES_VERSION (packages/shared/src/buzz/constants.ts) to ask everyone again.
create or replace function public.buzz_guidelines_version()
returns text
language sql
immutable
as $$
  select '2026-10-21'::text;
$$;

-- Minute flooring / ceiling in absolute time (no time-zone dependence).
create or replace function public.buzz_floor_minute(p_at timestamptz)
returns timestamptz
language sql
stable
as $$
  select to_timestamp(floor(extract(epoch from p_at) / 60) * 60);
$$;

create or replace function public.buzz_ceil_minute(p_at timestamptz)
returns timestamptz
language sql
stable
as $$
  select to_timestamp(ceil(extract(epoch from p_at) / 60) * 60);
$$;

create or replace function public.buzz_ms(p_at timestamptz)
returns bigint
language sql
stable
as $$
  select floor(extract(epoch from p_at) * 1000)::bigint;
$$;

-- Epoch ms floored to the minute: the only precision a Buzz time is ever served at.
create or replace function public.buzz_minute_ms(p_at timestamptz)
returns bigint
language sql
stable
as $$
  select (floor(extract(epoch from p_at) / 60) * 60000)::bigint;
$$;

create or replace function public.buzz_iso(p_at timestamptz)
returns text
language sql
stable
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- JavaScript's trim(): whitespace off both ends.
create or replace function public.buzz_trim(p_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_text, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
$$;

-- UniVerse snippet(): whitespace folded, cut at p_max with an ellipsis.
create or replace function public.buzz_snippet(p_text text, p_max int default 120)
returns text
language sql
immutable
as $$
  select case when char_length(s.t) > p_max then rtrim(left(s.t, p_max - 1)) || '…' else s.t end
  from (select btrim(regexp_replace(coalesce(p_text, ''), '[[:space:]]+', ' ', 'g')) as t) s;
$$;

-- What a buzz is about in one line: its title when it has one, else its body.
create or replace function public.buzz_headline(p_title text, p_body text)
returns text
language sql
immutable
as $$
  select case when btrim(coalesce(p_title, '')) <> '' then p_title else coalesce(p_body, '') end;
$$;

-- buzzSearchTerms() (packages/shared/src/buzz/helpers.ts), the same split: lower-cased words of letters, digits and
-- ' & + # . - (with . ' - trimmed off the ends), at least 2 characters, unique, at most 6, in order.
create or replace function public.buzz_search_terms(p_q text)
returns text[]
language sql
immutable
as $$
  select coalesce(array(
    select u.w
    from (
      select s.w, min(s.n) as first_n
      from (
        select regexp_replace(t.part, '^[.''-]+|[.''-]+$', '', 'g') as w, t.n
        from regexp_split_to_table(lower(coalesce(p_q, '')), '[^[:alnum:]''&+#.-]+') with ordinality as t(part, n)
      ) s
      where char_length(s.w) >= 2
      group by s.w
    ) u
    order by u.first_n
    limit 6
  ), '{}'::text[]);
$$;

-- A LIKE pattern matching the term anywhere, with % _ and \ taken literally.
create or replace function public.buzz_like_pattern(p_term text)
returns text
language sql
immutable
as $$
  select '%' || replace(replace(replace(coalesce(p_term, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- -----------------------------------------------------------------------------
-- 4. Data conversion (every run; each statement touches only what still needs it)
-- -----------------------------------------------------------------------------
-- Threads posted without a campus showed up everywhere: they belong to the Global feed. (Only old rows: they still
-- carry their old "Student 12345" alias. New rows always store their author's campus.)
update public.buzz_posts set scope = 'global'
where university_id is null and scope <> 'global' and alias ~ '^Student [0-9]+$';

-- Counts from the votes themselves (old votes count as eligible).
update public.buzz_posts b
set upvotes = v.up, downvotes = v.down, score = v.up - v.down, eligible_votes = v.ev, eligible_score = v.es
from (
  select p.id,
    (count(x.post_id) filter (where x.value = 1))::int as up,
    (count(x.post_id) filter (where x.value = -1))::int as down,
    (count(x.post_id) filter (where x.eligible))::int as ev,
    coalesce(sum(x.value) filter (where x.eligible), 0)::int as es
  from public.buzz_posts p
  left join public.buzz_votes x on x.post_id = p.id
  group by p.id
) v
where v.id = b.id
  and (b.upvotes, b.downvotes, b.score, b.eligible_votes, b.eligible_score) is distinct from (v.up, v.down, v.up - v.down, v.ev, v.es);

update public.buzz_comments c
set upvotes = v.up, downvotes = v.down, score = v.up - v.down, eligible_votes = v.ev, eligible_score = v.es
from (
  select r.id,
    (count(x.comment_id) filter (where x.value = 1))::int as up,
    (count(x.comment_id) filter (where x.value = -1))::int as down,
    (count(x.comment_id) filter (where x.eligible))::int as ev,
    coalesce(sum(x.value) filter (where x.eligible), 0)::int as es
  from public.buzz_comments r
  left join public.buzz_comment_votes x on x.comment_id = r.id
  group by r.id
) v
where v.id = c.id
  and (c.upvotes, c.downvotes, c.score, c.eligible_votes, c.eligible_score) is distinct from (v.up, v.down, v.up - v.down, v.ev, v.es);

-- Reply depth from the tree (a reply to the thread is 1).
with recursive d (id, depth) as (
  select c.id, 1 from public.buzz_comments c where c.parent_id is null
  union all
  select c.id, d.depth + 1 from public.buzz_comments c join d on c.parent_id = d.id where d.depth < 10000
)
update public.buzz_comments c set depth = d.depth from d where d.id = c.id and c.depth is distinct from d.depth;

-- The old "hide" of a thread was a hide of its author in that thread: those become hidden threads. The rest keep
-- meaning "hide this anon in this thread".
insert into public.buzz_hidden_threads (user_id, thread_id, created_at)
select m.user_id, m.post_id, m.created_at
from public.buzz_mutes m join public.buzz_posts b on b.id = m.post_id
where m.legacy and m.muted_id = b.author_id
on conflict do nothing;
delete from public.buzz_mutes m using public.buzz_posts b where b.id = m.post_id and m.legacy and m.muted_id = b.author_id;
update public.buzz_mutes set legacy = false where legacy;

-- Reports: a reply is a 'buzz_comment' (CampConnect Admin's report queue reads that type). The check keeps every type it
-- allows today plus Buzz's; a 'buzz_reply' report (an earlier version of this file wrote them) becomes 'buzz_comment'.
do $$
declare
  v_have text[];
  v_all text[];
begin
  select array_agg(distinct m[1]) into v_have
  from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
  where c.conrelid = 'public.reports'::regclass and c.conname = 'reports_target_type_check';
  select array_agg(distinct t order by t) into v_all
  from unnest(coalesce(v_have, '{}'::text[]) || array['apartment', 'item', 'roommate', 'profile', 'message', 'comment', 'post', 'buzz', 'buzz_comment']) as t
  where t <> 'buzz_reply';
  alter table public.reports drop constraint if exists reports_target_type_check;
  delete from public.reports a
  where a.target_type = 'buzz_reply'
    and exists (select 1 from public.reports z where z.target_type = 'buzz_comment' and z.reporter_id = a.reporter_id and z.target_id = a.target_id);
  update public.reports set target_type = 'buzz_comment' where target_type = 'buzz_reply';
  execute format('alter table public.reports add constraint reports_target_type_check check (target_type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_all) as t));
end
$$;

-- Notification types: every type allowed today plus Trust & Safety's and Buzz's three.
do $$
declare
  v_have text[];
  v_all text[];
begin
  select array_agg(distinct m[1]) into v_have
  from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  select array_agg(distinct t order by t) into v_all
  from unnest(coalesce(v_have, '{}'::text[]) || array['message', 'listing_saved', 'nearby_listing', 'system', 'like', 'comment', 'follow', 'snap',
                                                      'moderation', 'staff', 'buzz_reply', 'buzz_milestone', 'buzz_poll_closed']) as t;
  alter table public.notifications drop constraint if exists notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_all) as t));
end
$$;

-- The old reply notifications quoted the reply itself. They become anonymous buzz_reply notifications quoting only the
-- recipient's own thread (they always went to its author), timed to the minute; those about a thread that is gone go.
delete from public.notifications n
where n.type = 'comment' and n.data ->> 'target_type' = 'buzz'
  and not exists (select 1 from public.buzz_posts b where b.id::text = n.data ->> 'target_id');
update public.notifications n
set type = 'buzz_reply',
    actor_id = null,
    title = 'Someone replied to your buzz',
    body = (select nullif(public.buzz_snippet(public.buzz_headline(b.title, b.body), 80), '') from public.buzz_posts b where b.id::text = n.data ->> 'target_id'),
    data = jsonb_build_object('target_type', 'buzz', 'target_id', n.data ->> 'target_id', 'anonymous', true),
    created_at = public.buzz_floor_minute(n.created_at)
where n.type = 'comment' and n.data ->> 'target_type' = 'buzz';

-- -----------------------------------------------------------------------------
-- 5. Aliases (UniVerse safety 5.1, keyed with this project's private salt)
-- -----------------------------------------------------------------------------
-- Who wrote a row, for the alias and for "same author" inside one thread: the account, or for a detached row its
-- stored key (old rows: their old alias; rows detached since v2: their frozen digest). Never leaves the database.
create or replace function public.buzz_author_key(p_author uuid, p_alias text)
returns text
language sql
immutable
as $$
  select coalesce(p_author::text, 'legacy:' || coalesce(p_alias, ''));
$$;

-- sha256(salt || thread || ':' || author key). A row detached since v2 carries the digest it had (so its alias does
-- not change when the account goes: a set of buzzes changing alias at once would link them together).
create or replace function public.buzz_alias_digest(p_thread uuid, p_key text)
returns bytea
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_key like 'legacy:detached:%' and substr(p_key, 17) ~ '^[0-9a-f]{64}$' then decode(substr(p_key, 17), 'hex')
    else sha256(convert_to((select s.salt from public.buzz_secrets s where s.id = 1) || p_thread::text || ':' || p_key, 'UTF8'))
  end;
$$;

-- digest -> {emoji, label, color}: noun = uint16(d[0..1]) % 64, colour = uint16(d[2..3]) % 12, label "Anon Comet"
-- (+ " 2", " 3" ... for the 2nd, 3rd author with the same noun and colour in one thread). UniVerse's exact lists.
create or replace function public.buzz_alias_json(p_digest bytea, p_suffix int default 0)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'emoji', (array['☄️', '🌟', '🌌', '🌙', '🪐', '🚀', '🛰️', '🌠', '☀️', '🌍', '🔭', '👽', '🛸', '🌑', '⭐', '✨', '🌀', '⚡', '🔥', '❄️', '🌊', '🌪️', '🌈', '☁️', '🦊', '🦉', '🐺', '🦅', '🐙', '🐬', '🦋', '🐝', '🦎', '🐢', '🦈', '🐼', '🦁', '🐯', '🐻', '🦌', '🦜', '🦩', '🦔', '🦦', '🌵', '🍄', '🌻', '🍀', '🌲', '🍁', '🌸', '🥑', '🍋', '🍉', '🥨', '🍩', '🧊', '💎', '🎲', '🧭', '🎧', '🪁', '🔮', '🗝️'])[k.n + 1],
    'label', 'Anon ' || (array['Comet', 'Nova', 'Nebula', 'Moon', 'Saturn', 'Rocket', 'Satellite', 'Meteor', 'Sol', 'Terra', 'Scope', 'Alien', 'Saucer', 'Eclipse', 'Star', 'Spark', 'Vortex', 'Bolt', 'Ember', 'Frost', 'Tide', 'Cyclone', 'Prism', 'Cloud', 'Fox', 'Owl', 'Wolf', 'Falcon', 'Kraken', 'Dolphin', 'Moth', 'Bee', 'Gecko', 'Turtle', 'Shark', 'Panda', 'Lion', 'Tiger', 'Bear', 'Stag', 'Parrot', 'Flamingo', 'Hedgehog', 'Otter', 'Cactus', 'Mushroom', 'Sunflower', 'Clover', 'Pine', 'Maple', 'Blossom', 'Avocado', 'Lemon', 'Melon', 'Pretzel', 'Donut', 'Cube', 'Gem', 'Dice', 'Compass', 'Headphones', 'Kite', 'Oracle', 'Key'])[k.n + 1]
      || case when coalesce(p_suffix, 0) > 0 then ' ' || (p_suffix + 1)::text else '' end,
    'color', (array['#7C9BFF', '#5EEAD4', '#F472B6', '#FBBF24', '#A78BFA', '#34D399', '#FB7185', '#38BDF8', '#F97316', '#A3E635', '#E879F9', '#94A3B8'])[k.c + 1])
  from (select (get_byte(p_digest, 0) * 256 + get_byte(p_digest, 1)) % 64 as n,
               (get_byte(p_digest, 2) * 256 + get_byte(p_digest, 3)) % 12 as c) k;
$$;

-- Every participant of a thread -> its alias, with collision suffixes by order of first post in the thread (the
-- thread's author first; then publication time; ties by id). Computed on every read, never stored.
create or replace function public.buzz_v2_alias_book(p_thread uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with posts as (
    select public.buzz_author_key(b.author_id, b.alias) as k, 0 as r, b.visible_at as at, b.id from public.buzz_posts b where b.id = p_thread
    union all
    select public.buzz_author_key(c.author_id, c.alias), 1, c.visible_at, c.id from public.buzz_comments c where c.post_id = p_thread
  ),
  firsts as (select distinct on (p.k) p.k, p.r, p.at, p.id from posts p order by p.k, p.r, p.at, p.id),
  keyed as (select f.k, f.r, f.at, f.id, public.buzz_alias_digest(p_thread, f.k) as d from firsts f),
  slots as (
    select y.k, y.d,
      (row_number() over (
        partition by (get_byte(y.d, 0) * 256 + get_byte(y.d, 1)) % 64, (get_byte(y.d, 2) * 256 + get_byte(y.d, 3)) % 12
        order by y.r, y.at, y.id) - 1)::int as suffix
    from keyed y
  )
  select coalesce(jsonb_object_agg(s.k, public.buzz_alias_json(s.d, s.suffix)), '{}'::jsonb) from slots s;
$$;

-- Account deletion sets author_id to null (the rows stay, detached): keep the digest the alias came from.
create or replace function public.buzz_v2_freeze_post_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.alias := 'detached:' || encode(public.buzz_alias_digest(old.id, old.author_id::text), 'hex');
  return new;
end;
$$;
drop trigger if exists buzz_posts_freeze_alias on public.buzz_posts;
create trigger buzz_posts_freeze_alias before update on public.buzz_posts
  for each row when (old.author_id is not null and new.author_id is null) execute function public.buzz_v2_freeze_post_alias();

create or replace function public.buzz_v2_freeze_reply_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.alias := 'detached:' || encode(public.buzz_alias_digest(old.post_id, old.author_id::text), 'hex');
  return new;
end;
$$;
drop trigger if exists buzz_comments_freeze_alias on public.buzz_comments;
create trigger buzz_comments_freeze_alias before update on public.buzz_comments
  for each row when (old.author_id is not null and new.author_id is null) execute function public.buzz_v2_freeze_reply_alias();

-- -----------------------------------------------------------------------------
-- 6. Who is asking, and what they may reach
-- -----------------------------------------------------------------------------
create or replace function public.buzz_v2_gate_ok(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.buzz_gate g where g.user_id = p_user and g.version = public.buzz_guidelines_version());
$$;

-- The one error for "missing", "not yours", "not published yet", "held" and "gone": identical for everyone.
create or replace function public.buzz_v2_not_found()
returns void
language plpgsql
volatile
as $$
begin
  raise exception 'buzz:not_found:That buzz isn''t available.';
end;
$$;

create or replace function public.buzz_v2_me()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not exists (select 1 from public.profiles p where p.id = v) then
    raise exception 'buzz:unauthenticated:Log in to use Buzz.';
  end if;
  return v;
end;
$$;

-- Signed in AND the current guidelines accepted: required before the first Buzz read.
create or replace function public.buzz_v2_viewer()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid := public.buzz_v2_me();
begin
  if not public.buzz_v2_gate_ok(v) then
    raise exception 'buzz:buzz_gate_required:Accept the Buzz guidelines to continue.';
  end if;
  return v;
end;
$$;

-- A thread the viewer may open: not deleted; someone else's only once published and never while held (others never
-- learn a held state exists). Hidden and removed threads open as placeholders.
create or replace function public.buzz_v2_root_ok(b public.buzz_posts, p_viewer uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    b.id is not null and b.status <> 'deleted'
    and (b.status <> 'held' or coalesce(b.author_id = p_viewer, false))
    and (b.visible_at <= now() or coalesce(b.author_id = p_viewer, false)),
    false);
$$;

-- A reply the viewer may act on (inside a thread they may open): same rules.
create or replace function public.buzz_v2_reply_ok(c public.buzz_comments, p_viewer uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    c.id is not null and c.status <> 'deleted'
    and (c.status <> 'held' or coalesce(c.author_id = p_viewer, false))
    and (c.visible_at <= now() or coalesce(c.author_id = p_viewer, false)),
    false);
$$;

-- The campus name shown next to a Global buzz, only for campuses big enough that it does not point at a handful of
-- people; null otherwise.
create or replace function public.buzz_v2_campus_name(p_university uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(u.short_name, ''), u.name)
  from public.universities u
  where u.id = p_university
    and (select count(*) from public.profiles p where p.university_id = u.id)
        >= coalesce((select s.min_campus_named from public.buzz_secrets s where s.id = 1), 50);
$$;

create or replace function public.buzz_v2_campus_small(p_university uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_university is not null
    and (select count(*) from public.profiles p where p.university_id = p_university)
        < coalesce((select s.min_campus_named from public.buzz_secrets s where s.id = 1), 50);
$$;

-- Active replies the viewer can see (published or their own; not ones they reported).
create or replace function public.buzz_v2_reply_count(p_thread uuid, p_viewer uuid, p_staff boolean default false)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.buzz_comments c
  where c.post_id = p_thread and c.status = 'active'
    and (coalesce(p_staff, false) or (
      (c.visible_at <= now() or coalesce(c.author_id = p_viewer, false))
      and not exists (select 1 from public.reports r where r.reporter_id = p_viewer and r.target_type = 'buzz_comment' and r.target_id = c.id)));
$$;

-- -----------------------------------------------------------------------------
-- 7. The serializer: the only way out of the database for a Buzz row
-- -----------------------------------------------------------------------------
-- BuzzMedia[] of a thread, field by field from what buzz_v2_create validated.
create or replace function public.buzz_v2_media_json(b public.buzz_posts)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(m.v order by m.n), '[]'::jsonb)
  from (
    select i.n, jsonb_build_object(
      'type', 'image',
      'url', i.url,
      'width', case when jsonb_typeof(x.meta -> 'width') = 'number' then x.meta -> 'width' else 'null'::jsonb end,
      'height', case when jsonb_typeof(x.meta -> 'height') = 'number' then x.meta -> 'height' else 'null'::jsonb end,
      'blur', case when jsonb_typeof(x.meta -> 'blur') = 'string' then x.meta -> 'blur' else 'null'::jsonb end) as v
    from unnest(coalesce(b.images, '{}'::text[])) with ordinality as i(url, n)
    left join lateral (
      select e as meta
      from jsonb_array_elements(case when jsonb_typeof(b.image_meta) = 'array' then b.image_meta else '[]'::jsonb end) as e
      where jsonb_typeof(e) = 'object' and e ->> 'url' = i.url
      limit 1
    ) x on true
    where i.url is not null
    union all
    select 1000 + v.n, jsonb_build_object(
      'type', 'video',
      'playbackId', v.x ->> 'playback_id',
      'posterUrl', case when jsonb_typeof(v.x -> 'poster_url') = 'string' then v.x -> 'poster_url' else 'null'::jsonb end,
      'width', case when jsonb_typeof(v.x -> 'width') = 'number' then v.x -> 'width' else 'null'::jsonb end,
      'height', case when jsonb_typeof(v.x -> 'height') = 'number' then v.x -> 'height' else 'null'::jsonb end,
      'durationSeconds', case when jsonb_typeof(v.x -> 'duration_seconds') = 'number' then v.x -> 'duration_seconds' else 'null'::jsonb end)
    from jsonb_array_elements(case when jsonb_typeof(b.videos) = 'array' then b.videos else '[]'::jsonb end) with ordinality as v(x, n)
    where jsonb_typeof(v.x) = 'object' and coalesce(v.x ->> 'playback_id', '') ~ '^[A-Za-z0-9]{8,120}$'
  ) m;
$$;

-- BuzzPoll: results stay hidden until the viewer voted, the poll closed, or it is the viewer's own.
create or replace function public.buzz_v2_poll_json(p_post uuid, p_viewer uuid, p_is_mine boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pl public.buzz_polls;
  v_choice uuid;
  v_total int;
  v_closed boolean;
  v_visible boolean;
begin
  select * into pl from public.buzz_polls where post_id = p_post;
  if pl.post_id is null then
    return null;
  end if;
  if p_viewer is not null then
    select v.option_id into v_choice from public.buzz_poll_votes v where v.post_id = p_post and v.user_id = p_viewer;
  end if;
  select coalesce(sum(o.vote_count), 0)::int into v_total from public.buzz_poll_options o where o.post_id = p_post;
  v_closed := pl.closes_at <= now();
  v_visible := v_closed or v_choice is not null or coalesce(p_is_mine, false);
  return jsonb_build_object(
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'text', o.text,
        'votes', case when v_visible then o.vote_count end,
        'pct', case when v_visible then case when v_total = 0 then 0 else round(o.vote_count * 100.0 / v_total)::int end end
      ) order by o.idx)
      from public.buzz_poll_options o where o.post_id = p_post), '[]'::jsonb),
    'totalVotes', case when v_visible then v_total end,
    'closesAt', public.buzz_minute_ms(pl.closes_at),
    'closed', v_closed,
    'myChoice', v_choice,
    'resultsVisible', v_visible);
end;
$$;

-- Buzz (a thread), field by field. p_staff = the blind staff context: the words of every status are readable, isMine
-- is false, there is no vote / choice, and nothing else changes.
create or replace function public.buzz_root_json(b public.buzz_posts, p_viewer uuid, p_staff boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff boolean := coalesce(p_staff, false);
  v_viewer uuid := case when coalesce(p_staff, false) then null else p_viewer end;
  v_mine boolean := v_viewer is not null and coalesce(b.author_id = v_viewer, false);
  v_open boolean;
  v_vote int;
begin
  if b.id is null then
    return null;
  end if;
  -- Others read an active buzz; its author reads it in every state but deleted; a placeholder has no words at all.
  v_open := v_staff or (b.status <> 'deleted' and (b.status = 'active' or v_mine));
  if v_viewer is not null then
    select v.value into v_vote from public.buzz_votes v where v.post_id = b.id and v.user_id = v_viewer;
  end if;
  return jsonb_build_object(
    'kind', 'buzz',
    'id', b.id,
    'threadId', b.id,
    'alias', public.buzz_alias_json(public.buzz_alias_digest(b.id, public.buzz_author_key(b.author_id, b.alias)), 0),
    'isOp', true,
    'isMine', v_mine,
    'text', case when v_open then b.body else '' end,
    'title', case when v_open then b.title else '' end,
    'media', case when v_open then public.buzz_v2_media_json(b) else '[]'::jsonb end,
    'scope', b.scope,
    'score', b.score,
    'myVote', coalesce(v_vote, 0),
    'collapsed', b.eligible_score <= -5 and b.eligible_votes >= 8,
    'status', b.status,
    'supportLink', b.support_link,
    'createdAt', public.buzz_minute_ms(least(b.visible_at, now())),
    'poll', case when v_open then public.buzz_v2_poll_json(b.id, v_viewer, v_mine) end,
    'replyCount', public.buzz_v2_reply_count(b.id, v_viewer, v_staff),
    'locked', b.locked,
    'campusShortName', case when b.scope = 'global' then public.buzz_v2_campus_name(b.university_id) end,
    'promptId', b.prompt_id);
end;
$$;

-- BuzzReply, field by field. The shape (parentId, depth, replyingTo) and the thread's alias book come from the caller.
create or replace function public.buzz_reply_json(
  c public.buzz_comments, p_viewer uuid, p_staff boolean, p_parent_id uuid, p_depth int, p_replying_to jsonb, p_alias jsonb, p_root_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff boolean := coalesce(p_staff, false);
  v_viewer uuid := case when coalesce(p_staff, false) then null else p_viewer end;
  v_mine boolean := v_viewer is not null and coalesce(c.author_id = v_viewer, false);
  v_open boolean;
  v_vote int;
  v_hidden boolean := false;
begin
  if c.id is null then
    return null;
  end if;
  v_open := v_staff or (c.status <> 'deleted' and (c.status = 'active' or v_mine));
  if v_viewer is not null then
    select v.value into v_vote from public.buzz_comment_votes v where v.comment_id = c.id and v.user_id = v_viewer;
    -- "Hide this anon in this thread": keyed on thread + author here, never sent anywhere.
    v_hidden := c.author_id is not null and exists (
      select 1 from public.buzz_mutes m where m.user_id = v_viewer and m.post_id = c.post_id and m.muted_id = c.author_id);
  end if;
  return jsonb_build_object(
    'kind', 'reply',
    'id', c.id,
    'threadId', c.post_id,
    'alias', coalesce(p_alias, public.buzz_alias_json(public.buzz_alias_digest(c.post_id, public.buzz_author_key(c.author_id, c.alias)), 0)),
    'isOp', public.buzz_author_key(c.author_id, c.alias) = coalesce(p_root_key, ''),
    'isMine', v_mine,
    'text', case when v_open then c.body else '' end,
    'score', c.score,
    'myVote', coalesce(v_vote, 0),
    'collapsed', (c.eligible_score <= -5 and c.eligible_votes >= 8) or v_hidden,
    'status', c.status,
    'supportLink', c.support_link,
    'createdAt', public.buzz_minute_ms(least(c.visible_at, now())),
    'parentId', coalesce(p_parent_id, c.post_id),
    'depth', case when p_depth = 2 then 2 else 1 end,
    'replyingTo', p_replying_to);
end;
$$;

-- The replies of a thread the viewer sees, oldest first, shaped for two visual levels (UniVerse visibleReplies):
--   * others never see a held reply, an unpublished one, or one they reported (staff see everything);
--   * a deleted reply shows (as a placeholder) only while a reply below it still shows;
--   * a reply whose parent does not show hangs from the nearest ancestor that does;
--   * deeper than 2 flattens to 2 under its depth-1 ancestor, with replyingTo = the author it answered.
-- replying_key is that author's key (internal: the caller turns it into an alias).
create or replace function public.buzz_v2_visible_replies(p_thread uuid, p_viewer uuid, p_staff boolean default false)
returns table (id uuid, ord bigint, shape_parent uuid, shape_depth int, replying_key text)
language sql
stable
security definer
set search_path = public
as $$
  with recursive rows as (
    select c.id, c.parent_id, c.author_id, c.alias, c.status, c.visible_at, c.seq,
      coalesce(p_staff, false) or (
        (c.status <> 'held' or coalesce(c.author_id = p_viewer, false))
        and (c.visible_at <= now() or coalesce(c.author_id = p_viewer, false))
        and not exists (select 1 from public.reports r where r.reporter_id = p_viewer and r.target_type = 'buzz_comment' and r.target_id = c.id)
      ) as cand
    from public.buzz_comments c
    where c.post_id = p_thread
  ),
  -- every ancestor of a reply that shows with words
  marked (id) as (
    select r.parent_id from rows r where r.cand and r.status <> 'deleted' and r.parent_id is not null
    union
    select r.parent_id from marked m join rows r on r.id = m.id where r.parent_id is not null
  ),
  vis as (
    select r.* from rows r
    where r.cand and (coalesce(p_staff, false) or r.status <> 'deleted' or exists (select 1 from marked m where m.id = r.id))
  ),
  chain (start_id, anc_id, dist) as (
    select v.id, v.parent_id, 1 from vis v where v.parent_id is not null
    union all
    select ch.start_id, r.parent_id, ch.dist + 1 from chain ch join rows r on r.id = ch.anc_id where r.parent_id is not null and ch.dist < 1000
  ),
  vanc as (
    select ch.start_id, ch.anc_id, ch.dist from chain ch where exists (select 1 from vis v where v.id = ch.anc_id)
  ),
  shaped as (
    select v.id, v.visible_at, v.seq,
      (select a.anc_id from vanc a where a.start_id = v.id order by a.dist asc limit 1) as nearest,
      (select a.anc_id from vanc a where a.start_id = v.id order by a.dist desc limit 1) as top,
      (select count(*) from vanc a where a.start_id = v.id) as above
    from vis v
  )
  select s.id,
    row_number() over (order by s.visible_at, s.seq, s.id),
    case when s.above = 0 then p_thread when s.above = 1 then s.nearest else s.top end,
    case when s.above = 0 then 1 else 2 end,
    case when s.above >= 2 then (select public.buzz_author_key(r.author_id, r.alias) from rows r where r.id = s.nearest) end
  from shaped s;
$$;

-- One page of a thread's replies (BuzzPage<BuzzReply>).
create or replace function public.buzz_v2_reply_page(p_root public.buzz_posts, p_viewer uuid, p_offset int, p_limit int, p_staff boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_book jsonb := public.buzz_v2_alias_book(p_root.id);
  v_root_key text := public.buzz_author_key(p_root.author_id, p_root.alias);
  v_items jsonb;
  v_total bigint;
begin
  select coalesce(jsonb_agg(public.buzz_reply_json(
           c, p_viewer, p_staff, v.shape_parent, v.shape_depth,
           case when v.replying_key is not null then v_book -> v.replying_key end,
           v_book -> public.buzz_author_key(c.author_id, c.alias), v_root_key) order by v.ord), '[]'::jsonb),
         max(v.total)
  into v_items, v_total
  from (select r.*, count(*) over () as total from public.buzz_v2_visible_replies(p_root.id, p_viewer, p_staff) r) v
  join public.buzz_comments c on c.id = v.id
  where v.ord > v_offset and v.ord <= v_offset + v_limit;
  return jsonb_build_object('items', v_items, 'nextOffset', case when coalesce(v_total, 0) > v_offset + v_limit then v_offset + v_limit end);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Rate limits and posting rules
-- -----------------------------------------------------------------------------
-- UniVerse RATE_LIMITS: threads 6 an hour and 20 a day, replies 30 / 150, votes 120 an hour; accounts under 72 hours old
-- (or within 72 hours of a suspension ending) 2 / 5, 10 / 30 and 60. One request at a time per person (the advisory
-- lock), so parallel requests cannot slip past it. Deleting does not give a slot back.
create or replace function public.buzz_v2_rate_limit(p_user uuid, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_new boolean;
  w record;
  v_n int;
  v_oldest timestamptz;
  v_retry int;
  v_minutes int;
begin
  perform pg_advisory_xact_lock(hashtext('buzz:' || p_user::text));
  v_new := coalesce(public.ts_treated_as_new(p_user), true);
  for w in
    select * from (values
      ('thread', interval '1 hour', 6, 2), ('thread', interval '1 day', 20, 5),
      ('reply', interval '1 hour', 30, 10), ('reply', interval '1 day', 150, 30),
      ('vote', interval '1 hour', 120, 60)
    ) as t(kind, span, max_n, max_new)
    where t.kind = p_kind
  loop
    select count(*), min(l.at) into v_n, v_oldest
    from public.buzz_rate_log l
    where l.user_id = p_user and l.kind = p_kind and l.at > now() - w.span;
    if v_n >= (case when v_new then w.max_new else w.max_n end) then
      v_retry := greatest(1, ceil(extract(epoch from (coalesce(v_oldest, now()) + w.span - now())))::int);
      v_minutes := ceil(v_retry / 60.0)::int;
      raise exception '%', 'buzz:rate_limited:' || case
        when v_retry < 90 then 'You''re going fast. Try again in a minute.'
        when v_minutes < 120 then 'You''re going fast. Try again in ' || v_minutes || ' minutes.'
        else 'You''re going fast. Try again in ' || ceil(v_minutes / 60.0)::int || ' hours.'
      end;
    end if;
  end loop;
  delete from public.buzz_rate_log l where l.user_id = p_user and l.at < now() - interval '2 days';
  insert into public.buzz_rate_log (user_id, kind) values (p_user, p_kind);
end;
$$;

-- A write by p_author: a profile, the current guidelines accepted, and allowed to post on Buzz right now.
create or replace function public.buzz_v2_assert_writer(p_author uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_author is null or not exists (select 1 from public.profiles p where p.id = p_author) then
    raise exception 'buzz:unauthenticated:Log in to use Buzz.';
  end if;
  if not public.buzz_v2_gate_ok(p_author) then
    raise exception 'buzz:buzz_gate_required:Accept the Buzz guidelines to continue.';
  end if;
  v := public.ts_posting_status(p_author, 'buzz');
  if coalesce((v ->> 'allowed')::boolean, false) then
    return;
  end if;
  case coalesce(v ->> 'reason', '')
    when 'muted' then
      raise exception 'buzz:muted:You''re muted on Buzz right now, so you can''t post. You can still read and vote.';
    when 'suspended' then
      raise exception 'buzz:suspended:Your account is suspended right now, so you can''t post.';
    when 'banned' then
      raise exception 'buzz:banned:This account can''t post any more.';
    when 'warning' then
      raise exception 'buzz:warning_unacknowledged:Please read and acknowledge the notice from the safety team before posting.';
    else
      raise exception 'buzz:forbidden:You can''t post right now.';
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Anonymous notifications
-- -----------------------------------------------------------------------------
-- Never an actor; data says only which thread; created_at is the event floored to the minute and visible_at the next
-- minute boundary, so neither the list, nor the row, nor a realtime push dates the reply or vote that caused it.
create or replace function public.buzz_v2_notify(
  p_user uuid, p_type text, p_title text, p_body text, p_thread uuid, p_entity_type text, p_entity_id uuid, p_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, type, title, body, link, data, created_at, visible_at)
  values (p_user, null, p_type, p_title, nullif(p_body, ''), '/buzz/' || p_thread,
          jsonb_build_object('target_type', 'buzz', 'target_id', p_thread, 'anonymous', true),
          public.buzz_floor_minute(p_at), public.buzz_ceil_minute(p_at))
  returning id into v_id;
  insert into public.buzz_notification_refs (notification_id, entity_type, entity_id, thread_id)
  values (v_id, p_entity_type, p_entity_id, p_thread);
end;
$$;

-- A deleted or removed thread takes every notification of the thread with it; a reply, the ones it caused or earned.
create or replace function public.buzz_v2_drop_notifications(p_entity_type text, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_entity_type = 'buzz' then
    delete from public.notifications n
    where n.type in ('buzz_reply', 'buzz_milestone', 'buzz_poll_closed') and n.data ->> 'target_type' = 'buzz' and n.data ->> 'target_id' = p_id::text;
  else
    delete from public.notifications n
    using public.buzz_notification_refs r
    where r.notification_id = n.id and r.entity_type = 'buzz_reply' and r.entity_id = p_id;
  end if;
end;
$$;

-- "Someone replied to your buzz": to the parent's author and the thread's author, never yourself, never twice, not
-- for a held reply, and not to someone who hid that anon in this thread. The body quotes the RECIPIENT's own buzz or
-- reply, never the new reply. It shows when the reply does.
create or replace function public.buzz_v2_notify_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.buzz_posts;
  p public.buzz_comments;
  v_to uuid;
  v_own text;
begin
  if new.status <> 'active' or new.author_id is null then
    return null;
  end if;
  select * into r from public.buzz_posts where id = new.post_id;
  if r.id is null then
    return null;
  end if;
  if new.parent_id is not null then
    select * into p from public.buzz_comments where id = new.parent_id;
  end if;
  for v_to in
    select distinct x.uid
    from (values (case when p.id is not null then p.author_id else r.author_id end), (r.author_id)) as x(uid)
    where x.uid is not null and x.uid <> new.author_id
  loop
    if exists (select 1 from public.buzz_mutes m where m.user_id = v_to and m.post_id = new.post_id and m.muted_id = new.author_id) then
      continue;
    end if;
    v_own := case when v_to = r.author_id then public.buzz_headline(r.title, r.body) else p.body end;
    perform public.buzz_v2_notify(v_to, 'buzz_reply', 'Someone replied to your buzz', public.buzz_snippet(v_own, 80),
                                  r.id, 'buzz_reply', new.id, new.visible_at);
  end loop;
  return null;
end;
$$;
drop trigger if exists buzz_comments_notify on public.buzz_comments;
create trigger buzz_comments_notify after insert on public.buzz_comments for each row execute function public.buzz_v2_notify_reply();
drop function if exists public.buzz_notify_reply();

-- Polls that closed and whose author has not been told: "Your poll closed · n votes" (p_user = just that author's).
create or replace function public.buzz_v2_close_due_polls(p_user uuid default null)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
  v_n int := 0;
  v_votes int;
begin
  for r in
    select pl.post_id, b.author_id, b.title, b.body, pl.closes_at
    from public.buzz_polls pl join public.buzz_posts b on b.id = pl.post_id
    where not pl.closed_notified and pl.closes_at <= now() and b.status <> 'deleted' and (p_user is null or b.author_id = p_user)
    for update of pl skip locked
  loop
    update public.buzz_polls set closed_notified = true where post_id = r.post_id;
    if r.author_id is not null then
      select coalesce(sum(o.vote_count), 0)::int into v_votes from public.buzz_poll_options o where o.post_id = r.post_id;
      perform public.buzz_v2_notify(
        r.author_id, 'buzz_poll_closed', 'Your poll closed · ' || v_votes || case when v_votes = 1 then ' vote' else ' votes' end,
        public.buzz_snippet(public.buzz_headline(r.title, r.body), 80), r.post_id, 'buzz', r.post_id, r.closes_at);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Reading Buzz (signed in, guidelines accepted)
-- -----------------------------------------------------------------------------
-- BuzzFeedPage. Campus = the viewer's university's campus buzzes; Global = buzzes posted to Global from every campus.
-- Visible: active ones (and the viewer's own in any state but deleted), published, not hidden or reported by the viewer;
-- NO block filter and no author-status filter. Hot = (score + 2 x published replies) / (age hours + 2)^1.5 with age
-- from the minute-floored publication; community-collapsed buzzes leave Hot and Top. rankAt (the first page's minute)
-- is "now" for every page: anything published after it waits for a refresh, so offsets stay stable.
create or replace function public.buzz_v2_feed(
  p_scope text default 'campus', p_sort text default 'hot', p_window text default 'day', p_q text default null,
  p_limit int default 20, p_offset int default 0, p_rank_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_now timestamptz := now();
  v_rank timestamptz := public.buzz_floor_minute(least(coalesce(p_rank_at, now()), now()));
  v_scope text := coalesce(p_scope, 'campus');
  v_sort text := coalesce(p_sort, 'hot');
  v_window text := coalesce(p_window, 'day');
  v_q text := nullif(public.buzz_trim(p_q), '');
  v_terms text[] := '{}'::text[];
  v_likes text[] := '{}'::text[];
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_uni uuid;
  v_since timestamptz;
  v_ids uuid[];
  v_items jsonb;
begin
  if v_scope not in ('campus', 'global') then
    raise exception 'buzz:validation_failed:Pick Campus or Global.';
  end if;
  if v_sort not in ('hot', 'new', 'top') then
    raise exception 'buzz:validation_failed:Sort by Hot, New or Top.';
  end if;
  if v_window not in ('day', 'week', 'all') then
    raise exception 'buzz:validation_failed:Top covers today, this week or all time.';
  end if;
  if v_q is not null then
    if char_length(v_q) > 80 then
      raise exception 'buzz:validation_failed:Searches are limited to 80 characters.';
    end if;
    v_terms := public.buzz_search_terms(v_q);
    -- nothing searchable in it (one letter, only symbols): matches nothing, never "everything"
    if cardinality(v_terms) = 0 then
      return jsonb_build_object('items', '[]'::jsonb, 'nextOffset', null, 'rankAt', public.buzz_iso(v_rank));
    end if;
    v_likes := array(select public.buzz_like_pattern(t) from unnest(v_terms) as t);
  end if;
  select p.university_id into v_uni from public.profiles p where p.id = v_me;
  v_since := case v_window when 'day' then v_rank - interval '1 day' when 'week' then v_rank - interval '7 days' end;

  v_ids := array(
    select f.id
    from (
      select b.id, b.score, b.visible_at,
        case when v_sort = 'hot' then
          (b.score + 2 * (
            select count(*) from public.buzz_comments c
            where c.post_id = b.id and c.status = 'active' and c.visible_at <= v_now and public.buzz_floor_minute(c.visible_at) <= v_rank
          ))::numeric
          / power(greatest(extract(epoch from (v_rank - public.buzz_floor_minute(b.visible_at))) / 3600.0, 0) + 2, 1.5)
        end as hot
      from public.buzz_posts b
      where b.status <> 'deleted'
        and (b.status = 'active' or b.author_id = v_me)
        and ((b.visible_at <= v_now and public.buzz_floor_minute(b.visible_at) <= v_rank)
             or (b.author_id = v_me and public.buzz_floor_minute(b.created_at) <= v_rank))
        and case when v_scope = 'campus' then b.scope = 'campus' and b.university_id = v_uni else b.scope = 'global' end
        and (cardinality(v_likes) = 0 or not exists (
              select 1 from unnest(v_likes) as l
              where not (lower(b.title) like l escape '\' or lower(b.body) like l escape '\')))
        and not exists (select 1 from public.buzz_hidden_threads h where h.user_id = v_me and h.thread_id = b.id)
        and not exists (select 1 from public.reports r where r.reporter_id = v_me and r.target_type = 'buzz' and r.target_id = b.id)
        and (v_sort = 'new' or not (b.eligible_score <= -5 and b.eligible_votes >= 8))
        and (v_sort <> 'top' or v_since is null or public.buzz_floor_minute(b.visible_at) >= v_since)
    ) f
    order by
      case when v_sort = 'hot' then f.hot end desc nulls last,
      case when v_sort = 'top' then f.score end desc nulls last,
      case when v_sort = 'new' then f.visible_at end desc nulls last,
      f.id desc
    limit v_limit + 1 offset v_offset
  );
  select coalesce(jsonb_agg(public.buzz_root_json(b, v_me, false) order by x.n), '[]'::jsonb)
  into v_items
  from unnest(v_ids[1:v_limit]) with ordinality as x(id, n)
  join public.buzz_posts b on b.id = x.id;
  return jsonb_build_object(
    'items', v_items,
    'nextOffset', case when coalesce(cardinality(v_ids), 0) > v_limit then v_offset + v_limit end,
    'rankAt', public.buzz_iso(v_rank));
end;
$$;

-- BuzzFeedMeta: today's prompt, the small-campus note, the viewer's campus. Also tells the viewer about their polls
-- that closed since they last looked.
create or replace function public.buzz_v2_meta(p_scope text default 'campus')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_count int;
  v_prompt_id uuid;
  v_prompt_text text;
  v_uni uuid;
  v_uni_name text;
  v_uni_short text;
begin
  if coalesce(p_scope, 'campus') not in ('campus', 'global') then
    raise exception 'buzz:validation_failed:Pick Campus or Global.';
  end if;
  perform public.buzz_v2_close_due_polls(v_me);
  select count(*) into v_count from public.buzz_prompts;
  if v_count > 0 then
    select p.id, p.text into v_prompt_id, v_prompt_text
    from public.buzz_prompts p
    where p.idx = (floor(extract(epoch from now()) / 86400)::bigint % v_count)::int;
  end if;
  select u.id, u.name, coalesce(nullif(u.short_name, ''), u.name) into v_uni, v_uni_name, v_uni_short
  from public.profiles pr join public.universities u on u.id = pr.university_id
  where pr.id = v_me;
  return jsonb_build_object(
    'prompt', case when v_prompt_id is not null then jsonb_build_object('id', v_prompt_id, 'text', v_prompt_text) end,
    'smallCampusNote', coalesce(p_scope, 'campus') = 'campus' and v_uni is not null and public.buzz_v2_campus_small(v_uni),
    'campus', case when v_uni is not null then jsonb_build_object('name', v_uni_name, 'shortName', v_uni_short) end);
end;
$$;

-- BuzzThread: the thread and the first page of its replies.
create or replace function public.buzz_v2_thread(p_thread uuid, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  b public.buzz_posts;
  v_uni uuid;
begin
  select * into b from public.buzz_posts where id = p_thread;
  if not public.buzz_v2_root_ok(b, v_me) then
    perform public.buzz_v2_not_found();
  end if;
  select p.university_id into v_uni from public.profiles p where p.id = v_me;
  return jsonb_build_object(
    'root', public.buzz_root_json(b, v_me, false),
    'replies', public.buzz_v2_reply_page(b, v_me, 0, p_limit, false),
    'smallCampusNote', coalesce(v_uni is not null and b.university_id = v_uni and public.buzz_v2_campus_small(v_uni), false));
end;
$$;

create or replace function public.buzz_v2_replies(p_thread uuid, p_offset int default 0, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  b public.buzz_posts;
begin
  select * into b from public.buzz_posts where id = p_thread;
  if not public.buzz_v2_root_ok(b, v_me) then
    perform public.buzz_v2_not_found();
  end if;
  return public.buzz_v2_reply_page(b, v_me, p_offset, p_limit, false);
end;
$$;

-- My buzzes (threads | replies), newest first: BuzzPage<MyBuzzItem>. Only ever the caller's own.
create or replace function public.buzz_v2_mine(p_kind text default 'threads', p_offset int default 0, p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_kind text := coalesce(p_kind, 'threads');
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_items jsonb := '[]'::jsonb;
  v_total int;
  c public.buzz_comments;
  root public.buzz_posts;
  v_books jsonb := '{}'::jsonb;
  v_shapes jsonb := '{}'::jsonb;
  v_book jsonb;
  v_shape jsonb;
begin
  if v_kind not in ('threads', 'replies') then
    raise exception 'buzz:validation_failed:Pick threads or replies.';
  end if;
  if v_kind = 'threads' then
    select count(*) into v_total from public.buzz_posts x where x.author_id = v_me and x.status <> 'deleted';
    select coalesce(jsonb_agg(jsonb_build_object(
             'item', public.buzz_root_json(b, v_me, false),
             'threadSnippet', public.buzz_snippet(public.buzz_headline(b.title, b.body), 120)) order by b.created_at desc, b.id desc), '[]'::jsonb)
    into v_items
    from (
      select * from public.buzz_posts x
      where x.author_id = v_me and x.status <> 'deleted'
      order by x.created_at desc, x.id desc
      limit v_limit offset v_offset
    ) b;
  else
    select count(*) into v_total from public.buzz_comments x where x.author_id = v_me and x.status <> 'deleted';
    for c in
      select * from public.buzz_comments x
      where x.author_id = v_me and x.status <> 'deleted'
      order by x.created_at desc, x.id desc
      limit v_limit offset v_offset
    loop
      select * into root from public.buzz_posts where id = c.post_id;
      -- one alias book and one reply walk per thread on the page, never per row
      if not (v_books ? c.post_id::text) then
        v_books := v_books || jsonb_build_object(c.post_id::text, public.buzz_v2_alias_book(c.post_id));
        v_shapes := v_shapes || jsonb_build_object(c.post_id::text, (
          select coalesce(jsonb_object_agg(v.id::text, jsonb_build_object('p', v.shape_parent, 'd', v.shape_depth, 'k', v.replying_key)), '{}'::jsonb)
          from public.buzz_v2_visible_replies(c.post_id, v_me, false) v));
      end if;
      v_book := v_books -> c.post_id::text;
      v_shape := v_shapes -> c.post_id::text -> c.id::text;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'item', public.buzz_reply_json(
          c, v_me, false,
          coalesce((v_shape ->> 'p')::uuid, c.post_id),
          coalesce((v_shape ->> 'd')::int, 1),
          case when v_shape ->> 'k' is not null then v_book -> (v_shape ->> 'k') end,
          v_book -> public.buzz_author_key(c.author_id, c.alias),
          public.buzz_author_key(root.author_id, root.alias)),
        'threadSnippet', case
          when root.id is not null and (root.status = 'active' or coalesce(root.author_id = v_me, false))
          then public.buzz_snippet(public.buzz_headline(root.title, root.body), 120)
          else '' end));
    end loop;
  end if;
  return jsonb_build_object('items', v_items, 'nextOffset', case when v_total > v_offset + v_limit then v_offset + v_limit end);
end;
$$;

-- Private: the sum of the scores of the caller's own buzzes and replies (not deleted ones).
create or replace function public.buzz_v2_karma()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
begin
  return (coalesce((select sum(b.score) from public.buzz_posts b where b.author_id = v_me and b.status <> 'deleted'), 0)
        + coalesce((select sum(c.score) from public.buzz_comments c where c.author_id = v_me and c.status <> 'deleted'), 0))::int;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. The gate and the composer's posting status (before acceptance too)
-- -----------------------------------------------------------------------------
create or replace function public.buzz_v2_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_me();
  v_version text;
begin
  select g.version into v_version from public.buzz_gate g where g.user_id = v_me;
  return jsonb_build_object(
    'acceptedVersion', v_version,
    'currentVersion', public.buzz_guidelines_version(),
    'accepted', v_version is not distinct from public.buzz_guidelines_version());
end;
$$;

create or replace function public.buzz_v2_accept_gate(p_version text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_me();
begin
  if p_version is distinct from public.buzz_guidelines_version() then
    raise exception 'buzz:validation_failed:The Buzz guidelines changed. Reload and read them again.';
  end if;
  insert into public.buzz_gate (user_id, version, accepted_at) values (v_me, p_version, now())
  on conflict (user_id) do update set version = excluded.version, accepted_at = excluded.accepted_at;
  return public.buzz_v2_gate();
end;
$$;

-- BuzzPostingStatus: what the composer may do right now (the write API checks the same).
create or replace function public.buzz_v2_posting_status()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_me();
  v_status jsonb;
  v_created timestamptz;
begin
  v_status := coalesce(public.ts_posting_status(v_me, 'buzz'), '{}'::jsonb);
  select p.created_at into v_created from public.profiles p where p.id = v_me;
  return jsonb_build_object(
    'allowed', coalesce((v_status ->> 'allowed')::boolean, false),
    'mutedUntil', case when jsonb_typeof(v_status -> 'mutedUntil') = 'number' then v_status -> 'mutedUntil' end,
    'reason', case when v_status ->> 'reason' in ('muted', 'suspended', 'banned', 'warning') then v_status ->> 'reason' end,
    'warningId', v_status ->> 'warningId',
    'pollsUnlockAt', case when v_created + interval '24 hours' > now() then public.buzz_ms(v_created + interval '24 hours') end);
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Interactions
-- -----------------------------------------------------------------------------
-- Vote on a thread or a reply: 1 up, -1 down, 0 clears. The community rules run in the same transaction (UniVerse
-- votes.ts): eligible votes only (accounts a day old, allowed to post, trusted, not the author); collapse at <= -5
-- with >= 8 eligible votes; auto-hide at <= -10 with >= 12 (hidden, queued for review, P2, never for an item staff
-- approved); milestones at 10 / 25 / 50 / 100 / 250 upvotes, once each.
create or replace function public.buzz_v2_vote(p_id uuid, p_value int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  b public.buzz_posts;
  c public.buzz_comments;
  root public.buzz_posts;
  v_type text;
  v_author uuid;
  v_status text;
  v_immune boolean := false;
  v_reachable boolean := false;
  v_before int := 0;
  v_created timestamptz;
  v_posting jsonb;
  v_eligible boolean;
  v_up int;
  v_down int;
  v_ev int;
  v_es int;
  v_snippet text;
  m int;
begin
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'buzz:validation_failed:A vote is up, down or nothing.';
  end if;
  select * into b from public.buzz_posts where id = p_id for update;
  if b.id is not null then
    v_type := 'buzz';
    root := b;
    v_author := b.author_id;
    v_status := b.status;
    v_immune := b.auto_hide_immune;
    v_before := b.upvotes;
    v_reachable := public.buzz_v2_root_ok(b, v_me);
  else
    select * into c from public.buzz_comments where id = p_id for update;
    if c.id is not null then
      v_type := 'buzz_reply';
      select * into root from public.buzz_posts where id = c.post_id;
      v_author := c.author_id;
      v_status := c.status;
      v_immune := c.auto_hide_immune;
      v_before := c.upvotes;
      v_reachable := public.buzz_v2_root_ok(root, v_me) and public.buzz_v2_reply_ok(c, v_me);
    end if;
  end if;
  -- Only its author can reach an item of theirs that others cannot see, so this answer tells nobody else anything.
  if v_reachable and coalesce(v_author = v_me, false) then
    raise exception 'buzz:own_item:You can''t vote on your own buzz.';
  end if;
  if not v_reachable or v_status <> 'active' then
    perform public.buzz_v2_not_found();
  end if;
  perform public.buzz_v2_rate_limit(v_me, 'vote');

  select p.created_at into v_created from public.profiles p where p.id = v_me;
  v_posting := coalesce(public.ts_posting_status(v_me, 'buzz'), '{}'::jsonb);
  v_eligible := coalesce(v_created <= now() - interval '24 hours', false)
    and (coalesce((v_posting ->> 'allowed')::boolean, false) or v_posting ->> 'reason' = 'warning')
    and coalesce(public.ts_reporter_trust(v_me), 'normal') <> 'low';

  if v_type = 'buzz' then
    if p_value = 0 then
      delete from public.buzz_votes where post_id = p_id and user_id = v_me;
    else
      insert into public.buzz_votes (post_id, user_id, value, eligible, created_at) values (p_id, v_me, p_value, v_eligible, now())
      on conflict (post_id, user_id) do update set value = excluded.value, eligible = excluded.eligible, created_at = excluded.created_at;
    end if;
    select (count(*) filter (where x.value = 1))::int, (count(*) filter (where x.value = -1))::int,
           (count(*) filter (where x.eligible))::int, coalesce(sum(x.value) filter (where x.eligible), 0)::int
    into v_up, v_down, v_ev, v_es
    from public.buzz_votes x where x.post_id = p_id;
    update public.buzz_posts set upvotes = v_up, downvotes = v_down, score = v_up - v_down, eligible_votes = v_ev, eligible_score = v_es
    where id = p_id;
  else
    if p_value = 0 then
      delete from public.buzz_comment_votes where comment_id = p_id and user_id = v_me;
    else
      insert into public.buzz_comment_votes (comment_id, user_id, value, eligible, created_at) values (p_id, v_me, p_value, v_eligible, now())
      on conflict (comment_id, user_id) do update set value = excluded.value, eligible = excluded.eligible, created_at = excluded.created_at;
    end if;
    select (count(*) filter (where x.value = 1))::int, (count(*) filter (where x.value = -1))::int,
           (count(*) filter (where x.eligible))::int, coalesce(sum(x.value) filter (where x.eligible), 0)::int
    into v_up, v_down, v_ev, v_es
    from public.buzz_comment_votes x where x.comment_id = p_id;
    update public.buzz_comments set upvotes = v_up, downvotes = v_down, score = v_up - v_down, eligible_votes = v_ev, eligible_score = v_es
    where id = p_id;
  end if;

  if v_es <= -10 and v_ev >= 12 and not coalesce(v_immune, false) then
    if v_type = 'buzz' then
      update public.buzz_posts set status = 'hidden' where id = p_id and status = 'active';
    else
      update public.buzz_comments set status = 'hidden' where id = p_id and status = 'active';
    end if;
    perform public.ts_enqueue(
      p_entity_type => v_type, p_entity_id => p_id, p_surface => v_type, p_university => root.university_id, p_author => v_author,
      p_source => 'community_score', p_category => null, p_severity => 'none', p_priority => 'p2', p_label => null,
      p_rule_ids => '[]'::jsonb, p_blocked_text => null, p_report_delta => 0, p_weight_delta => 0);
  end if;

  if v_up > coalesce(v_before, 0) and v_author is not null then
    v_snippet := public.buzz_snippet(case when v_type = 'buzz' then public.buzz_headline(b.title, b.body) else c.body end, 80);
    foreach m in array array[10, 25, 50, 100, 250] loop
      continue when v_up < m;
      insert into public.buzz_milestones (target_type, target_id, milestone, day)
      values (v_type, p_id, m, floor(extract(epoch from now()) / 86400)::int)
      on conflict do nothing;
      if found then
        perform public.buzz_v2_notify(v_author, 'buzz_milestone', 'Your buzz passed ' || m || ' upvotes', v_snippet, root.id, v_type, p_id, now());
      end if;
    end loop;
  end if;
  return jsonb_build_object('score', v_up - v_down, 'myVote', p_value, 'collapsed', v_es <= -5 and v_ev >= 8);
end;
$$;

-- One vote per poll, no changing it, not in your own poll, not once it closed. Returns the poll with its results.
create or replace function public.buzz_v2_poll_vote(p_thread uuid, p_option uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  b public.buzz_posts;
  pl public.buzz_polls;
  v_choice uuid;
begin
  select * into b from public.buzz_posts where id = p_thread;
  if not (public.buzz_v2_root_ok(b, v_me) and b.status = 'active') then
    perform public.buzz_v2_not_found();
  end if;
  select * into pl from public.buzz_polls where post_id = b.id for update;
  if pl.post_id is null then
    raise exception 'buzz:not_found:This buzz has no poll.';
  end if;
  if coalesce(b.author_id = v_me, false) then
    raise exception 'buzz:own_item:You can''t vote in your own poll.';
  end if;
  if pl.closes_at <= now() then
    raise exception 'buzz:poll_closed:This poll has closed.';
  end if;
  if p_option is null or not exists (select 1 from public.buzz_poll_options o where o.id = p_option and o.post_id = b.id) then
    raise exception 'buzz:validation_failed:Pick one of the options.';
  end if;
  select v.option_id into v_choice from public.buzz_poll_votes v where v.post_id = b.id and v.user_id = v_me;
  if v_choice is not null and v_choice <> p_option then
    raise exception 'buzz:already_voted:You already voted in this poll.';
  end if;
  if v_choice is null then
    insert into public.buzz_poll_votes (post_id, user_id, option_id) values (b.id, v_me, p_option) on conflict do nothing;
    if found then
      update public.buzz_poll_options set vote_count = vote_count + 1 where id = p_option;
    end if;
  end if;
  return public.buzz_v2_poll_json(b.id, v_me, false);
end;
$$;

-- Delete your own buzz or reply (soft: status 'deleted'). Anyone else's answers exactly like a missing one.
create or replace function public.buzz_v2_delete(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_done int := 0;
begin
  update public.buzz_posts set status = 'deleted', deleted_at = now() where id = p_id and author_id = v_me and status <> 'deleted';
  get diagnostics v_done = row_count;
  if v_done > 0 then
    perform public.buzz_v2_drop_notifications('buzz', p_id);
    return;
  end if;
  update public.buzz_comments set status = 'deleted', deleted_at = now() where id = p_id and author_id = v_me and status <> 'deleted';
  get diagnostics v_done = row_count;
  if v_done > 0 then
    perform public.buzz_v2_drop_notifications('buzz_reply', p_id);
    return;
  end if;
  perform public.buzz_v2_not_found();
end;
$$;

-- Hide a whole thread from your feeds (it still opens from a link), or bring it back.
create or replace function public.buzz_v2_hide_thread(p_thread uuid, p_hide boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  b public.buzz_posts;
begin
  if coalesce(p_hide, true) then
    select * into b from public.buzz_posts where id = p_thread;
    if not public.buzz_v2_root_ok(b, v_me) then
      perform public.buzz_v2_not_found();
    end if;
    insert into public.buzz_hidden_threads (user_id, thread_id) values (v_me, b.id) on conflict do nothing;
  else
    delete from public.buzz_hidden_threads where user_id = v_me and thread_id = p_thread;
  end if;
end;
$$;

-- The thread or reply p_id as the viewer may reach it (for hide-author and report): its type, author and thread.
create or replace function public.buzz_v2_reach(p_id uuid, p_viewer uuid, out entity_type text, out author_id uuid, out thread_id uuid, out university_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.buzz_posts;
  c public.buzz_comments;
  root public.buzz_posts;
begin
  select * into b from public.buzz_posts where id = p_id;
  if b.id is not null then
    if public.buzz_v2_root_ok(b, p_viewer) then
      entity_type := 'buzz';
      author_id := b.author_id;
      thread_id := b.id;
      university_id := b.university_id;
    end if;
    return;
  end if;
  select * into c from public.buzz_comments where id = p_id;
  if c.id is null then
    return;
  end if;
  select * into root from public.buzz_posts where id = c.post_id;
  if public.buzz_v2_root_ok(root, p_viewer) and public.buzz_v2_reply_ok(c, p_viewer) then
    entity_type := 'buzz_reply';
    author_id := c.author_id;
    thread_id := root.id;
    university_id := root.university_id;
  end if;
end;
$$;

-- "Hide this anon in this thread": keyed on thread + author here, so the caller never learns who it is and it never
-- reaches another thread. Your own item: quietly nothing (no "that's you" answer).
create or replace function public.buzz_v2_hide_author(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  r record;
begin
  select * into r from public.buzz_v2_reach(p_id, v_me);
  if r.entity_type is null then
    perform public.buzz_v2_not_found();
  end if;
  if r.author_id is not null and r.author_id <> v_me then
    insert into public.buzz_mutes (user_id, post_id, muted_id, legacy) values (v_me, r.thread_id, r.author_id, false) on conflict do nothing;
  end if;
end;
$$;

-- Report a buzz or a reply (Trust & Safety files it, weighs it and may auto-hide it). It then leaves the reporter's
-- feeds and threads. Never offers a block.
create or replace function public.buzz_v2_report(p_id uuid, p_reason text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_note text := nullif(public.buzz_trim(p_note), '');
  r record;
  v_res jsonb;
begin
  if p_reason is null or p_reason not in ('self_harm', 'threat', 'minor_safety', 'doxxing', 'harassment', 'hate', 'sexual', 'drugs_illegal',
                                          'impersonation', 'spam_scam', 'academic_dishonesty', 'other') then
    raise exception 'buzz:validation_failed:Pick a reason.';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'buzz:validation_failed:Keep the note under 500 characters.';
  end if;
  if p_reason = 'other' and char_length(coalesce(v_note, '')) < 10 then
    raise exception 'buzz:validation_failed:Tell us a bit more (at least 10 characters).';
  end if;
  if exists (select 1 from public.reports x where x.reporter_id = v_me and x.target_type in ('buzz', 'buzz_comment') and x.target_id = p_id) then
    return jsonb_build_object('alreadyReported', true);
  end if;
  select * into r from public.buzz_v2_reach(p_id, v_me);
  if r.entity_type is null then
    perform public.buzz_v2_not_found();
  end if;
  if coalesce(r.author_id = v_me, false) then
    raise exception 'buzz:own_item:You can''t report your own buzz.';
  end if;
  v_res := public.ts_file_report(v_me, r.entity_type, p_id, p_reason, v_note, r.university_id);
  return jsonb_build_object('alreadyReported', coalesce((v_res ->> 'alreadyReported')::boolean, false));
end;
$$;

-- A buzz as a card (UniVerse's card resolver): its headline and "Buzz · {campus}" (only for campuses big enough to be
-- named), no image, no alias, nobody's name. Anything not active and published is simply unavailable.
create or replace function public.buzz_v2_share_snapshot(p_thread uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  b public.buzz_posts;
  v_campus text;
begin
  select * into b from public.buzz_posts where id = p_thread;
  if b.id is null or b.status <> 'active' or b.visible_at > now() then
    return jsonb_build_object('targetType', 'buzz', 'targetId', p_thread, 'status', 'unavailable', 'title', null, 'subtitle', 'Buzz',
                              'href', '/buzz/' || coalesce(p_thread::text, ''), 'imageUrl', null);
  end if;
  v_campus := public.buzz_v2_campus_name(b.university_id);
  return jsonb_build_object(
    'targetType', 'buzz',
    'targetId', b.id,
    'status', 'available',
    'title', public.buzz_snippet(public.buzz_headline(b.title, b.body), 100),
    'subtitle', case when v_campus is not null then 'Buzz · ' || v_campus else 'Buzz' end,
    'href', '/buzz/' || b.id,
    'imageUrl', null);
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Writes: the website's moderated write API only (service role)
-- -----------------------------------------------------------------------------
-- Post a buzz (CreateBuzzRequest), already moderated by the caller: p_status 'active' or 'held', p_support_link when
-- the text triggered the support resources, p_moderation = the engine's record for Trust & Safety. Everything is
-- checked again here. Returns the buzz as its author sees it.
create or replace function public.buzz_v2_create(
  p_author uuid, p_input jsonb, p_status text default 'active', p_support_link boolean default false, p_moderation jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, storage
as $$
declare
  v_cfg public.buzz_secrets;
  v_me public.profiles;
  v_in jsonb := coalesce(p_input, '{}'::jsonb);
  v_status text := coalesce(p_status, 'active');
  v_text text;
  v_title text;
  v_scope text;
  v_images text[] := '{}'::text[];
  v_meta jsonb := '[]'::jsonb;
  v_videos jsonb := '[]'::jsonb;
  v_item jsonb;
  v_url text;
  v_prefix text;
  v_video jsonb;
  v_pb text;
  v_media public.media;
  v_duration numeric;
  v_poster text;
  v_width numeric;
  v_height numeric;
  v_options text[];
  v_days int;
  v_prompt uuid;
  v_id uuid := gen_random_uuid();
  v_visible timestamptz;
  b public.buzz_posts;
begin
  perform public.buzz_v2_assert_writer(p_author);
  if v_status not in ('active', 'held') then
    raise exception 'buzz:validation_failed:A new buzz is active or held for review.';
  end if;
  if jsonb_typeof(v_in) <> 'object'
     or coalesce(jsonb_typeof(v_in -> 'text'), 'null') not in ('string', 'null')
     or coalesce(jsonb_typeof(v_in -> 'title'), 'null') not in ('string', 'null') then
    raise exception 'buzz:validation_failed:Say something first.';
  end if;
  select * into v_me from public.profiles where id = p_author;
  select * into v_cfg from public.buzz_secrets where id = 1;

  -- words: an optional title and a body, one of them saying something
  v_text := public.buzz_trim(v_in ->> 'text');
  v_title := public.buzz_trim(v_in ->> 'title');
  if char_length(v_text) > 500 then
    raise exception 'buzz:validation_failed:Keep it under 500 characters.';
  end if;
  if char_length(v_title) > 100 then
    raise exception 'buzz:validation_failed:Keep the title under 100 characters.';
  end if;
  if v_text = '' and v_title = '' then
    raise exception 'buzz:validation_failed:Say something first.';
  end if;

  -- where: Campus (the author's university) or Global, never both
  v_scope := coalesce(v_in ->> 'scope', 'campus');
  if v_scope not in ('campus', 'global') then
    raise exception 'buzz:validation_failed:Pick Campus or Global.';
  end if;
  if v_scope = 'campus' and v_me.university_id is null then
    raise exception 'buzz:validation_failed:Add your university to your profile to buzz on its campus feed.';
  end if;

  -- photos: up to 4, from this project's anonymous folder under a random name, really uploaded by the author
  if jsonb_typeof(v_in -> 'images') = 'array' then
    if jsonb_array_length(v_in -> 'images') > 4 then
      raise exception 'buzz:validation_failed:You can attach up to 4 photos.';
    end if;
    v_prefix := v_cfg.storage_origin || '/storage/v1/object/public/uploads/buzz/anon/';
    for v_item in select e from jsonb_array_elements(v_in -> 'images') as e loop
      v_url := case when jsonb_typeof(v_item) = 'string' then v_item #>> '{}' end;
      if v_url is null
         or left(v_url, length(v_cfg.storage_origin)) <> v_cfg.storage_origin
         or substr(v_url, length(v_cfg.storage_origin) + 1) !~ '^/storage/v1/object/public/uploads/buzz/anon/[a-f0-9]{32,64}\.(jpg|jpeg|png|webp)$'
         or not exists (
           select 1 from storage.objects o
           where o.bucket_id = 'uploads' and o.name = 'buzz/anon/' || substr(v_url, length(v_prefix) + 1)
             and (to_jsonb(o) ->> 'owner_id' = p_author::text or to_jsonb(o) ->> 'owner' = p_author::text)) then
        raise exception 'buzz:validation_failed:Buzz photos must be uploaded anonymously.';
      end if;
      if not (v_url = any (v_images)) then
        v_images := v_images || v_url;
      end if;
    end loop;
  elsif coalesce(jsonb_typeof(v_in -> 'images'), 'null') <> 'null' then
    raise exception 'buzz:validation_failed:Buzz photos must be uploaded anonymously.';
  end if;
  -- one meta entry per attached photo, numbers only, a small blur only
  select coalesce(jsonb_agg(t.entry), '[]'::jsonb) into v_meta
  from (
    select distinct on (m ->> 'url') jsonb_build_object(
      'url', m ->> 'url',
      'width', case when jsonb_typeof(m -> 'width') = 'number' and (m ->> 'width')::numeric between 1 and 50000 then m -> 'width' else 'null'::jsonb end,
      'height', case when jsonb_typeof(m -> 'height') = 'number' and (m ->> 'height')::numeric between 1 and 50000 then m -> 'height' else 'null'::jsonb end,
      'blur', case when jsonb_typeof(m -> 'blur') = 'string' and (m ->> 'blur') like 'data:image/%' and length(m ->> 'blur') <= 4000 then m -> 'blur' else 'null'::jsonb end
    ) as entry
    from jsonb_array_elements(case when jsonb_typeof(v_in -> 'imageMeta') = 'array' and jsonb_array_length(v_in -> 'imageMeta') <= 24
                                   then v_in -> 'imageMeta' else '[]'::jsonb end) as m
    where jsonb_typeof(m) = 'object' and m ->> 'url' = any (v_images)
    order by m ->> 'url'
  ) t;

  -- or one video: the author's own finished Mux upload, 60 seconds at most, stored without its media id
  if jsonb_typeof(v_in -> 'video') = 'object' then
    if cardinality(v_images) > 0 then
      raise exception 'buzz:validation_failed:Add photos or one video, not both.';
    end if;
    v_video := v_in -> 'video';
    v_pb := case when jsonb_typeof(v_video -> 'playbackId') = 'string' then v_video ->> 'playbackId' end;
    if v_pb is null or v_pb !~ '^[A-Za-z0-9]{8,120}$' then
      raise exception 'buzz:validation_failed:That video isn''t ready yet.';
    end if;
    select * into v_media from public.media m
    where m.playback_id = v_pb and m.owner_id = p_author and m.status = 'ready'
    order by m.created_at desc
    limit 1;
    if v_media.id is null then
      raise exception 'buzz:validation_failed:That video isn''t ready yet.';
    end if;
    v_duration := coalesce(v_media.duration_seconds,
                           case when jsonb_typeof(v_video -> 'durationSeconds') = 'number' then (v_video ->> 'durationSeconds')::numeric end);
    if v_duration is not null and (v_duration < 0 or v_duration > 60.5) then
      raise exception 'buzz:validation_failed:Videos on Buzz max out at 60 seconds.';
    end if;
    v_poster := coalesce(v_media.poster_url, case when jsonb_typeof(v_video -> 'posterUrl') = 'string' then v_video ->> 'posterUrl' end);
    if v_poster is null or length(v_poster) > 300 or v_poster !~ ('^https://image\.mux\.com/' || v_pb || '/[A-Za-z0-9._?=&-]+$') then
      v_poster := null;
    end if;
    v_width := coalesce(v_media.width::numeric, case when jsonb_typeof(v_video -> 'width') = 'number' then (v_video ->> 'width')::numeric end);
    v_height := coalesce(v_media.height::numeric, case when jsonb_typeof(v_video -> 'height') = 'number' then (v_video ->> 'height')::numeric end);
    v_videos := jsonb_build_array(jsonb_build_object(
      'media_id', '00000000-0000-0000-0000-000000000000',
      'playback_id', v_pb,
      'poster_url', v_poster,
      'width', case when v_width between 1 and 20000 then v_width end,
      'height', case when v_height between 1 and 20000 then v_height end,
      'duration_seconds', v_duration));
  elsif coalesce(jsonb_typeof(v_in -> 'video'), 'null') <> 'null' then
    raise exception 'buzz:validation_failed:That video isn''t ready yet.';
  end if;

  -- a poll: 2-4 different options of 1-60 characters, 1, 3 or 7 days, from accounts at least a day old
  if jsonb_typeof(v_in -> 'poll') = 'object' then
    if coalesce(jsonb_typeof(v_in -> 'poll' -> 'options'), '') <> 'array'
       or exists (select 1 from jsonb_array_elements(v_in -> 'poll' -> 'options') as e where jsonb_typeof(e) <> 'string') then
      raise exception 'buzz:validation_failed:Polls need 2 to 4 options.';
    end if;
    select array_agg(public.buzz_trim(x.e #>> '{}') order by x.n) into v_options
    from jsonb_array_elements(v_in -> 'poll' -> 'options') with ordinality as x(e, n);
    if coalesce(cardinality(v_options), 0) not between 2 and 4 then
      raise exception 'buzz:validation_failed:Polls need 2 to 4 options.';
    end if;
    if exists (select 1 from unnest(v_options) as o where char_length(o) not between 1 and 60) then
      raise exception 'buzz:validation_failed:Each poll option needs 1 to 60 characters.';
    end if;
    if (select count(distinct lower(o)) from unnest(v_options) as o) <> cardinality(v_options) then
      raise exception 'buzz:validation_failed:Poll options must be different.';
    end if;
    v_days := case when jsonb_typeof(v_in -> 'poll' -> 'durationDays') = 'number' and (v_in -> 'poll' ->> 'durationDays') in ('1', '3', '7')
                   then (v_in -> 'poll' ->> 'durationDays')::int end;
    if v_days is null then
      raise exception 'buzz:validation_failed:Polls run for 1, 3 or 7 days.';
    end if;
    if v_me.created_at > now() - interval '24 hours' then
      raise exception 'buzz:too_new:Polls unlock 24 hours after you join.';
    end if;
  elsif coalesce(jsonb_typeof(v_in -> 'poll'), 'null') <> 'null' then
    raise exception 'buzz:validation_failed:Polls need 2 to 4 options.';
  end if;

  -- answering a Daily Campus Prompt
  if coalesce(jsonb_typeof(v_in -> 'promptId'), 'null') <> 'null' then
    if jsonb_typeof(v_in -> 'promptId') = 'string' and (v_in ->> 'promptId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select p.id into v_prompt from public.buzz_prompts p where p.id = (v_in ->> 'promptId')::uuid;
    end if;
    if v_prompt is null then
      raise exception 'buzz:validation_failed:That prompt has expired.';
    end if;
  end if;

  perform public.buzz_v2_rate_limit(p_author, 'thread');
  v_visible := now() + make_interval(secs => random() * greatest(coalesce(v_cfg.thread_jitter_seconds, 0), 0));
  insert into public.buzz_posts (id, author_id, alias, university_id, title, body, images, image_meta, videos, scope, status, support_link,
                                 prompt_id, created_at, visible_at)
  values (v_id, p_author, '', v_me.university_id, v_title, v_text, v_images, v_meta, v_videos, v_scope, v_status, coalesce(p_support_link, false),
          v_prompt, now(), v_visible);
  if v_options is not null then
    insert into public.buzz_polls (post_id, closes_at) values (v_id, public.buzz_floor_minute(v_visible) + make_interval(days => v_days));
    insert into public.buzz_poll_options (post_id, idx, text)
    select v_id, (u.n - 1)::int, u.o from unnest(v_options) with ordinality as u(o, n);
  end if;
  if jsonb_typeof(p_moderation) = 'object' then
    perform public.ts_apply_moderation(p_entity_type => 'buzz', p_entity_id => v_id, p_surface => 'buzz', p_author => p_author,
                                       p_university => v_me.university_id, p_moderation => p_moderation);
  end if;
  -- Held content waits for a person: it always has a queue item, even if the record named none.
  if v_status = 'held' and coalesce(jsonb_typeof(p_moderation -> 'queue'), '') <> 'object' then
    perform public.ts_enqueue(
      p_entity_type => 'buzz', p_entity_id => v_id, p_surface => 'buzz', p_university => v_me.university_id, p_author => p_author,
      p_source => 'rule_flag', p_category => null, p_severity => 'none', p_priority => 'p2', p_label => null,
      p_rule_ids => '[]'::jsonb, p_blocked_text => null, p_report_delta => 0, p_weight_delta => 0);
  end if;
  select * into b from public.buzz_posts where id = v_id;
  return public.buzz_root_json(b, p_author, false);
end;
$$;

-- Reply (CreateBuzzReplyRequest) in a thread the author can open, that is active and not locked; the parent (if any)
-- in the same thread and visible to the author. The reply never shows before its thread or its parent. Returns the
-- reply as its author sees it.
create or replace function public.buzz_v2_reply(
  p_author uuid, p_thread uuid, p_input jsonb, p_status text default 'active', p_support_link boolean default false, p_moderation jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cfg public.buzz_secrets;
  v_in jsonb := coalesce(p_input, '{}'::jsonb);
  v_status text := coalesce(p_status, 'active');
  v_text text;
  v_parent_text text;
  root public.buzz_posts;
  par public.buzz_comments;
  c public.buzz_comments;
  v_id uuid := gen_random_uuid();
  v_visible timestamptz;
  v_book jsonb;
  v_shape record;
begin
  perform public.buzz_v2_assert_writer(p_author);
  if v_status not in ('active', 'held') then
    raise exception 'buzz:validation_failed:A new reply is active or held for review.';
  end if;
  if jsonb_typeof(v_in) <> 'object' or coalesce(jsonb_typeof(v_in -> 'text'), 'null') not in ('string', 'null') then
    raise exception 'buzz:validation_failed:Say something first.';
  end if;
  v_text := public.buzz_trim(v_in ->> 'text');
  if v_text = '' then
    raise exception 'buzz:validation_failed:Say something first.';
  end if;
  if char_length(v_text) > 500 then
    raise exception 'buzz:validation_failed:Keep replies under 500 characters.';
  end if;
  select * into root from public.buzz_posts where id = p_thread;
  if not (public.buzz_v2_root_ok(root, p_author) and root.status = 'active') then
    perform public.buzz_v2_not_found();
  end if;
  if root.locked then
    raise exception 'buzz:locked:This thread is locked.';
  end if;
  v_parent_text := case when jsonb_typeof(v_in -> 'parentId') = 'string' then v_in ->> 'parentId' end;
  if v_parent_text is not null and v_parent_text <> root.id::text then
    if v_parent_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select * into par from public.buzz_comments where id = v_parent_text::uuid;
    end if;
    if not (par.id is not null and par.post_id = root.id and public.buzz_v2_reply_ok(par, p_author)
            and (par.status = 'active' or coalesce(par.author_id = p_author, false))
            and not exists (select 1 from public.reports x where x.reporter_id = p_author and x.target_type = 'buzz_comment' and x.target_id = par.id)) then
      perform public.buzz_v2_not_found();
    end if;
  end if;

  perform public.buzz_v2_rate_limit(p_author, 'reply');
  select * into v_cfg from public.buzz_secrets where id = 1;
  v_visible := greatest(
    now() + make_interval(secs => random() * greatest(coalesce(v_cfg.reply_jitter_seconds, 0), 0)),
    root.visible_at,
    coalesce(par.visible_at, '-infinity'::timestamptz));
  insert into public.buzz_comments (id, post_id, author_id, alias, is_op, parent_id, body, status, support_link, depth, created_at, visible_at)
  values (v_id, root.id, p_author, '', coalesce(root.author_id = p_author, false), par.id, v_text, v_status, coalesce(p_support_link, false),
          coalesce(par.depth, 0) + 1, now(), v_visible);
  if jsonb_typeof(p_moderation) = 'object' then
    perform public.ts_apply_moderation(p_entity_type => 'buzz_reply', p_entity_id => v_id, p_surface => 'buzz_reply', p_author => p_author,
                                       p_university => root.university_id, p_moderation => p_moderation);
  end if;
  if v_status = 'held' and coalesce(jsonb_typeof(p_moderation -> 'queue'), '') <> 'object' then
    perform public.ts_enqueue(
      p_entity_type => 'buzz_reply', p_entity_id => v_id, p_surface => 'buzz_reply', p_university => root.university_id, p_author => p_author,
      p_source => 'rule_flag', p_category => null, p_severity => 'none', p_priority => 'p2', p_label => null,
      p_rule_ids => '[]'::jsonb, p_blocked_text => null, p_report_delta => 0, p_weight_delta => 0);
  end if;
  select * into c from public.buzz_comments where id = v_id;
  v_book := public.buzz_v2_alias_book(root.id);
  select * into v_shape from public.buzz_v2_visible_replies(root.id, p_author, false) v where v.id = v_id;
  return public.buzz_reply_json(
    c, p_author, false,
    coalesce(v_shape.shape_parent, root.id),
    coalesce(v_shape.shape_depth, 1),
    case when v_shape.replying_key is not null then v_book -> v_shape.replying_key end,
    v_book -> public.buzz_author_key(c.author_id, c.alias),
    public.buzz_author_key(root.author_id, root.alias));
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. Adapters for Trust & Safety (migration 41 calls these; no API role can)
-- -----------------------------------------------------------------------------
-- {entityType, entityId, status, universityId, surface, label, autoHideImmune, createdAt, href, fields, media, parent}.
-- No author: that is buzz_v2_author_of().
create or replace function public.buzz_v2_snapshot(p_entity_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.buzz_posts;
  c public.buzz_comments;
begin
  if p_entity_type = 'buzz' then
    select * into b from public.buzz_posts where id = p_id;
    if b.id is null then
      return null;
    end if;
    return jsonb_build_object(
      'entityType', 'buzz',
      'entityId', b.id,
      'status', b.status,
      'universityId', b.university_id,
      'surface', 'buzz',
      'label', 'buzz',
      'autoHideImmune', b.auto_hide_immune,
      'createdAt', public.buzz_minute_ms(least(b.visible_at, now())),
      'href', '/buzz/' || b.id,
      'fields', (
        select coalesce(jsonb_agg(f.v order by f.n), '[]'::jsonb)
        from (
          select 0 as n, jsonb_build_object('field', 'title', 'text', b.title) as v where btrim(coalesce(b.title, '')) <> ''
          union all
          select 1, jsonb_build_object('field', 'body', 'text', b.body)
          union all
          select 2 + o.idx, jsonb_build_object('field', 'option', 'text', o.text) from public.buzz_poll_options o where o.post_id = b.id
        ) f),
      'media', (
        select coalesce(jsonb_agg(m.v order by m.n), '[]'::jsonb)
        from (
          select i.n, jsonb_build_object('url', i.url, 'kind', 'image') as v
          from unnest(coalesce(b.images, '{}'::text[])) with ordinality as i(url, n) where i.url is not null
          union all
          select 1000 + v.n, jsonb_build_object('url', 'https://stream.mux.com/' || (v.x ->> 'playback_id') || '.m3u8', 'kind', 'video')
          from jsonb_array_elements(case when jsonb_typeof(b.videos) = 'array' then b.videos else '[]'::jsonb end) with ordinality as v(x, n)
          where jsonb_typeof(v.x) = 'object' and coalesce(v.x ->> 'playback_id', '') ~ '^[A-Za-z0-9]{8,120}$'
        ) m),
      'parent', null);
  elsif p_entity_type = 'buzz_reply' then
    select * into c from public.buzz_comments where id = p_id;
    if c.id is null then
      return null;
    end if;
    select * into b from public.buzz_posts where id = c.post_id;
    return jsonb_build_object(
      'entityType', 'buzz_reply',
      'entityId', c.id,
      'status', c.status,
      'universityId', b.university_id,
      'surface', 'buzz_reply',
      'label', 'reply',
      'autoHideImmune', c.auto_hide_immune,
      'createdAt', public.buzz_minute_ms(least(c.visible_at, now())),
      'href', '/buzz/' || c.post_id,
      'fields', jsonb_build_array(jsonb_build_object('field', 'body', 'text', c.body)),
      'media', '[]'::jsonb,
      'parent', jsonb_build_object('entityType', case when c.parent_id is null then 'buzz' else 'buzz_reply' end,
                                   'entityId', coalesce(c.parent_id, c.post_id)));
  end if;
  return null;
end;
$$;

-- FIREWALL: the author of a Buzz item. The only way from Buzz content to an account (unmask, sanctions, strikes).
create or replace function public.buzz_v2_author_of(p_entity_type text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_entity_type
    when 'buzz' then (select b.author_id from public.buzz_posts b where b.id = p_id)
    when 'buzz_reply' then (select c.author_id from public.buzz_comments c where c.id = p_id)
  end;
$$;

-- Moderation states (approve -> active, optionally immune to further auto-hide; hide; remove). Removing or deleting
-- takes the item's notifications with it. Reply counts are always computed when read, so nothing else changes.
create or replace function public.buzz_v2_set_status(p_entity_type text, p_id uuid, p_status text, p_immune boolean default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_status is null or p_status not in ('active', 'held', 'hidden', 'removed', 'deleted') then
    raise exception 'buzz:validation_failed:Unknown Buzz status.';
  end if;
  -- hidden_at tells CampConnect Admin (see the header): set by a removal or an auto-hide, cleared by a restore. Its
  -- keep_moderation_columns trigger lets those two columns change only while app.moderation is on.
  perform set_config('app.moderation', 'on', true);
  if p_entity_type = 'buzz' then
    update public.buzz_posts
    set status = p_status,
        auto_hide_immune = coalesce(p_immune, auto_hide_immune),
        deleted_at = case when p_status = 'deleted' then coalesce(deleted_at, now()) else deleted_at end,
        hidden_from_status = case when p_status in ('hidden', 'removed') and status in ('active', 'held') then status
                                  when p_status in ('active', 'held') then null else hidden_from_status end,
        hidden_at = case when p_status in ('hidden', 'removed') then coalesce(hidden_at, now())
                         when p_status in ('active', 'held') then null else hidden_at end,
        hidden_reason = case when p_status in ('hidden', 'removed') then coalesce(hidden_reason, public.buzz_v2_hidden_reason(p_status))
                             when p_status in ('active', 'held') then null else hidden_reason end
    where id = p_id;
  elsif p_entity_type = 'buzz_reply' then
    update public.buzz_comments
    set status = p_status,
        auto_hide_immune = coalesce(p_immune, auto_hide_immune),
        deleted_at = case when p_status = 'deleted' then coalesce(deleted_at, now()) else deleted_at end,
        hidden_from_status = case when p_status in ('hidden', 'removed') and status in ('active', 'held') then status
                                  when p_status in ('active', 'held') then null else hidden_from_status end,
        hidden_at = case when p_status in ('hidden', 'removed') then coalesce(hidden_at, now())
                         when p_status in ('active', 'held') then null else hidden_at end,
        hidden_reason = case when p_status in ('hidden', 'removed') then coalesce(hidden_reason, public.buzz_v2_hidden_reason(p_status))
                             when p_status in ('active', 'held') then null else hidden_reason end
    where id = p_id;
  else
    perform set_config('app.moderation', '', true);
    raise exception 'buzz:validation_failed:Unknown Buzz item type.';
  end if;
  perform set_config('app.moderation', '', true);
  if p_status in ('removed', 'deleted') then
    perform public.buzz_v2_drop_notifications(p_entity_type, p_id);
  end if;
end;
$$;

-- What CampConnect Admin's hidden list says about an item Buzz moderation took down.
create or replace function public.buzz_v2_hidden_reason(p_status text)
returns text
language sql
immutable
as $$
  select case p_status when 'hidden' then 'Hidden by reports on Buzz, waiting for review' else 'Removed by Buzz moderation' end;
$$;

-- CampConnect Admin hides and restores with hidden_at alone, inside its staff functions (app.moderation on). Buzz
-- follows: a hide removes the item, a restore brings back what it was before (active when that is unknown). Updates
-- through buzz_v2_set_status change the status themselves and are left alone.
create or replace function public.buzz_v2_follow_hidden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.moderation', true) is distinct from 'on' or new.status is distinct from old.status then
    return new;
  end if;
  if old.hidden_at is null and new.hidden_at is not null and new.status in ('active', 'held') then
    new.hidden_from_status := new.status;
    new.status := 'removed';
    perform public.buzz_v2_drop_notifications(tg_argv[0], new.id);
  elsif old.hidden_at is not null and new.hidden_at is null and new.status in ('hidden', 'removed') then
    new.status := coalesce(new.hidden_from_status, 'active');
    new.hidden_from_status := null;
  end if;
  return new;
end;
$$;
-- Named to run after CampConnect Admin's buzz_*_keep_moderation triggers (alphabetical), which undo a hidden_at
-- change made without app.moderation.
drop trigger if exists buzz_posts_moderation_follow on public.buzz_posts;
create trigger buzz_posts_moderation_follow before update of hidden_at on public.buzz_posts
  for each row execute function public.buzz_v2_follow_hidden('buzz');
drop trigger if exists buzz_comments_moderation_follow on public.buzz_comments;
create trigger buzz_comments_moderation_follow before update of hidden_at on public.buzz_comments
  for each row execute function public.buzz_v2_follow_hidden('buzz_reply');

-- Items hidden there before this migration (and any hidden since by hand) are removed here too.
update public.buzz_posts set hidden_from_status = status, status = 'removed' where hidden_at is not null and status in ('active', 'held');
update public.buzz_comments set hidden_from_status = status, status = 'removed' where hidden_at is not null and status in ('active', 'held');

-- CampConnect Admin's suspensions: its block_suspended_writes() trigger is on the other Buzz tables it knew; poll votes
-- get it too.
do $$
begin
  if to_regprocedure('public.block_suspended_writes()') is not null then
    drop trigger if exists buzz_poll_votes_block_suspended on public.buzz_poll_votes;
    create trigger buzz_poll_votes_block_suspended before insert or update on public.buzz_poll_votes
      for each row execute function public.block_suspended_writes();
  end if;
end
$$;

create or replace function public.buzz_v2_set_locked(p_id uuid, p_locked boolean)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.buzz_posts set locked = coalesce(p_locked, false) where id = p_id;
$$;

-- UniVerse blindStaffContext: the thread, the item, its parent chain and 3 replies either side, all through the
-- serializer in its blind staff mode (every status readable; isMine false; no votes; no identity of any kind).
create or replace function public.buzz_v2_staff_context(p_entity_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  root public.buzz_posts;
  c public.buzz_comments;
  v_book jsonb;
  v_root_key text;
  v_root jsonb;
  v_list jsonb;
  v_ord int;
  v_parents jsonb := '[]'::jsonb;
  v_p uuid;
  v_entry jsonb;
  v_steps int := 0;
begin
  if p_entity_type = 'buzz' then
    select * into root from public.buzz_posts where id = p_id;
  elsif p_entity_type = 'buzz_reply' then
    select * into c from public.buzz_comments where id = p_id;
    if c.id is not null then
      select * into root from public.buzz_posts where id = c.post_id;
    end if;
  end if;
  if root.id is null then
    return null;
  end if;
  v_book := public.buzz_v2_alias_book(root.id);
  v_root_key := public.buzz_author_key(root.author_id, root.alias);
  v_root := public.buzz_root_json(root, null, true);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'ord', v.ord, 'parent', x.parent_id,
           'json', public.buzz_reply_json(x, null, true, v.shape_parent, v.shape_depth,
                     case when v.replying_key is not null then v_book -> v.replying_key end,
                     v_book -> public.buzz_author_key(x.author_id, x.alias), v_root_key)) order by v.ord), '[]'::jsonb)
  into v_list
  from public.buzz_v2_visible_replies(root.id, null, true) v
  join public.buzz_comments x on x.id = v.id;

  if p_entity_type = 'buzz' then
    return jsonb_build_object(
      'entityType', 'buzz',
      'item', v_root,
      'root', v_root,
      'parents', '[]'::jsonb,
      'siblings', (select coalesce(jsonb_agg(e -> 'json' order by (e ->> 'ord')::int), '[]'::jsonb)
                   from jsonb_array_elements(v_list) as e where (e ->> 'ord')::int <= 6));
  end if;
  select (e ->> 'ord')::int into v_ord from jsonb_array_elements(v_list) as e where e ->> 'id' = c.id::text;
  v_p := c.parent_id;
  while v_p is not null and v_steps < 1000 loop
    v_entry := null;
    select e into v_entry from jsonb_array_elements(v_list) as e where e ->> 'id' = v_p::text;
    exit when v_entry is null;
    v_parents := jsonb_build_array(v_entry -> 'json') || v_parents;
    v_p := (v_entry ->> 'parent')::uuid;
    v_steps := v_steps + 1;
  end loop;
  return jsonb_build_object(
    'entityType', 'buzz_reply',
    'item', (select e -> 'json' from jsonb_array_elements(v_list) as e where e ->> 'id' = c.id::text),
    'root', v_root,
    'parents', v_parents,
    'siblings', (select coalesce(jsonb_agg(e -> 'json' order by (e ->> 'ord')::int), '[]'::jsonb)
                 from jsonb_array_elements(v_list) as e
                 where (e ->> 'ord')::int between coalesce(v_ord, 0) - 3 and coalesce(v_ord, 0) + 3 and e ->> 'id' <> c.id::text));
end;
$$;

-- -----------------------------------------------------------------------------
-- 15. Housekeeping: due polls and old rate-limit rows, every 10 minutes where pg_cron is installed
-- -----------------------------------------------------------------------------
create or replace function public.buzz_v2_housekeeping()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_polls int;
  v_rate int;
begin
  v_polls := public.buzz_v2_close_due_polls(null);
  delete from public.buzz_rate_log where at < now() - interval '2 days';
  get diagnostics v_rate = row_count;
  return jsonb_build_object('pollsClosed', v_polls, 'rateRowsPurged', v_rate);
end;
$$;

-- Without pg_cron, run `select public.buzz_v2_housekeeping()` every few minutes some other way (opening Buzz still
-- closes the viewer's own polls).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available: run public.buzz_v2_housekeeping() every few minutes another way (%).', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'buzz-housekeeping';
    perform cron.schedule('buzz-housekeeping', '*/10 * * * *', 'select public.buzz_v2_housekeeping()');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 16. The old functions: same signatures, one answer for old app builds
-- -----------------------------------------------------------------------------
create or replace function public.buzz_feed(
  p_university_id uuid default null,
  p_topic text default null,
  p_sort text default 'hot',
  p_limit int default 20,
  p_offset int default 0,
  p_q text default null
)
returns table (
  id uuid, topic text, title text, body text, images text[], image_meta jsonb, videos jsonb, university_id uuid,
  score int, comment_count int, created_at timestamptz, my_vote smallint, is_mine boolean, alias text
)
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_get(p_id uuid)
returns table (
  id uuid, topic text, title text, body text, images text[], image_meta jsonb, videos jsonb, university_id uuid,
  score int, comment_count int, created_at timestamptz, my_vote smallint, is_mine boolean, alias text
)
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_comments_list(p_post_id uuid)
returns table (id uuid, parent_id uuid, body text, created_at timestamptz, alias text, is_op boolean, is_mine boolean, score int, my_vote smallint)
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_create(
  p_topic text,
  p_title text,
  p_body text default '',
  p_university_id uuid default null,
  p_images text[] default '{}',
  p_image_meta jsonb default '[]'::jsonb,
  p_videos jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_reply(p_post_id uuid, p_body text, p_parent_id uuid default null)
returns uuid
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_vote(p_post_id uuid, p_value int)
returns table (score int, my_vote smallint)
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_comment_vote(p_comment_id uuid, p_value int)
returns table (score int, my_vote smallint)
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_delete(p_id uuid)
returns void
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_delete_comment(p_comment_id uuid)
returns void
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_mute(p_post_id uuid default null, p_comment_id uuid default null)
returns void
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

create or replace function public.buzz_unmute(p_post_id uuid)
returns void
language plpgsql
as $$
begin
  raise exception 'buzz:update_required:Update UniBuzz to use the new Buzz.';
end;
$$;

-- The old internals go (nothing calls them now).
drop function if exists public.buzz_alias(uuid, uuid);
drop function if exists public.buzz_hidden(uuid, uuid);
drop function if exists public.buzz_can_see(public.buzz_posts);
drop function if exists public.buzz_reply_count(uuid);

-- -----------------------------------------------------------------------------
-- 17. Who may call what
-- -----------------------------------------------------------------------------
do $$
declare
  f record;
  s text;
begin
  -- Nothing Buzz is callable by default (Supabase grants every new function to every API role).
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'buzz\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;

  -- Signed-in people.
  foreach s in array array[
    'buzz_guidelines_version()',
    'buzz_v2_gate()', 'buzz_v2_accept_gate(text)', 'buzz_v2_posting_status()',
    'buzz_v2_feed(text, text, text, text, integer, integer, timestamp with time zone)', 'buzz_v2_meta(text)',
    'buzz_v2_thread(uuid, integer)', 'buzz_v2_replies(uuid, integer, integer)',
    'buzz_v2_vote(uuid, integer)', 'buzz_v2_poll_vote(uuid, uuid)', 'buzz_v2_delete(uuid)',
    'buzz_v2_hide_thread(uuid, boolean)', 'buzz_v2_hide_author(uuid)',
    'buzz_v2_mine(text, integer, integer)', 'buzz_v2_karma()', 'buzz_v2_report(uuid, text, text)', 'buzz_v2_share_snapshot(uuid)',
    -- old builds: the stubs
    'buzz_feed(uuid, text, text, integer, integer, text)', 'buzz_get(uuid)', 'buzz_comments_list(uuid)',
    'buzz_create(text, text, text, uuid, text[], jsonb, jsonb)', 'buzz_reply(uuid, text, uuid)', 'buzz_vote(uuid, integer)',
    'buzz_comment_vote(uuid, integer)', 'buzz_delete(uuid)', 'buzz_delete_comment(uuid)', 'buzz_mute(uuid, uuid)', 'buzz_unmute(uuid)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', s);
  end loop;

  -- The website's moderated write API (and its AI second pass, which may hide an item it already wrote).
  foreach s in array array['buzz_v2_create(uuid, jsonb, text, boolean, jsonb)', 'buzz_v2_reply(uuid, uuid, jsonb, text, boolean, jsonb)',
                           'buzz_v2_set_status(text, uuid, text, boolean)'] loop
    execute format('grant execute on function public.%s to service_role', s);
  end loop;
end
$$;

-- =============================================================================
-- UniBuzz - one thread per day's prompt
-- Follows 20261103000100_buzz_v2.sql. Answering today's prompt used to post a buzz like any other: no title, nothing
-- tying it to the prompt. Now:
--
--   * Each day's prompt has one thread per campus, and one on Global, owned by no one: its title is the prompt and
--     its replies are the answers (written, like every reply, through the website's moderated reply API). The first
--     answer makes it (buzz_v2_prompt_thread), so a day nobody answers leaves nothing in the feed.
--   * A buzz that answers a prompt on its own carries the prompt as its title: a trigger on buzz_posts sets it on every
--     new answer (whatever the composer sent), and the buzz says which prompt thread it belongs with (promptThreadId).
--     An answer posted before this file gets the prompt only where it has no title; a title its author wrote stays.
--   * BuzzFeedMeta's prompt says which thread is today's on that feed (threadId, null until the first answer) and
--     how many answers it has.
--
-- buzz_root_json and buzz_v2_meta keep their signatures, so 20261103000100_buzz_v2.sql still runs again over this
-- file. Rollback: rollbacks/20261108000200_buzz_prompt_threads.down.sql (the threads and their answers stay).
-- =============================================================================

-- Which buzz is the thread of which day's prompt, on which feed. Internal, like every Buzz table.
create table if not exists public.buzz_prompt_threads (
  thread_id uuid primary key references public.buzz_posts (id) on delete cascade,
  prompt_id uuid not null references public.buzz_prompts (id) on delete cascade,
  day date not null,
  scope text not null check (scope in ('campus', 'global')),
  university_id uuid references public.universities (id) on delete cascade,
  constraint buzz_prompt_threads_scope_campus check ((scope = 'campus') = (university_id is not null))
);
create unique index if not exists buzz_prompt_threads_feed_key on public.buzz_prompt_threads (day, scope, coalesce(university_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists buzz_prompt_threads_prompt_idx on public.buzz_prompt_threads (prompt_id, scope, university_id, day desc);
alter table public.buzz_prompt_threads enable row level security;
revoke all on table public.buzz_prompt_threads from public, anon, authenticated;

-- Threads a rollback of this file left behind (owned by no one, alias 'daily-prompt') are linked again, so a day's
-- answers never split over two threads.
insert into public.buzz_prompt_threads (thread_id, prompt_id, day, scope, university_id)
select b.id, b.prompt_id, (b.created_at at time zone 'utc')::date, b.scope, case when b.scope = 'campus' then b.university_id end
from public.buzz_posts b
where b.author_id is null and b.alias = 'daily-prompt' and b.prompt_id is not null and (b.scope = 'global' or b.university_id is not null)
on conflict do nothing;

-- Today's prompt (a UTC day, the same everywhere): prompts[day % count], as buzz_v2_meta has always picked it.
create or replace function public.buzz_v2_today_prompt(out prompt_id uuid, out prompt_text text, out prompt_day date)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.text, (now() at time zone 'utc')::date
  from public.buzz_prompts p
  where p.idx = (floor(extract(epoch from now()) / 86400)::bigint % nullif((select count(*) from public.buzz_prompts), 0))::int;
$$;

-- A day's prompt thread on a feed (Global, or a campus), or null while no one has answered there.
create or replace function public.buzz_v2_prompt_thread_id(p_prompt uuid, p_day date, p_scope text, p_university uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.thread_id
  from public.buzz_prompt_threads t
  where t.prompt_id = p_prompt and t.day = p_day and t.scope = p_scope
    and t.university_id is not distinct from case when p_scope = 'campus' then p_university end;
$$;

-- The thread of today's prompt on a feed, made by the first answer: the caller is about to answer in it (the answer
-- itself is a reply, through the website's moderated reply API). Needs Buzz posting rights, and a campus for Campus.
-- A prompt that is no longer today's: buzz:prompt_ended.
create or replace function public.buzz_v2_prompt_thread(p_prompt uuid, p_scope text default 'campus')
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_scope text := coalesce(p_scope, 'campus');
  v_prompt_id uuid;
  v_prompt_text text;
  v_day date;
  v_uni uuid;
  v_thread uuid;
begin
  if v_scope not in ('campus', 'global') then
    raise exception 'buzz:validation_failed:Pick Campus or Global.';
  end if;
  select t.prompt_id, t.prompt_text, t.prompt_day into v_prompt_id, v_prompt_text, v_day from public.buzz_v2_today_prompt() t;
  if v_prompt_id is null or p_prompt is distinct from v_prompt_id then
    raise exception 'buzz:prompt_ended:That prompt has ended. Today''s is waiting for you.';
  end if;
  perform public.buzz_v2_assert_writer(v_me);
  if v_scope = 'campus' then
    select p.university_id into v_uni from public.profiles p where p.id = v_me;
    if v_uni is null then
      raise exception 'buzz:validation_failed:Add your university to your profile to buzz on its campus feed.';
    end if;
  end if;
  -- One thread per day and feed, however many answer at the same moment.
  perform pg_advisory_xact_lock(hashtextextended('buzz-prompt:' || v_day || ':' || v_scope || ':' || coalesce(v_uni::text, ''), 0));
  v_thread := public.buzz_v2_prompt_thread_id(v_prompt_id, v_day, v_scope, v_uni);
  if v_thread is null then
    insert into public.buzz_posts (author_id, alias, university_id, title, body, scope, status, prompt_id, created_at, visible_at)
    values (null, 'daily-prompt', v_uni, left(v_prompt_text, 100), '', v_scope, 'active', v_prompt_id, now(), now())
    returning id into v_thread;
    insert into public.buzz_prompt_threads (thread_id, prompt_id, day, scope, university_id)
    values (v_thread, v_prompt_id, v_day, v_scope, v_uni);
  end if;
  return v_thread;
end;
$$;

-- A buzz that answers a prompt carries the prompt as its title, whatever the composer sent.
create or replace function public.buzz_v2_prompt_title()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if new.prompt_id is not null then
    select left(p.text, 100) into v_title from public.buzz_prompts p where p.id = new.prompt_id;
    if v_title is not null then
      new.title := v_title;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists buzz_posts_prompt_title on public.buzz_posts;
create trigger buzz_posts_prompt_title before insert or update of prompt_id, title on public.buzz_posts
  for each row execute function public.buzz_v2_prompt_title();

-- The answers already posted on their own get their prompt as their title, but only where they have none (null or
-- blank): a title someone wrote before this file is their words and stays. The trigger above fires on this update too
-- and sets the same prompt.
update public.buzz_posts b set title = left(p.text, 100)
from public.buzz_prompts p
where b.prompt_id = p.id and nullif(btrim(b.title), '') is null;

-- BuzzFeedMeta: today's prompt with its thread on this feed and its answers; the small-campus note; the viewer's campus.
create or replace function public.buzz_v2_meta(p_scope text default 'campus')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_prompt_id uuid;
  v_prompt_text text;
  v_day date;
  v_thread uuid;
  v_uni uuid;
  v_uni_name text;
  v_uni_short text;
begin
  if coalesce(p_scope, 'campus') not in ('campus', 'global') then
    raise exception 'buzz:validation_failed:Pick Campus or Global.';
  end if;
  perform public.buzz_v2_close_due_polls(v_me);
  select t.prompt_id, t.prompt_text, t.prompt_day into v_prompt_id, v_prompt_text, v_day from public.buzz_v2_today_prompt() t;
  select u.id, u.name, coalesce(nullif(u.short_name, ''), u.name) into v_uni, v_uni_name, v_uni_short
  from public.profiles pr join public.universities u on u.id = pr.university_id
  where pr.id = v_me;
  if v_prompt_id is not null then
    v_thread := public.buzz_v2_prompt_thread_id(v_prompt_id, v_day, coalesce(p_scope, 'campus'), v_uni);
  end if;
  return jsonb_build_object(
    'prompt', case when v_prompt_id is not null then jsonb_build_object(
      'id', v_prompt_id,
      'text', v_prompt_text,
      'threadId', v_thread,
      'answers', case when v_thread is not null then public.buzz_v2_reply_count(v_thread, v_me, false) else 0 end) end,
    'smallCampusNote', coalesce(p_scope, 'campus') = 'campus' and v_uni is not null and public.buzz_v2_campus_small(v_uni),
    'campus', case when v_uni is not null then jsonb_build_object('name', v_uni_name, 'shortName', v_uni_short) end);
end;
$$;

-- Buzz, field by field (unchanged but for isPromptThread and promptThreadId).
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
    'promptId', b.prompt_id,
    -- the thread of a day's prompt, owned by no one: its replies are the answers
    'isPromptThread', exists (select 1 from public.buzz_prompt_threads t where t.thread_id = b.id),
    -- an answer posted as its own buzz: that day's prompt thread on its feed, once anyone answered there
    'promptThreadId', case when b.prompt_id is not null then (
      select t.thread_id from public.buzz_prompt_threads t
      where t.prompt_id = b.prompt_id and t.thread_id <> b.id and t.scope = b.scope
        and t.university_id is not distinct from case when b.scope = 'campus' then b.university_id end
        and t.day between (b.created_at at time zone 'utc')::date - 1 and (b.created_at at time zone 'utc')::date
      order by t.day desc
      limit 1) end);
end;
$$;

-- Internal, as every Buzz function is (buzz_v2.sql §17); answering today's prompt in its thread is for signed-in people.
revoke all on function public.buzz_v2_today_prompt() from public, anon, authenticated, service_role;
revoke all on function public.buzz_v2_prompt_thread_id(uuid, date, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.buzz_v2_prompt_title() from public, anon, authenticated, service_role;
revoke all on function public.buzz_root_json(public.buzz_posts, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.buzz_v2_prompt_thread(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.buzz_v2_prompt_thread(uuid, text) to authenticated;
revoke all on function public.buzz_v2_meta(text) from public, anon, authenticated, service_role;
grant execute on function public.buzz_v2_meta(text) to authenticated;

notify pgrst, 'reload schema';

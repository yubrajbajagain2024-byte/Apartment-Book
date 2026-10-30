-- =============================================================================
-- UniBuzz - migration 58: Stories
-- Follows 20261110000000_business_hours.sql (migration 57). Builds on migration 44's audience rules (verified_university,
-- the friends and campus rules) and migration 9's blocks (is_blocked_either_way).
-- Rollback: supabase/rollbacks/20261110000100_stories.down.sql. Safe to run more than once.
--
-- A story is one photo or one video a student shares for 24 hours, Instagram's way, shown in a row of rings at the top
-- of Home and full screen when tapped. It carries the same audience as a post (migration 44):
--     campus    students whose sign-in email belongs to the story's university (verified, never the editable profile field)
--     global    every signed-in student
--     friends   people who follow the author and are followed back
--     selected  only the people the author picked: story_viewers, at most 50, written by set_story_viewers()
-- The database keeps all of it, so a story never reaches anyone outside its audience, never after it expires, and never
-- across a block:
--   * public.stories: the row; a restrictive select policy adds can_see_story() (the audience rule) and the expiry to
--     every read. Only the author inserts (a trigger stamps the author, the clock and the expiry from the server: a row
--     cannot be post-dated or given a longer life) and only the author deletes. Nothing updates.
--   * public.story_viewers: the people a "Selected people" story is shown to; the author reads the list, a picked
--     person reads only their own row.
--   * public.story_views: who has seen a story and when. Written only by mark_story_seen(), which refuses stories the
--     caller may not see, the author's own, and a second row for the same viewer. The author reads every view of their
--     stories (the count and the list); a viewer reads only their own rows (whether they have seen a story).
--   * stories_sweep(): deletes stories a day past their expiry, with their viewers and views (pg_cron hourly where it is
--     installed). Expired rows are already invisible to every reader through the policy; the sweep keeps the table small.
--     The photo files stay in the public uploads bucket, as a deleted post's do; deleting them from Storage is follow-up
--     work (purge_snaps() shows the way).
-- =============================================================================

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- The campus a campus-only story is for: the author's verified university, set by the trigger below.
  university_id uuid references public.universities (id) on delete set null,
  kind text not null check (kind in ('photo', 'video')),
  image_url text,
  image_meta jsonb,
  -- A video as a post keeps one (migration 43's shape: media_id, playback_id, poster_url, width, height, duration_seconds).
  video jsonb,
  audience text not null default 'global' check (audience in ('campus', 'global', 'friends', 'selected')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  constraint stories_media_check check (
    (kind = 'photo' and image_url is not null and video is null) or (kind = 'video' and video is not null and image_url is null)
  ),
  constraint stories_campus_check check (audience <> 'campus' or university_id is not null)
);
create index if not exists stories_author_expires_idx on public.stories (author_id, expires_at desc);
create index if not exists stories_expires_idx on public.stories (expires_at);

create table if not exists public.story_viewers (
  story_id uuid not null references public.stories (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists story_viewers_user_idx on public.story_viewers (user_id);

create table if not exists public.story_views (
  story_id uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
create index if not exists story_views_viewer_idx on public.story_views (viewer_id);

alter table public.stories enable row level security;
alter table public.story_viewers enable row level security;
alter table public.story_views enable row level security;

-- -----------------------------------------------------------------------------
-- 1. Who can see a story: migration 44's rule, with this feature's own list of picked people
-- -----------------------------------------------------------------------------
-- Reads auth.users, follows and story_viewers as the definer, so it would answer questions about other people: no API
-- role may call it, only can_see_story() below.
create or replace function public.can_see_story_as(p_viewer uuid, p_story_id uuid, p_author uuid, p_audience text, p_university uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_viewer is null then false
    when p_viewer = p_author then true
    when p_audience = 'global' then true
    when p_audience = 'campus' then p_university is not null
      and public.verified_university(p_viewer) is not distinct from p_university
    when p_audience = 'friends' then
      exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = p_author)
      and exists (select 1 from public.follows f where f.follower_id = p_author and f.followee_id = p_viewer)
    when p_audience = 'selected' then
      exists (select 1 from public.story_viewers v where v.story_id = p_story_id and v.user_id = p_viewer)
    else false
  end;
$$;
revoke all on function public.can_see_story_as(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- The same for the caller: it answers only about the person asking, so the policies may run it as any role.
create or replace function public.can_see_story(p_story_id uuid, p_author uuid, p_audience text, p_university uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_see_story_as(auth.uid(), p_story_id, p_author, p_audience, p_university);
$$;
revoke all on function public.can_see_story(uuid, uuid, text, uuid) from public;

-- -----------------------------------------------------------------------------
-- 2. The rows: read within the audience and before expiry, never across a block; written by the author only
-- -----------------------------------------------------------------------------
revoke all on table public.stories from public, anon, authenticated;
grant select, insert, delete on table public.stories to authenticated;

drop policy if exists "stories_select" on public.stories;
create policy "stories_select" on public.stories
  for select to authenticated
  using (
    expires_at > now()
    and not public.is_blocked_either_way(author_id)
    and public.can_see_story(id, author_id, audience, university_id)
  );

drop policy if exists "stories_insert_own" on public.stories;
create policy "stories_insert_own" on public.stories
  for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists "stories_delete_own" on public.stories;
create policy "stories_delete_own" on public.stories
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- The server's clock and the server's 24 hours, whatever the client sent; a campus-only story belongs to the author's
-- verified campus (as a post's does, migration 44), and a story with nothing verified cannot be campus-only. A row from
-- the API carries auth.uid() (the definer's own role would not tell: inside this function current_user is the owner).
create or replace function public.stories_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    new.created_at := now();
    new.expires_at := now() + interval '24 hours';
    if new.audience = 'campus' then
      new.university_id := public.verified_university(new.author_id);
      if new.university_id is null then
        raise exception 'Only a verified student can share with their campus.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stories_before_insert() from public, anon, authenticated;
drop trigger if exists stories_before_insert on public.stories;
create trigger stories_before_insert before insert on public.stories for each row execute function public.stories_before_insert();

-- -----------------------------------------------------------------------------
-- 3. The people a "Selected people" story is shown to
-- -----------------------------------------------------------------------------
revoke all on table public.story_viewers from public, anon, authenticated;
grant select on table public.story_viewers to authenticated;
drop policy if exists "story_viewers_select" on public.story_viewers;
create policy "story_viewers_select" on public.story_viewers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.stories s where s.id = story_id and s.author_id = (select auth.uid()))
  );

create or replace function public.set_story_viewers(p_story_id uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_author uuid;
  v_ids uuid[];
  v_count int;
begin
  select s.author_id into v_author from public.stories s where s.id = p_story_id for update;
  if v_me is null or v_author is null or v_author <> v_me then
    raise exception 'Only the author can choose who sees this story.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct u), '{}') into v_ids
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  where u is not null and u <> v_me;
  if cardinality(v_ids) > 50 then
    raise exception 'Choose up to 50 people.' using errcode = '22023';
  end if;
  delete from public.story_viewers v where v.story_id = p_story_id;
  insert into public.story_viewers (story_id, user_id)
  select p_story_id, p.id
  from public.profiles p
  where p.id = any (v_ids) and not public.is_blocked_either_way(p.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.set_story_viewers(uuid, uuid[]) from public, anon;
grant execute on function public.set_story_viewers(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Who has seen a story
-- -----------------------------------------------------------------------------
revoke all on table public.story_views from public, anon, authenticated;
grant select on table public.story_views to authenticated;
drop policy if exists "story_views_select" on public.story_views;
create policy "story_views_select" on public.story_views
  for select to authenticated
  using (
    viewer_id = (select auth.uid())
    or exists (select 1 from public.stories s where s.id = story_id and s.author_id = (select auth.uid()))
  );

-- The caller has seen this story (shown full screen): one row per viewer, the first time. A story the caller may not
-- see (the policy's own rule), an expired one and the author's own leave no row. Returns whether a row was added.
create or replace function public.mark_story_seen(p_story_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_story public.stories%rowtype;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_story from public.stories s where s.id = p_story_id;
  if v_story.id is null or v_story.expires_at <= now() or v_story.author_id = v_me then
    return false;
  end if;
  if public.is_blocked_either_way(v_story.author_id) or not public.can_see_story_as(v_me, v_story.id, v_story.author_id, v_story.audience, v_story.university_id) then
    return false;
  end if;
  insert into public.story_views (story_id, viewer_id) values (p_story_id, v_me)
  on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.mark_story_seen(uuid) from public, anon;
grant execute on function public.mark_story_seen(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The sweep: stories a day past their expiry go, with their viewers and views. p_now is for tests.
-- -----------------------------------------------------------------------------
create or replace function public.stories_sweep(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.stories s where s.expires_at < p_now - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.stories_sweep(timestamptz) from public, anon, authenticated;

-- Hourly where pg_cron is installed (it is on production: migrations 26, 41, 42, 44 and 50 use it). Without it, run
-- stories_sweep() another way; nothing else depends on it.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available: run public.stories_sweep() hourly another way (%).', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'stories-sweep';
    perform cron.schedule('stories-sweep', '17 * * * *', 'select public.stories_sweep()');
  end if;
end;
$$;

notify pgrst, 'reload schema';

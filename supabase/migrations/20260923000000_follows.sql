-- =============================================================================
-- Apartment Book - migration 14: following, like Instagram
--   * follows: who follows whom. Public, like the follower lists of public Instagram accounts
--     (profiles are public too); blocked people never see each other's rows.
--   * follow_stats(): follower / following counts and "do I follow them / do they follow me" for many profiles at once
--   * following_posts(): Home → Posts → "Following" (posts and reels by the people I follow)
--   * a "follow" notification when someone starts following you
--   * blocking ends the relationship both ways and stops new follows
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.follows (
  follower_id uuid not null,
  followee_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_follower_id_fkey foreign key (follower_id) references public.profiles (id) on delete cascade,
  constraint follows_followee_id_fkey foreign key (followee_id) references public.profiles (id) on delete cascade,
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_created_idx on public.follows (followee_id, created_at desc);
create index if not exists follows_follower_created_idx on public.follows (follower_id, created_at desc);

alter table public.follows enable row level security;
drop policy if exists "follows_select" on public.follows;
create policy "follows_select" on public.follows
  for select using (not public.is_blocked_either_way(follower_id) and not public.is_blocked_either_way(followee_id));
drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own" on public.follows
  for insert to authenticated with check (follower_id = auth.uid() and not public.is_blocked_either_way(followee_id));
drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own" on public.follows
  for delete to authenticated using (follower_id = auth.uid());

-- Blocking someone ends the follow relationship in both directions.
create or replace function public.unfollow_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id)
     or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end;
$$;
drop trigger if exists unfollow_on_block on public.blocks;
create trigger unfollow_on_block
  after insert on public.blocks
  for each row execute function public.unfollow_on_block();

-- "Maya started following you". One unread notification per follower, however often they follow and unfollow.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'listing_saved', 'nearby_listing', 'system', 'like', 'comment', 'follow'));

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select full_name into v_name from public.profiles where id = new.follower_id;
  perform public.notify(
    new.followee_id, new.follower_id, 'follow',
    coalesce(v_name, 'Someone') || ' started following you', null,
    '/profile/' || new.follower_id,
    jsonb_build_object('follower_id', new.follower_id),
    'follow:' || new.follower_id
  );
  return new;
end;
$$;
drop trigger if exists notify_on_follow on public.follows;
create trigger notify_on_follow
  after insert on public.follows
  for each row execute function public.notify_on_follow();

-- Counts and my relationship with many profiles in one call (profile headers, follower lists).
-- Security invoker: the row-level policy above keeps blocked people out of the numbers.
create or replace function public.follow_stats(p_user_ids uuid[])
returns table (user_id uuid, followers bigint, following bigint, followed_by_me boolean, follows_me boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id,
    (select count(*) from public.follows f where f.followee_id = t.id),
    (select count(*) from public.follows f where f.follower_id = t.id),
    exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = t.id),
    exists (select 1 from public.follows f where f.follower_id = t.id and f.followee_id = auth.uid())
  from unnest(p_user_ids) as t(id);
$$;

-- Home → Posts → "Following": posts (or reels) by the people I follow, newest first. Returns feed_posts rows so the
-- API can embed the author exactly like the plain feed; security invoker, so the feed_posts policies still apply.
-- Signed out there is nobody to follow, so it returns nothing.
create or replace function public.following_posts(p_kind text default 'post', p_university_id uuid default null)
returns setof public.feed_posts
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.feed_posts p
  where p.author_id in (select f.followee_id from public.follows f where f.follower_id = auth.uid())
    and (p_kind is null or p.kind = p_kind)
    and (p_university_id is null or p.university_id = p_university_id)
  order by p.created_at desc, p.id desc;
$$;

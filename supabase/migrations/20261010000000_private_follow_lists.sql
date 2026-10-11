-- Migration 21: private follower lists. Safe to re-run.
--   * A follows row is readable only by the two people in it, the follower and the person followed (never while they
--     are blocked either way), so your Followers and Following lists are yours alone. Signed out nobody reads any.
--   * follow_stats() reads the rows as the definer and gives every viewer the same Followers · Following totals. The
--     follows of people you have blocked count too: hiding them would let anyone learn whom someone follows by blocking
--     them and watching a number drop. A profile you are blocked with either way still shows zeros.
--   * mutual_friends(): what everyone else gets behind those numbers, the friends (people who follow each other) the
--     viewer and the profile's owner have in common, by name. The ids come from mutual_friend_ids(), which only ever
--     answers with that set, for the person asking.
--   * are_friends() answers only about pairs that include the person asking, and the API can no longer call it: it
--     was a way to ask whether any two people follow each other.
--   * follows stays out of the realtime publication.

-- -----------------------------------------------------------------------------
-- Rows: only the two people in them
-- -----------------------------------------------------------------------------
-- The owner's lists still read straight from the table (follower_id or followee_id is them); anyone else gets their
-- own follow at most. Adding and removing your own follows is unchanged.
drop policy if exists "follows_select" on public.follows;
create policy "follows_select" on public.follows
  for select to authenticated
  using (
    (follower_id = auth.uid() or followee_id = auth.uid())
    and not public.is_blocked_either_way(follower_id)
    and not public.is_blocked_either_way(followee_id)
  );

-- -----------------------------------------------------------------------------
-- Counts: the same totals for everyone
-- -----------------------------------------------------------------------------
-- Counts and my relationship with many profiles in one call (profile headers, follower lists). Security definer now
-- that the rows are private. Every viewer gets the real totals, whoever they have blocked: if your blocks changed the
-- numbers you see, blocking someone and watching a profile's count drop would tell you that they follow it. Only a
-- profile you are blocked with either way shows zeros, as before.
create or replace function public.follow_stats(p_user_ids uuid[])
returns table (user_id uuid, followers bigint, following bigint, followed_by_me boolean, follows_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    case when t.blocked then 0 else (select count(*) from public.follows f where f.followee_id = t.id) end,
    case when t.blocked then 0 else (select count(*) from public.follows f where f.follower_id = t.id) end,
    not t.blocked and exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = t.id),
    not t.blocked and exists (select 1 from public.follows f where f.follower_id = t.id and f.followee_id = auth.uid())
  from (select u.id, public.is_blocked_either_way(u.id) as blocked from unnest(p_user_ids) as u(id)) t;
$$;

-- -----------------------------------------------------------------------------
-- Mutual friends
-- -----------------------------------------------------------------------------
-- The friends the person asking and p_user_id have in common: people who follow each other with both of them, never
-- the two themselves (nobody follows themselves) and never anyone blocked either way with the person asking. Nothing
-- signed out, on your own profile, or when you and p_user_id are blocked either way. Security definer because the rows
-- are private; each of the four rows it joins is found through the primary key or the followee index, never a scan.
create or replace function public.mutual_friend_ids(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select f1.followee_id
  from public.follows f1 -- I follow them
  join public.follows f2 on f2.follower_id = f1.followee_id and f2.followee_id = f1.follower_id -- they follow me back
  join public.follows f3 on f3.follower_id = p_user_id and f3.followee_id = f1.followee_id -- the owner follows them
  join public.follows f4 on f4.follower_id = f1.followee_id and f4.followee_id = p_user_id -- and they follow the owner back
  where f1.follower_id = auth.uid()
    and p_user_id <> auth.uid()
    and not public.is_blocked_either_way(p_user_id)
    and not public.is_blocked_either_way(f1.followee_id);
$$;

-- Behind the Followers and Following counts on someone else's profile: those friends as profiles rows, by name (then
-- id, so pages never shuffle), so the API can embed the university like any other list of people. Security invoker,
-- so the profiles policies still apply.
create or replace function public.mutual_friends(p_user_id uuid)
returns setof public.profiles
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.profiles p
  where p.id in (select public.mutual_friend_ids(p_user_id))
  order by p.full_name, p.id;
$$;

-- -----------------------------------------------------------------------------
-- are_friends: only about yourself
-- -----------------------------------------------------------------------------
-- Friends = they follow each other. It reads the rows as the definer, so it only answers for pairs that include the
-- person asking; its one caller, can_view_profile_section(), asks about the viewer and a profile's owner.
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
    and auth.uid() is not null and auth.uid() in (p_a, p_b)
    and exists (select 1 from public.follows f where f.follower_id = p_a and f.followee_id = p_b)
    and exists (select 1 from public.follows f where f.follower_id = p_b and f.followee_id = p_a);
$$;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- follows was never in the realtime publication and must stay out: deleted rows reach every subscriber whatever the
-- policies say, and a deleted row's key is who had followed whom.
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'follows')
     and not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
    alter publication supabase_realtime drop table public.follows;
  end if;
end
$$;

grant execute on function public.follow_stats(uuid[]) to anon, authenticated;
grant execute on function public.mutual_friend_ids(uuid) to anon, authenticated;
grant execute on function public.mutual_friends(uuid) to anon, authenticated;
-- are_friends is for can_view_profile_section only.
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;

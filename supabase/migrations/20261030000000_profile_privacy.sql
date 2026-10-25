-- Profile privacy (migration 37). Saved, Liked and Listings are private by default, and a visitor's profile shows no
-- tab they may not open: the apps leave it out entirely, and the database keeps the rule.
--
--   * profiles.listings_visibility (public | friends | private, private by default): who sees the Listings tab, the
--     profile's collection of someone's apartments, roommate posts and items. The listings themselves stay public in
--     Explore, as listings are.
--   * liked_visibility now starts at private (saved_visibility already did). On the first run, every Liked tab still on
--     the old default (Everyone) becomes private as well: nobody picked that, it was what a new profile got. A re-run
--     changes nobody's choice. Since migration 18 the "Liked by" faces follow the same setting, so a private Liked tab
--     keeps its owner out of them too (the like still counts).
--   * can_view_profile_section() knows Listings, and profile_visible_sections() answers for all four tabs at once.
--   * New messages and Snaps belong to Messages (its unread counts, and the push that notify() still sends for them),
--     so the Notifications badge leaves them out: unread_notification_count() skips them, and the apps' lists do too.
--     The rows themselves stay: notify() keeps one per chat for the push, as before.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'listings_visibility'
  ) then
    update public.profiles set liked_visibility = 'private' where liked_visibility = 'public';
    alter table public.profiles add column listings_visibility text not null default 'private';
  end if;
end
$$;
alter table public.profiles alter column saved_visibility set default 'private';
alter table public.profiles alter column liked_visibility set default 'private';
alter table public.profiles alter column listings_visibility set default 'private';
alter table public.profiles drop constraint if exists profiles_section_visibility_check;
alter table public.profiles add constraint profiles_section_visibility_check check (
  classes_visibility in ('public', 'friends', 'private')
  and saved_visibility in ('public', 'friends', 'private')
  and liked_visibility in ('public', 'friends', 'private')
  and listings_visibility in ('public', 'friends', 'private')
);
-- The API reads profiles column by column (migration 22): a new column needs its own grant, or select=* fails.
grant select (listings_visibility) on table public.profiles to anon, authenticated;

-- May the person asking see this part of p_owner's profile? Owners always; blocked either way never.
create or replace function public.can_view_profile_section(p_owner uuid, p_section text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner is null then false
    when auth.uid() is not null and auth.uid() = p_owner then true
    when public.is_blocked_either_way(p_owner) then false
    else coalesce((
      select case s.v
        when 'public' then true
        when 'friends' then public.are_friends(auth.uid(), p_owner)
        else false
      end
      from (
        select case p_section
          when 'classes' then p.classes_visibility
          when 'saved' then p.saved_visibility
          when 'liked' then p.liked_visibility
          when 'listings' then p.listings_visibility
        end as v
        from public.profiles p
        where p.id = p_owner
      ) s
    ), false)
  end;
$$;

-- All four answers in one call, for the profile page. profile_section_access() keeps its three columns for the builds
-- already installed (and so migration 18 still re-runs); the apps ask this one, and fall back to that one before it exists.
create or replace function public.profile_visible_sections(p_owner uuid)
returns table (classes boolean, saved boolean, liked boolean, listings boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_view_profile_section(p_owner, 'classes'),
    public.can_view_profile_section(p_owner, 'saved'),
    public.can_view_profile_section(p_owner, 'liked'),
    public.can_view_profile_section(p_owner, 'listings');
$$;
grant execute on function public.can_view_profile_section(uuid, text) to anon, authenticated;
grant execute on function public.profile_visible_sections(uuid) to anon, authenticated;

-- The Notifications badge: everything unread except new messages and Snaps, which Messages counts.
create or replace function public.unread_notification_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
  from public.notifications
  where user_id = auth.uid() and read_at is null and type not in ('message', 'snap');
$$;

notify pgrst, 'reload schema';

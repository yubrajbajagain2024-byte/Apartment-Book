-- =============================================================================
-- UniBuzz - anonymous listings, who can see a listing, and anonymous inquiry chats
-- Follows 20261104000000_post_details.sql (who can see a post: verified_university, can_see_feed_post_as).
--
-- The apps' new listing flow asks two more things about a roommate post (public.roommate_posts) or a Marketplace
-- item (public.items), both optional; left alone, a listing is what it always was (posted under the poster's name,
-- seen by everyone):
--
--   * is_anonymous (boolean, default false), fixed once posted. An anonymous listing's row keeps no poster at all:
--     author_id / seller_id is null, and the poster is written to anonymous_listing_owners, which nobody but the
--     poster can read. So whatever reads the row (the feeds, search, roommate_posts_within(), reels_feed(), a
--     function running as the definer, realtime, an export) has nobody to show, now or later. The apps upload an
--     anonymous listing's photos to uploads/buzz/anon/<random> (migration 11's folder: no user id, no clock, not
--     listable), and a video's media row was already private to its owner (migration 11).
--   * audience (default global): global (everyone, as before), campus (signed-in people whose verified campus is the
--     listing's university, which must be the poster's own: listings_check_campus) or friends (people who follow the
--     poster and are followed back), the rule posts use (can_see_feed_post_as). No "selected people" for listings.
--     A RESTRICTIVE select policy adds it to every read; the poster always sees their own.
--
-- The poster of an anonymous listing can do everything with it the poster of any listing can: see it (also while
-- inactive or hidden, like any author), change it (Mark as sold, No longer looking), delete it, see its numbers
-- (listing_stats), and hear about likes and saves (notify_on_like, notify_on_saved). They may not like or save it
-- themselves: their name would be among its likers, or on their profile's Liked and Saved tabs.
--
-- Nothing the caller controls can name the poster:
--   * listing_owner() (any API role may call it) now answers the caller only about themselves: for an anonymous
--     listing it is the caller when they posted it, else null. The policies that ask it about blocks
--     (post_likes_insert_own and the like) so skip the block check for anonymous listings: otherwise blocking someone
--     and seeing whether a like goes through would say whether they posted it.
--   * An anonymous listing is hidden from the people its poster blocked, and while its poster is suspended
--     (anonymous_listing_visible); blocks the viewer made are not consulted, for the same reason.
--   * A listing card shared into a chat carries no author when the listing is anonymous (guard_message_shared_post,
--     which now also keeps a listing out of chats where someone could not see it).
--
-- Inquiries: start_listing_inquiry(type, id) opens the caller's own chat with an anonymous listing's poster, one per
-- listing and person (conversations.direct_key 'anon:<type>:<listing>:<person>'; inquiry_target_* name the
-- listing), in which the poster stays hidden (conversations.poster_hidden; who it is: anonymous_chat_posters, which
-- only the poster can read) until they choose to show who they are to that one person: reveal_listing_identity(),
-- allowed once that person has written. While the poster is hidden:
--   * the person does not see the poster's membership row (conversation_members_hide_anonymous_poster);
--     is_conversation_member() and activity_status() do not answer about the poster either, and the chat is left out
--     of Snap recipients (list_snap_recipients, can_snap);
--   * the poster's messages are stored without a sender (sender_id null, anonymous true: the trigger
--     zz_messages_hide_anonymous_poster, after every other check has seen the real sender), so neither a read nor
--     realtime carries it; their notification and push say "Anonymous poster", with no actor;
--   * the poster sends words, replies and public cards only: files and voice messages would carry their id in the
--     storage path (and their voice), and Snaps, calls and cards of non-public posts are refused both ways (each
--     would say something about who is on the other side);
--   * the person may still message the poster unless the poster blocked them; the person's own blocks are not
--     consulted (blocking someone and seeing whether a message goes through would name the poster);
--   * the poster cannot leave the chat (realtime announces a deleted membership row, ids included, to anyone).
-- Showing who they are turns it into an ordinary chat between the two: the poster's earlier messages get their sender
-- back, and the person is told. It never changes the listing, which stays anonymous to everyone else.
--
-- Staff: ts_public_author_of() (staff's own functions only) resolves an anonymous listing's poster and an anonymous
-- poster's message, so reports of them can still be acted on.
--
-- Rollback: supabase/rollbacks/20261105000000_anonymous_listings.down.sql, which puts back the functions this replaces
-- exactly as they were here (production's and this repo's differ in places), from the copies kept below.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. The functions this replaces, as they are now, for the rollback (kept once: running this again keeps the first)
-- -----------------------------------------------------------------------------
create table if not exists public.anonymous_listings_rollback (
  signature text primary key,
  definition text not null
);
alter table public.anonymous_listings_rollback enable row level security;
revoke all on table public.anonymous_listings_rollback from public, anon, authenticated;
insert into public.anonymous_listings_rollback (signature, definition)
select f.oid::regprocedure::text, pg_get_functiondef(f.oid)
from unnest(array[
  'public.listing_owner(text, uuid)', 'public.record_view(text, uuid, text)', 'public.notify_on_like()', 'public.notify_on_saved()',
  'public.is_conversation_member(uuid, uuid)', 'public.handle_new_message()', 'public.notify_on_message()', 'public.can_snap(uuid)',
  'public.list_snap_recipients(text)', 'public.activity_status(uuid[])', 'public.guard_message_shared_post()', 'public.ts_public_author_of(text, uuid)'
]) as s(name)
join pg_proc f on f.oid = to_regprocedure(s.name)
on conflict (signature) do nothing;

-- -----------------------------------------------------------------------------
-- 1. The listings
-- -----------------------------------------------------------------------------
alter table public.roommate_posts
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists audience text not null default 'global';
alter table public.items
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists audience text not null default 'global';

alter table public.roommate_posts alter column author_id drop not null;
alter table public.items alter column seller_id drop not null;

alter table public.roommate_posts drop constraint if exists roommate_posts_poster_check;
alter table public.roommate_posts add constraint roommate_posts_poster_check
  check (case when is_anonymous then author_id is null else author_id is not null end);
alter table public.items drop constraint if exists items_poster_check;
alter table public.items add constraint items_poster_check
  check (case when is_anonymous then seller_id is null else seller_id is not null end);

alter table public.roommate_posts drop constraint if exists roommate_posts_audience_check;
alter table public.roommate_posts add constraint roommate_posts_audience_check
  check (audience in ('campus', 'global', 'friends') and (audience <> 'campus' or university_id is not null));
alter table public.items drop constraint if exists items_audience_check;
alter table public.items add constraint items_audience_check
  check (audience in ('campus', 'global', 'friends') and (audience <> 'campus' or university_id is not null));

-- -----------------------------------------------------------------------------
-- 2. Who posted an anonymous listing: only they can read it
-- -----------------------------------------------------------------------------
-- Written by the listing's own insert (listings_hide_poster, below) before the row exists, hence the deferred keys.
create table if not exists public.anonymous_listing_owners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  roommate_post_id uuid unique references public.roommate_posts (id) on delete cascade deferrable initially deferred,
  item_id uuid unique references public.items (id) on delete cascade deferrable initially deferred,
  created_at timestamptz not null default now(),
  constraint anonymous_listing_owners_one_listing check (num_nonnulls(roommate_post_id, item_id) = 1)
);
create index if not exists anonymous_listing_owners_owner_idx on public.anonymous_listing_owners (owner_id);
alter table public.anonymous_listing_owners enable row level security;
revoke all on table public.anonymous_listing_owners from public, anon, authenticated;
grant select on table public.anonymous_listing_owners to authenticated;
drop policy if exists "anonymous_listing_owners_select_own" on public.anonymous_listing_owners;
create policy "anonymous_listing_owners_select_own" on public.anonymous_listing_owners
  for select to authenticated using (owner_id = auth.uid());

-- A deleted account takes its anonymous listings with it, as its other listings go (their keys cascade).
create or replace function public.anonymous_listing_owner_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.roommate_post_id is not null then
    delete from public.roommate_posts where id = old.roommate_post_id and is_anonymous;
  end if;
  if old.item_id is not null then
    delete from public.items where id = old.item_id and is_anonymous;
  end if;
  return old;
end;
$$;
revoke all on function public.anonymous_listing_owner_gone() from public, anon, authenticated;
drop trigger if exists anonymous_listing_owner_gone on public.anonymous_listing_owners;
create trigger anonymous_listing_owner_gone
  after delete on public.anonymous_listing_owners
  for each row execute function public.anonymous_listing_owner_gone();

-- The poster of an anonymous listing, null for any other. Reads the table above as the definer, so no API role may
-- call it. Volatile, so that it finds a listing written earlier in the same statement (an insert … returning, whose
-- row the select policies check as the poster).
create or replace function public.anonymous_listing_owner(p_target_type text, p_target_id uuid)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  select o.owner_id from public.anonymous_listing_owners o where p_target_type = 'roommate' and o.roommate_post_id = p_target_id
  union all
  select o.owner_id from public.anonymous_listing_owners o where p_target_type = 'item' and o.item_id = p_target_id
  limit 1;
$$;
revoke all on function public.anonymous_listing_owner(text, uuid) from public, anon, authenticated;

-- The caller posted this anonymous listing. Answers only about the caller, inside the policies below.
create or replace function public.owns_anonymous_listing(p_target_type text, p_target_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select auth.uid() is not null and coalesce(public.anonymous_listing_owner(p_target_type, p_target_id) = auth.uid(), false);
$$;
revoke all on function public.owns_anonymous_listing(text, uuid) from public;
grant execute on function public.owns_anonymous_listing(text, uuid) to anon, authenticated;

-- Who owns a listing or post, as before, except that an anonymous listing has no owner for anyone but its poster
-- (who gets their own id). Every API role may call it (policies do), so it must not name anyone else.
create or replace function public.listing_owner(p_target_type text, p_target_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_target_type
    when 'apartment' then (select owner_id from public.apartments where id = p_target_id)
    when 'item' then (select coalesce(i.seller_id, case when i.is_anonymous and public.owns_anonymous_listing('item', i.id) then auth.uid() end) from public.items i where i.id = p_target_id)
    when 'roommate' then (select coalesce(r.author_id, case when r.is_anonymous and public.owns_anonymous_listing('roommate', r.id) then auth.uid() end) from public.roommate_posts r where r.id = p_target_id)
    when 'post' then (select author_id from public.feed_posts where id = p_target_id)
    when 'deal' then (select b.owner_id from public.deals d join public.businesses b on b.id = d.business_id where d.id = p_target_id)
  end;
$$;

-- Whoever posted it, anonymously or not: for the definer's own code (notifications, views). No API role may call it.
create or replace function public.listing_poster(p_target_type text, p_target_id uuid)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  select coalesce(
    case p_target_type
      when 'apartment' then (select owner_id from public.apartments where id = p_target_id)
      when 'item' then (select seller_id from public.items where id = p_target_id)
      when 'roommate' then (select author_id from public.roommate_posts where id = p_target_id)
      when 'post' then (select author_id from public.feed_posts where id = p_target_id)
      when 'deal' then (select b.owner_id from public.deals d join public.businesses b on b.id = d.business_id where d.id = p_target_id)
    end,
    public.anonymous_listing_owner(p_target_type, p_target_id)
  );
$$;
revoke all on function public.listing_poster(text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Who can see a listing
-- -----------------------------------------------------------------------------
-- The rule, for any viewer (null = signed out): the post rule (can_see_feed_post_as) with the listing's poster, its
-- anonymous one when the row has none. Reads other people's campus and follows as the definer: no API role.
create or replace function public.can_see_listing_as(p_viewer uuid, p_target_type text, p_target_id uuid, p_poster uuid, p_audience text, p_university uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select case
    when p_audience is null or p_audience = 'global' then true
    when p_viewer is null then false
    when p_audience in ('campus', 'friends') then
      public.can_see_feed_post_as(p_viewer, null, coalesce(p_poster, public.anonymous_listing_owner(p_target_type, p_target_id)), p_audience, p_university)
    else false
  end;
$$;
revoke all on function public.can_see_listing_as(uuid, text, uuid, uuid, text, uuid) from public, anon, authenticated;

-- The same for the caller, inside the select policies (it answers only about the caller's own campus and follows).
create or replace function public.can_see_listing(p_target_type text, p_target_id uuid, p_poster uuid, p_audience text, p_university uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select public.can_see_listing_as(auth.uid(), p_target_type, p_target_id, p_poster, p_audience, p_university);
$$;
revoke all on function public.can_see_listing(text, uuid, uuid, text, uuid) from public;
grant execute on function public.can_see_listing(text, uuid, uuid, text, uuid) to anon, authenticated;

-- An anonymous listing, for the caller: its poster always sees it; anyone else unless the poster blocked them or is
-- suspended (the moderation schema's is_suspended, where it exists). Blocks the caller made are not consulted.
create or replace function public.anonymous_listing_visible(p_target_type text, p_target_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.anonymous_listing_owner(p_target_type, p_target_id);
begin
  if v_owner is null or v_owner = auth.uid() then
    return true;
  end if;
  if auth.uid() is not null and exists (select 1 from public.blocks b where b.blocker_id = v_owner and b.blocked_id = auth.uid()) then
    return false;
  end if;
  if to_regprocedure('public.is_suspended(uuid)') is not null then
    if public.is_suspended(v_owner) then
      return false;
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.anonymous_listing_visible(text, uuid) from public;
grant execute on function public.anonymous_listing_visible(text, uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Policies
-- -----------------------------------------------------------------------------
-- Restrictive: on top of the select policies already there (the ones the moderation migration applied outside this
-- repo included, left as they are). Global listings skip the function calls.
drop policy if exists "roommate_posts_audience" on public.roommate_posts;
create policy "roommate_posts_audience" on public.roommate_posts
  as restrictive for select
  using (audience = 'global' or public.can_see_listing('roommate', id, author_id, audience, university_id));
drop policy if exists "items_audience" on public.items;
create policy "items_audience" on public.items
  as restrictive for select
  using (audience = 'global' or public.can_see_listing('item', id, seller_id, audience, university_id));

drop policy if exists "roommate_posts_anonymous" on public.roommate_posts;
create policy "roommate_posts_anonymous" on public.roommate_posts
  as restrictive for select
  using (not is_anonymous or public.anonymous_listing_visible('roommate', id));
drop policy if exists "items_anonymous" on public.items;
create policy "items_anonymous" on public.items
  as restrictive for select
  using (not is_anonymous or public.anonymous_listing_visible('item', id));

-- The poster's own anonymous listings, also while inactive or hidden (the ordinary policies match on the author).
drop policy if exists "roommate_posts_select_anonymous_own" on public.roommate_posts;
create policy "roommate_posts_select_anonymous_own" on public.roommate_posts
  for select to authenticated using (is_anonymous and public.owns_anonymous_listing('roommate', id));
drop policy if exists "items_select_anonymous_own" on public.items;
create policy "items_select_anonymous_own" on public.items
  for select to authenticated using (is_anonymous and public.owns_anonymous_listing('item', id));

-- Writing one: the row arrives with its poster, as any listing does, and leaves it at listings_hide_poster.
drop policy if exists "roommate_posts_insert_anonymous" on public.roommate_posts;
create policy "roommate_posts_insert_anonymous" on public.roommate_posts
  for insert to authenticated with check (is_anonymous and author_id is null);
drop policy if exists "items_insert_anonymous" on public.items;
create policy "items_insert_anonymous" on public.items
  for insert to authenticated with check (is_anonymous and seller_id is null);

drop policy if exists "roommate_posts_update_anonymous_own" on public.roommate_posts;
create policy "roommate_posts_update_anonymous_own" on public.roommate_posts
  for update to authenticated
  using (is_anonymous and public.owns_anonymous_listing('roommate', id))
  with check (is_anonymous and author_id is null);
drop policy if exists "items_update_anonymous_own" on public.items;
create policy "items_update_anonymous_own" on public.items
  for update to authenticated
  using (is_anonymous and public.owns_anonymous_listing('item', id))
  with check (is_anonymous and seller_id is null);

drop policy if exists "roommate_posts_delete_anonymous_own" on public.roommate_posts;
create policy "roommate_posts_delete_anonymous_own" on public.roommate_posts
  for delete to authenticated using (is_anonymous and public.owns_anonymous_listing('roommate', id));
drop policy if exists "items_delete_anonymous_own" on public.items;
create policy "items_delete_anonymous_own" on public.items
  for delete to authenticated using (is_anonymous and public.owns_anonymous_listing('item', id));

-- -----------------------------------------------------------------------------
-- 5. Triggers on the listings
-- -----------------------------------------------------------------------------
-- A campus-only listing is for its poster's own verified campus, as a post is (feed_posts_check_campus). Runs before
-- listings_hide_poster, so a new listing still has its poster; an existing anonymous one is looked up. Arguments: the
-- poster column and the listing type.
create or replace function public.listings_check_campus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poster uuid;
begin
  if new.audience is distinct from 'campus' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_poster := coalesce((to_jsonb(old) ->> tg_argv[0])::uuid, public.anonymous_listing_owner(tg_argv[1], old.id));
  else
    v_poster := (to_jsonb(new) ->> tg_argv[0])::uuid;
  end if;
  if new.university_id is distinct from public.verified_university(v_poster) then
    raise exception 'You can only post to your own campus.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.listings_check_campus() from public, anon, authenticated;
drop trigger if exists listings_check_campus on public.roommate_posts;
create trigger listings_check_campus
  before insert or update of audience, university_id on public.roommate_posts
  for each row execute function public.listings_check_campus('author_id', 'roommate');
drop trigger if exists listings_check_campus on public.items;
create trigger listings_check_campus
  before insert or update of audience, university_id on public.items
  for each row execute function public.listings_check_campus('seller_id', 'item');

-- An anonymous listing leaves its poster here, after every other check on the row has seen them (business accounts,
-- sanctions, campus: triggers fire by name, and this one sorts last): the poster goes to anonymous_listing_owners and
-- the column is emptied. Only the poster themselves may post it (the service role may name anyone). Whether a listing
-- is anonymous, and an anonymous listing's poster, never change.
create or replace function public.listings_hide_poster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poster uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if tg_op = 'UPDATE' then
    if new.is_anonymous is distinct from old.is_anonymous
       or (old.is_anonymous and v_poster is not null) then
      raise exception 'Whether a listing is anonymous can''t be changed after it''s posted.' using errcode = '42501';
    end if;
    return new;
  end if;
  if not new.is_anonymous then
    return new;
  end if;
  if v_poster is null then
    raise exception 'An anonymous listing still needs its poster.' using errcode = '23502';
  end if;
  if auth.uid() is not null and v_poster <> auth.uid() then
    raise exception 'You can only post as yourself.' using errcode = '42501';
  end if;
  if public.is_business_account(v_poster) then
    raise exception 'Business listings can''t be anonymous.' using errcode = '42501';
  end if;
  insert into public.anonymous_listing_owners (owner_id, roommate_post_id, item_id)
  values (v_poster, case when tg_argv[1] = 'roommate' then new.id end, case when tg_argv[1] = 'item' then new.id end);
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], null));
  return new;
end;
$$;
revoke all on function public.listings_hide_poster() from public, anon, authenticated;
drop trigger if exists zz_listings_hide_poster on public.roommate_posts;
create trigger zz_listings_hide_poster
  before insert or update of is_anonymous, author_id on public.roommate_posts
  for each row execute function public.listings_hide_poster('author_id', 'roommate');
drop trigger if exists zz_listings_hide_poster on public.items;
create trigger zz_listings_hide_poster
  before insert or update of is_anonymous, seller_id on public.items
  for each row execute function public.listings_hide_poster('seller_id', 'item');

-- -----------------------------------------------------------------------------
-- 6. The poster's own likes and saves, views and notifications
-- -----------------------------------------------------------------------------
-- The poster may not like or save their own anonymous listing: their name would be among its likers, and on their
-- profile's Liked and Saved tabs.
create or replace function public.engagement_not_own_anonymous()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.target_type in ('roommate', 'item') and public.anonymous_listing_owner(new.target_type, new.target_id) = new.user_id then
    raise exception 'You can''t like or save your own anonymous listing.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.engagement_not_own_anonymous() from public, anon, authenticated;
drop trigger if exists post_likes_not_own_anonymous on public.post_likes;
create trigger post_likes_not_own_anonymous
  before insert on public.post_likes
  for each row execute function public.engagement_not_own_anonymous();
drop trigger if exists saved_listings_not_own_anonymous on public.saved_listings;
create trigger saved_listings_not_own_anonymous
  before insert on public.saved_listings
  for each row execute function public.engagement_not_own_anonymous();

-- record_view() as in migration 39, with the anonymous poster found too (their own looks still do not count).
create or replace function public.record_view(p_target_type text, p_target_id uuid, p_viewer_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_owner uuid;
begin
  if p_target_type not in ('apartment', 'item', 'roommate', 'post', 'deal') or p_target_id is null then
    return;
  end if;
  v_owner := public.listing_poster(p_target_type, p_target_id);
  if v_owner is null or (auth.uid() is not null and v_owner = auth.uid()) then
    return;
  end if;
  -- A team looking at its own listing or deal does not count either.
  if auth.uid() is not null and public.is_business_account(auth.uid()) and public.business_of(auth.uid()) = public.business_of(v_owner) then
    return;
  end if;
  v_key := coalesce(auth.uid()::text, nullif(left(p_viewer_key, 64), ''));
  if v_key is null then
    return;
  end if;
  insert into public.post_views (target_type, target_id, viewer_id, viewer_key)
  values (p_target_type, p_target_id, auth.uid(), v_key)
  on conflict do nothing;
end;
$$;

-- notify_on_like() as in migration 13, reaching an anonymous listing's poster too. The notification is theirs alone.
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.listing_poster(new.target_type, new.target_id);
  v_actor text;
  v_count bigint;
begin
  if v_owner is null or v_owner = new.user_id then
    return new;
  end if;
  select full_name into v_actor from public.profiles where id = new.user_id;
  select count(*) into v_count from public.post_likes where target_type = new.target_type and target_id = new.target_id;
  perform public.notify(
    v_owner, new.user_id, 'like',
    case when v_count > 1 then coalesce(v_actor, 'Someone') || ' and ' || (v_count - 1) || ' other' || case when v_count > 2 then 's' else '' end || ' liked your post'
         else coalesce(v_actor, 'Someone') || ' liked your post' end,
    null, public.post_link(new.target_type, new.target_id),
    jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id),
    'like:' || new.target_type || ':' || new.target_id
  );
  return new;
end;
$$;

-- notify_on_saved() as production runs it (migration 9, and no ping from a suspended account: the moderation
-- migration applied outside this repo), reaching an anonymous listing's poster too.
create or replace function public.notify_on_saved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_link text;
  v_saver text;
begin
  if to_regprocedure('public.is_suspended(uuid)') is not null then
    if public.is_suspended(new.user_id) then
      return new;
    end if;
  end if;
  if new.target_type = 'apartment' then
    select owner_id, title into v_owner, v_title from public.apartments where id = new.target_id;
    v_link := '/apartments/' || new.target_id;
  elsif new.target_type = 'item' then
    select coalesce(seller_id, public.anonymous_listing_owner('item', id)), title into v_owner, v_title from public.items where id = new.target_id;
    v_link := '/marketplace/' || new.target_id;
  elsif new.target_type = 'roommate' then
    select coalesce(author_id, public.anonymous_listing_owner('roommate', id)), title into v_owner, v_title from public.roommate_posts where id = new.target_id;
    v_link := '/roommates/' || new.target_id;
  end if;
  if v_owner is null then
    return new;
  end if;
  select full_name into v_saver from public.profiles where id = new.user_id;
  perform public.notify(
    v_owner, new.user_id, 'listing_saved',
    coalesce(v_saver, 'Someone') || ' saved your listing', v_title, v_link,
    jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id),
    'saved:' || new.target_type || ':' || new.target_id
  );
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Anonymous inquiry chats
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column if not exists poster_hidden boolean not null default false,
  add column if not exists poster_revealed_at timestamptz;
alter table public.conversations drop constraint if exists conversations_inquiry_target_type_check;
alter table public.conversations add constraint conversations_inquiry_target_type_check
  check (inquiry_target_type is null or inquiry_target_type in ('apartment', 'deal', 'roommate', 'item'));
alter table public.messages add column if not exists anonymous boolean not null default false;

-- Who the anonymous poster of a chat is (kept after they show who they are). Only they can read it.
create table if not exists public.anonymous_chat_posters (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists anonymous_chat_posters_user_idx on public.anonymous_chat_posters (user_id);
alter table public.anonymous_chat_posters enable row level security;
revoke all on table public.anonymous_chat_posters from public, anon, authenticated;
grant select on table public.anonymous_chat_posters to authenticated;
drop policy if exists "anonymous_chat_posters_select_own" on public.anonymous_chat_posters;
create policy "anonymous_chat_posters_select_own" on public.anonymous_chat_posters
  for select to authenticated using (user_id = auth.uid());

-- The chat's poster while still hidden, else null. No API role.
create or replace function public.anonymous_chat_poster(p_conversation uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id
  from public.anonymous_chat_posters a
  join public.conversations c on c.id = a.conversation_id and c.poster_hidden
  where a.conversation_id = p_conversation;
$$;
revoke all on function public.anonymous_chat_poster(uuid) from public, anon, authenticated;

-- Someone in this chat is hidden from the caller: the anonymous poster they wrote to, not yet shown. True for that
-- chat whoever is asked about, so it says nothing about anyone in particular.
create or replace function public.chat_hides_poster(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.poster_hidden from public.conversations c where c.id = p_conversation), false)
    and not exists (select 1 from public.anonymous_chat_posters a where a.conversation_id = p_conversation and a.user_id = auth.uid());
$$;
revoke all on function public.chat_hides_poster(uuid) from public;
grant execute on function public.chat_hides_poster(uuid) to anon, authenticated;

-- The caller is this chat's hidden poster.
create or replace function public.am_anonymous_poster(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.anonymous_chat_poster(p_conversation) is not distinct from auth.uid();
$$;
revoke all on function public.am_anonymous_poster(uuid) from public;
grant execute on function public.am_anonymous_poster(uuid) to anon, authenticated;

-- The chat's hidden poster blocked the caller.
create or replace function public.blocked_by_anonymous_poster(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.blocks b
    where b.blocker_id = public.anonymous_chat_poster(p_conversation) and b.blocked_id = auth.uid()
  );
$$;
revoke all on function public.blocked_by_anonymous_poster(uuid) from public;
grant execute on function public.blocked_by_anonymous_poster(uuid) to anon, authenticated;

-- is_conversation_member() as in migration 1, except that it does not answer anyone but the poster about a hidden
-- poster's membership: asked about anyone but themselves in such a chat, the person who wrote to the poster gets false.
create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
  )
  and (auth.uid() is null or p_user_id = auth.uid() or not public.chat_hides_poster(p_conversation_id));
$$;

drop policy if exists "conversation_members_hide_anonymous_poster" on public.conversation_members;
create policy "conversation_members_hide_anonymous_poster" on public.conversation_members
  as restrictive for select
  using (user_id = auth.uid() or not public.chat_hides_poster(conversation_id));
drop policy if exists "conversation_members_anonymous_poster_stays" on public.conversation_members;
create policy "conversation_members_anonymous_poster_stays" on public.conversation_members
  as restrictive for delete
  using (not (user_id = auth.uid() and public.am_anonymous_poster(conversation_id)));

-- The hidden poster's own messages reach the table without a sender (zz_messages_hide_anonymous_poster), so they
-- pass this policy instead of messages_insert_member; the same block rule.
drop policy if exists "messages_insert_anonymous_poster" on public.messages;
create policy "messages_insert_anonymous_poster" on public.messages
  for insert to authenticated
  with check (
    sender_id is null
    and anonymous
    and public.am_anonymous_poster(conversation_id)
    and not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = messages.conversation_id and cm.user_id <> auth.uid() and public.is_blocked_either_way(cm.user_id)
    )
  );
-- The person writing to a hidden poster: messages_insert_member no longer sees the poster's row, so this keeps the
-- poster's block (and only theirs).
drop policy if exists "messages_anonymous_poster_block" on public.messages;
create policy "messages_anonymous_poster_block" on public.messages
  as restrictive for insert to authenticated
  with check (not public.blocked_by_anonymous_poster(conversation_id));

-- Is this shared card of something everyone may see? (A card of a post or listing that is gone, or a malformed one,
-- counts as public: the other checks decide those.)
create or replace function public.shared_post_is_public(p_card jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' or coalesce(p_card ->> 'target_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return true;
  end if;
  v_id := (p_card ->> 'target_id')::uuid;
  return case p_card ->> 'target_type'
    when 'post' then coalesce((select f.audience = 'global' from public.feed_posts f where f.id = v_id), true)
    when 'roommate' then coalesce((select r.audience = 'global' from public.roommate_posts r where r.id = v_id), true)
    when 'item' then coalesce((select i.audience = 'global' from public.items i where i.id = v_id), true)
    else true
  end;
end;
$$;
revoke all on function public.shared_post_is_public(jsonb) from public, anon, authenticated;

-- What a chat with a hidden poster allows, checked first (before the shared-post guard, whose answer would otherwise
-- say who can see what). Also clears `anonymous`, which only the trigger below may set.
create or replace function public.messages_anonymous_chat_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.anonymous := false;
  if not exists (select 1 from public.conversations c where c.id = new.conversation_id and c.poster_hidden) then
    return new;
  end if;
  if new.snap is not null then
    raise exception 'Snaps open once the poster shows who they are.' using errcode = '42501';
  end if;
  if new.call is not null then
    raise exception 'Calls open once the poster shows who they are.' using errcode = '42501';
  end if;
  if new.shared_post is not null and not public.shared_post_is_public(new.shared_post) then
    raise exception 'Only public posts can be shared in an anonymous chat.' using errcode = '42501';
  end if;
  if new.sender_id is not null and new.sender_id = public.anonymous_chat_poster(new.conversation_id)
     and ((jsonb_typeof(new.attachments) = 'array' and jsonb_array_length(new.attachments) > 0) or new.image_url is not null) then
    raise exception 'Photos, files and voice messages open once you show who you are.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.messages_anonymous_chat_rules() from public, anon, authenticated;
drop trigger if exists messages_anonymous_chat_rules on public.messages;
create trigger messages_anonymous_chat_rules
  before insert on public.messages
  for each row execute function public.messages_anonymous_chat_rules();

-- Last of all (triggers fire by name): the hidden poster's message is stored without them.
create or replace function public.messages_hide_anonymous_poster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender_id is not null and new.sender_id = public.anonymous_chat_poster(new.conversation_id) then
    new.sender_id := null;
    new.anonymous := true;
  end if;
  return new;
end;
$$;
revoke all on function public.messages_hide_anonymous_poster() from public, anon, authenticated;
drop trigger if exists zz_messages_hide_anonymous_poster on public.messages;
create trigger zz_messages_hide_anonymous_poster
  before insert on public.messages
  for each row execute function public.messages_hide_anonymous_poster();

-- handle_new_message() as in migration 35: the hidden poster has read their own message too.
create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      last_message_preview = coalesce(nullif(left(new.content, 120), ''), public.call_preview(new.call), public.message_preview(new.content, new.shared_post, new.attachments, new.snap))
  where id = new.conversation_id;

  -- The sender has obviously read (and received) their own message.
  update public.conversation_members
  set last_read_at = new.created_at, last_delivered_at = new.created_at
  where conversation_id = new.conversation_id
    and user_id = coalesce(new.sender_id, case when new.anonymous then public.anonymous_chat_poster(new.conversation_id) end);

  return new;
end;
$$;

-- notify_on_message() as in migration 35. A hidden poster's message reaches the other member as "Anonymous poster",
-- with no actor, and only a mute of the whole chat silences it.
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender text;
  v_sender_id uuid := coalesce(new.sender_id, case when new.anonymous then public.anonymous_chat_poster(new.conversation_id) end);
  v_conversation record;
  v_member uuid;
  v_title text;
begin
  if new.call is not null then
    return new;
  end if;
  if new.anonymous then
    v_sender := 'Anonymous poster';
  else
    select full_name into v_sender from public.profiles where id = new.sender_id;
  end if;
  select type, name into v_conversation from public.conversations where id = new.conversation_id;
  v_title := case
    when v_conversation.type = 'group' then coalesce(v_sender, 'Someone') || ' in ' || coalesce(v_conversation.name, 'group chat')
    else coalesce(v_sender, 'New message')
  end;
  for v_member in
    select user_id from public.conversation_members where conversation_id = new.conversation_id and user_id is distinct from v_sender_id
  loop
    if public.message_muted(v_member, new.sender_id, new.conversation_id) then
      continue;
    end if;
    if new.snap is not null then
      perform public.notify(
        v_member, new.sender_id, 'snap', v_title, 'Sent you a Snap',
        '/messages/' || new.conversation_id,
        jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'snap_id', new.snap ->> 'id'),
        'snap:' || new.conversation_id
      );
    else
      perform public.notify(
        v_member, new.sender_id, 'message', v_title, public.message_preview(new.content, new.shared_post, new.attachments, new.snap, 140),
        '/messages/' || new.conversation_id,
        jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id),
        'message:' || new.conversation_id
      );
    end if;
  end loop;
  return new;
end;
$$;

-- No calls while the poster is hidden, either way (start_call() checks only membership; a call names who joins).
create or replace function public.no_calls_with_hidden_posters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.conversations c where c.id = new.conversation_id and c.poster_hidden) then
    raise exception 'Calls open once the poster shows who they are.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.no_calls_with_hidden_posters() from public, anon, authenticated;
do $$
begin
  if to_regclass('public.calls') is not null then
    drop trigger if exists calls_no_hidden_poster on public.calls;
    create trigger calls_no_hidden_poster before insert on public.calls for each row execute function public.no_calls_with_hidden_posters();
  end if;
end $$;

-- can_snap() and list_snap_recipients() as in migration 28, leaving out chats with a hidden poster (which would name
-- the poster among the people you chat with, and let anyone check a guess).
create or replace function public.can_snap(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_other is not null
    and p_other <> auth.uid()
    and exists (select 1 from public.profiles p where p.id = p_other)
    and not public.is_blocked_either_way(p_other)
    and (
      exists (
        select 1
        from public.follows f1
        join public.follows f2 on f2.follower_id = p_other and f2.followee_id = auth.uid()
        where f1.follower_id = auth.uid() and f1.followee_id = p_other
      )
      or exists (
        select 1
        from public.conversations c
        join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
        join public.conversation_members theirs on theirs.conversation_id = c.id and theirs.user_id = p_other
        where c.type = 'direct' and not c.poster_hidden
      )
    );
$$;

create or replace function public.list_snap_recipients(p_q text default null)
returns table (id uuid, full_name text, avatar_url text, is_friend boolean, last_message_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with chats as (
    select theirs.user_id as person, max(c.last_message_at) as last_message_at
    from public.conversation_members mine
    join public.conversations c on c.id = mine.conversation_id and c.type = 'direct' and not c.poster_hidden
    join public.conversation_members theirs on theirs.conversation_id = c.id and theirs.user_id <> mine.user_id
    where mine.user_id = auth.uid()
    group by theirs.user_id
  ),
  friends as (
    select f1.followee_id as person
    from public.follows f1
    join public.follows f2 on f2.follower_id = f1.followee_id and f2.followee_id = f1.follower_id
    where f1.follower_id = auth.uid()
  ),
  people as (
    select coalesce(c.person, f.person) as person, c.last_message_at, f.person is not null as is_friend
    from chats c
    full join friends f on f.person = c.person
  )
  select p.id, p.full_name, p.avatar_url, x.is_friend, x.last_message_at
  from people x
  join public.profiles p on p.id = x.person
  where auth.uid() is not null
    and p.id <> auth.uid()
    and not public.is_blocked_either_way(p.id)
    and (
      btrim(coalesce(p_q, '')) = ''
      or p.full_name ilike '%' || replace(replace(replace(left(btrim(p_q), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    )
  order by x.last_message_at desc nulls last, p.full_name, p.id
  limit 500;
$$;

-- activity_status() as in migration 24, except that a chat with a poster hidden from the caller does not count as a
-- chat shared with anyone (the poster's "Active now" would otherwise answer a guess).
create or replace function public.activity_status(p_user_ids uuid[])
returns table (user_id uuid, last_active_at timestamptz, recent boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, case when s.wrote then s.minute end, s.recent
  from (
    select
      a.user_id,
      date_trunc('minute', a.last_active_at) as minute,
      date_trunc('minute', a.last_active_at) >= date_trunc('minute', now()) - interval '2 minutes' as recent,
      exists (
        select 1
        from public.conversation_members mine
        join public.conversation_members theirs on theirs.conversation_id = mine.conversation_id and theirs.user_id = a.user_id
        where mine.user_id = auth.uid()
          and not public.chat_hides_poster(mine.conversation_id)
          and exists (
            select 1 from public.messages m
            where m.sender_id = a.user_id and m.conversation_id = mine.conversation_id and m.created_at >= mine.joined_at
          )
      ) as wrote,
      exists (
        select 1
        from public.conversation_members mine
        join public.conversation_members theirs on theirs.conversation_id = mine.conversation_id and theirs.user_id = a.user_id
        where mine.user_id = auth.uid()
          and not public.chat_hides_poster(mine.conversation_id)
      ) as shared
    from (
      select distinct u.id
      from (select x.id from unnest(p_user_ids) with ordinality as x(id, n) order by x.n limit 100) u
    ) asked
    join public.user_activity a on a.user_id = asked.id
    join public.profiles them on them.id = a.user_id and them.show_active_status
    where a.user_id <> auth.uid()
      and exists (select 1 from public.profiles me where me.id = auth.uid() and me.show_active_status)
      and not public.is_blocked_either_way(a.user_id)
  ) s
  where s.wrote or (s.shared and s.recent);
$$;

-- The caller's chat with an anonymous listing's poster: theirs if there is one, else a new one, with the poster hidden.
-- Only for a listing the caller can see (a gone, closed, hidden or out-of-audience one is "no longer available", as is
-- one whose poster blocked the caller); not for the poster, nor for business accounts (which only answer students).
create or replace function public.start_listing_inquiry(p_target_type text, p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_anonymous boolean;
  v_open boolean;
  v_audience text;
  v_university uuid;
  v_poster uuid;
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if public.is_business_account(v_me) then
    raise exception 'Businesses can only reply to students who contacted them.' using errcode = '42501';
  end if;
  if p_target_type = 'roommate' then
    select r.is_anonymous, r.is_active and (to_jsonb(r) ->> 'hidden_at') is null, r.audience, r.university_id
      into v_anonymous, v_open, v_audience, v_university
      from public.roommate_posts r where r.id = p_target_id;
  elsif p_target_type = 'item' then
    select i.is_anonymous, i.status <> 'archived' and (to_jsonb(i) ->> 'hidden_at') is null, i.audience, i.university_id
      into v_anonymous, v_open, v_audience, v_university
      from public.items i where i.id = p_target_id;
  else
    raise exception 'Only roommate posts and Marketplace items can be anonymous.' using errcode = '22023';
  end if;
  if not found or not v_open then
    raise exception 'This listing is no longer available.' using errcode = 'P0002';
  end if;
  if not v_anonymous then
    raise exception 'This listing isn''t anonymous: message its poster directly.' using errcode = '22023';
  end if;
  v_poster := public.anonymous_listing_owner(p_target_type, p_target_id);
  if v_poster is null then
    raise exception 'This listing is no longer available.' using errcode = 'P0002';
  end if;
  if v_poster = v_me then
    raise exception 'This is your own listing.' using errcode = '22023';
  end if;
  if not public.can_see_listing_as(v_me, p_target_type, p_target_id, v_poster, v_audience, v_university)
     or not public.anonymous_listing_visible(p_target_type, p_target_id) then
    raise exception 'This listing is no longer available.' using errcode = 'P0002';
  end if;

  v_key := 'anon:' || p_target_type || ':' || p_target_id::text || ':' || v_me::text;
  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is not null then
    insert into public.conversation_members (conversation_id, user_id) values (v_id, v_me) on conflict do nothing;
    return v_id;
  end if;

  begin
    insert into public.conversations (type, direct_key, created_by, inquiry_target_type, inquiry_target_id, poster_hidden)
    values ('direct', v_key, v_me, p_target_type, p_target_id, true)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.conversations where direct_key = v_key;
    return v_id;
  end;
  insert into public.anonymous_chat_posters (conversation_id, user_id) values (v_id, v_poster);
  insert into public.conversation_members (conversation_id, user_id) values (v_id, v_me), (v_id, v_poster);
  return v_id;
end;
$$;
revoke all on function public.start_listing_inquiry(text, uuid) from public, anon;
grant execute on function public.start_listing_inquiry(text, uuid) to authenticated;

-- The hidden poster shows who they are, to the one person in this chat, once that person has written: the chat
-- becomes an ordinary one between them (their earlier messages get their sender back) and the person is told. Running
-- it again changes nothing. Returns when it happened.
create or replace function public.reveal_listing_identity(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_conversation public.conversations;
  v_other uuid;
  v_name text;
  v_title text;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select c.* into v_conversation
  from public.conversations c
  join public.anonymous_chat_posters a on a.conversation_id = c.id and a.user_id = v_me
  where c.id = p_conversation_id
  for update of c;
  if not found then
    raise exception 'Only the anonymous poster in this chat can do this.' using errcode = '42501';
  end if;
  if not v_conversation.poster_hidden then
    return v_conversation.poster_revealed_at;
  end if;
  select cm.user_id into v_other from public.conversation_members cm where cm.conversation_id = p_conversation_id and cm.user_id <> v_me limit 1;
  if v_other is null or not exists (select 1 from public.messages m where m.conversation_id = p_conversation_id and m.sender_id = v_other) then
    raise exception 'You can show who you are once they''ve messaged you.' using errcode = '42501';
  end if;

  update public.conversations set poster_hidden = false, poster_revealed_at = now() where id = p_conversation_id;
  update public.messages set sender_id = v_me, anonymous = false where conversation_id = p_conversation_id and anonymous;

  select full_name into v_name from public.profiles where id = v_me;
  v_title := case v_conversation.inquiry_target_type
    when 'roommate' then (select title from public.roommate_posts where id = v_conversation.inquiry_target_id)
    when 'item' then (select title from public.items where id = v_conversation.inquiry_target_id)
  end;
  if not public.message_muted(v_other, v_me, p_conversation_id) then
    perform public.notify(
      v_other, v_me, 'message',
      coalesce(nullif(v_name, ''), 'The poster') || ' shared who they are',
      case when v_title is not null then 'They posted "' || v_title || '"' else 'In your chat about their listing' end,
      '/messages/' || p_conversation_id,
      jsonb_build_object('conversation_id', p_conversation_id),
      'reveal:' || p_conversation_id
    );
  end if;
  return now();
end;
$$;
revoke all on function public.reveal_listing_identity(uuid) from public, anon;
grant execute on function public.reveal_listing_identity(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Shared cards: listings follow their audience, and an anonymous one has no author
-- -----------------------------------------------------------------------------
-- guard_message_shared_post() as in migration 44 for posts; a listing card now gets the same rule ("Some people in
-- this chat can't see this listing."), and the card of an anonymous listing loses the author its sender wrote into it.
create or replace function public.guard_message_shared_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_post public.feed_posts;
  v_type text;
  v_anonymous boolean;
  v_audience text;
  v_university uuid;
  v_poster uuid;
begin
  if new.shared_post is null or jsonb_typeof(new.shared_post) <> 'object' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.shared_post is not distinct from old.shared_post then
    return new;
  end if;
  v_type := new.shared_post ->> 'target_type';
  v_id := new.shared_post ->> 'target_id';
  if v_type not in ('post', 'roommate', 'item') or v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;

  if v_type = 'post' then
    select * into v_post from public.feed_posts f where f.id = v_id::uuid;
    if not found or v_post.audience = 'global' then
      return new;
    end if;
    if exists (
      select 1 from public.conversation_members m
      where m.conversation_id = new.conversation_id
        and m.user_id is distinct from new.sender_id
        and not public.can_see_feed_post_as(m.user_id, v_post.id, v_post.author_id, v_post.audience, v_post.university_id)
    ) then
      raise exception 'Some people in this chat can''t see this post.' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_type = 'roommate' then
    select r.is_anonymous, r.audience, r.university_id, r.author_id into v_anonymous, v_audience, v_university, v_poster from public.roommate_posts r where r.id = v_id::uuid;
  else
    select i.is_anonymous, i.audience, i.university_id, i.seller_id into v_anonymous, v_audience, v_university, v_poster from public.items i where i.id = v_id::uuid;
  end if;
  if not found then
    return new;
  end if;
  if v_anonymous then
    new.shared_post := (new.shared_post - 'author') || jsonb_build_object('author', jsonb_build_object('name', 'Anonymous'));
    v_poster := public.anonymous_listing_owner(v_type, v_id::uuid);
  end if;
  if v_audience is distinct from 'global' and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = new.conversation_id
      and m.user_id is distinct from new.sender_id
      and not public.can_see_listing_as(m.user_id, v_type, v_id::uuid, v_poster, v_audience, v_university)
  ) then
    raise exception 'Some people in this chat can''t see this listing.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Staff: an anonymous listing's poster, and an anonymous poster's message, can still be acted on
-- -----------------------------------------------------------------------------
-- ts_public_author_of() as in migration 41 (staff functions only: no API role may call it).
create or replace function public.ts_public_author_of(p_type text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'post' then (select x.author_id from public.feed_posts x where x.id = p_id)
    when 'comment' then (select x.user_id from public.post_comments x where x.id = p_id)
    when 'apartment' then (select x.owner_id from public.apartments x where x.id = p_id)
    when 'item' then (select coalesce(x.seller_id, public.anonymous_listing_owner('item', x.id)) from public.items x where x.id = p_id)
    when 'roommate' then (select coalesce(x.author_id, public.anonymous_listing_owner('roommate', x.id)) from public.roommate_posts x where x.id = p_id)
    when 'profile' then (select x.id from public.profiles x where x.id = p_id)
    when 'message' then (
      select coalesce(x.sender_id, case when x.anonymous then (select a.user_id from public.anonymous_chat_posters a where a.conversation_id = x.conversation_id) end)
      from public.messages x where x.id = p_id
    )
  end;
$$;

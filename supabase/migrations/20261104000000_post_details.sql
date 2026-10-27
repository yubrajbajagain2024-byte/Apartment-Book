-- =============================================================================
-- UniBuzz - migration 44: a title, a link, an audience and a comments switch
-- on posts and reels
-- The composer's publish screen now asks four more things about a Home post or
-- reel (public.feed_posts), all optional; left alone, a post is what it always
-- was (Global, comments on, no title, no link):
--
--   * title (text, null): shown in bold over the caption. At most 100
--     characters (the apps trim it first) and never blank. A post may now be
--     just a title: feed_posts_not_empty counts one.
--   * link_url (text, null): one http(s) address, at most 500 characters, no
--     whitespace. Only the scheme is checked here; the apps check the rest.
--   * audience, default global: who can see it.
--       global    everyone, signed out included (every post before this one)
--       campus    signed-in people whose verified campus is the post's
--                 university. The verified campus comes from the confirmed
--                 sign-in email's domain (verified_university), never from the
--                 profile's editable university; business accounts have none.
--                 A campus post needs a university_id, and it must be its
--                 author's own verified campus ("You can only post to your own
--                 campus.": feed_posts_check_campus).
--       friends   people who follow the author and are followed back
--       selected  only the people the author picked: feed_post_viewers, at
--                 most 50, written by set_post_viewers()
--     The author always sees their own post.
--   * comments_off (boolean, default false): nobody may comment, its author
--     included. Comments written before it was turned off stay.
--
-- The database keeps the audience, so a post never reaches anyone outside it:
--   * can_see_feed_post_as(viewer, post, author, audience, university) is the
--     rule; can_see_feed_post(post, author, audience, university) asks it for
--     the caller, can_see_feed_post_id(post) for a post known by its id.
--   * A RESTRICTIVE select policy, feed_posts_audience, adds that rule to every
--     read of feed_posts, on top of the policies already there (including the
--     ones the moderation migration applied outside this repo, left as they
--     are). reels_feed() and following_posts() run as the caller, so the Reels
--     and Following feeds follow it too.
--   * profile_stats() (security definer) counts only the posts and reels the
--     person asking may see; the likes total is unchanged.
--   * A comment on a post the caller may not see is refused ("This post is not
--     available."), and so is any comment on a post with comments off
--     ("Comments are turned off for this post."): post_comments_check_post.
--   * What hangs off a post follows it too: its comments are readable only by
--     people who may see it (post_comments_post_audience, restrictive; a
--     comment's writer always sees their own), likes and saves of it are
--     refused ("This post is not available.": post_likes_check_post,
--     saved_listings_check_post), views of it are not recorded
--     (post_views_check_post), and post_likers_many() leaves it out.
--   * A post can be shared into a chat only when everyone else in that chat may
--     see it ("Some people in this chat can't see this post."): a shared-post
--     card carries a snapshot of the caption and picture
--     (messages_guard_shared_post).
--
-- Staff read content through security definer functions (the website's
-- console_* and CampConnect Admin's admin_* functions), which run as the
-- tables' owner and are not subject to row-level security, so reports of a
-- post with any audience stay reviewable. Being staff does not open anyone's
-- posts in the ordinary feeds. The console's snapshot of a reported post
-- (ts_public_snapshot) now shows its title, its link and a narrower audience.
--
-- Additive: every existing post becomes Global with comments on, exactly what
-- it was. The apps write the new columns only when something differs from
-- that, so posting keeps working on a database without this migration.
-- Rollback: supabase/rollbacks/20261104000000_post_details.down.sql.
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.feed_posts
  add column if not exists title text,
  add column if not exists link_url text,
  add column if not exists audience text not null default 'global',
  add column if not exists comments_off boolean not null default false;

alter table public.feed_posts drop constraint if exists feed_posts_title_check;
alter table public.feed_posts add constraint feed_posts_title_check
  check (title is null or (char_length(title) <= 100 and title ~ '[^[:space:]]'));
alter table public.feed_posts drop constraint if exists feed_posts_link_url_check;
alter table public.feed_posts add constraint feed_posts_link_url_check
  check (link_url is null or (char_length(link_url) <= 500 and link_url ~* '^https?://[^[:space:]]+$'));
alter table public.feed_posts drop constraint if exists feed_posts_audience_check;
alter table public.feed_posts add constraint feed_posts_audience_check
  check (audience in ('campus', 'global', 'friends', 'selected'));
-- A campus post is for one university: without one it would reach nobody but its author.
alter table public.feed_posts drop constraint if exists feed_posts_campus_has_university;
alter table public.feed_posts add constraint feed_posts_campus_has_university
  check (audience <> 'campus' or university_id is not null);

-- A post may be just a title now (the composer allows it); a reel still needs its video.
alter table public.feed_posts drop constraint if exists feed_posts_not_empty;
alter table public.feed_posts add constraint feed_posts_not_empty
  check (char_length(btrim(body)) > 0 or title is not null or cardinality(images) > 0 or jsonb_array_length(videos) > 0);

-- -----------------------------------------------------------------------------
-- 2. The people a "Selected people" post is shown to
-- -----------------------------------------------------------------------------
-- Written only by set_post_viewers(). The author reads the whole list; a picked person reads only their own row, so
-- nobody learns who else was picked.
create table if not exists public.feed_post_viewers (
  post_id uuid not null references public.feed_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists feed_post_viewers_user_idx on public.feed_post_viewers (user_id);
alter table public.feed_post_viewers enable row level security;
revoke all on table public.feed_post_viewers from public, anon, authenticated;
grant select on table public.feed_post_viewers to authenticated;
drop policy if exists "feed_post_viewers_select" on public.feed_post_viewers;
create policy "feed_post_viewers_select" on public.feed_post_viewers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.feed_posts f where f.id = post_id and f.author_id = (select auth.uid()))
  );

-- -----------------------------------------------------------------------------
-- 3. Who can see a post
-- -----------------------------------------------------------------------------
-- Someone's verified campus: the university of their sign-in email's domain (university_for_email, migration 2), once
-- that email is confirmed. Not profiles.university_id, which its owner can edit. A business account has none (it may
-- sign up with any address, migration 39), nor does an address no university lists (invited staff). Supabase changes
-- auth.users.email only once the new address is confirmed, so the domain stays a verified one. Reads auth.users as the
-- definer: no API role may call it.
create or replace function public.verified_university(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.university_for_email(u.email)
  from auth.users u
  where u.id = p_user
    and u.email_confirmed_at is not null
    and not public.is_business_account(u.id);
$$;
revoke all on function public.verified_university(uuid) from public, anon, authenticated;

-- The rule, for any viewer (null = signed out). It reads auth.users, follows and feed_post_viewers as the definer, so
-- it would answer questions about other people: no API role may call it, only the functions here.
create or replace function public.can_see_feed_post_as(p_viewer uuid, p_post_id uuid, p_author uuid, p_audience text, p_university uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_audience is null or p_audience = 'global' then true
    when p_viewer is null then false
    when p_viewer = p_author then true
    when p_audience = 'campus' then p_university is not null
      and public.verified_university(p_viewer) is not distinct from p_university
    when p_audience = 'friends' then
      exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = p_author)
      and exists (select 1 from public.follows f where f.follower_id = p_author and f.followee_id = p_viewer)
    when p_audience = 'selected' then
      exists (select 1 from public.feed_post_viewers v where v.post_id = p_post_id and v.user_id = p_viewer)
    else false
  end;
$$;
revoke all on function public.can_see_feed_post_as(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- The same for the caller. Runs inside the select policies as the caller, so every API role may execute it; it answers
-- only about the person asking (their own campus, their own follows, whether they were picked).
create or replace function public.can_see_feed_post(p_post_id uuid, p_author uuid, p_audience text, p_university uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_see_feed_post_as(auth.uid(), p_post_id, p_author, p_audience, p_university);
$$;
revoke all on function public.can_see_feed_post(uuid, uuid, text, uuid) from public;
grant execute on function public.can_see_feed_post(uuid, uuid, text, uuid) to anon, authenticated;

-- The same, for a post known by its id (the comment policy and post_likers_many): one primary-key lookup, and a Global
-- post needs nothing more. A post that does not exist (or no longer does) is not visible.
create or replace function public.can_see_feed_post_id(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select f.audience = 'global' or public.can_see_feed_post(f.id, f.author_id, f.audience, f.university_id)
    from public.feed_posts f where f.id = p_post
  ), false);
$$;
revoke all on function public.can_see_feed_post_id(uuid) from public;
grant execute on function public.can_see_feed_post_id(uuid) to anon, authenticated;

-- Restrictive: a row must pass this AND one of the permissive select policies. Global posts skip the function call.
drop policy if exists "feed_posts_audience" on public.feed_posts;
create policy "feed_posts_audience" on public.feed_posts
  as restrictive for select
  using (audience = 'global' or public.can_see_feed_post(id, author_id, audience, university_id));

-- A campus post is for its author's own verified campus. Checked whenever a post is written campus-only or its
-- audience or university changes; posts with other audiences are left alone. On an update the author is the row's
-- old one (feed_posts_guard, which runs after this, puts it back if the update tried to change it).
create or replace function public.feed_posts_check_campus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.audience = 'campus'
     and new.university_id is distinct from public.verified_university(case when tg_op = 'UPDATE' then old.author_id else new.author_id end) then
    raise exception 'You can only post to your own campus.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.feed_posts_check_campus() from public, anon, authenticated;
drop trigger if exists feed_posts_check_campus on public.feed_posts;
create trigger feed_posts_check_campus
  before insert or update of audience, university_id on public.feed_posts
  for each row execute function public.feed_posts_check_campus();

-- -----------------------------------------------------------------------------
-- 4. Choosing the people: set_post_viewers()
-- -----------------------------------------------------------------------------
-- Replaces a post's list in one go and returns how many people it holds now. Only the author may; their own id, nulls
-- and repeats are dropped, more than 50 people are refused, and anyone blocked either way or without a profile is
-- left out. The audience column is the author's to set as before: the apps post with 'selected' first (seen by nobody
-- but the author until this call) and delete the post again if the call fails.
create or replace function public.set_post_viewers(p_post_id uuid, p_user_ids uuid[])
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
  select f.author_id into v_author from public.feed_posts f where f.id = p_post_id for update;
  if v_me is null or v_author is null or v_author <> v_me then
    raise exception 'Only the author can choose who sees this post.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct u), '{}') into v_ids
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  where u is not null and u <> v_me;
  if cardinality(v_ids) > 50 then
    raise exception 'Choose up to 50 people.' using errcode = '22023';
  end if;
  delete from public.feed_post_viewers v where v.post_id = p_post_id;
  insert into public.feed_post_viewers (post_id, user_id)
  select p_post_id, p.id
  from public.profiles p
  where p.id = any (v_ids) and not public.is_blocked_either_way(p.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.set_post_viewers(uuid, uuid[]) from public, anon;
grant execute on function public.set_post_viewers(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Profile numbers: migration 19's profile_stats(), counting only the posts and reels the caller may see
-- -----------------------------------------------------------------------------
create or replace function public.profile_stats(p_user_id uuid)
returns table (posts bigint, reels bigint, likes_received bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when s.blocked then 0 else (select count(*) from public.feed_posts f where f.author_id = p_user_id and f.kind = 'post' and (f.audience = 'global' or public.can_see_feed_post(f.id, f.author_id, f.audience, f.university_id))) end,
    case when s.blocked then 0 else (select count(*) from public.feed_posts f where f.author_id = p_user_id and f.kind = 'reel' and (f.audience = 'global' or public.can_see_feed_post(f.id, f.author_id, f.audience, f.university_id))) end,
    case when s.blocked then 0 else
      (select count(*) from public.feed_posts f join public.post_likes l on l.target_type = 'post' and l.target_id = f.id where f.author_id = p_user_id)
      + (select count(*) from public.apartments a join public.post_likes l on l.target_type = 'apartment' and l.target_id = a.id where a.owner_id = p_user_id)
      + (select count(*) from public.roommate_posts r join public.post_likes l on l.target_type = 'roommate' and l.target_id = r.id where r.author_id = p_user_id)
      + (select count(*) from public.items i join public.post_likes l on l.target_type = 'item' and l.target_id = i.id where i.seller_id = p_user_id)
    end
  from (select public.is_blocked_either_way(p_user_id) as blocked) s;
$$;
grant execute on function public.profile_stats(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Comments: only on a post you may see, and never with comments off
-- -----------------------------------------------------------------------------
-- Reads the post as the definer, so a post the caller may not see is refused instead of looking absent. Without a
-- caller (the service role, the SQL editor) only the comments switch applies. A post that does not exist is left to
-- the checks that were there before.
create or replace function public.post_comments_check_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.feed_posts;
begin
  if new.target_type is distinct from 'post' then
    return new;
  end if;
  select * into v_post from public.feed_posts f where f.id = new.target_id;
  if not found then
    return new;
  end if;
  if auth.uid() is not null and not public.can_see_feed_post(v_post.id, v_post.author_id, v_post.audience, v_post.university_id) then
    raise exception 'This post is not available.' using errcode = '42501';
  end if;
  if v_post.comments_off then
    raise exception 'Comments are turned off for this post.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.post_comments_check_post() from public, anon, authenticated;
drop trigger if exists post_comments_check_post on public.post_comments;
create trigger post_comments_check_post
  before insert on public.post_comments
  for each row execute function public.post_comments_check_post();

-- Comments on a post are readable only by people who may see the post, and by their own writers (who can still find and
-- delete them after losing sight of the post). Restrictive, like feed_posts_audience, so the comment policies already
-- there (blocks, moderation, business sessions) stay as they are; comments on listings are untouched. Realtime applies
-- select policies before it sends a new or changed comment, so this covers it too.
drop policy if exists "post_comments_post_audience" on public.post_comments;
create policy "post_comments_post_audience" on public.post_comments
  as restrictive for select
  using (target_type <> 'post' or user_id = (select auth.uid()) or public.can_see_feed_post_id(target_id));

-- -----------------------------------------------------------------------------
-- 7. Likes, saves and views follow the post's audience
-- -----------------------------------------------------------------------------
-- No likes or saves on a post the caller may not see: they would notify its author and count on it. Without a caller
-- (the service role, the SQL editor) nothing is checked; a post that does not exist is left to the checks before.
create or replace function public.feed_post_engagement_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.feed_posts;
begin
  if new.target_type is distinct from 'post' or auth.uid() is null then
    return new;
  end if;
  select * into v_post from public.feed_posts f where f.id = new.target_id;
  if found and not public.can_see_feed_post(v_post.id, v_post.author_id, v_post.audience, v_post.university_id) then
    raise exception 'This post is not available.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.feed_post_engagement_check() from public, anon, authenticated;
drop trigger if exists post_likes_check_post on public.post_likes;
create trigger post_likes_check_post
  before insert on public.post_likes
  for each row execute function public.feed_post_engagement_check();
drop trigger if exists saved_listings_check_post on public.saved_listings;
create trigger saved_listings_check_post
  before insert on public.saved_listings
  for each row execute function public.feed_post_engagement_check();

-- Views are written only by record_view() (security definer, for signed-in and signed-out visitors alike), which never
-- reports an error: a view of a post the viewer may not see is simply not recorded.
create or replace function public.post_views_check_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.feed_posts;
begin
  if new.target_type is distinct from 'post' then
    return new;
  end if;
  select * into v_post from public.feed_posts f where f.id = new.target_id;
  if found and not public.can_see_feed_post(v_post.id, v_post.author_id, v_post.audience, v_post.university_id) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.post_views_check_post() from public, anon, authenticated;
drop trigger if exists post_views_check_post on public.post_views;
create trigger post_views_check_post
  before insert on public.post_views
  for each row execute function public.post_views_check_post();

-- -----------------------------------------------------------------------------
-- 8. Shared posts in chats: only where everyone else in the chat may see the post
-- -----------------------------------------------------------------------------
-- A shared-post card (migration 17) stores the caption and a picture in the message, where the post's audience no
-- longer reaches: every other member must be inside it (a Global post always is; a campus post when they are all at
-- its university; friends and selected people one by one). Reads the post and the members as the definer. Listing
-- cards, cards of posts that are gone and malformed cards (left to messages_shared_post_check) are as before.
create or replace function public.guard_message_shared_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_post public.feed_posts;
begin
  if new.shared_post is null or jsonb_typeof(new.shared_post) <> 'object' or new.shared_post ->> 'target_type' is distinct from 'post' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.shared_post is not distinct from old.shared_post then
    return new;
  end if;
  v_id := new.shared_post ->> 'target_id';
  if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
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
end;
$$;
revoke all on function public.guard_message_shared_post() from public, anon, authenticated;
drop trigger if exists messages_guard_shared_post on public.messages;
create trigger messages_guard_shared_post
  before insert or update of shared_post on public.messages
  for each row execute function public.guard_message_shared_post();

-- -----------------------------------------------------------------------------
-- 9. "Liked by" faces: migration 19's post_likers_many(), skipping posts the caller may not see
-- -----------------------------------------------------------------------------
create or replace function public.post_likers_many(p_target_type text, p_target_ids uuid[], p_per int default 3)
returns table (target_id uuid, user_id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, x.user_id, x.full_name, x.avatar_url
  from unnest(p_target_ids[1:100]) with ordinality as t(id, ord)
  cross join lateral (
    select l.user_id, p.full_name, p.avatar_url, l.created_at
    from public.post_likes l
    join public.profiles p on p.id = l.user_id
    where l.target_type = p_target_type
      and l.target_id = t.id
      and (l.user_id = auth.uid() or public.can_view_profile_section(l.user_id, 'liked'))
    order by l.created_at desc, l.user_id
    limit least(greatest(coalesce(p_per, 3), 1), 10)
  ) x
  where p_target_type is distinct from 'post' or public.can_see_feed_post_id(t.id)
  order by t.ord, x.created_at desc, x.user_id;
$$;
grant execute on function public.post_likers_many(text, uuid[], int) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Moderators see a reported post's title, link and audience: migration 41's ts_public_snapshot(), whose post
--     snapshot gains a 'title' field before the body, and a 'link' and an 'audience' field after it, when the post
--     has a title, a link or an audience other than Global (unchanged otherwise)
-- -----------------------------------------------------------------------------
create or replace function public.ts_public_snapshot(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_fields jsonb := '[]'::jsonb;
  v_media jsonb := '[]'::jsonb;
  v_href text;
  v_label text;
  v_uni uuid;
  v_parent jsonb := null;
begin
  if p_id is null then
    return null;
  end if;
  if p_type = 'post' then
    select to_jsonb(x) into r from public.feed_posts x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'body', '')));
    if coalesce(btrim(r ->> 'title'), '') <> '' then
      v_fields := jsonb_build_array(jsonb_build_object('field', 'title', 'text', r ->> 'title')) || v_fields;
    end if;
    if coalesce(r ->> 'link_url', '') <> '' then
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('field', 'link', 'text', r ->> 'link_url'));
    end if;
    if coalesce(r ->> 'audience', 'global') <> 'global' then
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('field', 'audience', 'text', case r ->> 'audience' when 'campus' then 'Campus only' when 'friends' then 'Friends only' when 'selected' then 'Selected people' else r ->> 'audience' end));
    end if;
    v_label := case when r ->> 'kind' = 'reel' then 'reel' else 'post' end;
    v_href := case when r ->> 'kind' = 'reel' then '/reels/' else '/posts/' end || p_id::text;
  elsif p_type = 'comment' then
    select to_jsonb(x) into r from public.post_comments x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'body', '')));
    v_label := 'comment';
    v_href := public.post_link(r ->> 'target_type', public.ts_uuid(r ->> 'target_id'));
    v_parent := jsonb_build_object('entityType', r ->> 'target_type', 'entityId', r ->> 'target_id');
  elsif p_type = 'apartment' then
    select to_jsonb(x) into r from public.apartments x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'title', 'text', coalesce(r ->> 'title', '')),
                                  jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'description', '')));
    v_label := 'listing';
    v_href := '/apartments/' || p_id::text;
  elsif p_type = 'item' then
    select to_jsonb(x) into r from public.items x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'title', 'text', coalesce(r ->> 'title', '')),
                                  jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'description', '')));
    v_label := 'item';
    v_href := '/marketplace/' || p_id::text;
  elsif p_type = 'roommate' then
    select to_jsonb(x) into r from public.roommate_posts x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'title', 'text', coalesce(r ->> 'title', '')),
                                  jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'description', '')));
    v_label := 'roommate post';
    v_href := '/roommates/' || p_id::text;
  elsif p_type = 'profile' then
    select to_jsonb(x) into r from public.profiles x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'name', 'text', coalesce(r ->> 'full_name', '')),
                                  jsonb_build_object('field', 'bio', 'text', coalesce(r ->> 'bio', '')));
    v_label := 'profile';
    v_href := '/profile/' || p_id::text;
    if coalesce(r ->> 'avatar_url', '') <> '' then
      v_media := jsonb_build_array(jsonb_build_object('url', r ->> 'avatar_url', 'kind', 'image'));
    end if;
  elsif p_type = 'message' then
    select to_jsonb(x) into r from public.messages x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'content', '')));
    v_label := 'message';
    v_href := '/messages/' || coalesce(r ->> 'conversation_id', '');
    if coalesce(r ->> 'image_url', '') <> '' then
      v_media := jsonb_build_array(jsonb_build_object('url', r ->> 'image_url', 'kind', 'image'));
    end if;
  else
    return null;
  end if;

  if p_type in ('post', 'apartment', 'item', 'roommate') then
    select coalesce(jsonb_agg(jsonb_build_object('url', u, 'kind', 'image') order by o), '[]'::jsonb) into v_media
    from jsonb_array_elements_text(case when jsonb_typeof(r -> 'images') = 'array' then r -> 'images' else '[]'::jsonb end) with ordinality as e(u, o);
    v_media := v_media || coalesce((
      select jsonb_agg(jsonb_build_object('url', 'https://stream.mux.com/' || (v ->> 'playback_id') || '.m3u8', 'kind', 'video') order by o)
      from jsonb_array_elements(case when jsonb_typeof(r -> 'videos') = 'array' then r -> 'videos' else '[]'::jsonb end) with ordinality as e(v, o)
      where coalesce(v ->> 'playback_id', '') ~ '^[A-Za-z0-9]+$'
    ), '[]'::jsonb);
  end if;
  v_uni := public.ts_uuid(r ->> 'university_id');
  if v_uni is null and p_type = 'comment' then
    select p.university_id into v_uni from public.profiles p where p.id = public.ts_uuid(r ->> 'user_id');
  end if;
  return jsonb_build_object(
    'entityType', p_type, 'entityId', p_id, 'status', 'active', 'universityId', v_uni, 'surface', p_type, 'label', v_label,
    'autoHideImmune', false, 'createdAt', public.ts_ms((r ->> 'created_at')::timestamptz), 'href', v_href,
    'fields', v_fields, 'media', v_media, 'parent', v_parent);
end;
$$;

notify pgrst, 'reload schema';

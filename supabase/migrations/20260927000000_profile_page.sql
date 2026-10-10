-- Migration 18: the profile page, TikTok style. Safe to re-run.
--   1. Usernames: every profile gets an @handle (generated, then editable).
--   2. Who can see your Classes, Saved and Liked tabs: everyone, friends (people you follow who follow you back) or only you.
--   3. Classes per semester, readable only as far as that setting allows.
--   4. The Saved and Liked lists behind that setting. Likes stop being readable row by row: counts and the
--      "Liked by Maya" faces come from functions that honour each liker's setting.
--   5. Profile numbers (likes received), view counts for the grid, and pinned posts.

-- -----------------------------------------------------------------------------
-- 1. Usernames
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists username text;

-- Letters and digits of a name, lowercased, at most 20 characters; short or empty names fall back to "student".
create or replace function public.username_base(p_seed text)
returns text
language sql
immutable
as $$
  select case
    when char_length(b) >= 3 then b
    when b = '' then 'student'
    else b || 'student'
  end
  from (select left(lower(regexp_replace(coalesce(p_seed, ''), '[^a-zA-Z0-9]+', '', 'g')), 20) as b) s;
$$;

create or replace function public.generate_username(p_seed text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_base text := public.username_base(p_seed);
  v_candidate text := v_base;
  v_tries int := 0;
begin
  while exists (select 1 from public.profiles where username = v_candidate) loop
    v_tries := v_tries + 1;
    v_candidate := v_base || (floor(random() * 9000) + 1000)::int::text;
    if v_tries > 40 then
      v_candidate := left(v_base, 12) || left(replace(gen_random_uuid()::text, '-', ''), 10);
    end if;
  end loop;
  return v_candidate;
end;
$$;

-- New profiles get a generated username; a changed one is tidied (lowercase, no leading @) and checked with a
-- readable message, so every client gets the same friendly errors.
create or replace function public.profiles_username_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.username is null or btrim(new.username) = '' then
    if tg_op = 'INSERT' then
      new.username := public.generate_username(new.full_name);
    else
      new.username := old.username;
    end if;
    return new;
  end if;
  new.username := lower(btrim(regexp_replace(btrim(new.username), '^@+', '')));
  if tg_op = 'UPDATE' and new.username = old.username then
    return new;
  end if;
  if new.username !~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$' or new.username ~ '[._]{2}' then
    raise exception 'Usernames are 3 to 30 characters: letters, numbers, dots and underscores, starting and ending with a letter or number.'
      using errcode = '22023';
  end if;
  if new.username in ('admin', 'administrator', 'support', 'help', 'campconnect', 'apartmentbook', 'settings', 'profile', 'official', 'moderator') then
    raise exception 'That username is reserved. Try another one.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.username = new.username and p.id <> new.id) then
    raise exception 'That username is taken. Try another one.' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_username_guard on public.profiles;
create trigger profiles_username_guard
  before insert or update of username on public.profiles
  for each row execute function public.profiles_username_guard();

-- Give everyone who signed up before this migration a username, one row at a time so each sees the ones before it.
do $$
declare
  r record;
begin
  for r in select id, full_name from public.profiles where username is null order by created_at, id loop
    update public.profiles set username = public.generate_username(r.full_name) where id = r.id;
  end loop;
end
$$;

create unique index if not exists profiles_username_key on public.profiles (username);
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$');
alter table public.profiles alter column username set not null;

-- -----------------------------------------------------------------------------
-- 2. Who can see Classes, Saved and Liked
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists classes_visibility text not null default 'friends';
alter table public.profiles add column if not exists saved_visibility text not null default 'private';
alter table public.profiles add column if not exists liked_visibility text not null default 'public';
alter table public.profiles drop constraint if exists profiles_section_visibility_check;
alter table public.profiles add constraint profiles_section_visibility_check check (
  classes_visibility in ('public', 'friends', 'private')
  and saved_visibility in ('public', 'friends', 'private')
  and liked_visibility in ('public', 'friends', 'private')
);

-- Friends = they follow each other.
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
    and exists (select 1 from public.follows f where f.follower_id = p_a and f.followee_id = p_b)
    and exists (select 1 from public.follows f where f.follower_id = p_b and f.followee_id = p_a);
$$;

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
        end as v
        from public.profiles p
        where p.id = p_owner
      ) s
    ), false)
  end;
$$;

-- All three answers in one call, for the profile page.
create or replace function public.profile_section_access(p_owner uuid)
returns table (classes boolean, saved boolean, liked boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_view_profile_section(p_owner, 'classes'),
    public.can_view_profile_section(p_owner, 'saved'),
    public.can_view_profile_section(p_owner, 'liked');
$$;

-- -----------------------------------------------------------------------------
-- 3. Classes per semester
-- -----------------------------------------------------------------------------
create table if not exists public.profile_classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  term text not null,
  code text not null,
  title text,
  created_at timestamptz not null default now(),
  constraint profile_classes_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint profile_classes_term_check check (term ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'),
  constraint profile_classes_code_check check (char_length(code) between 2 and 16 and code ~ '^[A-Z0-9][A-Z0-9 .&-]*[A-Z0-9]$'),
  constraint profile_classes_title_check check (title is null or char_length(title) <= 80),
  constraint profile_classes_unique unique (user_id, term, code)
);
create index if not exists profile_classes_user_term_idx on public.profile_classes (user_id, term);

-- "cs3358 " becomes "CS 3358"; a blank title is no title; a dozen classes per semester at most.
create or replace function public.profile_classes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.code := upper(regexp_replace(btrim(new.code), '\s+', ' ', 'g'));
  new.code := regexp_replace(new.code, '^([A-Z&]+)([0-9])', '\1 \2');
  new.title := nullif(btrim(coalesce(new.title, '')), '');
  if tg_op = 'INSERT' then
    new.created_at := now();
    if (select count(*) from public.profile_classes c where c.user_id = new.user_id and c.term = new.term) >= 12 then
      raise exception 'You can list up to 12 classes per semester.';
    end if;
    if exists (select 1 from public.profile_classes c where c.user_id = new.user_id and c.term = new.term and c.code = new.code) then
      raise exception '% is already on your % classes.', new.code, new.term using errcode = '23505';
    end if;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists profile_classes_guard on public.profile_classes;
create trigger profile_classes_guard
  before insert or update on public.profile_classes
  for each row execute function public.profile_classes_guard();

alter table public.profile_classes enable row level security;
drop policy if exists "profile_classes_select" on public.profile_classes;
create policy "profile_classes_select" on public.profile_classes
  for select using (public.can_view_profile_section(user_id, 'classes'));
drop policy if exists "profile_classes_insert_own" on public.profile_classes;
create policy "profile_classes_insert_own" on public.profile_classes
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "profile_classes_update_own" on public.profile_classes;
create policy "profile_classes_update_own" on public.profile_classes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "profile_classes_delete_own" on public.profile_classes;
create policy "profile_classes_delete_own" on public.profile_classes
  for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. Saved and Liked lists; likes are no longer readable row by row
-- -----------------------------------------------------------------------------
-- Every like counts, whoever can see it.
create or replace function public.post_like_count(p_target_type text, p_target_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.post_likes l where l.target_type = p_target_type and l.target_id = p_target_id;
$$;

-- Your own likes only; everything else goes through the functions here.
drop policy if exists "post_likes_select" on public.post_likes;
create policy "post_likes_select" on public.post_likes for select using (user_id = auth.uid());

create or replace function public.post_engagement(p_target_type text, p_target_id uuid)
returns table (likes bigint, comments bigint, liked_by_me boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.post_like_count(p_target_type, p_target_id),
    (select count(*) from public.post_comments c where c.target_type = p_target_type and c.target_id = p_target_id),
    exists (select 1 from public.post_likes l where l.target_type = p_target_type and l.target_id = p_target_id and l.user_id = auth.uid());
$$;

create or replace function public.post_engagement_many(p_target_type text, p_target_ids uuid[])
returns table (target_id uuid, likes bigint, comments bigint, liked_by_me boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id,
    public.post_like_count(p_target_type, t.id),
    (select count(*) from public.post_comments c where c.target_type = p_target_type and c.target_id = t.id),
    exists (select 1 from public.post_likes l where l.target_type = p_target_type and l.target_id = t.id and l.user_id = auth.uid())
  from unnest(p_target_ids) as t(id);
$$;

-- Same feed as migration 11; only the like count changed, so private likes still count.
create or replace function public.reels_feed(p_university_id uuid default null, p_limit int default 10, p_offset int default 0)
returns table (
  source_type text,
  source_id uuid,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  author_verified boolean,
  title text,
  caption text,
  video jsonb,
  created_at timestamptz,
  likes bigint,
  comments bigint,
  liked_by_me boolean,
  saved_by_me boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with src as (
    select 'post'::text as source_type, p.id as source_id, p.author_id, p.university_id, null::text as title, p.body as caption, p.videos -> 0 as video, p.created_at
      from public.feed_posts p where p.kind = 'reel' and p.has_video
    union all
    select 'apartment', a.id, a.owner_id, a.university_id, a.title, a.description, a.videos -> 0, a.created_at
      from public.apartments a where a.has_video and a.status = 'active'
    union all
    select 'roommate', r.id, r.author_id, r.university_id, r.title, r.description, r.videos -> 0, r.created_at
      from public.roommate_posts r where r.has_video and r.is_active
  )
  select
    s.source_type, s.source_id, s.author_id, pr.full_name, pr.avatar_url,
    coalesce(u.email_domain is not null, false),
    s.title, s.caption, s.video, s.created_at,
    public.post_like_count(s.source_type, s.source_id),
    (select count(*) from public.post_comments c where c.target_type = s.source_type and c.target_id = s.source_id),
    exists (select 1 from public.post_likes l where l.target_type = s.source_type and l.target_id = s.source_id and l.user_id = auth.uid()),
    exists (select 1 from public.saved_listings sv where sv.target_type = s.source_type and sv.target_id = s.source_id and sv.user_id = auth.uid())
  from src s
  join public.profiles pr on pr.id = s.author_id
  left join public.universities u on u.id = pr.university_id
  where (p_university_id is null or s.university_id = p_university_id)
    and jsonb_typeof(s.video) = 'object'
  order by s.created_at desc, s.source_id desc
  limit least(greatest(coalesce(p_limit, 10), 1), 30)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- The "Liked by Maya and others" faces: the newest likers of each post the viewer may see (their Liked setting
-- allows it, or it is the viewer), never anyone blocked either way.
create or replace function public.post_likers_many(p_target_type text, p_target_ids uuid[], p_per int default 3)
returns table (target_id uuid, user_id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select x.target_id, x.user_id, x.full_name, x.avatar_url
  from (
    select l.target_id, l.user_id, p.full_name, p.avatar_url, l.created_at,
      row_number() over (partition by l.target_id order by l.created_at desc, l.user_id) as rn
    from public.post_likes l
    join public.profiles p on p.id = l.user_id
    where l.target_type = p_target_type
      and l.target_id = any (p_target_ids[1:100])
      and (l.user_id = auth.uid() or public.can_view_profile_section(l.user_id, 'liked'))
  ) x
  where x.rn <= least(greatest(coalesce(p_per, 3), 1), 10)
  order by x.target_id, x.created_at desc;
$$;

-- What p_user_id saved / liked, newest first, if their setting lets the person asking see it.
create or replace function public.profile_saved_items(p_user_id uuid, p_limit int default 30, p_before timestamptz default null)
returns table (target_type text, target_id uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_profile_section(p_user_id, 'saved') then
    raise exception 'This list is private.' using errcode = '42501';
  end if;
  return query
    select s.target_type, s.target_id, s.created_at
    from public.saved_listings s
    where s.user_id = p_user_id and (p_before is null or s.created_at < p_before)
    order by s.created_at desc, s.target_id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 60);
end;
$$;

create or replace function public.profile_liked_items(p_user_id uuid, p_limit int default 30, p_before timestamptz default null)
returns table (target_type text, target_id uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_profile_section(p_user_id, 'liked') then
    raise exception 'This list is private.' using errcode = '42501';
  end if;
  return query
    select l.target_type, l.target_id, l.created_at
    from public.post_likes l
    where l.user_id = p_user_id and (p_before is null or l.created_at < p_before)
    order by l.created_at desc, l.target_id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 60);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Profile numbers, view counts, pinned posts
-- -----------------------------------------------------------------------------
-- Posts, reels and every like on everything they posted (posts, reels and listings). Nothing for blocked people.
create or replace function public.profile_stats(p_user_id uuid)
returns table (posts bigint, reels bigint, likes_received bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when public.is_blocked_either_way(p_user_id) then 0 else (select count(*) from public.feed_posts f where f.author_id = p_user_id and f.kind = 'post') end,
    case when public.is_blocked_either_way(p_user_id) then 0 else (select count(*) from public.feed_posts f where f.author_id = p_user_id and f.kind = 'reel') end,
    case when public.is_blocked_either_way(p_user_id) then 0 else (
      select count(*) from public.post_likes l
      where (l.target_type = 'post' and l.target_id in (select f.id from public.feed_posts f where f.author_id = p_user_id))
         or (l.target_type = 'apartment' and l.target_id in (select a.id from public.apartments a where a.owner_id = p_user_id))
         or (l.target_type = 'roommate' and l.target_id in (select r.id from public.roommate_posts r where r.author_id = p_user_id))
         or (l.target_type = 'item' and l.target_id in (select i.id from public.items i where i.seller_id = p_user_id))
    ) end;
$$;

-- How many people viewed each post (owners' own views were never recorded).
create or replace function public.post_view_counts(p_target_type text, p_target_ids uuid[])
returns table (target_id uuid, views bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, (select count(*) from public.post_views v where v.target_type = p_target_type and v.target_id = t.id)
  from unnest(p_target_ids[1:200]) as t(id);
$$;

-- Pin up to three posts or reels to the top of your profile. Pinning stamps the time (the order on the profile);
-- a new post never starts pinned.
alter table public.feed_posts add column if not exists pinned_at timestamptz;
create index if not exists feed_posts_author_pinned_idx on public.feed_posts (author_id, pinned_at desc nulls last, created_at desc);

create or replace function public.feed_posts_pin_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.pinned_at := null;
    return new;
  end if;
  if new.pinned_at is null or new.pinned_at is not distinct from old.pinned_at then
    return new;
  end if;
  if old.pinned_at is not null then
    new.pinned_at := old.pinned_at;
    return new;
  end if;
  if (select count(*) from public.feed_posts f where f.author_id = new.author_id and f.pinned_at is not null and f.id <> new.id) >= 3 then
    raise exception 'You can pin up to 3 posts. Unpin one first.';
  end if;
  new.pinned_at := now();
  return new;
end;
$$;
drop trigger if exists feed_posts_pin_guard on public.feed_posts;
create trigger feed_posts_pin_guard
  before insert or update of pinned_at on public.feed_posts
  for each row execute function public.feed_posts_pin_guard();

grant execute on function public.username_base(text) to anon, authenticated;
grant execute on function public.are_friends(uuid, uuid) to anon, authenticated;
grant execute on function public.can_view_profile_section(uuid, text) to anon, authenticated;
grant execute on function public.profile_section_access(uuid) to anon, authenticated;
grant execute on function public.post_like_count(text, uuid) to anon, authenticated;
grant execute on function public.post_likers_many(text, uuid[], int) to anon, authenticated;
grant execute on function public.profile_saved_items(uuid, int, timestamptz) to anon, authenticated;
grant execute on function public.profile_liked_items(uuid, int, timestamptz) to anon, authenticated;
grant execute on function public.profile_stats(uuid) to anon, authenticated;
grant execute on function public.post_view_counts(text, uuid[]) to anon, authenticated;
-- generate_username is for the trigger and the backfill only.
revoke all on function public.generate_username(text) from public, anon, authenticated;

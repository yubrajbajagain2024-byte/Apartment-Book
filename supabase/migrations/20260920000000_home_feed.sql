-- =============================================================================
-- Apartment Book - migration 11: Home feed = Posts, Reels and Buzz
--   * feed_posts: posts and reels by identified students (likes, comments, saves)
--   * reels_feed(): reels + listing video tours in one vertical feed
--   * buzz_*: anonymous Reddit-style threads. The author is stored (moderation,
--     delete, block) but is NEVER readable by other users: no direct select,
--     everything goes through security-definer functions that strip it.
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Posts and reels
-- -----------------------------------------------------------------------------
create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  university_id uuid,
  kind text not null default 'post' check (kind in ('post', 'reel')),
  body text not null default '' check (char_length(body) <= 4000),
  images text[] not null default '{}',
  image_meta jsonb not null default '[]'::jsonb,
  videos jsonb not null default '[]'::jsonb,
  has_video boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feed_posts_author_id_fkey foreign key (author_id) references public.profiles (id) on delete cascade,
  constraint feed_posts_university_id_fkey foreign key (university_id) references public.universities (id) on delete set null,
  constraint feed_posts_not_empty check (char_length(btrim(body)) > 0 or cardinality(images) > 0 or jsonb_array_length(videos) > 0),
  constraint feed_posts_reel_has_video check (kind <> 'reel' or jsonb_array_length(videos) = 1),
  constraint feed_posts_max_images check (cardinality(images) <= 12 and array_position(images, null) is null and coalesce(array_ndims(images), 1) = 1),
  constraint feed_posts_json_shapes check (jsonb_typeof(videos) = 'array' and jsonb_typeof(image_meta) = 'array' and jsonb_array_length(videos) <= 3)
);
create index if not exists feed_posts_kind_created_idx on public.feed_posts (kind, created_at desc);
create index if not exists feed_posts_author_idx on public.feed_posts (author_id, created_at desc);

drop trigger if exists feed_posts_set_has_video on public.feed_posts;
-- The server owns the clock and the identity columns: a client cannot post into
-- the future, bump an old post to the top, or turn a post into a reel later.
create or replace function public.feed_posts_guard()
returns trigger
language plpgsql
as $$
begin
  new.has_video := jsonb_typeof(new.videos) = 'array' and jsonb_array_length(new.videos) > 0;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
  else
    new.created_at := old.created_at;
    new.kind := old.kind;
    new.author_id := old.author_id;
  end if;
  return new;
end;
$$;
drop trigger if exists feed_posts_guard on public.feed_posts;
create trigger feed_posts_guard before insert or update on public.feed_posts for each row execute function public.feed_posts_guard();
drop trigger if exists feed_posts_set_updated_at on public.feed_posts;
create trigger feed_posts_set_updated_at before update on public.feed_posts
  for each row execute function public.set_updated_at();

alter table public.feed_posts enable row level security;
drop policy if exists "feed_posts_select" on public.feed_posts;
create policy "feed_posts_select" on public.feed_posts for select using (not public.is_blocked_either_way(author_id));
drop policy if exists "feed_posts_insert_own" on public.feed_posts;
create policy "feed_posts_insert_own" on public.feed_posts for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "feed_posts_update_own" on public.feed_posts;
create policy "feed_posts_update_own" on public.feed_posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "feed_posts_delete_own" on public.feed_posts;
create policy "feed_posts_delete_own" on public.feed_posts for delete to authenticated using (author_id = auth.uid());

-- Likes, comments, saves, views and reports also work on posts.
alter table public.saved_listings drop constraint if exists saved_listings_target_type_check;
alter table public.saved_listings add constraint saved_listings_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post'));
alter table public.post_likes drop constraint if exists post_likes_target_type_check;
alter table public.post_likes add constraint post_likes_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post'));
alter table public.post_comments drop constraint if exists post_comments_target_type_check;
alter table public.post_comments add constraint post_comments_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post'));
alter table public.post_views drop constraint if exists post_views_target_type_check;
alter table public.post_views add constraint post_views_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post'));
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('apartment', 'item', 'roommate', 'profile', 'message', 'comment', 'post', 'buzz', 'buzz_comment'));

create or replace function public.listing_owner(p_target_type text, p_target_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_target_type
    when 'apartment' then (select owner_id from public.apartments where id = p_target_id)
    when 'item' then (select seller_id from public.items where id = p_target_id)
    when 'roommate' then (select author_id from public.roommate_posts where id = p_target_id)
    when 'post' then (select author_id from public.feed_posts where id = p_target_id)
  end;
$$;

create or replace function public.post_link(p_target_type text, p_target_id uuid)
returns text
language sql
immutable
as $$
  select case p_target_type
    when 'apartment' then '/apartments/'
    when 'item' then '/marketplace/'
    when 'post' then '/posts/'
    else '/roommates/'
  end || p_target_id;
$$;

-- Views are counted for posts too (never the author's own visits).
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
  if p_target_type not in ('apartment', 'item', 'roommate', 'post') or p_target_id is null then
    return;
  end if;
  v_owner := public.listing_owner(p_target_type, p_target_id);
  if v_owner is null or (auth.uid() is not null and v_owner = auth.uid()) then
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

-- People you blocked (or who blocked you) cannot like or comment on your posts,
-- so they cannot reach you through notifications either.
drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own" on public.post_likes for insert to authenticated
  with check (user_id = auth.uid() and not public.is_blocked_either_way(public.listing_owner(target_type, target_id)));
drop policy if exists "post_comments_insert_own" on public.post_comments;
create policy "post_comments_insert_own" on public.post_comments for insert to authenticated
  with check (user_id = auth.uid() and not public.is_blocked_either_way(public.listing_owner(target_type, target_id)));

-- ...and they cannot "save" your listings to ping you either.
drop policy if exists "saved_listings_all_own" on public.saved_listings;
drop policy if exists "saved_listings_select_own" on public.saved_listings;
create policy "saved_listings_select_own" on public.saved_listings for select to authenticated using (user_id = auth.uid());
drop policy if exists "saved_listings_delete_own" on public.saved_listings;
create policy "saved_listings_delete_own" on public.saved_listings for delete to authenticated using (user_id = auth.uid());
drop policy if exists "saved_listings_insert_own" on public.saved_listings;
create policy "saved_listings_insert_own" on public.saved_listings for insert to authenticated
  with check (user_id = auth.uid() and not public.is_blocked_either_way(public.listing_owner(target_type, target_id)));

-- Notifications can be scheduled: a row is invisible (and not pushed) until visible_at.
-- Buzz uses this so a thread's author cannot clock the exact moment someone replied.
alter table public.notifications add column if not exists visible_at timestamptz not null default now();
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated using (user_id = auth.uid() and visible_at <= now());

-- "Last seen" is public, so keep it coarse: ten-minute steps, written only when the
-- step changes. Millisecond-precise activity next to anonymous posts is a way to guess authors.
create or replace function public.touch_presence()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.profiles
  set last_seen_at = to_timestamp(floor(extract(epoch from now()) / 600) * 600)
  where id = auth.uid() and show_active_status
    and last_seen_at is distinct from to_timestamp(floor(extract(epoch from now()) / 600) * 600);
$$;

-- notify() is for triggers only. It used to be callable through the API, which
-- let anyone forge a notification to anyone.
revoke all on function public.notify(uuid, uuid, text, text, text, text, jsonb, text) from public, anon, authenticated;

-- Likes and comments disappear with the post.
create or replace function public.cleanup_post_engagement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.post_likes where target_type = 'post' and target_id = old.id;
  delete from public.post_comments where target_type = 'post' and target_id = old.id;
  delete from public.saved_listings where target_type = 'post' and target_id = old.id;
  delete from public.post_views where target_type = 'post' and target_id = old.id;
  return old;
end;
$$;
drop trigger if exists feed_posts_cleanup on public.feed_posts;
create trigger feed_posts_cleanup after delete on public.feed_posts for each row execute function public.cleanup_post_engagement();

-- One vertical feed: reels people posted plus video tours from listings.
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
    (select count(*) from public.post_likes l where l.target_type = s.source_type and l.target_id = s.source_id),
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

-- -----------------------------------------------------------------------------
-- Anonymity plumbing
-- -----------------------------------------------------------------------------
-- (1) Who owns a video must not be public: a Buzz video's playback id would
--     otherwise lead straight to its uploader. Listings keep their own snapshot
--     of the video, so nobody needs to read other people's media rows.
drop policy if exists "media_select" on public.media;
create policy "media_select" on public.media for select using (owner_id = auth.uid());

-- (2) Buzz photos live under uploads/buzz/anon/<random>.jpg: no user id and no
--     clock in the URL. The uploader is recorded privately by Storage so people
--     can delete their own files, and the folder cannot be listed by others.
drop policy if exists "uploads_insert_buzz" on storage.objects;
create policy "uploads_insert_buzz" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = 'buzz' and (storage.foldername(name))[2] = 'anon');
drop policy if exists "uploads_delete_buzz_own" on storage.objects;
create policy "uploads_delete_buzz_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = 'buzz' and (to_jsonb(objects) ->> 'owner_id' = auth.uid()::text or to_jsonb(objects) ->> 'owner' = auth.uid()::text));
drop policy if exists "uploads_public_read" on storage.objects;
create policy "uploads_public_read" on storage.objects
  for select using (
    bucket_id = 'uploads'
    and ((storage.foldername(name))[1] is distinct from 'buzz' or to_jsonb(objects) ->> 'owner_id' = auth.uid()::text or to_jsonb(objects) ->> 'owner' = auth.uid()::text)
  );

-- (3) Settings nobody can read through the API (RLS on, no policies, no grants):
--     * salt: without it, anyone could hash every public profile id against a
--       thread id and find the author from the alias.
--     * jitter: threads and replies become visible a random moment after they were
--       written, and only that later time is ever shown.
--     * storage_origin: Buzz photos must come from THIS project's storage, so a
--       photo cannot be a tracking pixel on someone else's server.
create table if not exists public.buzz_secrets (
  id int primary key default 1 check (id = 1),
  salt text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  thread_jitter_seconds int not null default 180,
  reply_jitter_seconds int not null default 45,
  min_campus_size int not null default 20,
  storage_origin text not null default 'https://dskbzoqreandwwpxiplh.supabase.co'
);
alter table public.buzz_secrets enable row level security;
insert into public.buzz_secrets (id) values (1) on conflict (id) do nothing;
revoke all on public.buzz_secrets from anon, authenticated;

-- "Student 48213": stable for one person inside one thread, different in every
-- other thread. Computed once when something is written, then stored.
create or replace function public.buzz_alias(p_author uuid, p_post uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'Student ' || ((('x' || substr(encode(sha256(convert_to((select salt from public.buzz_secrets where id = 1) || p_author::text || p_post::text, 'UTF8')), 'hex'), 1, 7))::bit(28)::int % 90000) + 10000)::text;
$$;
revoke all on function public.buzz_alias(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Buzz tables. No API role can touch them: reading and writing go through the
-- functions below (direct grants would even leak row-count estimates per author).
-- -----------------------------------------------------------------------------
create table if not exists public.buzz_posts (
  id uuid primary key default gen_random_uuid(),
  -- Null once the author deletes their account: the thread stays, detached, so an
  -- account disappearing does not take a tell-tale set of threads with it.
  author_id uuid,
  alias text not null,
  university_id uuid,
  topic text not null default 'thoughts' check (topic in ('thoughts', 'experience', 'advice', 'question', 'housing', 'campus', 'rant', 'other')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  body text not null default '' check (char_length(body) <= 6000),
  images text[] not null default '{}' check (cardinality(images) <= 6 and array_position(images, null) is null and coalesce(array_ndims(images), 1) = 1),
  image_meta jsonb not null default '[]'::jsonb check (jsonb_typeof(image_meta) = 'array'),
  videos jsonb not null default '[]'::jsonb check (jsonb_typeof(videos) = 'array' and jsonb_array_length(videos) <= 1),
  score int not null default 0,
  -- created_at is the real time and never leaves the database; visible_at is what people see.
  created_at timestamptz not null default now(),
  visible_at timestamptz not null default now(),
  constraint buzz_posts_author_id_fkey foreign key (author_id) references public.profiles (id) on delete set null,
  constraint buzz_posts_university_id_fkey foreign key (university_id) references public.universities (id) on delete set null
);
create index if not exists buzz_posts_visible_idx on public.buzz_posts (visible_at desc);
create index if not exists buzz_posts_topic_idx on public.buzz_posts (topic, visible_at desc);

create table if not exists public.buzz_votes (
  post_id uuid not null references public.buzz_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.buzz_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.buzz_posts (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  alias text not null,
  is_op boolean not null default false,
  parent_id uuid references public.buzz_comments (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  visible_at timestamptz not null default now(),
  -- Arrival order, to list replies written in the same instant in the order they came.
  seq bigint generated always as identity
);
create index if not exists buzz_comments_post_idx on public.buzz_comments (post_id, visible_at);

-- "Hide" is scoped to ONE thread. A campus-wide hide would make all of someone's
-- threads vanish together and so reveal which threads share an author; blocking is
-- not applied to Buzz at all for the same reason (block a suspect, watch a thread disappear).
create table if not exists public.buzz_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.buzz_posts (id) on delete cascade,
  muted_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id, muted_id)
);

-- What someone did recently, for rate limits. Deleting a thread does not give the slot back.
create table if not exists public.buzz_rate_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('thread', 'reply')),
  at timestamptz not null default now()
);
create index if not exists buzz_rate_log_idx on public.buzz_rate_log (user_id, kind, at desc);

alter table public.buzz_posts enable row level security;
alter table public.buzz_votes enable row level security;
alter table public.buzz_comments enable row level security;
alter table public.buzz_mutes enable row level security;
alter table public.buzz_rate_log enable row level security;
revoke all on public.buzz_posts, public.buzz_votes, public.buzz_comments, public.buzz_mutes, public.buzz_rate_log from anon, authenticated;
drop policy if exists "buzz_posts_select_own" on public.buzz_posts;
drop policy if exists "buzz_posts_insert_own" on public.buzz_posts;
drop policy if exists "buzz_posts_delete_own" on public.buzz_posts;
drop policy if exists "buzz_votes_own" on public.buzz_votes;
drop policy if exists "buzz_comments_select_own" on public.buzz_comments;
drop policy if exists "buzz_comments_insert_own" on public.buzz_comments;
drop trigger if exists buzz_comments_count on public.buzz_comments;
drop function if exists public.buzz_sync_comment_count();

-- A reply notifies the thread's author anonymously (no actor), and only once the
-- reply is published: the notification carries the published time, not the real one.
-- Not sent when the author hid that person in this thread.
create or replace function public.buzz_notify_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select author_id into v_owner from public.buzz_posts where id = new.post_id;
  if v_owner is null or new.author_id is null or v_owner = new.author_id then
    return new;
  end if;
  if exists (select 1 from public.buzz_mutes m where m.user_id = v_owner and m.post_id = new.post_id and m.muted_id = new.author_id) then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, title, body, link, data, created_at, visible_at)
  values (v_owner, null, 'comment', 'Someone replied to your Buzz post', left(new.body, 140), '/buzz/' || new.post_id,
    jsonb_build_object('target_type', 'buzz', 'target_id', new.post_id), new.visible_at, new.visible_at);
  return new;
end;
$$;
drop trigger if exists buzz_comments_notify on public.buzz_comments;
create trigger buzz_comments_notify after insert on public.buzz_comments for each row execute function public.buzz_notify_reply();

-- -----------------------------------------------------------------------------
-- Buzz API
-- -----------------------------------------------------------------------------
drop function if exists public.buzz_hidden(uuid);
create or replace function public.buzz_hidden(p_author uuid, p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and p_author is not null
    and exists (select 1 from public.buzz_mutes m where m.user_id = auth.uid() and m.post_id = p_post and m.muted_id = p_author);
$$;
revoke all on function public.buzz_hidden(uuid, uuid) from public, anon, authenticated;

-- Can the caller see this thread right now? (published, or their own; not hidden by them)
create or replace function public.buzz_can_see(p_post public.buzz_posts)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p_post.visible_at <= now() or coalesce(p_post.author_id = auth.uid(), false)) and not public.buzz_hidden(p_post.author_id, p_post.id);
$$;
revoke all on function public.buzz_can_see(public.buzz_posts) from public, anon, authenticated;

-- Replies the caller can see in a thread (published or their own, not hidden by them).
create or replace function public.buzz_reply_count(p_post uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.buzz_comments c
  where c.post_id = p_post and (c.visible_at <= now() or coalesce(c.author_id = auth.uid(), false)) and not public.buzz_hidden(c.author_id, p_post);
$$;
revoke all on function public.buzz_reply_count(uuid) from public, anon, authenticated;

drop function if exists public.buzz_feed(uuid, text, text, int, int, text);
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
language sql
stable
security definer
set search_path = public
as $$
  with q as (select nullif(regexp_replace(btrim(coalesce(p_q, '')), '[%_\\]', '', 'g'), '') as term),
  visible as (
    select b.*, (select count(*)::int from public.buzz_comments c where c.post_id = b.id and c.visible_at <= now()) as published_replies
    from public.buzz_posts b, q
    -- Threads without a campus (small campuses, see buzz_create) show up everywhere.
    where (p_university_id is null or b.university_id is null or b.university_id = p_university_id)
      and (p_topic is null or b.topic = p_topic)
      and (q.term is null or b.title ilike '%' || q.term || '%' or b.body ilike '%' || q.term || '%')
      and public.buzz_can_see(b)
  )
  select
    v.id, v.topic, v.title, v.body, v.images, v.image_meta, v.videos, v.university_id,
    v.score,
    public.buzz_reply_count(v.id),
    least(v.visible_at, now()),
    coalesce((select bv.value from public.buzz_votes bv where bv.post_id = v.id and bv.user_id = auth.uid()), 0)::smallint,
    coalesce(v.author_id = auth.uid(), false),
    v.alias
  from visible v
  order by
    case when p_sort = 'top' then v.score end desc nulls last,
    -- Reddit-style "hot": votes and PUBLISHED replies count logarithmically, newer wins. Unpublished
    -- replies must not move a thread, or the ranking would give away the moment someone replied.
    case when p_sort = 'hot' then sign(v.score + v.published_replies) * log(greatest(abs(v.score + v.published_replies), 1)::numeric) + extract(epoch from v.visible_at) / 45000.0 end desc nulls last,
    v.visible_at desc,
    v.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.buzz_get(p_id uuid)
returns table (
  id uuid, topic text, title text, body text, images text[], image_meta jsonb, videos jsonb, university_id uuid,
  score int, comment_count int, created_at timestamptz, my_vote smallint, is_mine boolean, alias text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.topic, b.title, b.body, b.images, b.image_meta, b.videos, b.university_id,
    b.score,
    public.buzz_reply_count(b.id),
    least(b.visible_at, now()),
    coalesce((select v.value from public.buzz_votes v where v.post_id = b.id and v.user_id = auth.uid()), 0)::smallint,
    coalesce(b.author_id = auth.uid(), false),
    b.alias
  from public.buzz_posts b
  where b.id = p_id and public.buzz_can_see(b);
$$;

-- (Later migrations widen this function's result, so drop first to stay re-runnable.)
drop function if exists public.buzz_comments_list(uuid);
create or replace function public.buzz_comments_list(p_post_id uuid)
returns table (id uuid, parent_id uuid, body text, created_at timestamptz, alias text, is_op boolean, is_mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.parent_id, c.body, least(c.visible_at, now()), c.alias, c.is_op, coalesce(c.author_id = auth.uid(), false)
  from public.buzz_comments c
  join public.buzz_posts b on b.id = c.post_id
  where c.post_id = p_post_id
    and public.buzz_can_see(b)
    and (c.visible_at <= now() or coalesce(c.author_id = auth.uid(), false))
    and not public.buzz_hidden(c.author_id, c.post_id)
  order by c.visible_at asc, c.seq asc
  limit 500;
$$;

-- Start a thread. Validates what the app sends, because anonymity depends on it:
-- photos must sit in this project's anonymous folder under a random name, and the
-- video is reduced to what a player needs.
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
security definer
set search_path = public, storage
as $$
declare
  v_me uuid := auth.uid();
  v_cfg public.buzz_secrets;
  v_images text[] := coalesce(p_images, '{}');
  v_meta jsonb;
  v_videos jsonb;
  v_university uuid;
  v_id uuid := gen_random_uuid();
  v_url text;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 160 then
    raise exception 'Titles need 3 to 160 characters';
  end if;
  if coalesce(p_topic, 'thoughts') not in ('thoughts', 'experience', 'advice', 'question', 'housing', 'campus', 'rant', 'other') then
    raise exception 'Pick a topic from the list';
  end if;
  if char_length(coalesce(p_body, '')) > 6000 then
    raise exception 'Keep posts under 6,000 characters';
  end if;
  if coalesce(array_ndims(v_images), 1) > 1 or cardinality(v_images) > 6 then
    raise exception 'Up to 6 photos';
  end if;
  if array_position(v_images, null) is not null then
    raise exception 'Buzz photos must be uploaded anonymously';
  end if;
  select * into v_cfg from public.buzz_secrets where id = 1;
  -- One request at a time per person, so parallel requests cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtext('buzz:' || v_me::text));
  delete from public.buzz_rate_log where at < now() - interval '1 day';
  if (select count(*) from public.buzz_rate_log l where l.user_id = v_me and l.kind = 'thread' and l.at > now() - interval '1 hour') >= 5 then
    raise exception 'You are posting a lot. Try again in a little while.';
  end if;
  foreach v_url in array v_images loop
    if v_url is null
      or left(v_url, length(v_cfg.storage_origin)) <> v_cfg.storage_origin
      or substr(v_url, length(v_cfg.storage_origin) + 1) !~ '^/storage/v1/object/public/uploads/buzz/anon/[a-f0-9]{32,64}\.(jpg|jpeg|png|webp)$' then
      raise exception 'Buzz photos must be uploaded anonymously';
    end if;
    -- ...and it has to be a file this person really uploaded (nobody else's photo, no dangling link).
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'uploads' and o.name = 'buzz/anon/' || substr(v_url, length(v_cfg.storage_origin) + length('/storage/v1/object/public/uploads/buzz/anon/') + 1)
        and (to_jsonb(o) ->> 'owner_id' = v_me::text or to_jsonb(o) ->> 'owner' = v_me::text)
    ) then
      raise exception 'Buzz photos must be uploaded anonymously';
    end if;
  end loop;
  -- One meta entry per attached photo, numbers only, small blur only.
  select coalesce(jsonb_agg(t.entry), '[]'::jsonb) into v_meta from (
    select distinct on (m ->> 'url') jsonb_build_object(
      'url', m ->> 'url',
      'width', case when jsonb_typeof(m -> 'width') = 'number' and (m ->> 'width')::numeric between 1 and 50000 then m -> 'width' else 'null'::jsonb end,
      'height', case when jsonb_typeof(m -> 'height') = 'number' and (m ->> 'height')::numeric between 1 and 50000 then m -> 'height' else 'null'::jsonb end,
      'blur', case when jsonb_typeof(m -> 'blur') = 'string' and (m ->> 'blur') like 'data:image/%' and length(m ->> 'blur') <= 4000 then m -> 'blur' else 'null'::jsonb end
    ) as entry
    from jsonb_array_elements(case when jsonb_typeof(p_image_meta) = 'array' and jsonb_array_length(p_image_meta) <= 24 then p_image_meta else '[]'::jsonb end) m
    where jsonb_typeof(m) = 'object' and m ->> 'url' = any (v_images)
    order by m ->> 'url'
  ) t;
  -- One video at most; drop the uploader's media id, keep what a player needs.
  select coalesce(jsonb_agg(t.entry), '[]'::jsonb) into v_videos from (
    select jsonb_build_object(
      'media_id', '00000000-0000-0000-0000-000000000000',
      'playback_id', v ->> 'playback_id',
      'poster_url', case when jsonb_typeof(v -> 'poster_url') = 'string' and (v ->> 'poster_url') ~ '^https://image\.mux\.com/[A-Za-z0-9]+/[A-Za-z0-9._?=&-]+$' and length(v ->> 'poster_url') <= 300 then v -> 'poster_url' else 'null'::jsonb end,
      'width', case when jsonb_typeof(v -> 'width') = 'number' and (v ->> 'width')::numeric between 1 and 20000 then v -> 'width' else 'null'::jsonb end,
      'height', case when jsonb_typeof(v -> 'height') = 'number' and (v ->> 'height')::numeric between 1 and 20000 then v -> 'height' else 'null'::jsonb end,
      'duration_seconds', case when jsonb_typeof(v -> 'duration_seconds') = 'number' and (v ->> 'duration_seconds')::numeric between 0 and 100000 then v -> 'duration_seconds' else 'null'::jsonb end
    ) as entry
    from jsonb_array_elements(case when jsonb_typeof(p_videos) = 'array' and jsonb_array_length(p_videos) <= 5 then p_videos else '[]'::jsonb end) v
    where jsonb_typeof(v) = 'object' and (v ->> 'playback_id') ~ '^[A-Za-z0-9]{8,120}$'
    limit 1
  ) t;
  -- A campus tag on a tiny campus would point at a handful of people: leave it off.
  select p_university_id into v_university
    where p_university_id is not null
      and (select count(*) from public.profiles pr where pr.university_id = p_university_id) >= v_cfg.min_campus_size;
  insert into public.buzz_posts (id, author_id, alias, university_id, topic, title, body, images, image_meta, videos, created_at, visible_at)
  values (v_id, v_me, public.buzz_alias(v_me, v_id), v_university, coalesce(p_topic, 'thoughts'), btrim(p_title), coalesce(btrim(p_body), ''), v_images, v_meta, v_videos,
          now(), now() + make_interval(secs => random() * greatest(v_cfg.thread_jitter_seconds, 0)));
  insert into public.buzz_rate_log (user_id, kind) values (v_me, 'thread');
  return v_id;
end;
$$;

-- Reply anonymously.
create or replace function public.buzz_reply(p_post_id uuid, p_body text, p_parent_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_cfg public.buzz_secrets;
  v_post public.buzz_posts;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'Replies need 1 to 2,000 characters';
  end if;
  select * into v_cfg from public.buzz_secrets where id = 1;
  select * into v_post from public.buzz_posts b where b.id = p_post_id;
  if v_post.id is null or not public.buzz_can_see(v_post) then
    raise exception 'Thread not found';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.buzz_comments c
    where c.id = p_parent_id and c.post_id = p_post_id
      and (c.visible_at <= now() or coalesce(c.author_id = v_me, false)) and not public.buzz_hidden(c.author_id, p_post_id)
  ) then
    raise exception 'That reply belongs to another thread';
  end if;
  perform pg_advisory_xact_lock(hashtext('buzz:' || v_me::text));
  if (select count(*) from public.buzz_rate_log l where l.user_id = v_me and l.kind = 'reply' and l.at > now() - interval '10 minutes') >= 30 then
    raise exception 'You are replying a lot. Try again in a little while.';
  end if;
  -- A reply never becomes visible before the thread it is in, or before the reply it answers.
  insert into public.buzz_comments (post_id, author_id, alias, is_op, parent_id, body, created_at, visible_at)
  values (p_post_id, v_me, public.buzz_alias(v_me, p_post_id), coalesce(v_post.author_id = v_me, false), p_parent_id, btrim(p_body), now(),
    greatest(
      now() + make_interval(secs => random() * greatest(v_cfg.reply_jitter_seconds, 0)),
      v_post.visible_at,
      coalesce((select c.visible_at from public.buzz_comments c where c.id = p_parent_id), '-infinity'::timestamptz)
    ))
  returning id into v_id;
  insert into public.buzz_rate_log (user_id, kind) values (v_me, 'reply');
  return v_id;
end;
$$;

-- Vote: 1 up, -1 down, 0 clears. Returns the fresh score and my vote.
create or replace function public.buzz_vote(p_post_id uuid, p_value int)
returns table (score int, my_vote smallint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_post public.buzz_posts;
  v_old int;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'Invalid vote';
  end if;
  select * into v_post from public.buzz_posts b where b.id = p_post_id for update;
  if v_post.id is null or not public.buzz_can_see(v_post) then
    raise exception 'Thread not found';
  end if;
  select v.value into v_old from public.buzz_votes v where v.post_id = p_post_id and v.user_id = v_me;
  v_old := coalesce(v_old, 0);
  if p_value = 0 then
    delete from public.buzz_votes v where v.post_id = p_post_id and v.user_id = v_me;
  else
    insert into public.buzz_votes (post_id, user_id, value) values (p_post_id, v_me, p_value)
    on conflict (post_id, user_id) do update set value = excluded.value;
  end if;
  update public.buzz_posts b set score = b.score - v_old + p_value where b.id = p_post_id;
  return query select b.score, p_value::smallint from public.buzz_posts b where b.id = p_post_id;
end;
$$;

-- Delete my own thread (its votes, replies and hides go with it).
create or replace function public.buzz_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  delete from public.buzz_posts b where b.id = p_id and b.author_id = auth.uid();
  if not found then
    raise exception 'Thread not found';
  end if;
end;
$$;

-- Delete a reply: its writer, or the thread's author.
create or replace function public.buzz_delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  delete from public.buzz_comments c
  using public.buzz_posts b
  where c.id = p_comment_id and b.id = c.post_id and (c.author_id = v_me or b.author_id = v_me);
  if not found then
    raise exception 'Comment not found';
  end if;
end;
$$;

-- Hide a thread (pass the thread) or one person's replies inside a thread (pass the reply).
-- Scoped to that thread only, and never reveals who they are.
create or replace function public.buzz_mute(p_post_id uuid default null, p_comment_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_author uuid;
  v_post_id uuid;
  v_post public.buzz_posts;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_comment_id is not null then
    select c.author_id, c.post_id into v_author, v_post_id from public.buzz_comments c where c.id = p_comment_id and c.visible_at <= now();
  else
    select b.author_id, b.id into v_author, v_post_id from public.buzz_posts b where b.id = p_post_id;
  end if;
  select * into v_post from public.buzz_posts b where b.id = v_post_id;
  if v_author is null or v_author = v_me or v_post.id is null or not public.buzz_can_see(v_post) then
    return;
  end if;
  insert into public.buzz_mutes (user_id, post_id, muted_id) values (v_me, v_post_id, v_author) on conflict do nothing;
end;
$$;

-- Undo: bring a hidden thread (and anyone hidden inside it) back. Says nothing about authors.
create or replace function public.buzz_unmute(p_post_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.buzz_mutes where user_id = auth.uid() and post_id = p_post_id;
$$;
revoke all on function public.buzz_unmute(uuid) from public, anon;
grant execute on function public.buzz_unmute(uuid) to authenticated;

revoke all on function public.buzz_create(text, text, text, uuid, text[], jsonb, jsonb) from public, anon;
revoke all on function public.buzz_reply(uuid, text, uuid) from public, anon;
revoke all on function public.buzz_vote(uuid, int) from public, anon;
revoke all on function public.buzz_delete(uuid) from public, anon;
revoke all on function public.buzz_delete_comment(uuid) from public, anon;
revoke all on function public.buzz_mute(uuid, uuid) from public, anon;
revoke all on function public.buzz_notify_reply() from public, anon, authenticated;
grant execute on function public.buzz_create(text, text, text, uuid, text[], jsonb, jsonb) to authenticated;
grant execute on function public.buzz_reply(uuid, text, uuid) to authenticated;
grant execute on function public.buzz_vote(uuid, int) to authenticated;
grant execute on function public.buzz_delete(uuid) to authenticated;
grant execute on function public.buzz_delete_comment(uuid) to authenticated;
grant execute on function public.buzz_mute(uuid, uuid) to authenticated;
grant execute on function public.buzz_feed(uuid, text, text, int, int, text) to anon, authenticated;
grant execute on function public.buzz_get(uuid) to anon, authenticated;
grant execute on function public.buzz_comments_list(uuid) to anon, authenticated;
grant execute on function public.reels_feed(uuid, int, int) to anon, authenticated;

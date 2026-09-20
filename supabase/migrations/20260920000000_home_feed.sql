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
  constraint feed_posts_reel_has_video check (kind <> 'reel' or jsonb_array_length(videos) > 0),
  constraint feed_posts_max_images check (cardinality(images) <= 12)
);
create index if not exists feed_posts_kind_created_idx on public.feed_posts (kind, created_at desc);
create index if not exists feed_posts_author_idx on public.feed_posts (author_id, created_at desc);

drop trigger if exists feed_posts_set_has_video on public.feed_posts;
create trigger feed_posts_set_has_video before insert or update of videos on public.feed_posts
  for each row execute function public.set_has_video();
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
  order by s.created_at desc
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

-- (2) Buzz photos live under uploads/buzz/anon/… (no user id in the URL).
--     storage.objects.owner still records the uploader privately, so people can
--     delete their own files.
drop policy if exists "uploads_insert_buzz" on storage.objects;
create policy "uploads_insert_buzz" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = 'buzz' and (storage.foldername(name))[2] = 'anon');
drop policy if exists "uploads_delete_buzz_own" on storage.objects;
create policy "uploads_delete_buzz_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = 'buzz' and owner = auth.uid());

-- (3) A secret salt for per-thread aliases. Without it, anyone could hash every
--     public profile id against a post id and find the author. RLS on, no policies.
create table if not exists public.buzz_secrets (
  id int primary key default 1 check (id = 1),
  salt text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.buzz_secrets enable row level security;
insert into public.buzz_secrets (id) values (1) on conflict (id) do nothing;
revoke all on public.buzz_secrets from anon, authenticated;

-- "Student 4821": stable for one person inside one thread, different in every other thread.
create or replace function public.buzz_alias(p_author uuid, p_post uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'Student ' || ((('x' || substr(encode(sha256(convert_to((select salt from public.buzz_secrets where id = 1) || p_author::text || p_post::text, 'UTF8')), 'hex'), 1, 6))::bit(24)::int % 9000) + 1000)::text;
$$;
revoke all on function public.buzz_alias(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Buzz tables
-- -----------------------------------------------------------------------------
create table if not exists public.buzz_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  university_id uuid,
  topic text not null default 'thoughts' check (topic in ('thoughts', 'experience', 'advice', 'question', 'housing', 'campus', 'rant', 'other')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  body text not null default '' check (char_length(body) <= 6000),
  images text[] not null default '{}' check (cardinality(images) <= 6),
  image_meta jsonb not null default '[]'::jsonb,
  videos jsonb not null default '[]'::jsonb,
  score int not null default 0,
  comment_count int not null default 0,
  created_at timestamptz not null default now(),
  constraint buzz_posts_author_id_fkey foreign key (author_id) references public.profiles (id) on delete cascade,
  constraint buzz_posts_university_id_fkey foreign key (university_id) references public.universities (id) on delete set null
);
create index if not exists buzz_posts_created_idx on public.buzz_posts (created_at desc);
create index if not exists buzz_posts_topic_idx on public.buzz_posts (topic, created_at desc);

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
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.buzz_comments (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists buzz_comments_post_idx on public.buzz_comments (post_id, created_at);

-- "Hide everything from whoever wrote this." Never readable, so it cannot be
-- used to learn who the author was.
create table if not exists public.buzz_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_id)
);

alter table public.buzz_posts enable row level security;
alter table public.buzz_votes enable row level security;
alter table public.buzz_comments enable row level security;
alter table public.buzz_mutes enable row level security;
revoke all on public.buzz_mutes from anon, authenticated;

-- Direct table access shows you only your own rows. Everyone else's content
-- comes from the functions below, without author_id.
drop policy if exists "buzz_posts_select_own" on public.buzz_posts;
create policy "buzz_posts_select_own" on public.buzz_posts for select to authenticated using (author_id = auth.uid());
drop policy if exists "buzz_posts_insert_own" on public.buzz_posts;
create policy "buzz_posts_insert_own" on public.buzz_posts for insert to authenticated
  with check (author_id = auth.uid() and score = 0 and comment_count = 0);
drop policy if exists "buzz_posts_delete_own" on public.buzz_posts;
create policy "buzz_posts_delete_own" on public.buzz_posts for delete to authenticated using (author_id = auth.uid());

drop policy if exists "buzz_votes_own" on public.buzz_votes;
create policy "buzz_votes_own" on public.buzz_votes for select to authenticated using (user_id = auth.uid());

drop policy if exists "buzz_comments_select_own" on public.buzz_comments;
create policy "buzz_comments_select_own" on public.buzz_comments for select to authenticated using (author_id = auth.uid());
drop policy if exists "buzz_comments_insert_own" on public.buzz_comments;
create policy "buzz_comments_insert_own" on public.buzz_comments for insert to authenticated with check (author_id = auth.uid());

-- Counters
create or replace function public.buzz_sync_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.buzz_posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  end if;
  update public.buzz_posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
  return old;
end;
$$;
drop trigger if exists buzz_comments_count on public.buzz_comments;
create trigger buzz_comments_count after insert or delete on public.buzz_comments for each row execute function public.buzz_sync_comment_count();

-- A reply notifies the thread's author, anonymously (no actor).
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
  if v_owner is null or v_owner = new.author_id then
    return new;
  end if;
  perform public.notify(v_owner, null, 'comment', 'Someone replied to your Buzz post', left(new.body, 140), '/buzz/' || new.post_id,
    jsonb_build_object('target_type', 'buzz', 'target_id', new.post_id), null);
  return new;
end;
$$;
drop trigger if exists buzz_comments_notify on public.buzz_comments;
create trigger buzz_comments_notify after insert on public.buzz_comments for each row execute function public.buzz_notify_reply();

-- -----------------------------------------------------------------------------
-- Buzz API (the only way to read other people's Buzz content)
-- -----------------------------------------------------------------------------
create or replace function public.buzz_hidden(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_blocked_either_way(p_author)
    or exists (select 1 from public.buzz_mutes m where m.user_id = auth.uid() and m.muted_id = p_author)
  );
$$;
revoke all on function public.buzz_hidden(uuid) from public, anon, authenticated;

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
  select
    b.id, b.topic, b.title, b.body, b.images, b.image_meta, b.videos, b.university_id,
    b.score, b.comment_count, b.created_at,
    coalesce((select v.value from public.buzz_votes v where v.post_id = b.id and v.user_id = auth.uid()), 0)::smallint,
    coalesce(b.author_id = auth.uid(), false),
    public.buzz_alias(b.author_id, b.id)
  from public.buzz_posts b
  where (p_university_id is null or b.university_id = p_university_id)
    and (p_topic is null or b.topic = p_topic)
    and (p_q is null or btrim(p_q) = '' or b.title ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%' or b.body ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%')
    and not public.buzz_hidden(b.author_id)
  order by
    case when p_sort = 'top' then b.score end desc nulls last,
    case when p_sort = 'hot' then (b.score + b.comment_count + 1) / power(extract(epoch from (now() - b.created_at)) / 3600.0 + 2, 1.5) end desc nulls last,
    b.created_at desc
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
    b.score, b.comment_count, b.created_at,
    coalesce((select v.value from public.buzz_votes v where v.post_id = b.id and v.user_id = auth.uid()), 0)::smallint,
    coalesce(b.author_id = auth.uid(), false),
    public.buzz_alias(b.author_id, b.id)
  from public.buzz_posts b
  where b.id = p_id and not public.buzz_hidden(b.author_id);
$$;

create or replace function public.buzz_comments_list(p_post_id uuid)
returns table (id uuid, parent_id uuid, body text, created_at timestamptz, alias text, is_op boolean, is_mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.parent_id, c.body, c.created_at,
    public.buzz_alias(c.author_id, c.post_id),
    c.author_id = b.author_id,
    coalesce(c.author_id = auth.uid(), false)
  from public.buzz_comments c
  join public.buzz_posts b on b.id = c.post_id
  where c.post_id = p_post_id and not public.buzz_hidden(c.author_id) and not public.buzz_hidden(b.author_id)
  order by c.created_at asc
  limit 500;
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
  v_old int;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_value not in (-1, 0, 1) then
    raise exception 'Invalid vote';
  end if;
  perform 1 from public.buzz_posts b where b.id = p_post_id for update;
  if not found then
    raise exception 'Post not found';
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

-- Delete a comment: its writer, or the thread's author.
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

-- "Hide posts from this person" without ever learning who they are.
create or replace function public.buzz_mute(p_post_id uuid default null, p_comment_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_author uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_comment_id is not null then
    select author_id into v_author from public.buzz_comments where id = p_comment_id;
  else
    select author_id into v_author from public.buzz_posts where id = p_post_id;
  end if;
  if v_author is null or v_author = v_me then
    return;
  end if;
  insert into public.buzz_mutes (user_id, muted_id) values (v_me, v_author) on conflict do nothing;
end;
$$;

revoke all on function public.buzz_vote(uuid, int) from public, anon;
revoke all on function public.buzz_delete_comment(uuid) from public, anon;
revoke all on function public.buzz_mute(uuid, uuid) from public, anon;
grant execute on function public.buzz_vote(uuid, int) to authenticated;
grant execute on function public.buzz_delete_comment(uuid) to authenticated;
grant execute on function public.buzz_mute(uuid, uuid) to authenticated;
grant execute on function public.buzz_feed(uuid, text, text, int, int, text) to anon, authenticated;
grant execute on function public.buzz_get(uuid) to anon, authenticated;
grant execute on function public.buzz_comments_list(uuid) to anon, authenticated;
grant execute on function public.reels_feed(uuid, int, int) to anon, authenticated;

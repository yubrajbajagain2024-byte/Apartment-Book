-- Migration 19: profile page tuning (after review of migration 18). Safe to re-run.
--   * "Liked by" faces stop after the newest few visible likers of each post instead of checking every like.
--   * The Likes total on a profile counts per kind with indexes instead of scanning every like.
--   * The Liked tab reads one person's likes through an index.
--   * Saved and Liked pages carry a (time, id) cursor, so items saved or liked in the same instant are not skipped.

create index if not exists post_likes_target_created_idx on public.post_likes (target_type, target_id, created_at desc, user_id);
create index if not exists post_likes_user_created_idx on public.post_likes (user_id, created_at desc, target_id desc);

-- Newest visible likers of each post, at most p_per (1 to 10) each, walking each post's likes newest first.
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
  order by t.ord, x.created_at desc, x.user_id;
$$;

-- Same numbers as before, each like count joined through an index on the owner's posts and listings.
create or replace function public.profile_stats(p_user_id uuid)
returns table (posts bigint, reels bigint, likes_received bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when s.blocked then 0 else (select count(*) from public.feed_posts f where f.author_id = p_user_id and f.kind = 'post') end,
    case when s.blocked then 0 else (select count(*) from public.feed_posts f where f.author_id = p_user_id and f.kind = 'reel') end,
    case when s.blocked then 0 else
      (select count(*) from public.feed_posts f join public.post_likes l on l.target_type = 'post' and l.target_id = f.id where f.author_id = p_user_id)
      + (select count(*) from public.apartments a join public.post_likes l on l.target_type = 'apartment' and l.target_id = a.id where a.owner_id = p_user_id)
      + (select count(*) from public.roommate_posts r join public.post_likes l on l.target_type = 'roommate' and l.target_id = r.id where r.author_id = p_user_id)
      + (select count(*) from public.items i join public.post_likes l on l.target_type = 'item' and l.target_id = i.id where i.seller_id = p_user_id)
    end
  from (select public.is_blocked_either_way(p_user_id) as blocked) s;
$$;

-- Saved / Liked pages: the next page starts after (p_before, p_before_id), the time and id of the last item shown.
-- Calls without p_before_id behave as before.
drop function if exists public.profile_saved_items(uuid, int, timestamptz);
create or replace function public.profile_saved_items(p_user_id uuid, p_limit int default 30, p_before timestamptz default null, p_before_id uuid default null)
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
    where s.user_id = p_user_id
      and (p_before is null or s.created_at < p_before or (p_before_id is not null and s.created_at = p_before and s.target_id < p_before_id))
    order by s.created_at desc, s.target_id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 60);
end;
$$;

drop function if exists public.profile_liked_items(uuid, int, timestamptz);
create or replace function public.profile_liked_items(p_user_id uuid, p_limit int default 30, p_before timestamptz default null, p_before_id uuid default null)
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
    where l.user_id = p_user_id
      and (p_before is null or l.created_at < p_before or (p_before_id is not null and l.created_at = p_before and l.target_id < p_before_id))
    order by l.created_at desc, l.target_id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 60);
end;
$$;

grant execute on function public.post_likers_many(text, uuid[], int) to anon, authenticated;
grant execute on function public.profile_stats(uuid) to anon, authenticated;
grant execute on function public.profile_saved_items(uuid, int, timestamptz, uuid) to anon, authenticated;
grant execute on function public.profile_liked_items(uuid, int, timestamptz, uuid) to anon, authenticated;

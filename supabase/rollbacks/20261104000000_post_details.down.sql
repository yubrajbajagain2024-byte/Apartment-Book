-- =============================================================================
-- Rollback of migration 44 (supabase/migrations/20261104000000_post_details.sql). Run as one transaction.
-- Removes the title, link, audience and comments switch of posts and reels with everything that enforces them (the
-- feed_post_viewers table, set_post_viewers(), verified_university() and the other visibility helpers, policies and
-- triggers), and puts profile_stats() and post_likers_many() back exactly as migration 19 made them,
-- ts_public_snapshot() as migration 41 did, and feed_posts_not_empty as migration 11 did.
-- Refuses while any post or reel has a title, a link, an audience other than Global or comments off, or any "Selected
-- people" list exists: without this migration such a post would become public, and a title-only post would break the
-- not-empty rule. Clear those on purpose first.
-- =============================================================================
do $$
declare
  v_cond text;
  v_found boolean;
begin
  select string_agg(case column_name
      when 'title' then 'title is not null'
      when 'link_url' then 'link_url is not null'
      when 'audience' then 'audience <> ''global'''
      else 'comments_off'
    end, ' or ')
  into v_cond
  from information_schema.columns
  where table_schema = 'public' and table_name = 'feed_posts' and column_name in ('title', 'link_url', 'audience', 'comments_off');
  if v_cond is not null then
    execute format('select exists (select 1 from public.feed_posts where %s)', v_cond) into v_found;
    if v_found then
      raise exception 'posts with a title, link, audience or comment setting exist: clear them before rolling back migration 44';
    end if;
  end if;
  if to_regclass('public.feed_post_viewers') is not null then
    execute 'select exists (select 1 from public.feed_post_viewers)' into v_found;
    if v_found then
      raise exception 'posts with chosen viewers exist: clear feed_post_viewers before rolling back migration 44';
    end if;
  end if;
end $$;

-- Policies
drop policy if exists "feed_posts_audience" on public.feed_posts;
drop policy if exists "post_comments_post_audience" on public.post_comments;

-- Triggers and their functions: shared posts, comments, likes, saves, views and campus posts
drop trigger if exists messages_guard_shared_post on public.messages;
drop function if exists public.guard_message_shared_post();
drop trigger if exists post_comments_check_post on public.post_comments;
drop function if exists public.post_comments_check_post();
drop trigger if exists post_likes_check_post on public.post_likes;
drop trigger if exists saved_listings_check_post on public.saved_listings;
drop function if exists public.feed_post_engagement_check();
drop trigger if exists post_views_check_post on public.post_views;
drop function if exists public.post_views_check_post();
drop trigger if exists feed_posts_check_campus on public.feed_posts;
drop function if exists public.feed_posts_check_campus();

-- profile_stats() exactly as migration 19 (20260928000000_profile_page_tuning.sql) made it
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
grant execute on function public.profile_stats(uuid) to anon, authenticated;

-- post_likers_many() exactly as migration 19 (20260928000000_profile_page_tuning.sql) made it
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
grant execute on function public.post_likers_many(text, uuid[], int) to anon, authenticated;

-- ts_public_snapshot() exactly as migration 41 (20261103000000_trust_safety.sql) made it
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

-- "Selected people" and the visibility helpers
drop function if exists public.set_post_viewers(uuid, uuid[]);
drop function if exists public.can_see_feed_post_id(uuid);
drop function if exists public.can_see_feed_post(uuid, uuid, text, uuid);
drop function if exists public.can_see_feed_post_as(uuid, uuid, uuid, text, uuid);
drop function if exists public.verified_university(uuid);
drop table if exists public.feed_post_viewers;

-- The not-empty rule as migration 11 (20260920000000_home_feed.sql) made it, then the columns
alter table public.feed_posts drop constraint if exists feed_posts_not_empty;
alter table public.feed_posts add constraint feed_posts_not_empty
  check (char_length(btrim(body)) > 0 or cardinality(images) > 0 or jsonb_array_length(videos) > 0);
alter table public.feed_posts drop constraint if exists feed_posts_title_check;
alter table public.feed_posts drop constraint if exists feed_posts_link_url_check;
alter table public.feed_posts drop constraint if exists feed_posts_audience_check;
alter table public.feed_posts drop constraint if exists feed_posts_campus_has_university;
alter table public.feed_posts
  drop column if exists title,
  drop column if exists link_url,
  drop column if exists audience,
  drop column if exists comments_off;

do $$
begin
  if to_regclass('public._migrations') is not null then
    delete from public._migrations where name = '20261104000000_post_details.sql';
  end if;
end $$;

notify pgrst, 'reload schema';

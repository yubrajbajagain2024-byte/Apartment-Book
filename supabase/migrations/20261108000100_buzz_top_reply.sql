-- =============================================================================
-- UniBuzz - the top reply on a Buzz feed card
-- Follows 20261103000100_buzz_v2.sql. Every buzz in the feed (and in Buzz search, which is the same reader) now
-- carries the reply its card shows under it, "Top reply", or null:
--
--   * the most upvoted reply that anyone may read: active and published, not folded by the community, not one the
--     viewer reported or from an anon they hid in that thread; with at least 3 upvotes (BUZZ_TOP_REPLY_MIN_UPVOTES in
--     packages/shared) and more up than down; ties go to the earlier reply;
--   * never a reply that touched on self-harm (support_link): those stay in their thread, beside the support
--     resources, and are not pushed to everyone's feed;
--   * none under a buzz that is not active or that the community folded.
--
-- The reply keeps its thread alias (the alias book, collision suffix and all), so it reads as it does in the thread:
-- nothing about anyone that the thread does not already show. buzz_v2_feed keeps its signature (only its last select
-- changes), so 20261103000100_buzz_v2.sql still runs again over this file. A partial index finds the candidates.
-- Rollback: rollbacks/20261108000100_buzz_top_reply.down.sql.
-- =============================================================================

-- Only replies with enough upvotes are ever candidates; this finds them per thread, best first.
create index if not exists buzz_comments_top_idx on public.buzz_comments (post_id, score desc) where status = 'active' and upvotes >= 3;

-- The top reply of a buzz for this viewer (BuzzTopReply), or null.
create or replace function public.buzz_v2_top_reply(p_post public.buzz_posts, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.buzz_comments;
  v_key text;
begin
  if p_post.id is null or p_post.status <> 'active' or (p_post.eligible_score <= -5 and p_post.eligible_votes >= 8) then
    return null;
  end if;
  select x.* into c
  from public.buzz_comments x
  where x.post_id = p_post.id
    and x.status = 'active'
    and x.upvotes >= 3
    and x.score > 0
    and x.visible_at <= now()
    and not x.support_link
    and not (x.eligible_score <= -5 and x.eligible_votes >= 8)
    and not exists (select 1 from public.reports r where r.reporter_id = p_viewer and r.target_type = 'buzz_comment' and r.target_id = x.id)
    and not exists (select 1 from public.buzz_mutes m where m.user_id = p_viewer and m.post_id = x.post_id and m.muted_id = x.author_id)
  order by x.score desc, x.visible_at, x.seq, x.id
  limit 1;
  if c.id is null then
    return null;
  end if;
  v_key := public.buzz_author_key(c.author_id, c.alias);
  return jsonb_build_object(
    'id', c.id,
    'alias', coalesce(public.buzz_v2_alias_book(p_post.id) -> v_key, public.buzz_alias_json(public.buzz_alias_digest(p_post.id, v_key), 0)),
    'isOp', v_key = public.buzz_author_key(p_post.author_id, p_post.alias),
    'isMine', p_viewer is not null and coalesce(c.author_id = p_viewer, false),
    'text', c.body,
    'score', c.score,
    'createdAt', public.buzz_minute_ms(least(c.visible_at, now())));
end;
$$;

-- The feed (and search): each buzz with its topReply.
create or replace function public.buzz_v2_feed(
  p_scope text default 'campus', p_sort text default 'hot', p_window text default 'day', p_q text default null,
  p_limit int default 20, p_offset int default 0, p_rank_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_now timestamptz := now();
  v_rank timestamptz := public.buzz_floor_minute(least(coalesce(p_rank_at, now()), now()));
  v_scope text := coalesce(p_scope, 'campus');
  v_sort text := coalesce(p_sort, 'hot');
  v_window text := coalesce(p_window, 'day');
  v_q text := nullif(public.buzz_trim(p_q), '');
  v_terms text[] := '{}'::text[];
  v_likes text[] := '{}'::text[];
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_uni uuid;
  v_since timestamptz;
  v_ids uuid[];
  v_items jsonb;
begin
  if v_scope not in ('campus', 'global') then
    raise exception 'buzz:validation_failed:Pick Campus or Global.';
  end if;
  if v_sort not in ('hot', 'new', 'top') then
    raise exception 'buzz:validation_failed:Sort by Hot, New or Top.';
  end if;
  if v_window not in ('day', 'week', 'all') then
    raise exception 'buzz:validation_failed:Top covers today, this week or all time.';
  end if;
  if v_q is not null then
    if char_length(v_q) > 80 then
      raise exception 'buzz:validation_failed:Searches are limited to 80 characters.';
    end if;
    v_terms := public.buzz_search_terms(v_q);
    -- nothing searchable in it (one letter, only symbols): matches nothing, never "everything"
    if cardinality(v_terms) = 0 then
      return jsonb_build_object('items', '[]'::jsonb, 'nextOffset', null, 'rankAt', public.buzz_iso(v_rank));
    end if;
    v_likes := array(select public.buzz_like_pattern(t) from unnest(v_terms) as t);
  end if;
  select p.university_id into v_uni from public.profiles p where p.id = v_me;
  v_since := case v_window when 'day' then v_rank - interval '1 day' when 'week' then v_rank - interval '7 days' end;

  v_ids := array(
    select f.id
    from (
      select b.id, b.score, b.visible_at,
        case when v_sort = 'hot' then
          (b.score + 2 * (
            select count(*) from public.buzz_comments c
            where c.post_id = b.id and c.status = 'active' and c.visible_at <= v_now and public.buzz_floor_minute(c.visible_at) <= v_rank
          ))::numeric
          / power(greatest(extract(epoch from (v_rank - public.buzz_floor_minute(b.visible_at))) / 3600.0, 0) + 2, 1.5)
        end as hot
      from public.buzz_posts b
      where b.status <> 'deleted'
        and (b.status = 'active' or b.author_id = v_me)
        and ((b.visible_at <= v_now and public.buzz_floor_minute(b.visible_at) <= v_rank)
             or (b.author_id = v_me and public.buzz_floor_minute(b.created_at) <= v_rank))
        and case when v_scope = 'campus' then b.scope = 'campus' and b.university_id = v_uni else b.scope = 'global' end
        and (cardinality(v_likes) = 0 or not exists (
              select 1 from unnest(v_likes) as l
              where not (lower(b.title) like l escape '\' or lower(b.body) like l escape '\')))
        and not exists (select 1 from public.buzz_hidden_threads h where h.user_id = v_me and h.thread_id = b.id)
        and not exists (select 1 from public.reports r where r.reporter_id = v_me and r.target_type = 'buzz' and r.target_id = b.id)
        and (v_sort = 'new' or not (b.eligible_score <= -5 and b.eligible_votes >= 8))
        and (v_sort <> 'top' or v_since is null or public.buzz_floor_minute(b.visible_at) >= v_since)
    ) f
    order by
      case when v_sort = 'hot' then f.hot end desc nulls last,
      case when v_sort = 'top' then f.score end desc nulls last,
      case when v_sort = 'new' then f.visible_at end desc nulls last,
      f.id desc
    limit v_limit + 1 offset v_offset
  );
  select coalesce(jsonb_agg(public.buzz_root_json(b, v_me, false) || jsonb_build_object('topReply', public.buzz_v2_top_reply(b, v_me)) order by x.n), '[]'::jsonb)
  into v_items
  from unnest(v_ids[1:v_limit]) with ordinality as x(id, n)
  join public.buzz_posts b on b.id = x.id;
  return jsonb_build_object(
    'items', v_items,
    'nextOffset', case when coalesce(cardinality(v_ids), 0) > v_limit then v_offset + v_limit end,
    'rankAt', public.buzz_iso(v_rank));
end;
$$;

-- Internal, as every Buzz function is (buzz_v2.sql §17); the feed stays callable by signed-in people only.
revoke all on function public.buzz_v2_top_reply(public.buzz_posts, uuid) from public, anon, authenticated, service_role;
revoke all on function public.buzz_v2_feed(text, text, text, text, integer, integer, timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.buzz_v2_feed(text, text, text, text, integer, integer, timestamp with time zone) to authenticated;

notify pgrst, 'reload schema';

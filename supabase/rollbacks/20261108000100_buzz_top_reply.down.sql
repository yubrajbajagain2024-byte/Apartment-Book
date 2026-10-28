-- Rollback of supabase/migrations/20261108000100_buzz_top_reply.sql.
-- Puts back the feed of 20261103000100_buzz_v2.sql (buzzes without topReply) and drops the top reply's function and
-- index. Nothing anyone wrote changes.
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
  select coalesce(jsonb_agg(public.buzz_root_json(b, v_me, false) order by x.n), '[]'::jsonb)
  into v_items
  from unnest(v_ids[1:v_limit]) with ordinality as x(id, n)
  join public.buzz_posts b on b.id = x.id;
  return jsonb_build_object(
    'items', v_items,
    'nextOffset', case when coalesce(cardinality(v_ids), 0) > v_limit then v_offset + v_limit end,
    'rankAt', public.buzz_iso(v_rank));
end;
$$;

drop function if exists public.buzz_v2_top_reply(public.buzz_posts, uuid);
drop index if exists public.buzz_comments_top_idx;

revoke all on function public.buzz_v2_feed(text, text, text, text, integer, integer, timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.buzz_v2_feed(text, text, text, text, integer, integer, timestamp with time zone) to authenticated;

notify pgrst, 'reload schema';

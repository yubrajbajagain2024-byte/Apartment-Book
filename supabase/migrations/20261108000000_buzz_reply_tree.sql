-- =============================================================================
-- UniBuzz - Buzz replies nest at any depth, as on Reddit
-- Follows 20261103000100_buzz_v2.sql. A thread's replies have always been stored with their real parent
-- (buzz_comments.parent_id), but the readers shape them for two visual levels: anything deeper is flattened under its
-- depth-1 ancestor with "replying to Anon X". The app now draws the whole conversation as a tree, so every reply
-- of a page also says which reply it answers:
--
--   * treeParentId: the nearest ancestor the viewer can see (the thread when there is none). What the viewer can see
--     is still decided by buzz_v2_visible_replies alone, so a held, unpublished or reported reply is never pointed at:
--     it is stepped over, exactly as the replies under it already hang from the nearest reply that shows.
--
-- parentId, depth and replyingTo are unchanged, so the website (two levels) reads the same replies as before. Only
-- buzz_v2_reply_page changes, keeping its signature, so 20261103000100_buzz_v2.sql still runs again over this file.
-- No table, row or rule changes. Rollback: rollbacks/20261108000000_buzz_reply_tree.down.sql.
-- =============================================================================

-- One page of a thread's replies (BuzzPage<BuzzReply>), each with its treeParentId.
create or replace function public.buzz_v2_reply_page(p_root public.buzz_posts, p_viewer uuid, p_offset int, p_limit int, p_staff boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_book jsonb := public.buzz_v2_alias_book(p_root.id);
  v_root_key text := public.buzz_author_key(p_root.author_id, p_root.alias);
  v_items jsonb;
  v_total bigint;
begin
  with recursive vis as (
    select r.*, count(*) over () as total from public.buzz_v2_visible_replies(p_root.id, p_viewer, p_staff) r
  ),
  -- from each reply that shows, up its real parents until one that shows
  up (start_id, anc_id, dist) as (
    select c.id, c.parent_id, 1 from vis v join public.buzz_comments c on c.id = v.id where c.parent_id is not null
    union all
    select u.start_id, c.parent_id, u.dist + 1
    from up u join public.buzz_comments c on c.id = u.anc_id
    where c.parent_id is not null and u.dist < 1000 and not exists (select 1 from vis w where w.id = u.anc_id)
  ),
  tree as (
    select v.id, coalesce((select u.anc_id from up u join vis w on w.id = u.anc_id where u.start_id = v.id order by u.dist limit 1), p_root.id) as tree_parent
    from vis v
  )
  select coalesce(jsonb_agg(public.buzz_reply_json(
           c, p_viewer, p_staff, v.shape_parent, v.shape_depth,
           case when v.replying_key is not null then v_book -> v.replying_key end,
           v_book -> public.buzz_author_key(c.author_id, c.alias), v_root_key)
         || jsonb_build_object('treeParentId', t.tree_parent) order by v.ord), '[]'::jsonb),
         max(v.total)
  into v_items, v_total
  from vis v
  join tree t on t.id = v.id
  join public.buzz_comments c on c.id = v.id
  where v.ord > v_offset and v.ord <= v_offset + v_limit;
  return jsonb_build_object('items', v_items, 'nextOffset', case when coalesce(v_total, 0) > v_offset + v_limit then v_offset + v_limit end);
end;
$$;

-- Internal, as every Buzz function is (buzz_v2.sql §17). Replacing a function keeps its grants; said again anyway.
revoke all on function public.buzz_v2_reply_page(public.buzz_posts, uuid, integer, integer, boolean) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

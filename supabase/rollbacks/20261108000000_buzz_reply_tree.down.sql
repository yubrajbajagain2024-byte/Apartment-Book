-- Rollback of supabase/migrations/20261108000000_buzz_reply_tree.sql.
-- Puts back the reply page of 20261103000100_buzz_v2.sql: replies lose treeParentId and the app shows them on two
-- levels again. Nothing anyone wrote changes (every reply keeps its real parent in buzz_comments.parent_id).
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
  select coalesce(jsonb_agg(public.buzz_reply_json(
           c, p_viewer, p_staff, v.shape_parent, v.shape_depth,
           case when v.replying_key is not null then v_book -> v.replying_key end,
           v_book -> public.buzz_author_key(c.author_id, c.alias), v_root_key) order by v.ord), '[]'::jsonb),
         max(v.total)
  into v_items, v_total
  from (select r.*, count(*) over () as total from public.buzz_v2_visible_replies(p_root.id, p_viewer, p_staff) r) v
  join public.buzz_comments c on c.id = v.id
  where v.ord > v_offset and v.ord <= v_offset + v_limit;
  return jsonb_build_object('items', v_items, 'nextOffset', case when coalesce(v_total, 0) > v_offset + v_limit then v_offset + v_limit end);
end;
$$;

revoke all on function public.buzz_v2_reply_page(public.buzz_posts, uuid, integer, integer, boolean) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

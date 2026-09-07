-- Owners looking at their own listing should not count as a view.
create or replace function public.record_view(p_target_type text, p_target_id uuid, p_viewer_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if p_target_type not in ('apartment', 'item', 'roommate') or p_target_id is null then
    return;
  end if;
  if auth.uid() is not null and public.listing_owner(p_target_type, p_target_id) = auth.uid() then
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

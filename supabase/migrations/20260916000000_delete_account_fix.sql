-- =============================================================================
-- Apartment Book - migration 11: delete_my_account must not touch storage
-- tables directly (Supabase forbids it); the app removes files via the Storage
-- API first, then calls this.
-- =============================================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  delete from auth.users where id = v_me;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- =============================================================================
-- Rollback of 20261110000000_business_hours.sql (a business's opening hours).
-- Run as one transaction. Removes the check, its functions and the hours column with every business's hours in it:
-- profiles show none, and the portal's form no longer offers them (it asks the database whether the column exists).
-- Puts back migration 49's audit of profile edits (without hours).
-- =============================================================================
alter table public.businesses drop constraint if exists businesses_hours_check;
alter table public.businesses drop column if exists hours;
drop function if exists public.business_hours_valid(jsonb);
drop function if exists public.business_hours_ranges_valid(jsonb);

-- Migration 49's audit of profile edits, as 49 wrote it (without hours).
create or replace function public.businesses_audit_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields text[];
begin
  if current_setting('app.business_review', true) = 'on' or auth.uid() is null then
    return new;
  end if;
  select array_agg(k order by k) into v_fields
  from jsonb_each(to_jsonb(new)) n(k, v)
  where k in ('name', 'category', 'description', 'website', 'phone', 'contact_email', 'address', 'city', 'logo_url', 'university_ids')
    and v is distinct from (to_jsonb(old) -> k);
  if v_fields is not null then
    perform public.business_audit_write(new.id, 'team', 'profile_updated', 'business', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return new;
end;
$$;
revoke all on function public.businesses_audit_profile() from public, anon, authenticated;
notify pgrst, 'reload schema';

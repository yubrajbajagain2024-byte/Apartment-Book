-- =============================================================================
-- UniBuzz - migration 57: a business's opening hours
-- Follows 20261109000100_business_hardening.sql (migration 56); adds to migration 39's public.businesses and to 49's audit.
-- Rollback: supabase/rollbacks/20261110000000_business_hours.down.sql. Safe to run more than once.
--  * public.businesses.hours (jsonb, null for none): the business's time zone, each weekday's opening and closing
--    times (none is closed) and special hours by date (holidays, events), closed or with their own times. Students
--    see them on the business's profile with whether it is open now (packages/shared/src/business-hours.ts):
--      { "timezone": "America/Chicago",
--        "week": { "mon": [{ "open": "09:00", "close": "17:00" }], …, "sun": [] },
--        "special": [{ "date": "2026-11-26", "label": "Thanksgiving", "closed": true, "hours": [] }] }
--    A close at or before the open runs past midnight; "24:00" is midnight at the end of the day.
--  * Public like the rest of the profile: column grants let everyone read it (of an approved business, as the row
--    policy already decides). Written as the profile is: by the owner and admins (owner_can_edit()); my_business()
--    returns the whole row, hours included. Migration 49's audit of profile edits records "hours" too (its function,
--    with hours added to its list of fields; the rollback puts 49's back).
--  * The database checks the shape (businesses_hours_check), the same rules as the portal's form: one of the United
--    States time zones UniBuzz's campuses are in, at most 3 ranges a day, times as HH:MM, at most 60 special dates,
--    each a real date, once, with a name of 40 characters at most, and closed or with hours. Nothing else is stored.
-- =============================================================================

alter table public.businesses add column if not exists hours jsonb;

-- One day's ranges: [] (closed) or up to 3 { open, close } with HH:MM times ("24:00" closes at midnight) that differ.
create or replace function public.business_hours_ranges_valid(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_range jsonb;
begin
  if coalesce(jsonb_typeof(p), '') <> 'array' or jsonb_array_length(p) > 3 then
    return false;
  end if;
  for v_range in select value from jsonb_array_elements(p) loop
    if coalesce(jsonb_typeof(v_range), '') <> 'object'
      or exists (select 1 from jsonb_object_keys(v_range) k where k not in ('open', 'close'))
      or coalesce(jsonb_typeof(v_range->'open'), '') <> 'string'
      or coalesce(jsonb_typeof(v_range->'close'), '') <> 'string'
      or (v_range->>'open') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v_range->>'close') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
      or (v_range->>'open') = (v_range->>'close') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- The whole value: the three keys, a listed time zone, all seven days, and the special dates. Deterministic (no clock,
-- no settings), as a check constraint needs; reveals nothing, so the API may call it like the constraint does.
create or replace function public.business_hours_valid(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_day text;
  v_special jsonb;
  v_date text;
  v_dates text[] := '{}';
begin
  if coalesce(jsonb_typeof(p), '') <> 'object' or octet_length(p::text) > 20000 then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('timezone', 'week', 'special')) then
    return false;
  end if;
  if coalesce(jsonb_typeof(p->'timezone'), '') <> 'string'
    or (p->>'timezone') not in ('America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu') then
    return false;
  end if;
  if coalesce(jsonb_typeof(p->'week'), '') <> 'object'
    or exists (select 1 from jsonb_object_keys(p->'week') k where k not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')) then
    return false;
  end if;
  foreach v_day in array array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] loop
    if not public.business_hours_ranges_valid(p->'week'->v_day) then
      return false;
    end if;
  end loop;
  if coalesce(jsonb_typeof(p->'special'), '') <> 'array' or jsonb_array_length(p->'special') > 60 then
    return false;
  end if;
  for v_special in select value from jsonb_array_elements(p->'special') loop
    if coalesce(jsonb_typeof(v_special), '') <> 'object'
      or exists (select 1 from jsonb_object_keys(v_special) k where k not in ('date', 'label', 'closed', 'hours'))
      or coalesce(jsonb_typeof(v_special->'date'), '') <> 'string'
      or coalesce(jsonb_typeof(v_special->'label'), 'null') not in ('string', 'null')
      or char_length(coalesce(v_special->>'label', '')) > 40
      or coalesce(jsonb_typeof(v_special->'closed'), '') <> 'boolean'
      or not public.business_hours_ranges_valid(v_special->'hours') then
      return false;
    end if;
    -- Closed, or open with hours: never both, never neither.
    if (v_special->>'closed')::boolean = (jsonb_array_length(v_special->'hours') > 0) then
      return false;
    end if;
    v_date := v_special->>'date';
    if v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_date = any (v_dates) then
      return false;
    end if;
    begin
      perform make_date(substr(v_date, 1, 4)::int, substr(v_date, 6, 2)::int, substr(v_date, 9, 2)::int);
    exception when others then
      return false;
    end;
    v_dates := v_dates || v_date;
  end loop;
  return true;
end;
$$;

alter table public.businesses drop constraint if exists businesses_hours_check;
alter table public.businesses add constraint businesses_hours_check check (hours is null or public.business_hours_valid(hours));

-- Public, like the rest of the profile (migration 39 grants column by column; the row policy still decides which rows).
grant select (hours) on table public.businesses to anon, authenticated;

-- Migration 49's audit of what the owner or an admin changes on the profile, with the hours among the fields.
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
  where k in ('name', 'category', 'description', 'website', 'phone', 'contact_email', 'address', 'city', 'logo_url', 'university_ids', 'hours')
    and v is distinct from (to_jsonb(old) -> k);
  if v_fields is not null then
    perform public.business_audit_write(new.id, 'team', 'profile_updated', 'business', new.id, jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return new;
end;
$$;
revoke all on function public.businesses_audit_profile() from public, anon, authenticated;

notify pgrst, 'reload schema';

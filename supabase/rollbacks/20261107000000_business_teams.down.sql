-- =============================================================================
-- Rollback of 20261107000000_business_teams.sql (UniBuzz Business v2, part 1: team roles and the business audit log).
-- Run as one transaction, after 20261107000100_business_ads.down.sql (this refuses while public.ads exists).
--  * Every admin, editor and analyst becomes staff again, v1's one role besides the owner (staff could do what an
--    editor does: an analyst regains the inbox and publishing, an admin loses the team and the profile), and joins
--    every inquiry chat of the business again. Pending invites lose their role.
--  * The business audit log is dropped, with what it recorded: export it first if it is needed.
--  * The 'business' notifications go.
--  * Migration 39's functions and policies come back exactly as they were.
-- =============================================================================
do $$
begin
  if to_regclass('public.ads') is not null then
    raise exception 'roll back 20261107000100_business_ads.sql first';
  end if;
  if to_regclass('public.business_audit_log') is null then
    raise exception 'public.business_audit_log is missing: this database did not run 20261107000000_business_teams.sql';
  end if;
end $$;

-- Policies back to migration 39's
drop policy if exists "deals_insert_member" on public.deals;
create policy "deals_insert_member" on public.deals
  for insert to authenticated with check (public.team_can_manage(business_id) and created_by = auth.uid());
drop policy if exists "deals_update_member" on public.deals;
create policy "deals_update_member" on public.deals
  for update to authenticated using (public.team_can_manage(business_id)) with check (public.team_can_manage(business_id));
drop policy if exists "deals_delete_member" on public.deals;
create policy "deals_delete_member" on public.deals
  for delete to authenticated using (public.team_can_manage(business_id));
drop policy if exists "business_invites_select" on public.business_invites;
create policy "business_invites_select" on public.business_invites
  for select to authenticated using (public.is_business_owner_of(business_id) and public.team_can_manage(business_id));

-- Migration 39's functions
create or replace function public.team_can_operate(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_business_member(p_business) and public.business_status(p_business) = 'approved', false);
$$;

create or replace function public.owner_can_edit(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_business_owner_of(p_business) and public.business_status(p_business) in ('pending', 'approved', 'rejected'), false);
$$;

drop function if exists public.business_invite_create(text, text);
create or replace function public.business_invite_create(p_email text)
returns public.business_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_business uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.business_invites;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  select business_id into v_business from public.business_members where user_id = v_me and role = 'owner';
  if v_business is null then
    raise exception 'Only the business owner can invite staff';
  end if;
  if not public.team_can_manage(v_business) then
    raise exception 'Your business cannot add people right now' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'Enter a valid email address';
  end if;
  if exists (select 1 from auth.users u where lower(u.email::text) = v_email) then
    raise exception 'That email already has a CampConnect account. Staff need an address that is not registered yet.';
  end if;
  if (select count(*) from public.business_invites i where i.business_id = v_business and i.accepted_at is null and i.expires_at > now()) >= 20 then
    raise exception 'Too many pending invites. Revoke some first.';
  end if;
  -- A fresh link replaces an earlier one for the same address.
  delete from public.business_invites where business_id = v_business and email = v_email and accepted_at is null;
  insert into public.business_invites (business_id, email, invited_by) values (v_business, v_email, v_me) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.business_invite_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.business_members where user_id = auth.uid() and role = 'owner';
  if v_business is null then
    raise exception 'Only the business owner can revoke invites';
  end if;
  delete from public.business_invites where id = p_id and business_id = v_business and accepted_at is null;
end;
$$;

create or replace function public.business_member_remove(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.business_members where user_id = auth.uid() and role = 'owner';
  if v_business is null then
    raise exception 'Only the business owner can remove staff';
  end if;
  if public.business_status(v_business) = 'suspended' then
    raise exception 'Your business is suspended' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'The owner cannot leave the business';
  end if;
  delete from public.business_members where user_id = p_user and business_id = v_business and role = 'staff';
  if not found then
    raise exception 'That person is not on your team';
  end if;
end;
$$;

create or replace function public.business_claim_invite(p_user uuid, p_email text, p_meta jsonb, p_created_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := coalesce(p_meta ->> 'business_invite', '');
  v_inv public.business_invites;
begin
  if v_token = '' or p_user is null then
    return false;
  end if;
  select * into v_inv
  from public.business_invites i
  where i.token = v_token and i.email = lower(btrim(coalesce(p_email, ''))) and i.accepted_at is null and i.expires_at > now();
  if v_inv.id is null then
    return false;
  end if;
  if p_created_at is not null and p_created_at < v_inv.created_at then
    return false;
  end if;
  if not exists (
    select 1 from public.businesses b
    where b.id = v_inv.business_id and b.status in ('pending', 'approved') and b.owner_id = v_inv.invited_by
  ) then
    return false;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.role = 'business_staff') then
    return false;
  end if;
  insert into public.business_members (user_id, business_id, role, invited_by)
  values (p_user, v_inv.business_id, 'staff', v_inv.invited_by)
  on conflict (user_id) do nothing;
  if not found then
    return false;
  end if;
  update public.business_invites set accepted_at = now(), accepted_by = p_user where id = v_inv.id;
  return true;
end;
$$;

create or replace function public.start_business_inquiry(p_target_type text, p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_business uuid;
  v_name text;
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_business_account(v_me) then
    raise exception 'Businesses can only reply to students who contacted them.';
  end if;
  if p_target_type = 'apartment' then
    select business_id into v_business from public.apartments where id = p_target_id;
  elsif p_target_type = 'deal' then
    select business_id into v_business from public.deals where id = p_target_id;
  else
    raise exception 'Unknown listing type';
  end if;
  if v_business is null then
    raise exception 'This listing is not from a business';
  end if;
  select name into v_name from public.businesses where id = v_business and status = 'approved';
  if v_name is null then
    raise exception 'This business isn''t taking messages right now.';
  end if;

  v_key := 'biz:' || v_business::text || ':' || v_me::text;
  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  begin
    insert into public.conversations (type, name, direct_key, created_by, business_id, inquiry_target_type, inquiry_target_id)
    values ('direct', v_name, v_key, v_me, v_business, p_target_type, p_target_id)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.conversations where direct_key = v_key;
    return v_id;
  end;

  insert into public.conversation_members (conversation_id, user_id)
  select v_id, v_me
  union
  select v_id, m.user_id from public.business_members m where m.business_id = v_business
  on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.business_members_sync_conversations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id from public.conversations c where c.business_id = new.business_id
    on conflict do nothing;
    return new;
  end if;
  delete from public.conversation_members cm
  using public.conversations c
  where c.id = cm.conversation_id and c.business_id = old.business_id and cm.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists business_members_sync_conversations on public.business_members;
create trigger business_members_sync_conversations
  after insert or delete on public.business_members
  for each row execute function public.business_members_sync_conversations();

drop function if exists public.business_invite_lookup(text);
create or replace function public.business_invite_lookup(p_token text)
returns table (business_name text, email text, valid boolean)
language sql
stable
security definer
set search_path = public
as $$
  select b.name, i.email, (i.accepted_at is null and i.expires_at > now() and b.status in ('pending', 'approved'))
  from public.business_invites i
  join public.businesses b on b.id = i.business_id
  where i.token = coalesce(p_token, '') and char_length(coalesce(p_token, '')) between 16 and 128;
$$;

create or replace function public.admin_review_business(p_business uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  perform public.require_admin();
  if p_decision not in ('approved', 'rejected', 'suspended', 'pending') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  select owner_id into v_owner from public.businesses where id = p_business;
  if v_owner is null then
    raise exception 'No such business';
  end if;
  if p_decision = 'approved' and not public.account_confirmed(v_owner) then
    raise exception 'The owner has not confirmed their email address yet.';
  end if;
  perform set_config('app.business_review', 'on', true);
  update public.businesses
  set status = p_decision,
      verified_partner = case when p_decision = 'approved' then verified_partner else false end,
      verified_at = case when p_decision = 'approved' then verified_at else null end,
      verified_by = case when p_decision = 'approved' then verified_by else null end,
      verification_note = case when p_decision = 'approved' then verification_note else null end,
      review_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_business;
  if p_decision <> 'approved' then
    update public.apartments set status = 'archived' where business_id = p_business and status = 'active';
    update public.deals set status = 'paused' where business_id = p_business and status = 'active';
  end if;
end;
$$;

create or replace function public.admin_set_verified(p_business uuid, p_verified boolean, p_evidence text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evidence text := nullif(left(btrim(coalesce(p_evidence, '')), 1000), '');
begin
  perform public.require_admin();
  if p_verified and public.business_status(p_business) is distinct from 'approved' then
    raise exception 'Only an approved business can be a Verified Partner.';
  end if;
  if p_verified and (v_evidence is null or char_length(v_evidence) < 10) then
    raise exception 'Say what was checked to verify this business (at least 10 characters).';
  end if;
  perform set_config('app.business_review', 'on', true);
  update public.businesses
  set verified_partner = coalesce(p_verified, false),
      verified_at = case when p_verified then now() else null end,
      verified_by = case when p_verified then auth.uid() else null end,
      verification_note = case when p_verified then v_evidence else null end
  where id = p_business;
  if not found then
    raise exception 'No such business';
  end if;
end;
$$;

revoke all on function public.business_invite_create(text) from public, anon;
grant execute on function public.business_invite_create(text) to authenticated;
grant execute on function public.business_invite_lookup(text) to anon, authenticated;

-- The audit log and the helpers
drop trigger if exists businesses_audit_profile on public.businesses;
drop function if exists public.businesses_audit_profile();
drop function if exists public.business_member_set_role(uuid, text);
drop function if exists public.business_audit(uuid, integer, bigint);
drop function if exists public.business_notify_team(uuid, text, text, text, text, jsonb, text[]);
drop function if exists public.business_audit_write(uuid, text, text, text, uuid, jsonb);
drop table if exists public.business_audit_log;
drop function if exists public.business_audit_log_append_only();
drop function if exists public.business_can(uuid, text);
drop function if exists public.business_role_allows(text, text);
drop function if exists public.business_role(uuid);

-- Roles: owner and staff
drop index if exists public.business_members_one_owner;
alter table public.business_members drop constraint if exists business_members_role_check;
update public.business_members set role = 'staff' where role in ('admin', 'editor', 'analyst');
alter table public.business_members alter column role set default 'staff';
alter table public.business_members add constraint business_members_role_check check (role in ('owner', 'staff'));
alter table public.business_invites drop constraint if exists business_invites_role_check;
alter table public.business_invites drop column if exists role;
-- v1 had every member in every chat of the business.
insert into public.conversation_members (conversation_id, user_id)
select c.id, m.user_id from public.conversations c join public.business_members m on m.business_id = c.business_id
on conflict do nothing;

-- Notifications of type 'business'
delete from public.notifications where type = 'business';
do $$
declare
  v_have text[];
begin
  select array_agg(distinct m[1] order by m[1]) into v_have
  from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  alter table public.notifications drop constraint if exists notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_have) as t where t <> 'business'));
end
$$;

notify pgrst, 'reload schema';

-- =============================================================================
-- UniBuzz - migration 49: business team roles and the business audit log (UniBuzz Business v2, part 1)
-- Follows 20261101000000_business_portal.sql (migration 39), whose team was an owner plus "staff". Part 2 is
-- 20261107000100_business_ads.sql. Rollback: supabase/rollbacks/20261107000000_business_teams.down.sql.
--  * business_members.role: owner | admin | editor | analyst. Every v1 staff member becomes an editor, the role that
--    keeps exactly what staff could do (listings, deals, inquiries). business_invites.role is what an invite joins as.
--  * What each role may do is decided in one place, business_can(business, capability), and the portal's policies and
--    functions ask it (team_can_operate() now means "owner, admin or editor of an approved business"):
--      capability     owner admin editor analyst   while the business is
--      view             x     x     x      x       pending or approved
--      analytics        x     x     x      x       pending or approved
--      publish          x     x     x              pending (drafts) or approved
--      reply            x     x     x              approved
--      manage_team      x     x                    pending or approved
--      edit_profile     x     x                    pending, approved or rejected
--      manage_ads       x     x                    approved
--  * Inquiry chats hold the owner, admins and editors: an analyst reads numbers, never a student's messages, and sees
--    no student's profile. A role change moves the person in or out of the chats at once.
--  * Owners and admins invite, change roles and remove people. An admin manages editors and analysts only; only the
--    owner makes or unmakes an admin; the owner stays the owner (one per business).
--  * business_audit_log: who did what to a business. Append-only, closed to the API, written by the functions here
--    and in part 2, read through business_audit(): the platform's admins see everything, a business's owner and
--    admins see their own business (with the UniBuzz team's reviewers shown as "UniBuzz team"). It also counts the
--    invites a business sends: 30 a day, on top of v1's 20 pending.
--  * Notifications of type 'business' tell the team about reviews (approved, not approved, suspended, back to review)
--    and the Verified Partner mark; a person told their role changed gets one too.
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Roles
-- -----------------------------------------------------------------------------
alter table public.business_members drop constraint if exists business_members_role_check;
update public.business_members set role = 'editor' where role = 'staff';
alter table public.business_members alter column role set default 'editor';
alter table public.business_members add constraint business_members_role_check
  check (role in ('owner', 'admin', 'editor', 'analyst'));
-- The business's owner is its only 'owner' row.
create unique index if not exists business_members_one_owner on public.business_members (business_id) where role = 'owner';

alter table public.business_invites add column if not exists role text not null default 'editor';
alter table public.business_invites drop constraint if exists business_invites_role_check;
alter table public.business_invites add constraint business_invites_role_check check (role in ('admin', 'editor', 'analyst'));

-- The caller's role on a business, or null.
create or replace function public.business_role(p_business uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.business_members m where m.user_id = auth.uid() and m.business_id = p_business;
$$;

-- What a role may do, whatever the business's standing (the table in the header).
create or replace function public.business_role_allows(p_role text, p_capability text)
returns boolean
language sql
immutable
as $$
  select coalesce(case p_capability
    when 'view' then p_role in ('owner', 'admin', 'editor', 'analyst')
    when 'analytics' then p_role in ('owner', 'admin', 'editor', 'analyst')
    when 'publish' then p_role in ('owner', 'admin', 'editor')
    when 'reply' then p_role in ('owner', 'admin', 'editor')
    when 'manage_team' then p_role in ('owner', 'admin')
    when 'edit_profile' then p_role in ('owner', 'admin')
    when 'manage_ads' then p_role in ('owner', 'admin')
    else false
  end, false);
$$;

-- May the caller do this for this business now: their role allows it and the business's standing does too.
create or replace function public.business_can(p_business uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.business_role_allows(m.role, p_capability)
      and case p_capability
        when 'edit_profile' then b.status in ('pending', 'approved', 'rejected')
        when 'reply' then b.status = 'approved'
        when 'manage_ads' then b.status = 'approved'
        else b.status in ('pending', 'approved')
      end
    from public.business_members m
    join public.businesses b on b.id = m.business_id
    where m.user_id = auth.uid() and m.business_id = p_business
  ), false);
$$;

-- Migration 39's "on the team of an approved business", now for the roles that work with students: listings, inquiry
-- chats and the students in them. An analyst is on the team without any of that.
create or replace function public.team_can_operate(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.business_can(p_business, 'reply'), false);
$$;

-- Migration 39's name, kept because policies use it: the owner or an admin, of a business that is not suspended.
create or replace function public.owner_can_edit(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.business_can(p_business, 'edit_profile');
$$;

-- Deals (posts, from part 2 on) are written by the roles that publish; every role reads them.
drop policy if exists "deals_insert_member" on public.deals;
create policy "deals_insert_member" on public.deals
  for insert to authenticated with check (public.business_can(business_id, 'publish') and created_by = auth.uid());
drop policy if exists "deals_update_member" on public.deals;
create policy "deals_update_member" on public.deals
  for update to authenticated using (public.business_can(business_id, 'publish')) with check (public.business_can(business_id, 'publish'));
drop policy if exists "deals_delete_member" on public.deals;
create policy "deals_delete_member" on public.deals
  for delete to authenticated using (public.business_can(business_id, 'publish'));

-- Pending invites: for the people who manage the team.
drop policy if exists "business_invites_select" on public.business_invites;
create policy "business_invites_select" on public.business_invites
  for select to authenticated using (public.business_can(business_id, 'manage_team'));

-- -----------------------------------------------------------------------------
-- 2. The audit log
-- -----------------------------------------------------------------------------
-- No foreign keys: an entry outlives the business, the person and the thing it names (detail keeps their names).
create table if not exists public.business_audit_log (
  id bigint generated always as identity primary key,
  business_id uuid,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('team', 'admin', 'system')),
  action text not null check (char_length(action) between 3 and 60),
  target_type text check (target_type in ('business', 'member', 'invite', 'post', 'listing', 'ad', 'payment', 'report')),
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists business_audit_log_business_idx on public.business_audit_log (business_id, id desc);
create index if not exists business_audit_log_action_idx on public.business_audit_log (business_id, action, created_at desc);

alter table public.business_audit_log enable row level security;
revoke all on table public.business_audit_log from public, anon, authenticated;

create or replace function public.business_audit_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The business audit log is append-only';
end;
$$;

drop trigger if exists business_audit_log_no_update on public.business_audit_log;
create trigger business_audit_log_no_update before update or delete on public.business_audit_log
  for each row execute function public.business_audit_log_append_only();
drop trigger if exists business_audit_log_no_truncate on public.business_audit_log;
create trigger business_audit_log_no_truncate before truncate on public.business_audit_log
  for each statement execute function public.business_audit_log_append_only();

-- Every entry goes through here (internal). The actor is the caller; 'admin' when the platform's admin acts.
create or replace function public.business_audit_write(
  p_business uuid, p_actor_kind text, p_action text, p_target_type text, p_target_id uuid, p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business_audit_log (business_id, actor_id, actor_kind, action, target_type, target_id, detail)
  values (
    p_business, auth.uid(), p_actor_kind, p_action, p_target_type, p_target_id,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('business_name', (select b.name from public.businesses b where b.id = p_business))
  );
end;
$$;

-- The log, newest first, 50 at a time (p_before: the last id of the previous page). The platform's admins read every
-- business (or one, with p_business); a business's owner and admins read their own, where the UniBuzz team's people
-- are "UniBuzz team".
create or replace function public.business_audit(p_business uuid default null, p_limit integer default 50, p_before bigint default null)
returns table (
  id bigint, business_id uuid, business_name text, actor_id uuid, actor_name text, actor_kind text, action text,
  target_type text, target_id uuid, detail jsonb, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
begin
  if not v_admin and (p_business is null or not public.business_can(p_business, 'manage_team')) then
    raise exception 'Only the business''s owner and admins, or the UniBuzz team, can read this log' using errcode = '42501';
  end if;
  return query
  select l.id, l.business_id, coalesce(b.name, l.detail ->> 'business_name'), l.actor_id,
    case
      when l.actor_kind = 'admin' and not v_admin then 'UniBuzz team'
      when l.actor_kind = 'system' then 'UniBuzz'
      else coalesce(p.full_name, 'Former member')
    end,
    l.actor_kind, l.action, l.target_type, l.target_id, l.detail, l.created_at
  from public.business_audit_log l
  left join public.businesses b on b.id = l.business_id
  left join public.profiles p on p.id = l.actor_id
  where (p_business is null or l.business_id = p_business)
    and (p_before is null or l.id < p_before)
  order by l.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Notifications of type 'business' (a union with every type allowed today, as migrations 41 and 42 do)
-- -----------------------------------------------------------------------------
do $$
declare
  v_have text[];
  v_all text[];
begin
  select array_agg(distinct m[1]) into v_have
  from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  select array_agg(distinct t order by t) into v_all
  from unnest(coalesce(v_have, '{}'::text[]) || array['message', 'listing_saved', 'nearby_listing', 'system', 'business']) as t;
  alter table public.notifications drop constraint if exists notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_all) as t));
end
$$;

-- Tells the team (internal): every member, or only the roles named. Links are portal paths ("/ads/<id>"); the portal
-- puts its own prefix in front.
create or replace function public.business_notify_team(
  p_business uuid, p_type text, p_title text, p_body text, p_link text, p_data jsonb, p_roles text[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select m.user_id from public.business_members m
    where m.business_id = p_business and (p_roles is null or m.role = any (p_roles))
  loop
    perform public.notify(r.user_id, auth.uid(), p_type, p_title, p_body, p_link,
      coalesce(p_data, '{}'::jsonb) || jsonb_build_object('business_id', p_business, 'portal', true), null);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Invites, roles and leaving the team
-- -----------------------------------------------------------------------------
-- The join page also says what the invite joins as.
drop function if exists public.business_invite_lookup(text);
create function public.business_invite_lookup(p_token text)
returns table (business_name text, email text, valid boolean, role text)
language sql
stable
security definer
set search_path = public
as $$
  select b.name, i.email, (i.accepted_at is null and i.expires_at > now() and b.status in ('pending', 'approved')), i.role
  from public.business_invites i
  join public.businesses b on b.id = i.business_id
  where i.token = coalesce(p_token, '') and char_length(coalesce(p_token, '')) between 16 and 128;
$$;

-- The owner or an admin invites someone as an admin (the owner only), an editor or an analyst. Migration 39's
-- business_invite_create(text) is replaced: the role defaults to editor, what v1's staff could do.
drop function if exists public.business_invite_create(text);
create or replace function public.business_invite_create(p_email text, p_role text default 'editor')
returns public.business_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_business uuid;
  v_my_role text;
  v_role text := coalesce(nullif(btrim(p_role), ''), 'editor');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.business_invites;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  select business_id, role into v_business, v_my_role from public.business_members where user_id = v_me;
  if v_business is null or not public.business_role_allows(v_my_role, 'manage_team') then
    raise exception 'Only the business owner or an admin can invite people';
  end if;
  if not public.business_can(v_business, 'manage_team') then
    raise exception 'Your business cannot add people right now' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'editor', 'analyst') then
    raise exception 'Invite someone as an admin, an editor or an analyst';
  end if;
  if v_role = 'admin' and v_my_role <> 'owner' then
    raise exception 'Only the owner can make someone an admin' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'Enter a valid email address';
  end if;
  if exists (select 1 from auth.users u where lower(u.email::text) = v_email) then
    raise exception 'That email already has a UniBuzz account. Team members need an address that is not registered yet.';
  end if;
  if (select count(*) from public.business_invites i where i.business_id = v_business and i.accepted_at is null and i.expires_at > now()) >= 20 then
    raise exception 'Too many pending invites. Revoke some first.';
  end if;
  -- A day's worth, counted from the log (revoked invites are deleted, their entries stay).
  perform pg_advisory_xact_lock(hashtext('business_invites:' || v_business::text));
  if (select count(*) from public.business_audit_log l
      where l.business_id = v_business and l.action = 'invite_created' and l.created_at > now() - interval '1 day') >= 30 then
    raise exception 'You have sent 30 invites today. Try again tomorrow.' using errcode = '42501', hint = 'RATE_LIMITED';
  end if;
  -- A fresh link replaces an earlier one for the same address.
  delete from public.business_invites where business_id = v_business and email = v_email and accepted_at is null;
  insert into public.business_invites (business_id, email, invited_by, role) values (v_business, v_email, v_me, v_role) returning * into v_row;
  perform public.business_audit_write(v_business, 'team', 'invite_created', 'invite', v_row.id, jsonb_build_object('email', v_email, 'role', v_role));
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
  v_email text;
begin
  select m.business_id into v_business from public.business_members m where m.user_id = auth.uid();
  if v_business is null or not public.business_can(v_business, 'manage_team') then
    raise exception 'Only the business owner or an admin can revoke invites';
  end if;
  delete from public.business_invites where id = p_id and business_id = v_business and accepted_at is null returning email into v_email;
  if v_email is not null then
    perform public.business_audit_write(v_business, 'team', 'invite_revoked', 'invite', p_id, jsonb_build_object('email', v_email));
  end if;
end;
$$;

-- Migration 39's claim, joining as the invite's role. Everything else holds as before: the token in the account's own
-- sign-up metadata, for this very address, unused and unexpired; the account made after the invite; the business still
-- in good standing and its inviter still on its team with the right to invite; the account a staff account on no team.
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
    join public.business_members m on m.business_id = b.id and m.user_id = v_inv.invited_by
    where b.id = v_inv.business_id and b.status in ('pending', 'approved')
      and public.business_role_allows(m.role, 'manage_team')
      and (v_inv.role <> 'admin' or m.role = 'owner')
  ) then
    return false;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.role = 'business_staff') then
    return false;
  end if;
  insert into public.business_members (user_id, business_id, role, invited_by)
  values (p_user, v_inv.business_id, v_inv.role, v_inv.invited_by)
  on conflict (user_id) do nothing;
  if not found then
    return false;
  end if;
  update public.business_invites set accepted_at = now(), accepted_by = p_user where id = v_inv.id;
  insert into public.business_audit_log (business_id, actor_id, actor_kind, action, target_type, target_id, detail)
  values (v_inv.business_id, p_user, 'team', 'member_joined', 'member', p_user,
    jsonb_build_object('role', v_inv.role, 'email', v_inv.email, 'business_name', (select b.name from public.businesses b where b.id = v_inv.business_id)));
  return true;
end;
$$;

-- The owner changes anyone's role but their own; an admin moves people between editor and analyst. The person moves
-- in or out of the inquiry chats at once (the trigger below).
create or replace function public.business_member_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_business uuid;
  v_my_role text;
  v_their_role text;
begin
  select business_id, role into v_business, v_my_role from public.business_members where user_id = v_me;
  if v_business is null or not public.business_role_allows(v_my_role, 'manage_team') then
    raise exception 'Only the owner or an admin can change roles';
  end if;
  if not public.business_can(v_business, 'manage_team') then
    raise exception 'Your business cannot change its team right now' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'editor', 'analyst') then
    raise exception 'Choose admin, editor or analyst';
  end if;
  select role into v_their_role from public.business_members where user_id = p_user and business_id = v_business;
  if v_their_role is null then
    raise exception 'That person is not on your team';
  end if;
  if v_their_role = 'owner' then
    raise exception 'The owner stays the owner' using errcode = '42501';
  end if;
  if v_my_role <> 'owner' and (p_role = 'admin' or v_their_role = 'admin') then
    raise exception 'Only the owner can make or change an admin' using errcode = '42501';
  end if;
  if v_their_role = p_role then
    return;
  end if;
  update public.business_members set role = p_role where user_id = p_user and business_id = v_business;
  perform public.business_audit_write(v_business, 'team', 'role_changed', 'member', p_user, jsonb_build_object('from', v_their_role, 'to', p_role));
  perform public.notify(p_user, v_me, 'business', 'Your role changed',
    format('You are now an %s on %s.', p_role, (select b.name from public.businesses b where b.id = v_business)),
    '/team', jsonb_build_object('business_id', v_business, 'portal', true, 'role', p_role), null);
end;
$$;

-- Leaving the team: the owner removes anyone but themselves; an admin removes editors and analysts. They leave the
-- team's chats at once (the trigger below) and the portal.
create or replace function public.business_member_remove(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_my_role text;
  v_their_role text;
begin
  select business_id, role into v_business, v_my_role from public.business_members where user_id = auth.uid();
  if v_business is null or not public.business_role_allows(v_my_role, 'manage_team') then
    raise exception 'Only the owner or an admin can remove people from the team';
  end if;
  if public.business_status(v_business) = 'suspended' then
    raise exception 'Your business is suspended' using errcode = '42501';
  end if;
  if p_user = auth.uid() and v_my_role = 'owner' then
    raise exception 'The owner cannot leave the business';
  end if;
  select role into v_their_role from public.business_members where user_id = p_user and business_id = v_business;
  if v_their_role is null then
    raise exception 'That person is not on your team';
  end if;
  if v_their_role = 'owner' then
    raise exception 'The owner cannot leave the business';
  end if;
  if v_their_role = 'admin' and v_my_role <> 'owner' and p_user <> auth.uid() then
    raise exception 'Only the owner can remove an admin' using errcode = '42501';
  end if;
  delete from public.business_members where user_id = p_user and business_id = v_business;
  perform public.business_audit_write(v_business, 'team', 'member_removed', 'member', p_user,
    jsonb_build_object('role', v_their_role, 'name', (select p.full_name from public.profiles p where p.id = p_user)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Inquiry chats: the owner, admins and editors
-- -----------------------------------------------------------------------------
-- Migration 39's function, with the team limited to the roles that reply.
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
  select v_id, m.user_id from public.business_members m
  where m.business_id = v_business and public.business_role_allows(m.role, 'reply')
  on conflict do nothing;
  return v_id;
end;
$$;

-- A member who replies joins every chat the business has; one who leaves, or becomes an analyst, leaves them.
create or replace function public.business_members_sync_conversations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and public.business_role_allows(new.role, 'reply') then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id from public.conversations c where c.business_id = new.business_id
    on conflict do nothing;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and not public.business_role_allows(new.role, 'reply')) then
    delete from public.conversation_members cm
    using public.conversations c
    where c.id = cm.conversation_id and c.business_id = old.business_id and cm.user_id = old.user_id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists business_members_sync_conversations on public.business_members;
create trigger business_members_sync_conversations
  after insert or update of role or delete on public.business_members
  for each row execute function public.business_members_sync_conversations();

-- An analyst made before this migration (none: the role is new) would sit in chats; members are re-synced once.
delete from public.conversation_members cm
using public.conversations c, public.business_members m
where c.id = cm.conversation_id and c.business_id = m.business_id and m.user_id = cm.user_id
  and not public.business_role_allows(m.role, 'reply');

-- -----------------------------------------------------------------------------
-- 6. Reviews and the Verified Partner mark, logged and told to the team
-- -----------------------------------------------------------------------------
-- Migration 39's review: approve (the owner's address confirmed), reject, suspend or send back to review. Anything but
-- approval clears the Verified Partner mark, archives the live listings and pauses the deals (and, from part 2 on, the
-- ads). Now also written to the audit log and told to the team.
create or replace function public.admin_review_business(p_business uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_before text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  perform public.require_admin();
  if p_decision not in ('approved', 'rejected', 'suspended', 'pending') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  select owner_id, status into v_owner, v_before from public.businesses where id = p_business;
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
      review_note = v_note,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_business;
  perform set_config('app.business_review', '', true);
  if p_decision <> 'approved' then
    update public.apartments set status = 'archived' where business_id = p_business and status = 'active';
    update public.deals set status = 'paused' where business_id = p_business and status = 'active';
  end if;
  perform public.business_audit_write(p_business, 'admin', 'business_' || p_decision, 'business', p_business,
    jsonb_build_object('from', v_before, 'note', v_note));
  perform public.business_notify_team(p_business, 'business',
    case p_decision
      when 'approved' then 'Your business is approved'
      when 'rejected' then 'Your business was not approved'
      when 'suspended' then 'Your business is suspended'
      else 'Your business is back in review'
    end,
    case p_decision
      when 'approved' then coalesce(v_note, 'Students can now see your profile, posts and listings, and you can run ads.')
      when 'rejected' then coalesce(v_note, 'Update your profile with what the UniBuzz team asked for, then write to them.')
      when 'suspended' then coalesce(v_note, 'Your posts, listings and ads are hidden from students while it lasts.')
      else coalesce(v_note, 'The UniBuzz team is looking at your business again.')
    end,
    '/', jsonb_build_object('decision', p_decision));
end;
$$;

-- Migration 39's Verified Partner mark, logged and told to the team.
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
  perform set_config('app.business_review', '', true);
  perform public.business_audit_write(p_business, 'admin', case when p_verified then 'verified' else 'unverified' end, 'business', p_business,
    case when p_verified then jsonb_build_object('evidence', v_evidence) else '{}'::jsonb end);
  perform public.business_notify_team(p_business, 'business',
    case when p_verified then 'You are a Verified Partner' else 'Verified Partner mark removed' end,
    case when p_verified then 'Students now see the Verified Partner mark on your profile and posts.' else 'Write to the UniBuzz team if you think this is a mistake.' end,
    '/profile', jsonb_build_object('verified', p_verified));
end;
$$;

-- What the owner or an admin changes on the profile goes in the log too (the review functions log their own).
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

drop trigger if exists businesses_audit_profile on public.businesses;
create trigger businesses_audit_profile
  after update on public.businesses
  for each row execute function public.businesses_audit_profile();

-- -----------------------------------------------------------------------------
-- 7. Who may call what
-- -----------------------------------------------------------------------------
revoke all on function public.business_role_allows(text, text) from public, anon, authenticated;
revoke all on function public.business_audit_log_append_only() from public, anon, authenticated;
revoke all on function public.business_audit_write(uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.business_notify_team(uuid, text, text, text, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.businesses_audit_profile() from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.business_role(uuid)', 'public.business_can(uuid, text)', 'public.business_audit(uuid, integer, bigint)',
    'public.business_invite_create(text, text)', 'public.business_invite_revoke(uuid)',
    'public.business_member_set_role(uuid, text)', 'public.business_member_remove(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- The join page reads an invite signed out, as before.
grant execute on function public.business_invite_lookup(text) to anon, authenticated;

notify pgrst, 'reload schema';

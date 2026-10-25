-- =============================================================================
-- Apartment Book - migration 14: staff access for the private /admin section
--   * staff: who works on Apartment Book and with which role
--       owner > admin > moderator  (owners manage the team, admins manage
--       moderators, moderators handle reports and content)
--   * staff_invites: a role promised to an email address that has not finished
--       signing up yet; it is claimed the moment that address is confirmed
--   * staff_audit_log: every administrative action, append-only
--
-- The three tables are closed to the API (RLS on, no policies, no grants).
-- Everything goes through security-definer functions that check, in SQL,
--   (1) that the caller is staff with a high enough role, and
--   (2) that the session passed two-factor authentication: the JWT claim
--       aal = 'aal2', which Supabase Auth sets after a TOTP code is verified,
--       AND a verified factor still exists for the account.
-- The website and the mobile app both call these functions; neither of them
-- is trusted to decide who is staff.
--
-- Hardened after an adversarial audit: invites are never granted to an account
-- that already existed when the invite was written (someone could register the
-- address first and keep their password), invites die with the authority of the
-- person who issued them, bootstrap forgets earlier attempts, the last-owner
-- guard takes a lock and also covers TRUNCATE, two-factor enrolment is recorded
-- by a trigger on auth.mfa_factors instead of being self-reported, and the
-- service role and the log's sequence are closed too.
-- Safe to run more than once, also after migration 15 (it carries the final bodies
-- of the two functions 15 hardens, guarded so this file still works on its own).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.staff (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'moderator')),
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_role_idx on public.staff (role);

create table if not exists public.staff_invites (
  email text primary key check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  role text not null check (role in ('owner', 'admin', 'moderator')),
  invited_by uuid,
  created_at timestamptz not null default now()
);

-- An inviter who deletes their account takes their pending invites with them.
alter table public.staff_invites drop constraint if exists staff_invites_invited_by_fkey;

alter table public.staff_invites add constraint staff_invites_invited_by_fkey
  foreign key (invited_by) references public.profiles (id) on delete cascade;

create table if not exists public.staff_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_audit_log_actor_idx on public.staff_audit_log (actor_id, id desc);

alter table public.staff enable row level security;

alter table public.staff_invites enable row level security;

alter table public.staff_audit_log enable row level security;

revoke all on public.staff, public.staff_invites, public.staff_audit_log from public, anon, authenticated;

-- Supabase also grants new sequences to the API roles; the log's id sequence must not leak row counts or be reset.
revoke all on sequence public.staff_audit_log_id_seq from public, anon, authenticated;

drop trigger if exists staff_set_updated_at on public.staff;

create trigger staff_set_updated_at before update on public.staff
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Internal helpers (not callable through the API)
-- -----------------------------------------------------------------------------
create or replace function public.staff_role_rank(p_role text)
returns int
language sql
immutable
as $$
  select case p_role when 'owner' then 3 when 'admin' then 2 when 'moderator' then 1 else 0 end;
$$;

revoke all on function public.staff_role_rank(text) from public, anon, authenticated;

-- The highest role rank this role may hand out: owners any, admins moderator only.
create or replace function public.staff_grant_rank(p_role text)
returns int
language sql
immutable
as $$
  select case p_role when 'owner' then 3 when 'admin' then 1 else 0 end;
$$;

revoke all on function public.staff_grant_rank(text) from public, anon, authenticated;

-- True when this session verified a second factor (Supabase sets aal = 'aal2')
-- and the account still has a verified factor (a factor deleted in the
-- dashboard revokes access at once, without waiting for the token to expire).
create or replace function public.staff_mfa_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;

revoke all on function public.staff_mfa_verified() from public, anon, authenticated;

-- The caller's staff row, or an error. Every administrative function starts here.
create or replace function public.staff_require(p_min_role text, p_require_mfa boolean default true)
returns public.staff
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row public.staff;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_row from public.staff s where s.user_id = v_me;
  if v_row.user_id is null then
    raise exception 'Not allowed';
  end if;
  -- Migration 15 adds suspensions; a suspended staff member has no staff powers. The nested
  -- IF keeps this file valid on its own: plpgsql resolves is_suspended only when it runs.
  if to_regprocedure('public.is_suspended(uuid)') is not null then
    if public.is_suspended(v_me) then
      raise exception 'Your account is suspended' using errcode = 'P0001', hint = 'ACCOUNT_SUSPENDED';
    end if;
  end if;
  if public.staff_role_rank(v_row.role) < public.staff_role_rank(p_min_role) then
    raise exception 'Not allowed';
  end if;
  if p_require_mfa and not public.staff_mfa_verified() then
    raise exception 'Two-factor authentication required';
  end if;
  return v_row;
end;
$$;

revoke all on function public.staff_require(text, boolean) from public, anon, authenticated;

create or replace function public.staff_log(p_action text, p_target_type text default null, p_target_id text default null, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
  values (
    auth.uid(),
    (select lower(u.email::text) from auth.users u where u.id = auth.uid()),
    p_action,
    p_target_type,
    p_target_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.staff_log(text, text, text, jsonb) from public, anon, authenticated;

-- The id of a *confirmed* account with this email. Unconfirmed sign-ups never
-- count: someone could register an address they do not own and wait.
create or replace function public.staff_confirmed_user(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from auth.users u
  where lower(u.email::text) = lower(btrim(p_email))
    and u.email_confirmed_at is not null
    and exists (select 1 from public.profiles p where p.id = u.id)
  order by u.created_at
  limit 1;
$$;

revoke all on function public.staff_confirmed_user(text) from public, anon, authenticated;

-- An account exists for this address but has never confirmed it.
create or replace function public.staff_unconfirmed_user_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email::text) = lower(btrim(p_email)) and u.email_confirmed_at is null
  );
$$;

revoke all on function public.staff_unconfirmed_user_exists(text) from public, anon, authenticated;

create or replace function public.staff_valid_email(p_email text)
returns boolean
language sql
immutable
as $$
  select p_email is not null
    and char_length(p_email) between 3 and 320
    and p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$$;

revoke all on function public.staff_valid_email(text) from public, anon, authenticated;

-- An invited address may be a non-university one (owners are not always students):
-- the invitation itself lets it sign up, see enforce_university_email below. What an
-- invite must never do is hand a role to an account somebody else already started.
create or replace function public.staff_assert_invitable(p_email text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.staff_unconfirmed_user_exists(p_email) then
    raise exception 'Someone already signed up with this address but has not confirmed it. Once they have confirmed their email and logged in themselves, add them from the list.';
  end if;
end;
$$;

revoke all on function public.staff_assert_invitable(text) from public, anon, authenticated;

-- Sign-ups stay limited to university addresses (migration 2), with one exception:
-- an address that holds a pending staff invitation. Staff are not always students,
-- and the invitation is the deliberate decision to let that person in. The sign-up
-- form still asks students for their university email; invited outsiders use
-- "Continue with Google" or the invitation the dashboard sends.
create or replace function public.enforce_university_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.university_for_email(new.email) is null
     and not exists (select 1 from public.staff_invites i where i.email = lower(btrim(coalesce(new.email::text, '')))) then
    raise exception 'Please sign up with your university email address (for example you@txstate.edu).'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_university_email() from public, anon, authenticated;

-- Remove the pending invites someone issued above what they may grant now
-- (p_max_rank 0 = all of them), logging each.
create or replace function public.staff_revoke_invites_of(p_user uuid, p_max_rank int, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.staff_invites;
begin
  for v_inv in
    delete from public.staff_invites i
    where i.invited_by = p_user and public.staff_role_rank(i.role) > p_max_rank
    returning *
  loop
    perform public.staff_log('invite.revoke', 'email', v_inv.email,
      jsonb_build_object('role', v_inv.role, 'reason', p_reason, 'invited_by', v_inv.invited_by));
  end loop;
end;
$$;

revoke all on function public.staff_revoke_invites_of(uuid, int, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
-- The team can never lose its last owner: not through the admin functions, not
-- through a cascading account deletion, not through the SQL editor by mistake.
-- Owner removals are serialised with a transaction lock so two owners acting at
-- the same instant cannot each remove the other.
create or replace function public.staff_guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    perform pg_advisory_xact_lock(hashtext('public.staff.last_owner'));
    if not exists (select 1 from public.staff s where s.role = 'owner' and s.user_id <> old.user_id) then
      raise exception 'Cannot remove the last owner. Make someone else an owner first.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.staff_guard_last_owner() from public, anon, authenticated;

drop trigger if exists staff_guard_last_owner on public.staff;

create trigger staff_guard_last_owner before update or delete on public.staff
  for each row execute function public.staff_guard_last_owner();

-- Row triggers do not fire on TRUNCATE; refuse it outright (also stops
-- `truncate profiles cascade` and `truncate auth.users cascade`).
create or replace function public.staff_guard_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'staff cannot be truncated: it holds the owners of Apartment Book';
end;
$$;

revoke all on function public.staff_guard_truncate() from public, anon, authenticated;

drop trigger if exists staff_guard_truncate on public.staff;

create trigger staff_guard_truncate before truncate on public.staff
  for each statement execute function public.staff_guard_truncate();

-- Every removal from the team is logged here, whichever path removed the row:
-- an admin, the person deleting their own account, or a deletion in the dashboard.
create or replace function public.staff_log_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_deleting text := nullif(current_setting('staff.deleting_email', true), '');
begin
  insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
  values (
    v_actor,
    coalesce((select lower(u.email::text) from auth.users u where u.id = v_actor), case when v_actor = old.user_id then v_deleting end),
    'staff.remove', 'user', old.user_id::text,
    jsonb_build_object(
      'email', coalesce((select lower(u.email::text) from auth.users u where u.id = old.user_id), v_deleting),
      'role', old.role,
      'cause', case when v_actor = old.user_id then 'account_deleted' when v_actor is null then 'cascade' else 'admin' end
    )
  );
  return old;
end;
$$;

revoke all on function public.staff_log_delete() from public, anon, authenticated;

drop trigger if exists staff_log_delete on public.staff;

create trigger staff_log_delete after delete on public.staff
  for each row execute function public.staff_log_delete();

-- An invited address becomes staff when (and only when) it is confirmed, the
-- account did not exist before the invite, and the inviter still holds a role
-- able to grant it. Anything else is held and logged for an owner to look at.
create or replace function public.staff_claim_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(new.email::text);
  v_inv public.staff_invites;
  v_inviter_role text;
  v_removed text[];
begin
  if new.email_confirmed_at is null or v_email is null then
    return new;
  end if;
  select * into v_inv from public.staff_invites i where i.email = v_email;
  if v_inv.email is null then
    return new;
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.id) then
    return new; -- profile not created yet; the invite stays and can be applied from /admin/staff
  end if;
  -- The account predates the invite: whoever registered it may not be the person
  -- we meant (Supabase keeps the first password when a sign-up is repeated).
  -- Not for an email change: that needs the account's session AND a click in
  -- the new mailbox, so the same person holds both.
  if coalesce(tg_argv[0], '') <> 'email_change' and new.created_at < v_inv.created_at then
    insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
    values (null, null, 'invite.held', 'user', new.id::text,
      jsonb_build_object('email', v_email, 'role', v_inv.role, 'reason', 'account predates invite'));
    return new;
  end if;
  if v_inv.invited_by is not null then
    select s.role into v_inviter_role from public.staff s where s.user_id = v_inv.invited_by;
    if v_inviter_role is null or public.staff_grant_rank(v_inviter_role) < public.staff_role_rank(v_inv.role) then
      delete from public.staff_invites where email = v_email;
      insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
      values (null, null, 'invite.revoke', 'email', v_email,
        jsonb_build_object('role', v_inv.role, 'reason', 'inviter no longer able to grant this role', 'invited_by', v_inv.invited_by));
      return new;
    end if;
  end if;
  insert into public.staff (user_id, role, granted_by)
  values (new.id, v_inv.role, v_inv.invited_by)
  on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by;
  delete from public.staff_invites where email = v_email;
  insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
  values (null, null, 'invite.accepted', 'user', new.id::text,
    jsonb_build_object('email', v_email, 'role', v_inv.role, 'invited_by', v_inv.invited_by));
  -- The first owner has arrived: forget other bootstrap attempts (mistyped addresses).
  if v_inv.invited_by is null and v_inv.role = 'owner' then
    with d as (delete from public.staff_invites i where i.role = 'owner' and i.invited_by is null returning i.email)
    select array_agg(d.email) into v_removed from d;
    if v_removed is not null then
      insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
      values (null, null, 'invite.revoke', 'email', array_to_string(v_removed, ','),
        jsonb_build_object('role', 'owner', 'reason', 'bootstrap superseded'));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.staff_claim_invite() from public, anon, authenticated;

-- Named after on_auth_user_created so the profile row exists first (same-event triggers fire by name).
drop trigger if exists staff_claim_invite_on_insert on auth.users;

create trigger staff_claim_invite_on_insert after insert on auth.users
  for each row when (new.email_confirmed_at is not null)
  execute function public.staff_claim_invite();

drop trigger if exists staff_claim_invite_on_confirm on auth.users;

create trigger staff_claim_invite_on_confirm after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.staff_claim_invite();

-- A confirmed user who changes their address to an invited one (Supabase writes
-- the new address only after it has been verified).
drop trigger if exists staff_claim_invite_on_email_change on auth.users;

create trigger staff_claim_invite_on_email_change after update of email on auth.users
  for each row when (new.email_confirmed_at is not null and old.email is distinct from new.email)
  execute function public.staff_claim_invite('email_change');

-- Two-factor enrolment and removal are recorded from Supabase Auth's own table,
-- so the log cannot be flooded or forged from a session that only has a password.
create or replace function public.staff_mfa_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_action text;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
    if old.status::text = 'verified' then
      v_action := 'security.mfa_removed';
    end if;
  else
    v_user := new.user_id;
    if new.status::text = 'verified' and (tg_op = 'INSERT' or old.status::text is distinct from 'verified') then
      v_action := 'security.mfa_enrolled';
    end if;
  end if;
  if v_action is not null and exists (select 1 from public.staff s where s.user_id = v_user) then
    insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
    values (
      coalesce(auth.uid(), v_user),
      (select lower(u.email::text) from auth.users u where u.id = coalesce(auth.uid(), v_user)),
      v_action, 'user', v_user::text,
      jsonb_build_object(
        'factor_type', case when tg_op = 'DELETE' then old.factor_type::text else new.factor_type::text end,
        'friendly_name', case when tg_op = 'DELETE' then old.friendly_name else new.friendly_name end
      )
    );
  end if;
  return null;
exception when others then
  return null; -- never get in the way of Supabase Auth
end;
$$;

revoke all on function public.staff_mfa_audit() from public, anon, authenticated;

drop trigger if exists staff_mfa_audit on auth.mfa_factors;

create trigger staff_mfa_audit after insert or update of status or delete on auth.mfa_factors
  for each row execute function public.staff_mfa_audit();

-- The old self-reported event RPC is gone: it could be called without a second factor.
drop function if exists public.admin_note_security_event(text);

-- -----------------------------------------------------------------------------
-- First owner. Only runnable as the database owner (SQL editor, setup script):
-- it is revoked from every API role. Refuses to run once an owner exists.
-- -----------------------------------------------------------------------------
create or replace function public.admin_bootstrap_owner(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
  v_removed text[];
begin
  if not public.staff_valid_email(v_email) then
    raise exception 'Enter a valid email address';
  end if;
  v_user := public.staff_confirmed_user(v_email);
  if v_user is not null and exists (select 1 from public.staff s where s.user_id = v_user and s.role = 'owner') then
    return 'already owner';
  end if;
  if exists (select 1 from public.staff s where s.role = 'owner') then
    raise exception 'An owner already exists. Add more owners from /admin/staff.';
  end if;
  if v_user is null and public.staff_unconfirmed_user_exists(v_email) then
    raise exception 'This address has signed up but has not confirmed its email yet. Confirm it, then run this again.';
  end if;
  -- Forget earlier bootstrap attempts for other addresses.
  with d as (delete from public.staff_invites i where i.role = 'owner' and i.invited_by is null and i.email <> v_email returning i.email)
  select array_agg(d.email) into v_removed from d;
  if v_removed is not null then
    perform public.staff_log('invite.revoke', 'email', array_to_string(v_removed, ','),
      jsonb_build_object('role', 'owner', 'reason', 'bootstrap superseded', 'by', v_email));
  end if;
  if v_user is not null then
    insert into public.staff (user_id, role, granted_by) values (v_user, 'owner', null)
    on conflict (user_id) do update set role = 'owner', granted_by = null;
    delete from public.staff_invites where email = v_email;
    perform public.staff_log('owner.bootstrap', 'user', v_user::text, jsonb_build_object('email', v_email));
    return 'added';
  end if;
  insert into public.staff_invites (email, role, invited_by) values (v_email, 'owner', null)
  on conflict (email) do update set role = 'owner', invited_by = null, created_at = now();
  perform public.staff_log('owner.bootstrap', 'email', v_email, jsonb_build_object('pending', true));
  return 'invited';
end;
$$;

revoke all on function public.admin_bootstrap_owner(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPCs used by the website and the mobile app (authenticated only)
-- -----------------------------------------------------------------------------
-- Who am I to the admin section? No rows for ordinary users. Callable without
-- a second factor so the UI can send staff to the two-factor setup page.
drop function if exists public.admin_me();

create function public.admin_me()
returns table (user_id uuid, role text, mfa_verified boolean, mfa_enrolled boolean, last_owner boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, s.role, public.staff_mfa_verified(),
    exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified'),
    s.role = 'owner' and not exists (select 1 from public.staff o where o.role = 'owner' and o.user_id <> s.user_id)
  from public.staff s
  where s.user_id = auth.uid();
$$;

revoke all on function public.admin_me() from public, anon;

grant execute on function public.admin_me() to authenticated;

-- Moderators see the team but not who among the owners and admins lacks a
-- second factor (that is a target list); they do see their own row.
create or replace function public.admin_staff_list()
returns table (
  user_id uuid, email text, full_name text, avatar_url text, role text,
  granted_by uuid, granted_by_name text, created_at timestamptz, mfa_enrolled boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
begin
  v_caller := public.staff_require('moderator');
  return query
    select s.user_id, lower(u.email::text), p.full_name, p.avatar_url, s.role,
      s.granted_by, g.full_name, s.created_at,
      case when v_caller.role <> 'moderator' or s.user_id = v_caller.user_id
        then exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified')
      end
    from public.staff s
    join public.profiles p on p.id = s.user_id
    left join auth.users u on u.id = s.user_id
    left join public.profiles g on g.id = s.granted_by
    order by public.staff_role_rank(s.role) desc, s.created_at asc, s.user_id;
end;
$$;

revoke all on function public.admin_staff_list() from public, anon;

grant execute on function public.admin_staff_list() to authenticated;

-- Pending invites name addresses that are about to get power: admins and owners only.
create or replace function public.admin_invites_list()
returns table (email text, role text, invited_by uuid, invited_by_name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require('admin');
  return query
    select i.email, i.role, i.invited_by, g.full_name, i.created_at
    from public.staff_invites i
    left join public.profiles g on g.id = i.invited_by
    order by i.created_at desc, i.email;
end;
$$;

revoke all on function public.admin_invites_list() from public, anon;

grant execute on function public.admin_invites_list() to authenticated;

-- Add someone to the team by email. Owners may grant any role; admins only
-- 'moderator'. A confirmed account is added at once ('added'); an address with
-- no account gets an invite that is claimed when it is confirmed ('invited').
-- Make sure the person has logged in to Apartment Book themselves before adding
-- a confirmed account: the role goes to whoever holds that account's password.
create or replace function public.admin_staff_add(p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_email text := lower(btrim(p_email));
  v_target uuid;
  v_invite_role text;
begin
  v_caller := public.staff_require('admin');
  if not public.staff_valid_email(v_email) then
    raise exception 'Enter a valid email address';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'moderator') then
    raise exception 'Invalid role';
  end if;
  if public.staff_grant_rank(v_caller.role) < public.staff_role_rank(p_role) then
    raise exception 'Not allowed';
  end if;
  v_target := public.staff_confirmed_user(v_email);
  if v_target = v_caller.user_id then
    raise exception 'You cannot change your own role';
  end if;
  if v_target is not null and exists (select 1 from public.staff s where s.user_id = v_target) then
    raise exception 'This person is already on the team. Change their role in the list instead.';
  end if;
  select i.role into v_invite_role from public.staff_invites i where i.email = v_email;
  if v_invite_role is not null and public.staff_grant_rank(v_caller.role) < public.staff_role_rank(v_invite_role) then
    raise exception 'Not allowed';
  end if;
  if v_target is not null then
    insert into public.staff (user_id, role, granted_by) values (v_target, p_role, v_caller.user_id);
    delete from public.staff_invites where email = v_email;
    perform public.staff_log('staff.add', 'user', v_target::text, jsonb_build_object('email', v_email, 'role', p_role));
    return 'added';
  end if;
  perform public.staff_assert_invitable(v_email);
  insert into public.staff_invites (email, role, invited_by) values (v_email, p_role, v_caller.user_id)
  on conflict (email) do update set role = excluded.role, invited_by = excluded.invited_by, created_at = now();
  perform public.staff_log('invite.create', 'email', v_email, jsonb_build_object('role', p_role));
  return 'invited';
end;
$$;

revoke all on function public.admin_staff_add(text, text) from public, anon;

grant execute on function public.admin_staff_add(text, text) to authenticated;

-- Change a team member's role. Owners may change anyone but themselves; admins
-- may only touch moderators (so, in effect, remove them). The write re-asserts
-- the role that was checked, in case it changed a moment earlier.
create or replace function public.admin_staff_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_existing public.staff;
  v_email text;
begin
  v_caller := public.staff_require('admin');
  if p_role is null or p_role not in ('owner', 'admin', 'moderator') then
    raise exception 'Invalid role';
  end if;
  if p_user_id is null or p_user_id = v_caller.user_id then
    raise exception 'You cannot change your own role';
  end if;
  select * into v_existing from public.staff s where s.user_id = p_user_id;
  if v_existing.user_id is null then
    raise exception 'Not a staff member';
  end if;
  if public.staff_grant_rank(v_caller.role) < public.staff_role_rank(v_existing.role)
     or public.staff_grant_rank(v_caller.role) < public.staff_role_rank(p_role) then
    raise exception 'Not allowed';
  end if;
  if v_existing.role = p_role then
    return;
  end if;
  update public.staff set role = p_role, granted_by = v_caller.user_id
  where user_id = p_user_id and role = v_existing.role;
  if not found then
    raise exception 'This person''s role just changed. Reload and try again.';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = p_user_id;
  perform public.staff_log('staff.role', 'user', p_user_id::text,
    jsonb_build_object('email', v_email, 'from', v_existing.role, 'to', p_role));
  -- A demoted person's pending invites must not outrank what they may grant now.
  if public.staff_role_rank(p_role) < public.staff_role_rank(v_existing.role) then
    perform public.staff_revoke_invites_of(p_user_id, public.staff_grant_rank(p_role), 'inviter demoted');
  end if;
end;
$$;

revoke all on function public.admin_staff_set_role(uuid, text) from public, anon;

grant execute on function public.admin_staff_set_role(uuid, text) to authenticated;

-- Removing someone also withdraws every invite they issued. The removal itself
-- is logged by the staff_log_delete trigger.
create or replace function public.admin_staff_remove(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_existing public.staff;
begin
  v_caller := public.staff_require('admin');
  if p_user_id is null or p_user_id = v_caller.user_id then
    raise exception 'You cannot remove yourself';
  end if;
  select * into v_existing from public.staff s where s.user_id = p_user_id;
  if v_existing.user_id is null then
    raise exception 'Not a staff member';
  end if;
  if public.staff_grant_rank(v_caller.role) < public.staff_role_rank(v_existing.role) then
    raise exception 'Not allowed';
  end if;
  perform public.staff_revoke_invites_of(p_user_id, 0, 'inviter removed');
  delete from public.staff where user_id = p_user_id and role = v_existing.role;
  if not found then
    raise exception 'This person''s role just changed. Reload and try again.';
  end if;
end;
$$;

revoke all on function public.admin_staff_remove(uuid) from public, anon;

grant execute on function public.admin_staff_remove(uuid) to authenticated;

create or replace function public.admin_invite_revoke(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_email text := lower(btrim(p_email));
  v_role text;
begin
  v_caller := public.staff_require('admin');
  select i.role into v_role from public.staff_invites i where i.email = v_email;
  if v_role is null then
    raise exception 'No invitation for that address';
  end if;
  if public.staff_grant_rank(v_caller.role) < public.staff_role_rank(v_role) then
    raise exception 'Not allowed';
  end if;
  delete from public.staff_invites where email = v_email;
  perform public.staff_log('invite.revoke', 'email', v_email, jsonb_build_object('role', v_role));
end;
$$;

revoke all on function public.admin_invite_revoke(text) from public, anon;

grant execute on function public.admin_invite_revoke(text) to authenticated;

-- Newest first; pass the smallest id you have as p_before to load older rows.
-- Moderators see moderation activity and their own actions, not the team's
-- membership and security history.
create or replace function public.admin_audit_list(p_limit int default 50, p_before bigint default null)
returns table (
  id bigint, actor_id uuid, actor_email text, actor_name text, action text,
  target_type text, target_id text, details jsonb, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
begin
  v_caller := public.staff_require('moderator');
  return query
    select l.id, l.actor_id, l.actor_email, p.full_name, l.action, l.target_type, l.target_id,
      -- A deleted Buzz thread's record names its author; moderators see the text, not the identity.
      case when v_caller.role = 'moderator' and l.action = 'content.delete' and l.target_type in ('buzz', 'buzz_comment')
        then (l.details - 'children') || jsonb_build_object('snapshot', coalesce(l.details -> 'snapshot', '{}'::jsonb) - 'author_id' - 'author_name' - 'author_email')
        else l.details end,
      l.created_at
    from public.staff_audit_log l
    left join public.profiles p on p.id = l.actor_id
    where (p_before is null or l.id < p_before)
      and (v_caller.role <> 'moderator'
           or l.actor_id = v_caller.user_id
           or l.action like 'content.%' or l.action like 'report.%' or l.action like 'user.%' or l.action like 'media.%')
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_audit_list(int, bigint) from public, anon;

grant execute on function public.admin_audit_list(int, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- Account deletion for staff: a second factor is required (a stolen password
-- must not be enough to make a colleague disappear), and the only owner is told
-- what to do before anything is removed.
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_me uuid := auth.uid();
  v_email text;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  -- Migration 15: a suspended account may not delete itself (the restriction would go with it).
  if to_regprocedure('public.is_suspended(uuid)') is not null then
    if public.is_suspended(v_me) then
      raise exception 'Your account is suspended. Contact support to delete it.' using errcode = 'P0001', hint = 'ACCOUNT_SUSPENDED';
    end if;
  end if;
  if exists (select 1 from public.staff s where s.user_id = v_me) then
    if not public.staff_mfa_verified() then
      raise exception 'Two-factor authentication required';
    end if;
    if exists (select 1 from public.staff s where s.user_id = v_me and s.role = 'owner')
       and not exists (select 1 from public.staff s where s.role = 'owner' and s.user_id <> v_me) then
      raise exception 'You are the only owner of Apartment Book. Make someone else an owner in /admin/staff before deleting your account.';
    end if;
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = v_me;
  perform set_config('staff.deleting_email', coalesce(v_email, ''), true);
  delete from auth.users where id = v_me;
end;
$$;

-- -----------------------------------------------------------------------------
-- The service role (server-side key) gets everything in public by default on
-- Supabase; the staff tables and the owner bootstrap are for the database owner only.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.staff, public.staff_invites, public.staff_audit_log from service_role;
    revoke all on sequence public.staff_audit_log_id_seq from service_role;
    revoke all on function
      public.admin_bootstrap_owner(text), public.staff_require(text, boolean), public.staff_log(text, text, text, jsonb),
      public.staff_confirmed_user(text), public.staff_unconfirmed_user_exists(text), public.staff_mfa_verified(),
      public.staff_role_rank(text), public.staff_grant_rank(text), public.staff_valid_email(text),
      public.staff_assert_invitable(text), public.staff_revoke_invites_of(uuid, int, text),
      public.staff_guard_last_owner(), public.staff_guard_truncate(), public.staff_log_delete(),
      public.staff_claim_invite(), public.staff_mfa_audit()
      from service_role;
  end if;
end $$;

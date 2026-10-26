-- =============================================================================
-- Migration 18: staff invitations sent by email (CampConnect Admin)
-- =============================================================================
-- Until now an invitation was only a row in staff_invites: nothing was sent, and
-- the role went to whichever account confirmed that address first. From here:
--
--   * The admin app asks Supabase Auth to send the invitation (inviteUserByEmail,
--     through the project's SMTP). That creates the invitee's account at once,
--     without a password, and the link in the email confirms it.
--   * admin_invite_email_result() records what happened (sent / failed, when,
--     how often, the error) and BINDS the invitation to the account the email
--     created. A bound invitation is claimed by that account only: someone who
--     signs up with the same address can never take it (their password would
--     otherwise survive the real person's confirmation).
--   * Invitations expire after 7 days (expires_at). An expired invitation is not
--     claimed (logged as invite.expired) and stays listed until it is re-sent or
--     withdrawn. admin_invite_resend() renews it. The first-owner bootstrap
--     (invited_by is null) keeps its old behaviour and does not expire.
--   * Withdrawing a bound invitation also deletes the account its email created,
--     provided nobody has confirmed or used it, so an old link cannot leave a
--     non-university account behind.
--
-- Everything else is unchanged: admin+ and aal2 for every function, admins
-- manage moderator invitations only, the inviter must still hold a role able to
-- grant it, an account older than the invitation is held, and every step is in
-- staff_audit_log. Only functions from migration 14 are replaced; main's
-- enforce_university_email() and handle_new_user() are not touched.
-- Safe to re-run.
-- =============================================================================

alter table public.staff_invites
  add column if not exists expires_at timestamptz not null default (now() + interval '7 days'),
  add column if not exists email_status text not null default 'not_sent',
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_attempts int not null default 0,
  add column if not exists email_error text,
  add column if not exists auth_user_id uuid;
alter table public.staff_invites drop constraint if exists staff_invites_email_status_check;
alter table public.staff_invites add constraint staff_invites_email_status_check check (email_status in ('not_sent', 'sent', 'failed'));
alter table public.staff_invites drop constraint if exists staff_invites_email_error_check;
alter table public.staff_invites add constraint staff_invites_email_error_check check (email_error is null or char_length(email_error) <= 500);

-- An unconfirmed account with this address that someone created by signing up (not by an invitation email).
create or replace function public.staff_stranger_signup_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email::text) = lower(btrim(p_email)) and u.email_confirmed_at is null and u.invited_at is null
  );
$$;
revoke all on function public.staff_stranger_signup_exists(text) from public, anon, authenticated;

-- The caller (admin+, aal2) and the invitation they may act on: owners any, admins moderator ones only.
create or replace function public.staff_invite_for_caller(p_email text)
returns public.staff_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_inv public.staff_invites;
begin
  v_caller := public.staff_require('admin');
  select * into v_inv from public.staff_invites i where i.email = lower(btrim(coalesce(p_email, '')));
  if v_inv.email is null then
    raise exception 'No invitation for that address';
  end if;
  if public.staff_grant_rank(v_caller.role) < public.staff_role_rank(v_inv.role) then
    raise exception 'Not allowed';
  end if;
  return v_inv;
end;
$$;
revoke all on function public.staff_invite_for_caller(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claiming: bound invitations go to their own account only; expired ones wait
-- ---------------------------------------------------------------------------
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
    return new; -- profile not created yet; the invite stays and can be applied from the Staff page
  end if;
  -- An invitation sent by email belongs to the account that email created. Any other
  -- account with this address (a sign-up made around it) is held, never promoted.
  if v_inv.auth_user_id is not null and v_inv.auth_user_id <> new.id then
    insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
    values (null, null, 'invite.held', 'user', new.id::text,
      jsonb_build_object('email', v_email, 'role', v_inv.role, 'reason', 'not the account the invitation email created'));
    return new;
  end if;
  -- Expired: nothing is granted; the row stays so an admin sees it and can re-send it.
  if v_inv.invited_by is not null and v_inv.expires_at < now() then
    insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
    values (null, null, 'invite.expired', 'user', new.id::text,
      jsonb_build_object('email', v_email, 'role', v_inv.role, 'expired_at', v_inv.expires_at));
    return new;
  end if;
  -- The account predates the invite: whoever registered it may not be the person
  -- we meant (Supabase keeps the first password when a sign-up is repeated).
  -- Not for an email change: that needs the account's session AND a click in
  -- the new mailbox, so the same person holds both. Not for the account the
  -- invitation email itself created (bound above).
  if coalesce(tg_argv[0], '') <> 'email_change' and v_inv.auth_user_id is distinct from new.id and new.created_at < v_inv.created_at then
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
    jsonb_build_object('email', v_email, 'role', v_inv.role, 'invited_by', v_inv.invited_by,
      'via', case when v_inv.auth_user_id is not null then 'email link' else 'sign-up' end));
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

-- ---------------------------------------------------------------------------
-- Adding: a pending invitation whose email already created an account can have
-- its role changed (that account is the invitation's own, not a stranger's
-- unconfirmed sign-up); a fresh or renewed invitation gets a new 7-day window.
-- ---------------------------------------------------------------------------
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
  v_invite public.staff_invites;
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
  select * into v_invite from public.staff_invites i where i.email = v_email;
  if v_invite.email is not null and public.staff_grant_rank(v_caller.role) < public.staff_role_rank(v_invite.role) then
    raise exception 'Not allowed';
  end if;
  if v_target is not null then
    insert into public.staff (user_id, role, granted_by) values (v_target, p_role, v_caller.user_id);
    delete from public.staff_invites where email = v_email;
    perform public.staff_log('staff.add', 'user', v_target::text, jsonb_build_object('email', v_email, 'role', p_role));
    return 'added';
  end if;
  -- A stranger's own unconfirmed sign-up blocks the invitation (Supabase would keep their
  -- password). An unconfirmed account created by an invitation email (invited_at set, which
  -- only the service role can do) does not: it is this invitation's, or becomes it when bound.
  if public.staff_stranger_signup_exists(v_email) then
    perform public.staff_assert_invitable(v_email);
  end if;
  insert into public.staff_invites (email, role, invited_by) values (v_email, p_role, v_caller.user_id)
  on conflict (email) do update set
    role = excluded.role,
    invited_by = excluded.invited_by,
    expires_at = now() + interval '7 days',
    -- As before, a re-invitation counts from now, unless its email already created the
    -- account (that account is younger than the first invitation, and bound to it).
    created_at = case when staff_invites.auth_user_id is null then now() else staff_invites.created_at end;
  perform public.staff_log('invite.create', 'email', v_email, jsonb_build_object('role', p_role));
  return 'invited';
end;
$$;
revoke all on function public.admin_staff_add(text, text) from public, anon;
grant execute on function public.admin_staff_add(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What happened to the email. p_user_id (when sent) must be the account Supabase
-- created for this very address by an invitation, not yet confirmed: binding is
-- checked here, not taken on trust from the caller.
-- ---------------------------------------------------------------------------
create or replace function public.admin_invite_email_result(p_email text, p_ok boolean, p_user_id uuid default null, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.staff_invites := public.staff_invite_for_caller(p_email);
  v_bind uuid;
begin
  if p_ok then
    if p_user_id is not null then
      select u.id into v_bind from auth.users u
      where u.id = p_user_id and lower(u.email::text) = v_inv.email and u.email_confirmed_at is null and u.invited_at is not null;
      if v_bind is null then
        raise exception 'That account does not belong to this invitation';
      end if;
      if v_inv.auth_user_id is not null and v_inv.auth_user_id <> v_bind then
        raise exception 'This invitation is already bound to another account';
      end if;
    end if;
    update public.staff_invites
    set email_status = 'sent', email_sent_at = now(), email_attempts = email_attempts + 1, email_error = null,
        auth_user_id = coalesce(v_bind, auth_user_id)
    where email = v_inv.email;
    perform public.staff_log('invite.email_sent', 'email', v_inv.email, jsonb_build_object('role', v_inv.role, 'attempt', v_inv.email_attempts + 1));
  else
    update public.staff_invites
    set email_status = 'failed', email_attempts = email_attempts + 1,
        email_error = left(coalesce(nullif(btrim(p_error), ''), 'The email could not be sent'), 500)
    where email = v_inv.email;
    perform public.staff_log('invite.email_failed', 'email', v_inv.email,
      jsonb_build_object('role', v_inv.role, 'error', left(coalesce(nullif(btrim(p_error), ''), 'The email could not be sent'), 200)));
  end if;
end;
$$;
revoke all on function public.admin_invite_email_result(text, boolean, uuid, text) from public, anon;
grant execute on function public.admin_invite_email_result(text, boolean, uuid, text) to authenticated;

-- Renew a pending invitation for another 7 days before its email is sent again. Returns its role.
create or replace function public.admin_invite_resend(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.staff_invites := public.staff_invite_for_caller(p_email);
begin
  -- A stranger's unconfirmed sign-up with this address blocks it, exactly as when adding.
  if public.staff_stranger_signup_exists(v_inv.email) then
    perform public.staff_assert_invitable(v_inv.email);
  end if;
  update public.staff_invites set expires_at = now() + interval '7 days' where email = v_inv.email;
  perform public.staff_log('invite.resend', 'email', v_inv.email, jsonb_build_object('role', v_inv.role, 'was_expired', v_inv.expires_at < now()));
  return v_inv.role;
end;
$$;
revoke all on function public.admin_invite_resend(text) from public, anon;
grant execute on function public.admin_invite_resend(text) to authenticated;

-- Withdraw an invitation, and with it the account its email created if nobody has
-- confirmed or used it (an old link then leads nowhere). Returns whether an account went.
drop function if exists public.admin_invite_revoke(text);
create function public.admin_invite_revoke(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inv public.staff_invites := public.staff_invite_for_caller(p_email);
  v_removed boolean := false;
begin
  delete from public.staff_invites where email = v_inv.email;
  if v_inv.auth_user_id is not null then
    delete from auth.users u
    where u.id = v_inv.auth_user_id and lower(u.email::text) = v_inv.email
      and u.email_confirmed_at is null and u.invited_at is not null and u.last_sign_in_at is null
      and not exists (select 1 from public.staff s where s.user_id = u.id);
    v_removed := found;
  end if;
  perform public.staff_log('invite.revoke', 'email', v_inv.email, jsonb_build_object('role', v_inv.role, 'account_removed', v_removed));
  return v_removed;
end;
$$;
revoke all on function public.admin_invite_revoke(text) from public, anon;
grant execute on function public.admin_invite_revoke(text) to authenticated;

-- The pending list, now with the email and expiry state (admin+, aal2).
drop function if exists public.admin_invites_list();
create function public.admin_invites_list()
returns table (
  email text, role text, invited_by uuid, invited_by_name text, created_at timestamptz,
  expires_at timestamptz, expired boolean, email_status text, email_sent_at timestamptz, email_attempts int, email_error text,
  account_created boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require('admin');
  return query
    select i.email, i.role, i.invited_by, g.full_name, i.created_at,
      case when i.invited_by is null then null else i.expires_at end,
      i.invited_by is not null and i.expires_at < now(),
      i.email_status, i.email_sent_at, i.email_attempts, i.email_error,
      i.auth_user_id is not null
    from public.staff_invites i
    left join public.profiles g on g.id = i.invited_by
    order by i.created_at desc, i.email;
end;
$$;
revoke all on function public.admin_invites_list() from public, anon;
grant execute on function public.admin_invites_list() to authenticated;

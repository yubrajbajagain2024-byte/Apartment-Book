-- =============================================================================
-- Apartment Book - migration 15: database support for moderation
--   * account_restrictions: suspensions with a reason the person sees, a note
--       only staff see, and an optional end date
--   * hidden_at / hidden_reason on every kind of content: reversible removal,
--       kept apart from permanent deletion (a separate, admin-only action)
--   * reports: who reviewed, what they decided, their notes, when
--   * media_jobs: the files and videos the database cannot touch itself
--
-- Three layers, because the website and the mobile app both talk to Supabase
-- directly with the user's own token, so anything the database allows, a user
-- can do with curl:
--   (1) Enforcement lives in row level security and triggers. A suspended
--       account cannot insert or update content, messages, media or storage
--       objects the moment the suspension is saved, not at its next login
--       (auth.users.banned_until takes care of that too). Hidden content and
--       the content of suspended accounts disappear from every select, feed
--       function and search, except for its own author, who still sees it
--       with the reason.
--   (2) Staff act through security-definer functions that start with
--       staff_require() (role + second factor) and end with staff_log(): who
--       changed what and why is always on record.
--   (3) Photos live in a PUBLIC bucket and videos on Mux, both outside the
--       reach of SQL. Hiding, restoring and deleting therefore QUEUE media jobs
--       that an app-side worker performs with the service role and retries.
--
-- Buzz stays anonymous: a suspension never changes what Buzz shows (a suspect's
-- threads vanishing together would reveal their author); only individual hides
-- apply, and staff see a Buzz author only through admin_content_get, logged.
-- The staff functions in section B call the queue helpers of section D; they
-- are plpgsql, so the order in this file does not matter to Postgres.
-- Safe to run more than once. Do NOT re-run an OLDER migration after this one by
-- hand: 11-13 recreate the Buzz functions, reels_feed and the upload policies with
-- their older bodies, which would drop the hidden_at/suspension rules below (the
-- setup script only ever applies migrations that have not been applied yet).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Account restrictions
-- -----------------------------------------------------------------------------
create table if not exists public.account_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'suspension' check (kind in ('suspension')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),          -- shown to the person
  internal_note text check (internal_note is null or char_length(internal_note) <= 2000), -- staff only
  expires_at timestamptz,                                                                -- null = until lifted
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references public.profiles (id) on delete set null,
  lift_note text check (lift_note is null or char_length(lift_note) <= 2000)
);

-- One open row per person; an expired row is closed (lifted_at = its end) before a new one is added.
create unique index if not exists account_restrictions_active_idx on public.account_restrictions (user_id) where lifted_at is null;

alter table public.account_restrictions enable row level security;

revoke all on public.account_restrictions from public, anon, authenticated;

-- Is this account suspended right now? Runs inside policies as the caller, so
-- every API role may execute it; it reveals nothing but a boolean.
create or replace function public.is_suspended(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (
    select 1 from public.account_restrictions r
    where r.user_id = p_user
      and r.lifted_at is null
      and (r.expires_at is null or r.expires_at > now())
  );
$$;

revoke all on function public.is_suspended(uuid) from public;

grant execute on function public.is_suspended(uuid) to anon, authenticated;

-- May the caller see this row? Its author always can (with the reason, so the
-- apps can say "Hidden by moderators"); everyone else only while it is not
-- hidden and its author is not suspended.
create or replace function public.content_visible(p_author uuid, p_hidden_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_author = auth.uid(), false)
    or (p_hidden_at is null and not public.is_suspended(p_author));
$$;

revoke all on function public.content_visible(uuid, timestamptz) from public;

grant execute on function public.content_visible(uuid, timestamptz) to anon, authenticated;

-- Suspended accounts cannot write. Fires before the row is checked against any
-- policy, and inside the security-definer RPCs too (buzz_create, buzz_reply,
-- get_or_create_direct_conversation...), because auth.uid() is still the caller.
-- The hint lets the apps recognise the case and show the restriction notice.
create or replace function public.block_suspended_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and public.is_suspended(auth.uid()) then
    raise exception 'Your account is suspended' using errcode = 'P0001', hint = 'ACCOUNT_SUSPENDED';
  end if;
  return new;
end;
$$;

revoke all on function public.block_suspended_writes() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'apartments', 'roommate_posts', 'items', 'feed_posts', 'messages', 'post_comments', 'post_likes', 'conversations',
    'buzz_posts', 'buzz_comments', 'buzz_votes', 'buzz_comment_votes', 'media', 'universities'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_block_suspended', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.block_suspended_writes()', t || '_block_suspended', t);
  end loop;
  -- Read receipts are updates on conversation_members: those keep working.
  execute 'drop trigger if exists conversation_members_block_suspended on public.conversation_members';
  execute 'create trigger conversation_members_block_suspended before insert on public.conversation_members for each row execute function public.block_suspended_writes()';
end $$;

-- ...but a membership row must stay in its conversation. The original policy only
-- checked user_id, and a bare `update conversation_members set conversation_id = X`
-- (no WHERE, no RETURNING, so no select policy is consulted) moved the caller's
-- row into any conversation whose id they knew, history included.
-- is_conversation_member() sees the pre-update row, so a read receipt passes.
drop policy if exists "conversation_members_update_own" on public.conversation_members;

create policy "conversation_members_update_own" on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid()));

-- Saving a listing stays allowed (a private bookmark), but it no longer pings the
-- owner: "<Name> saved your listing" was the last way a suspended account's name
-- could reach someone else's inbox.
create or replace function public.notify_on_saved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_link text;
  v_saver text;
begin
  if public.is_suspended(new.user_id) then
    return new;
  end if;
  if new.target_type = 'apartment' then
    select owner_id, title into v_owner, v_title from public.apartments where id = new.target_id;
    v_link := '/apartments/' || new.target_id;
  elsif new.target_type = 'item' then
    select seller_id, title into v_owner, v_title from public.items where id = new.target_id;
    v_link := '/marketplace/' || new.target_id;
  elsif new.target_type = 'roommate' then
    select author_id, title into v_owner, v_title from public.roommate_posts where id = new.target_id;
    v_link := '/roommates/' || new.target_id;
  end if;
  if v_owner is null then
    return new;
  end if;
  select full_name into v_saver from public.profiles where id = new.user_id;
  perform public.notify(
    v_owner, new.user_id, 'listing_saved',
    coalesce(v_saver, 'Someone') || ' saved your listing', v_title, v_link,
    jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id),
    'saved:' || new.target_type || ':' || new.target_id
  );
  return new;
end;
$$;

revoke all on function public.notify_on_saved() from public, anon, authenticated;

-- Profiles: no trigger; the policy itself refuses every update by a suspended
-- account (bio, avatar, privacy toggles and the presence heartbeat alike, which the
-- apps already ignore failing) with the generic row-level-security error.
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id and not public.is_suspended(id));

drop policy if exists "uploads_insert_own_folder" on storage.objects;

create policy "uploads_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] is distinct from 'buzz'
    and (storage.foldername(name))[2] = auth.uid()::text
    and not public.is_suspended(auth.uid())
  );

drop policy if exists "uploads_insert_buzz" on storage.objects;

create policy "uploads_insert_buzz" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = 'buzz' and (storage.foldername(name))[2] = 'anon' and not public.is_suspended(auth.uid()));

drop policy if exists "uploads_update_own_folder" on storage.objects;

create policy "uploads_update_own_folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] is distinct from 'buzz'
    and (storage.foldername(name))[2] = auth.uid()::text
    and not public.is_suspended(auth.uid())
  );

-- The caller's own active restriction, for the "Your account is suspended" notice.
create or replace function public.my_restriction()
returns table (kind text, reason text, expires_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.kind, r.reason, r.expires_at, r.created_at
  from public.account_restrictions r
  where r.user_id = auth.uid()
    and r.lifted_at is null
    and (r.expires_at is null or r.expires_at > now())
  limit 1;
$$;

revoke all on function public.my_restriction() from public, anon;

grant execute on function public.my_restriction() to authenticated;

-- Staff are people too: a suspended staff member loses every staff power the
-- moment the suspension is saved (an access token outlives banned_until for up
-- to an hour, and only the content tables carry the trigger above). Same body
-- as migration 14 plus the suspension check; admin_me() is not gated, so the
-- admin UI can still show the notice.
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
  if public.is_suspended(v_me) then
    raise exception 'Your account is suspended' using errcode = 'P0001', hint = 'ACCOUNT_SUSPENDED';
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

-- Deleting one's account while suspended is refused, deliberately and for
-- everyone: `delete from auth.users` would take the restriction and banned_until
-- with it, and the same university address could sign up again a minute later
-- with a clean account. (Without this it also failed by accident for anyone with
-- chat or Buzz history: the cascade's set-null updates on messages, conversations
-- and buzz_* tripped block_suspended_writes with the caller's own id.) A timed
-- suspension ends on its own; otherwise support erases the account from the
-- dashboard. Same body as migration 14 otherwise.
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
  if public.is_suspended(v_me) then
    raise exception 'Your account is suspended. Contact support to delete it.' using errcode = 'P0001', hint = 'ACCOUNT_SUSPENDED';
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

-- Suspend someone (moderators and up). A staff target needs a caller with a
-- strictly higher role. Suspending someone who already is updates the open row.
-- Supabase Auth refuses sessions while banned_until is in the future, so the
-- next login stops as well; the triggers above stop the current one.
create or replace function public.admin_user_suspend(p_user_id uuid, p_reason text, p_expires_at timestamptz default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_target_role text;
  v_reason text := btrim(p_reason);
  v_email text;
  v_id uuid;
begin
  v_caller := public.staff_require('moderator');
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'User not found';
  end if;
  if p_user_id = v_caller.user_id then
    raise exception 'You cannot suspend yourself';
  end if;
  select s.role into v_target_role from public.staff s where s.user_id = p_user_id;
  if v_target_role is not null and public.staff_role_rank(v_caller.role) <= public.staff_role_rank(v_target_role) then
    raise exception 'Not allowed';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Give a reason of 3 to 500 characters';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Keep the note under 2,000 characters';
  end if;
  if p_expires_at is not null and (not isfinite(p_expires_at) or p_expires_at <= now() or p_expires_at > now() + interval '100 years') then
    raise exception 'The end date must be in the future (and within 100 years)';
  end if;
  -- Two staff acting on the same person at the same moment: the second waits and sees the first's row.
  perform pg_advisory_xact_lock(hashtext('restriction:' || p_user_id::text));

  select r.id into v_id
  from public.account_restrictions r
  where r.user_id = p_user_id and r.lifted_at is null and (r.expires_at is null or r.expires_at > now());
  if v_id is not null then
    update public.account_restrictions
    set reason = v_reason, expires_at = p_expires_at, internal_note = p_note
    where id = v_id;
  else
    -- A suspension that ran out on its own is closed at the moment it ended (nobody lifted it).
    update public.account_restrictions
    set lifted_at = coalesce(expires_at, now()), lift_note = coalesce(lift_note, 'Expired')
    where user_id = p_user_id and lifted_at is null;
    insert into public.account_restrictions (user_id, kind, reason, internal_note, expires_at, created_by)
    values (p_user_id, 'suspension', v_reason, p_note, p_expires_at, v_caller.user_id)
    returning id into v_id;
  end if;

  update auth.users set banned_until = coalesce(p_expires_at, now() + interval '100 years') where id = p_user_id;
  select lower(u.email::text) into v_email from auth.users u where u.id = p_user_id;
  perform public.staff_log('user.suspend', 'user', p_user_id::text,
    jsonb_build_object('email', v_email, 'reason', v_reason, 'expires_at', p_expires_at, 'note', p_note));
  return v_id;
end;
$$;

revoke all on function public.admin_user_suspend(uuid, text, timestamptz, text) from public, anon;

grant execute on function public.admin_user_suspend(uuid, text, timestamptz, text) to authenticated;

-- Lift a suspension early. Same rank rule as suspending, so a moderator cannot
-- undo what an admin did to another moderator.
create or replace function public.admin_user_unsuspend(p_user_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_target_role text;
  v_email text;
  v_id uuid;
begin
  v_caller := public.staff_require('moderator');
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'User not found';
  end if;
  select s.role into v_target_role from public.staff s where s.user_id = p_user_id;
  if v_target_role is not null and public.staff_role_rank(v_caller.role) <= public.staff_role_rank(v_target_role) then
    raise exception 'Not allowed';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Keep the note under 2,000 characters';
  end if;
  perform pg_advisory_xact_lock(hashtext('restriction:' || p_user_id::text));
  select r.id into v_id
  from public.account_restrictions r
  where r.user_id = p_user_id and r.lifted_at is null and (r.expires_at is null or r.expires_at > now());
  if v_id is null then
    raise exception 'Not suspended';
  end if;
  update public.account_restrictions
  set lifted_at = now(), lifted_by = v_caller.user_id, lift_note = p_note
  where id = v_id;
  update auth.users set banned_until = null where id = p_user_id;
  select lower(u.email::text) into v_email from auth.users u where u.id = p_user_id;
  perform public.staff_log('user.unsuspend', 'user', p_user_id::text, jsonb_build_object('email', v_email, 'note', p_note));
end;
$$;

revoke all on function public.admin_user_unsuspend(uuid, text) from public, anon;

grant execute on function public.admin_user_unsuspend(uuid, text) to authenticated;

create or replace function public.admin_restrictions_list(p_active_only boolean default true, p_limit int default 50)
returns table (
  id uuid, user_id uuid, full_name text, email text, kind text, reason text, internal_note text, expires_at timestamptz,
  created_by uuid, created_by_name text, created_at timestamptz, lifted_at timestamptz, lifted_by_name text, lift_note text, active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require('moderator');
  return query
    select r.id, r.user_id, p.full_name, lower(u.email::text), r.kind, r.reason, r.internal_note, r.expires_at,
      r.created_by, c.full_name, r.created_at, r.lifted_at, l.full_name, r.lift_note,
      (r.lifted_at is null and (r.expires_at is null or r.expires_at > now()))
    from public.account_restrictions r
    left join public.profiles p on p.id = r.user_id
    left join auth.users u on u.id = r.user_id
    left join public.profiles c on c.id = r.created_by
    left join public.profiles l on l.id = r.lifted_by
    where not coalesce(p_active_only, true) or (r.lifted_at is null and (r.expires_at is null or r.expires_at > now()))
    order by r.created_at desc, r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_restrictions_list(boolean, int) from public, anon;

grant execute on function public.admin_restrictions_list(boolean, int) to authenticated;

-- Find people by name or email (same wildcard clean-up as the apps' searchProfiles).
create or replace function public.admin_user_search(p_q text, p_limit int default 20)
returns table (user_id uuid, full_name text, email text, avatar_url text, university_name text, created_at timestamptz, suspended boolean, staff_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_term text := nullif(btrim(regexp_replace(coalesce(p_q, ''), '[%_,()"''\\]', ' ', 'g')), '');
begin
  perform public.staff_require('moderator');
  if v_term is null then
    return;
  end if;
  return query
    select p.id, p.full_name, lower(u.email::text), p.avatar_url, un.name, p.created_at, public.is_suspended(p.id), s.role
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.universities un on un.id = p.university_id
    left join public.staff s on s.user_id = p.id
    where p.full_name ilike '%' || v_term || '%' or u.email::text ilike '%' || v_term || '%'
    order by (lower(u.email::text) = lower(v_term)) desc, p.full_name, p.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.admin_user_search(text, int) from public, anon;

grant execute on function public.admin_user_search(text, int) to authenticated;

-- Everything staff need on one person's page. Reports against Buzz content are
-- not counted here: Buzz authorship is only ever shown through admin_content_get.
create or replace function public.admin_user_get(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  perform public.staff_require('moderator');
  select jsonb_build_object(
    'user_id', p.id,
    'full_name', p.full_name,
    'email', lower(u.email::text),
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'program', p.program,
    'university', un.name,
    'created_at', p.created_at,
    'last_seen_at', p.last_seen_at,
    'staff_role', (select s.role from public.staff s where s.user_id = p.id),
    'banned_until', u.banned_until,
    'counts', jsonb_build_object(
      'apartments', (select count(*) from public.apartments a where a.owner_id = p.id),
      'items', (select count(*) from public.items i where i.seller_id = p.id),
      'roommate_posts', (select count(*) from public.roommate_posts r where r.author_id = p.id),
      'posts', (select count(*) from public.feed_posts f where f.author_id = p.id),
      'comments', (select count(*) from public.post_comments c where c.user_id = p.id),
      'reports_filed', (select count(*) from public.reports r where r.reporter_id = p.id),
      'reports_against', (
        select count(*) from public.reports r
        where (r.target_type = 'profile' and r.target_id = p.id)
           or (r.target_type = 'apartment' and r.target_id in (select a.id from public.apartments a where a.owner_id = p.id))
           or (r.target_type = 'item' and r.target_id in (select i.id from public.items i where i.seller_id = p.id))
           or (r.target_type = 'roommate' and r.target_id in (select x.id from public.roommate_posts x where x.author_id = p.id))
           or (r.target_type = 'post' and r.target_id in (select f.id from public.feed_posts f where f.author_id = p.id))
           or (r.target_type = 'comment' and r.target_id in (select c.id from public.post_comments c where c.user_id = p.id))
           or (r.target_type = 'message' and r.target_id in (select m.id from public.messages m where m.sender_id = p.id))
      )
    ),
    'active_restriction', (
      select to_jsonb(ar) from (
        select r.id, r.kind, r.reason, r.internal_note, r.expires_at, r.created_at, r.created_by, cb.full_name as created_by_name
        from public.account_restrictions r
        left join public.profiles cb on cb.id = r.created_by
        where r.user_id = p.id and r.lifted_at is null and (r.expires_at is null or r.expires_at > now())
        limit 1
      ) ar
    ),
    'restrictions', coalesce((
      select jsonb_agg(to_jsonb(hr) order by hr.created_at desc) from (
        select r.id, r.kind, r.reason, r.internal_note, r.expires_at, r.created_at, r.created_by, cb.full_name as created_by_name,
          r.lifted_at, r.lifted_by, lb.full_name as lifted_by_name, r.lift_note,
          (r.lifted_at is null and (r.expires_at is null or r.expires_at > now())) as active
        from public.account_restrictions r
        left join public.profiles cb on cb.id = r.created_by
        left join public.profiles lb on lb.id = r.lifted_by
        where r.user_id = p.id
      ) hr
    ), '[]'::jsonb)
  )
  into v_out
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.universities un on un.id = p.university_id
  where p.id = p_user_id;
  if v_out is null then
    raise exception 'User not found';
  end if;
  return v_out;
end;
$$;

revoke all on function public.admin_user_get(uuid) from public, anon;

grant execute on function public.admin_user_get(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- B. Content moderation status: reversible removal first, deletion separately
-- -----------------------------------------------------------------------------
-- Who hid it lives in the audit log only, so the owner never learns which staff
-- member acted.
alter table public.apartments add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;

alter table public.roommate_posts add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;

alter table public.items add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;

alter table public.feed_posts add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;

alter table public.post_comments add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;

alter table public.messages add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;

alter table public.buzz_posts add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;

alter table public.buzz_comments add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;

-- The owner may still edit a hidden row, but not un-hide it: those two columns
-- are ordinary owner-writable columns under the *_update_own policies, so a
-- before-update trigger keeps their old values unless the staff functions below
-- raise a transaction-local flag right before their own update. Everything else
-- that updates these rows (owners, the worker refreshing a videos snapshot, the
-- Buzz vote counters) leaves the moderation state exactly as it was.
create or replace function public.keep_moderation_columns()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.moderation', true) is distinct from 'on' then
    new.hidden_at := old.hidden_at;
    new.hidden_reason := old.hidden_reason;
  end if;
  return new;
end;
$$;

revoke all on function public.keep_moderation_columns() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['apartments', 'roommate_posts', 'items', 'feed_posts', 'post_comments', 'messages', 'buzz_posts', 'buzz_comments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_keep_moderation', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.keep_moderation_columns()', t || '_keep_moderation', t);
  end loop;
end $$;

drop policy if exists "apartments_select" on public.apartments;

create policy "apartments_select" on public.apartments
  for select using ((status = 'active' or owner_id = auth.uid()) and not public.is_blocked_either_way(owner_id) and public.content_visible(owner_id, hidden_at));

drop policy if exists "roommate_posts_select" on public.roommate_posts;

create policy "roommate_posts_select" on public.roommate_posts
  for select using ((is_active or author_id = auth.uid()) and not public.is_blocked_either_way(author_id) and public.content_visible(author_id, hidden_at));

drop policy if exists "items_select" on public.items;

create policy "items_select" on public.items
  for select using ((status <> 'archived' or seller_id = auth.uid()) and not public.is_blocked_either_way(seller_id) and public.content_visible(seller_id, hidden_at));

drop policy if exists "feed_posts_select" on public.feed_posts;

create policy "feed_posts_select" on public.feed_posts
  for select using (not public.is_blocked_either_way(author_id) and public.content_visible(author_id, hidden_at));

drop policy if exists "post_comments_select" on public.post_comments;

create policy "post_comments_select" on public.post_comments
  for select using (not public.is_blocked_either_way(user_id) and public.content_visible(user_id, hidden_at));

-- A suspension does not hide chat history; a hidden message is seen by its sender only.
drop policy if exists "messages_select_member" on public.messages;

create policy "messages_select_member" on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()) and (hidden_at is null or sender_id = auth.uid()));

-- No new likes, comments or saves on content the caller cannot see (hidden, or
-- by a suspended author): a removed post must not keep collecting engagement and
-- pinging its owner. Existing engagement rows stay readable as before (they are
-- other people's own content). Runs inside policies as the caller, like
-- content_visible, and reveals only what the select policies already do.
create or replace function public.target_visible(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'apartment' then exists (select 1 from public.apartments a where a.id = p_id and public.content_visible(a.owner_id, a.hidden_at))
    when 'item' then exists (select 1 from public.items i where i.id = p_id and public.content_visible(i.seller_id, i.hidden_at))
    when 'roommate' then exists (select 1 from public.roommate_posts r where r.id = p_id and public.content_visible(r.author_id, r.hidden_at))
    when 'post' then exists (select 1 from public.feed_posts f where f.id = p_id and public.content_visible(f.author_id, f.hidden_at))
    else false
  end;
$$;

revoke all on function public.target_visible(text, uuid) from public;

grant execute on function public.target_visible(text, uuid) to anon, authenticated;

drop policy if exists "post_likes_insert_own" on public.post_likes;

create policy "post_likes_insert_own" on public.post_likes for insert to authenticated
  with check (user_id = auth.uid() and not public.is_blocked_either_way(public.listing_owner(target_type, target_id)) and public.target_visible(target_type, target_id));

drop policy if exists "post_comments_insert_own" on public.post_comments;

create policy "post_comments_insert_own" on public.post_comments for insert to authenticated
  with check (user_id = auth.uid() and not public.is_blocked_either_way(public.listing_owner(target_type, target_id)) and public.target_visible(target_type, target_id));

drop policy if exists "saved_listings_insert_own" on public.saved_listings;

create policy "saved_listings_insert_own" on public.saved_listings for insert to authenticated
  with check (user_id = auth.uid() and not public.is_blocked_either_way(public.listing_owner(target_type, target_id)) and public.target_visible(target_type, target_id));

-- Buzz: a hidden thread is gone for everyone, its author included (telling the
-- author alone would be fine, but the thread must not behave differently for
-- different viewers). Suspension is deliberately NOT applied here.
create or replace function public.buzz_can_see(p_post public.buzz_posts)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p_post.visible_at <= now() or coalesce(p_post.author_id = auth.uid(), false)) and not public.buzz_hidden(p_post.author_id, p_post.id)
    and p_post.hidden_at is null;
$$;

create or replace function public.buzz_reply_count(p_post uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.buzz_comments c
  where c.post_id = p_post and (c.visible_at <= now() or coalesce(c.author_id = auth.uid(), false)) and not public.buzz_hidden(c.author_id, p_post)
    and c.hidden_at is null;
$$;

create or replace function public.buzz_comments_list(p_post_id uuid)
returns table (id uuid, parent_id uuid, body text, created_at timestamptz, alias text, is_op boolean, is_mine boolean, score int, my_vote smallint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.parent_id, c.body, least(c.visible_at, now()), c.alias, c.is_op, coalesce(c.author_id = auth.uid(), false),
    c.score,
    coalesce((select v.value from public.buzz_comment_votes v where v.comment_id = c.id and v.user_id = auth.uid()), 0)::smallint
  from public.buzz_comments c
  join public.buzz_posts b on b.id = c.post_id
  where c.post_id = p_post_id
    and public.buzz_can_see(b)
    and (c.visible_at <= now() or coalesce(c.author_id = auth.uid(), false))
    and not public.buzz_hidden(c.author_id, c.post_id)
    and c.hidden_at is null
  order by c.visible_at asc, c.seq asc
  limit 500;
$$;

-- The feed itself (current body from home_feed): "hot" counts published replies,
-- and a hidden reply must not keep a thread warm while comments_list and
-- reply_count say it is gone.
create or replace function public.buzz_feed(
  p_university_id uuid default null,
  p_topic text default null,
  p_sort text default 'hot',
  p_limit int default 20,
  p_offset int default 0,
  p_q text default null
)
returns table (
  id uuid, topic text, title text, body text, images text[], image_meta jsonb, videos jsonb, university_id uuid,
  score int, comment_count int, created_at timestamptz, my_vote smallint, is_mine boolean, alias text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (select nullif(regexp_replace(btrim(coalesce(p_q, '')), '[%_\\]', '', 'g'), '') as term),
  visible as (
    select b.*, (select count(*)::int from public.buzz_comments c where c.post_id = b.id and c.visible_at <= now() and c.hidden_at is null) as published_replies
    from public.buzz_posts b, q
    -- Threads without a campus (small campuses, see buzz_create) show up everywhere.
    where (p_university_id is null or b.university_id is null or b.university_id = p_university_id)
      and (p_topic is null or b.topic = p_topic)
      and (q.term is null or b.title ilike '%' || q.term || '%' or b.body ilike '%' || q.term || '%')
      and public.buzz_can_see(b)
  )
  select
    v.id, v.topic, v.title, v.body, v.images, v.image_meta, v.videos, v.university_id,
    v.score,
    public.buzz_reply_count(v.id),
    least(v.visible_at, now()),
    coalesce((select bv.value from public.buzz_votes bv where bv.post_id = v.id and bv.user_id = auth.uid()), 0)::smallint,
    coalesce(v.author_id = auth.uid(), false),
    v.alias
  from visible v
  order by
    case when p_sort = 'top' then v.score end desc nulls last,
    -- Reddit-style "hot": votes and PUBLISHED replies count logarithmically, newer wins. Unpublished
    -- replies must not move a thread, or the ranking would give away the moment someone replied.
    case when p_sort = 'hot' then sign(v.score + v.published_replies) * log(greatest(abs(v.score + v.published_replies), 1)::numeric) + extract(epoch from v.visible_at) / 45000.0 end desc nulls last,
    v.visible_at desc,
    v.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Reply anonymously. (A hidden parent is refused like any reply the caller cannot see.)
create or replace function public.buzz_reply(p_post_id uuid, p_body text, p_parent_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_cfg public.buzz_secrets;
  v_post public.buzz_posts;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'Replies need 1 to 2,000 characters';
  end if;
  select * into v_cfg from public.buzz_secrets where id = 1;
  select * into v_post from public.buzz_posts b where b.id = p_post_id;
  if v_post.id is null or not public.buzz_can_see(v_post) then
    raise exception 'Thread not found';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.buzz_comments c
    where c.id = p_parent_id and c.post_id = p_post_id
      and (c.visible_at <= now() or coalesce(c.author_id = v_me, false)) and not public.buzz_hidden(c.author_id, p_post_id)
      and c.hidden_at is null
  ) then
    raise exception 'That reply belongs to another thread';
  end if;
  perform pg_advisory_xact_lock(hashtext('buzz:' || v_me::text));
  if (select count(*) from public.buzz_rate_log l where l.user_id = v_me and l.kind = 'reply' and l.at > now() - interval '10 minutes') >= 30 then
    raise exception 'You are replying a lot. Try again in a little while.';
  end if;
  -- A reply never becomes visible before the thread it is in, or before the reply it answers.
  insert into public.buzz_comments (post_id, author_id, alias, is_op, parent_id, body, created_at, visible_at)
  values (p_post_id, v_me, public.buzz_alias(v_me, p_post_id), coalesce(v_post.author_id = v_me, false), p_parent_id, btrim(p_body), now(),
    greatest(
      now() + make_interval(secs => random() * greatest(v_cfg.reply_jitter_seconds, 0)),
      v_post.visible_at,
      coalesce((select c.visible_at from public.buzz_comments c where c.id = p_parent_id), '-infinity'::timestamptz)
    ))
  returning id into v_id;
  insert into public.buzz_rate_log (user_id, kind) values (v_me, 'reply');
  return v_id;
end;
$$;

-- Vote on a reply: 1 up, -1 down, 0 clears. Only replies the caller can see.
create or replace function public.buzz_comment_vote(p_comment_id uuid, p_value int)
returns table (score int, my_vote smallint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_comment public.buzz_comments;
  v_post public.buzz_posts;
  v_old int;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'Invalid vote';
  end if;
  select * into v_comment from public.buzz_comments c where c.id = p_comment_id for update;
  if v_comment.id is not null then
    select * into v_post from public.buzz_posts b where b.id = v_comment.post_id;
  end if;
  if v_comment.id is null or v_post.id is null or not public.buzz_can_see(v_post)
     or not (v_comment.visible_at <= now() or coalesce(v_comment.author_id = v_me, false))
     or public.buzz_hidden(v_comment.author_id, v_comment.post_id)
     or v_comment.hidden_at is not null then
    raise exception 'Reply not found';
  end if;
  select v.value into v_old from public.buzz_comment_votes v where v.comment_id = p_comment_id and v.user_id = v_me;
  v_old := coalesce(v_old, 0);
  if p_value = 0 then
    delete from public.buzz_comment_votes v where v.comment_id = p_comment_id and v.user_id = v_me;
  else
    insert into public.buzz_comment_votes (comment_id, user_id, value) values (p_comment_id, v_me, p_value)
    on conflict (comment_id, user_id) do update set value = excluded.value;
  end if;
  update public.buzz_comments c set score = c.score - v_old + p_value where c.id = p_comment_id;
  return query select c.score, p_value::smallint from public.buzz_comments c where c.id = p_comment_id;
end;
$$;

-- Mute (current body from home_feed): a hidden reply behaves like a nonexistent
-- one here too, so nobody can tell "hidden" from "deleted" or link a hidden reply
-- to a visible alias by watching which one vanishes.
create or replace function public.buzz_mute(p_post_id uuid default null, p_comment_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_author uuid;
  v_post_id uuid;
  v_post public.buzz_posts;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_comment_id is not null then
    select c.author_id, c.post_id into v_author, v_post_id from public.buzz_comments c
    where c.id = p_comment_id and c.visible_at <= now() and c.hidden_at is null;
  else
    select b.author_id, b.id into v_author, v_post_id from public.buzz_posts b where b.id = p_post_id;
  end if;
  select * into v_post from public.buzz_posts b where b.id = v_post_id;
  if v_author is null or v_author = v_me or v_post.id is null or not public.buzz_can_see(v_post) then
    return;
  end if;
  insert into public.buzz_mutes (user_id, post_id, muted_id) values (v_me, v_post_id, v_author) on conflict do nothing;
end;
$$;

-- Supabase grants new sequences to the API roles. The reply sequence is a live
-- counter of every reply ever written (hidden and unpublished ones included),
-- which is exactly what the reply jitter hides, and setval() would stop replies.
-- buzz_reply inserts as the function owner, so nothing legitimate needs it.
revoke all on sequence public.buzz_comments_seq_seq from public, anon, authenticated;

-- One vertical feed: reels people posted plus video tours from listings. Hidden
-- rows and the rows of suspended accounts stay out, for their authors too.
create or replace function public.reels_feed(p_university_id uuid default null, p_limit int default 10, p_offset int default 0)
returns table (
  source_type text,
  source_id uuid,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  author_verified boolean,
  title text,
  caption text,
  video jsonb,
  created_at timestamptz,
  likes bigint,
  comments bigint,
  liked_by_me boolean,
  saved_by_me boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with src as (
    select 'post'::text as source_type, p.id as source_id, p.author_id, p.university_id, null::text as title, p.body as caption, p.videos -> 0 as video, p.created_at
      from public.feed_posts p where p.kind = 'reel' and p.has_video and p.hidden_at is null and not public.is_suspended(p.author_id)
    union all
    select 'apartment', a.id, a.owner_id, a.university_id, a.title, a.description, a.videos -> 0, a.created_at
      from public.apartments a where a.has_video and a.status = 'active' and a.hidden_at is null and not public.is_suspended(a.owner_id)
    union all
    select 'roommate', r.id, r.author_id, r.university_id, r.title, r.description, r.videos -> 0, r.created_at
      from public.roommate_posts r where r.has_video and r.is_active and r.hidden_at is null and not public.is_suspended(r.author_id)
  )
  select
    s.source_type, s.source_id, s.author_id, pr.full_name, pr.avatar_url,
    coalesce(u.email_domain is not null, false),
    s.title, s.caption, s.video, s.created_at,
    (select count(*) from public.post_likes l where l.target_type = s.source_type and l.target_id = s.source_id),
    (select count(*) from public.post_comments c where c.target_type = s.source_type and c.target_id = s.source_id),
    exists (select 1 from public.post_likes l where l.target_type = s.source_type and l.target_id = s.source_id and l.user_id = auth.uid()),
    exists (select 1 from public.saved_listings sv where sv.target_type = s.source_type and sv.target_id = s.source_id and sv.user_id = auth.uid())
  from src s
  join public.profiles pr on pr.id = s.author_id
  left join public.universities u on u.id = pr.university_id
  where (p_university_id is null or s.university_id = p_university_id)
    and jsonb_typeof(s.video) = 'object'
  order by s.created_at desc, s.source_id desc
  limit least(greatest(coalesce(p_limit, 10), 1), 30)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Hidden photos are moved here by the worker. No policies: only the service role
-- can touch it, so a hidden photo's old public URL stops working.
insert into storage.buckets (id, name, public) values ('quarantine', 'quarantine', false) on conflict (id) do nothing;

-- The eight kinds of content staff can hide, restore and delete (the same names
-- reports.target_type uses; 'profile' is handled by suspension).
create or replace function public.admin_content_table(p_target_type text)
returns text
language sql
immutable
as $$
  select case p_target_type
    when 'apartment' then 'apartments'
    when 'item' then 'items'
    when 'roommate' then 'roommate_posts'
    when 'post' then 'feed_posts'
    when 'comment' then 'post_comments'
    when 'message' then 'messages'
    when 'buzz' then 'buzz_posts'
    when 'buzz_comment' then 'buzz_comments'
  end;
$$;

revoke all on function public.admin_content_table(text) from public, anon, authenticated;

-- One shape for every kind of content. Null when it does not exist. The author
-- is included for Buzz too: this is internal, and its callers decide who may
-- see it (admin_content_get logs every Buzz view; admin_reports_list drops it).
create or replace function public.admin_content_snapshot(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_target_id is null then
    return null;
  end if;
  case p_target_type
    when 'apartment' then
      select jsonb_build_object(
        'target_type', 'apartment', 'target_id', a.id, 'author_id', a.owner_id, 'author_name', p.full_name, 'author_email', lower(u.email::text),
        'created_at', a.created_at, 'hidden_at', a.hidden_at, 'hidden_reason', a.hidden_reason,
        'title', a.title, 'body', a.description, 'images', to_jsonb(a.images), 'videos', a.videos,
        'extra', jsonb_build_object('price', a.price_per_month, 'currency', a.currency, 'address', a.address, 'city', a.city, 'status', a.status, 'university_id', a.university_id))
      into v
      from public.apartments a
      left join public.profiles p on p.id = a.owner_id
      left join auth.users u on u.id = a.owner_id
      where a.id = p_target_id;
    when 'item' then
      select jsonb_build_object(
        'target_type', 'item', 'target_id', i.id, 'author_id', i.seller_id, 'author_name', p.full_name, 'author_email', lower(u.email::text),
        'created_at', i.created_at, 'hidden_at', i.hidden_at, 'hidden_reason', i.hidden_reason,
        'title', i.title, 'body', i.description, 'images', to_jsonb(i.images), 'videos', '[]'::jsonb,
        'extra', jsonb_build_object('price', i.price, 'currency', i.currency, 'category', i.category, 'condition', i.condition, 'status', i.status, 'university_id', i.university_id))
      into v
      from public.items i
      left join public.profiles p on p.id = i.seller_id
      left join auth.users u on u.id = i.seller_id
      where i.id = p_target_id;
    when 'roommate' then
      select jsonb_build_object(
        'target_type', 'roommate', 'target_id', r.id, 'author_id', r.author_id, 'author_name', p.full_name, 'author_email', lower(u.email::text),
        'created_at', r.created_at, 'hidden_at', r.hidden_at, 'hidden_reason', r.hidden_reason,
        'title', r.title, 'body', r.description, 'images', to_jsonb(r.images), 'videos', r.videos,
        'extra', jsonb_build_object('post_type', r.post_type, 'budget_min', r.budget_min, 'budget_max', r.budget_max, 'currency', r.currency, 'location', r.location, 'status', case when r.is_active then 'active' else 'inactive' end, 'university_id', r.university_id))
      into v
      from public.roommate_posts r
      left join public.profiles p on p.id = r.author_id
      left join auth.users u on u.id = r.author_id
      where r.id = p_target_id;
    when 'post' then
      select jsonb_build_object(
        'target_type', 'post', 'target_id', f.id, 'author_id', f.author_id, 'author_name', p.full_name, 'author_email', lower(u.email::text),
        'created_at', f.created_at, 'hidden_at', f.hidden_at, 'hidden_reason', f.hidden_reason,
        'title', null, 'body', f.body, 'images', to_jsonb(f.images), 'videos', f.videos,
        'extra', jsonb_build_object('kind', f.kind, 'university_id', f.university_id))
      into v
      from public.feed_posts f
      left join public.profiles p on p.id = f.author_id
      left join auth.users u on u.id = f.author_id
      where f.id = p_target_id;
    when 'comment' then
      select jsonb_build_object(
        'target_type', 'comment', 'target_id', c.id, 'author_id', c.user_id, 'author_name', p.full_name, 'author_email', lower(u.email::text),
        'created_at', c.created_at, 'hidden_at', c.hidden_at, 'hidden_reason', c.hidden_reason,
        'title', null, 'body', c.body, 'images', '[]'::jsonb, 'videos', '[]'::jsonb,
        'extra', jsonb_build_object('target_type', c.target_type, 'target_id', c.target_id))
      into v
      from public.post_comments c
      left join public.profiles p on p.id = c.user_id
      left join auth.users u on u.id = c.user_id
      where c.id = p_target_id;
    when 'message' then
      select jsonb_build_object(
        'target_type', 'message', 'target_id', m.id, 'author_id', m.sender_id, 'author_name', p.full_name, 'author_email', lower(u.email::text),
        'created_at', m.created_at, 'hidden_at', m.hidden_at, 'hidden_reason', m.hidden_reason,
        'title', null, 'body', m.content, 'images', case when m.image_url is null then '[]'::jsonb else jsonb_build_array(m.image_url) end, 'videos', '[]'::jsonb,
        'extra', jsonb_build_object('conversation_id', m.conversation_id))
      into v
      from public.messages m
      left join public.profiles p on p.id = m.sender_id
      left join auth.users u on u.id = m.sender_id
      where m.id = p_target_id;
    when 'buzz' then
      select jsonb_build_object(
        'target_type', 'buzz', 'target_id', b.id, 'author_id', b.author_id, 'author_name', p.full_name, 'author_email', lower(u.email::text),
        'created_at', b.created_at, 'hidden_at', b.hidden_at, 'hidden_reason', b.hidden_reason,
        'title', b.title, 'body', b.body, 'images', to_jsonb(b.images), 'videos', b.videos,
        'extra', jsonb_build_object('alias', b.alias, 'topic', b.topic, 'score', b.score, 'university_id', b.university_id))
      into v
      from public.buzz_posts b
      left join public.profiles p on p.id = b.author_id
      left join auth.users u on u.id = b.author_id
      where b.id = p_target_id;
    when 'buzz_comment' then
      select jsonb_build_object(
        'target_type', 'buzz_comment', 'target_id', c.id, 'author_id', c.author_id, 'author_name', p.full_name, 'author_email', lower(u.email::text),
        'created_at', c.created_at, 'hidden_at', c.hidden_at, 'hidden_reason', c.hidden_reason,
        'title', null, 'body', c.body, 'images', '[]'::jsonb, 'videos', '[]'::jsonb,
        'extra', jsonb_build_object('alias', c.alias, 'post_id', c.post_id, 'parent_id', c.parent_id, 'score', c.score, 'is_op', c.is_op))
      into v
      from public.buzz_comments c
      left join public.profiles p on p.id = c.author_id
      left join auth.users u on u.id = c.author_id
      where c.id = p_target_id;
    else
      v := null;
  end case;
  return v;
end;
$$;

revoke all on function public.admin_content_snapshot(text, uuid) from public, anon, authenticated;

-- The Mux asset behind one element of a `videos` snapshot: by the media id the
-- apps store, or (Buzz strips the id) by playback id. Only assets owned by the
-- row's author count: `videos` is written by the client with nothing but an
-- ownership policy on the row, and media ids and playback ids are public in
-- every listing, so a row pointing at someone else's video must not turn into a
-- mux_disable or mux_delete of that video. Null when unknown or not theirs.
drop function if exists public.media_asset_for_video(jsonb);

create or replace function public.media_asset_for_video(p_video jsonb, p_owner uuid default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.provider_asset_id from public.media m
      where m.id = case when (p_video ->> 'media_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (p_video ->> 'media_id')::uuid end
        and m.owner_id = p_owner and m.provider_asset_id is not null),
    (select m.provider_asset_id from public.media m
      where m.playback_id = nullif(p_video ->> 'playback_id', '') and m.owner_id = p_owner and m.provider_asset_id is not null
      order by m.created_at limit 1)
  )
  where jsonb_typeof(p_video) = 'object' and p_owner is not null;
$$;

revoke all on function public.media_asset_for_video(jsonb, uuid) from public, anon, authenticated;

-- Messages, comments and Buzz replies are copied (first 140 characters) into the
-- recipients' notifications, and the latest message into the conversation row
-- every member reads. Hiding or deleting the original takes those copies with
-- it; restoring a message recomputes the conversation preview.
create or replace function public.moderation_sync_copies(p_target_type text, p_target_id uuid, p_snap jsonb, p_removed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv uuid;
begin
  if p_target_type = 'message' then
    v_conv := (p_snap -> 'extra' ->> 'conversation_id')::uuid;
    if p_removed then
      update public.notifications set body = null
      where type = 'message' and data ->> 'message_id' = p_target_id::text and body is not null;
    end if;
    update public.conversations c
    set last_message_preview = (
      select left(m.content, 120) from public.messages m
      where m.conversation_id = c.id and m.hidden_at is null and (not p_removed or m.id <> p_target_id)
      order by m.created_at desc limit 1)
    where c.id = v_conv;
  elsif p_target_type = 'comment' and p_removed then
    update public.notifications set body = null
    where type = 'comment' and data ->> 'comment_id' = p_target_id::text and body is not null;
  elsif p_target_type = 'buzz_comment' and p_removed then
    -- Buzz notifications carry no comment id (and no actor): match the thread and the text.
    update public.notifications set body = null
    where type = 'comment' and actor_id is null and data ->> 'target_type' = 'buzz'
      and data ->> 'target_id' = p_snap -> 'extra' ->> 'post_id' and body = left(p_snap ->> 'body', 140);
  end if;
end;
$$;

revoke all on function public.moderation_sync_copies(text, uuid, jsonb, boolean) from public, anon, authenticated;

-- Hide (moderators and up): the row stays, its owner still sees it with the
-- reason, everyone else stops seeing it, and its media is queued for quarantine.
create or replace function public.admin_content_hide(p_target_type text, p_target_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_reason text := btrim(p_reason);
  v_snap jsonb;
  v_url text;
  v_path text;
  v_video jsonb;
  v_asset text;
  v_photos text[] := '{}';
  v_videos text[] := '{}';
  v_skipped text[] := '{}';
  v_owner uuid;
  v_details jsonb;
begin
  v_caller := public.staff_require('moderator');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Give a reason of 3 to 500 characters';
  end if;
  v_snap := public.admin_content_snapshot(p_target_type, p_target_id);
  if v_snap is null then
    raise exception 'Content not found';
  end if;
  v_owner := (v_snap ->> 'author_id')::uuid;
  perform set_config('app.moderation', 'on', true);
  execute format('update public.%I set hidden_at = coalesce(hidden_at, now()), hidden_reason = $1 where id = $2', public.admin_content_table(p_target_type))
    using v_reason, p_target_id;
  perform set_config('app.moderation', '', true);
  perform public.moderation_sync_copies(p_target_type, p_target_id, v_snap, true);
  -- Only media the author owns is queued: the refs come from the row itself, and
  -- a row may point at anyone's public file or video. Foreign refs are recorded
  -- for staff instead (a listing built from someone else's media is a signal).
  for v_url in select jsonb_array_elements_text(coalesce(v_snap -> 'images', '[]'::jsonb)) loop
    v_path := public.storage_path_from_url(v_url);
    if v_path is not null and public.media_path_owned(v_path, v_owner, p_target_type = 'buzz') then
      perform public.media_cancel(array['release'], v_path);
      perform public.media_enqueue('quarantine', v_path, p_target_type, p_target_id);
      v_photos := array_append(v_photos, v_path);
    else
      v_skipped := array_append(v_skipped, v_url);
    end if;
  end loop;
  for v_video in select jsonb_array_elements(case when jsonb_typeof(v_snap -> 'videos') = 'array' then v_snap -> 'videos' else '[]'::jsonb end) loop
    v_asset := public.media_asset_for_video(v_video, v_owner);
    if v_asset is not null then
      perform public.media_cancel(array['mux_enable'], v_asset);
      perform public.media_enqueue('mux_disable', v_asset, p_target_type, p_target_id);
      v_videos := array_append(v_videos, v_asset);
    else
      v_skipped := array_append(v_skipped, coalesce(v_video ->> 'playback_id', v_video ->> 'media_id', v_video::text));
    end if;
  end loop;
  v_details := jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'reason', v_reason,
    'photos', to_jsonb(v_photos), 'videos', to_jsonb(v_videos));
  if cardinality(v_skipped) > 0 then
    v_details := v_details || jsonb_build_object('skipped_refs', to_jsonb(v_skipped));
  end if;
  if p_target_type not in ('buzz', 'buzz_comment') then
    v_details := v_details || jsonb_build_object('author_id', v_snap -> 'author_id');
  end if;
  perform public.staff_log('content.hide', p_target_type, p_target_id::text, v_details);
end;
$$;

revoke all on function public.admin_content_hide(text, uuid, text) from public, anon;

grant execute on function public.admin_content_hide(text, uuid, text) to authenticated;

-- Restore (moderators and up): clears the hide and queues the media back.
create or replace function public.admin_content_restore(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_snap jsonb;
  v_url text;
  v_path text;
  v_video jsonb;
  v_asset text;
  v_photos text[] := '{}';
  v_videos text[] := '{}';
  v_owner uuid;
  v_details jsonb;
begin
  v_caller := public.staff_require('moderator');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  v_snap := public.admin_content_snapshot(p_target_type, p_target_id);
  if v_snap is null then
    raise exception 'Content not found';
  end if;
  if v_snap -> 'hidden_at' is null or jsonb_typeof(v_snap -> 'hidden_at') = 'null' then
    raise exception 'Content is not hidden';
  end if;
  v_owner := (v_snap ->> 'author_id')::uuid;
  perform set_config('app.moderation', 'on', true);
  execute format('update public.%I set hidden_at = null, hidden_reason = null where id = $1', public.admin_content_table(p_target_type))
    using p_target_id;
  perform set_config('app.moderation', '', true);
  perform public.moderation_sync_copies(p_target_type, p_target_id, v_snap, false);
  for v_url in select jsonb_array_elements_text(coalesce(v_snap -> 'images', '[]'::jsonb)) loop
    v_path := public.storage_path_from_url(v_url);
    if v_path is not null and public.media_path_owned(v_path, v_owner, p_target_type = 'buzz') then
      perform public.media_cancel(array['quarantine'], v_path);
      perform public.media_enqueue('release', v_path, p_target_type, p_target_id);
      v_photos := array_append(v_photos, v_path);
    end if;
  end loop;
  for v_video in select jsonb_array_elements(case when jsonb_typeof(v_snap -> 'videos') = 'array' then v_snap -> 'videos' else '[]'::jsonb end) loop
    v_asset := public.media_asset_for_video(v_video, v_owner);
    if v_asset is not null then
      perform public.media_cancel(array['mux_disable'], v_asset);
      perform public.media_enqueue('mux_enable', v_asset, p_target_type, p_target_id);
      v_videos := array_append(v_videos, v_asset);
    end if;
  end loop;
  v_details := jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'was_hidden_reason', v_snap -> 'hidden_reason',
    'photos', to_jsonb(v_photos), 'videos', to_jsonb(v_videos));
  if p_target_type not in ('buzz', 'buzz_comment') then
    v_details := v_details || jsonb_build_object('author_id', v_snap -> 'author_id');
  end if;
  perform public.staff_log('content.restore', p_target_type, p_target_id::text, v_details);
end;
$$;

revoke all on function public.admin_content_restore(text, uuid) from public, anon;

grant execute on function public.admin_content_restore(text, uuid) to authenticated;

-- Permanent deletion: the separate, deliberate action. Admins and up, a reason
-- required, and the full content goes into the audit log first. The row's
-- cascades take comments, likes, saves and votes; the after-delete triggers of
-- section D queue the files and videos for removal.
create or replace function public.admin_content_delete(p_target_type text, p_target_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_reason text := btrim(p_reason);
  v_snap jsonb;
  v_children jsonb := '[]'::jsonb;
  v_children_count int := 0;
begin
  v_caller := public.staff_require('admin');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Give a reason of 3 to 500 characters';
  end if;
  v_snap := public.admin_content_snapshot(p_target_type, p_target_id);
  if v_snap is null then
    raise exception 'Content not found';
  end if;
  -- The cascade takes replies and comments with the row; the log keeps them (first 500) so it
  -- can still say what was removed and who wrote it.
  case p_target_type
    when 'buzz' then
      select count(*)::int into v_children_count from public.buzz_comments c where c.post_id = p_target_id;
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_children from (
        select jsonb_build_object('id', c.id, 'alias', c.alias, 'author_id', c.author_id, 'body', c.body, 'created_at', c.created_at, 'hidden_at', c.hidden_at) as j
        from public.buzz_comments c where c.post_id = p_target_id order by c.seq limit 500) x;
    when 'buzz_comment' then
      with recursive d as (
        select c.* from public.buzz_comments c where c.parent_id = p_target_id
        union all
        select c.* from public.buzz_comments c join d on c.parent_id = d.id)
      select count(*)::int, coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'alias', d.alias, 'author_id', d.author_id, 'body', d.body, 'created_at', d.created_at, 'hidden_at', d.hidden_at) order by d.seq), '[]'::jsonb)
      into v_children_count, v_children
      from (select * from d order by seq limit 500) d;
    when 'apartment', 'item', 'roommate', 'post' then
      select count(*)::int into v_children_count from public.post_comments c where c.target_type = p_target_type and c.target_id = p_target_id;
      select coalesce(jsonb_agg(x.j), '[]'::jsonb) into v_children from (
        select jsonb_build_object('id', c.id, 'author_id', c.user_id, 'body', c.body, 'created_at', c.created_at, 'hidden_at', c.hidden_at) as j
        from public.post_comments c where c.target_type = p_target_type and c.target_id = p_target_id order by c.created_at limit 500) x;
    else
      v_children_count := 0; v_children := '[]'::jsonb;
  end case;
  perform public.staff_log('content.delete', p_target_type, p_target_id::text,
    jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'reason', v_reason, 'snapshot', v_snap,
      'children_count', v_children_count, 'children', v_children));
  perform public.moderation_sync_copies(p_target_type, p_target_id, v_snap, true);
  execute format('delete from public.%I where id = $1', public.admin_content_table(p_target_type)) using p_target_id;
end;
$$;

revoke all on function public.admin_content_delete(text, uuid, text) from public, anon;

grant execute on function public.admin_content_delete(text, uuid, text) to authenticated;

-- The content behind a report, for the review screen. For Buzz this reveals the
-- author to staff on purpose (moderation needs it), and every such look is logged.
create or replace function public.admin_content_get(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snap jsonb;
begin
  perform public.staff_require('moderator');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  v_snap := public.admin_content_snapshot(p_target_type, p_target_id);
  if v_snap is null then
    raise exception 'Content not found';
  end if;
  if p_target_type in ('buzz', 'buzz_comment') then
    perform public.staff_log('content.view', p_target_type, p_target_id::text, jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id));
  end if;
  return v_snap;
end;
$$;

revoke all on function public.admin_content_get(text, uuid) from public, anon;

grant execute on function public.admin_content_get(text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- C. Report review fields
-- -----------------------------------------------------------------------------
alter table public.reports
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists decision text,
  add column if not exists notes text;

alter table public.reports drop constraint if exists reports_decision_check;

alter table public.reports add constraint reports_decision_check
  check (decision is null or decision in ('dismissed', 'content_hidden', 'content_deleted', 'user_suspended', 'warning', 'no_action'));

alter table public.reports drop constraint if exists reports_notes_check;

alter table public.reports add constraint reports_notes_check check (notes is null or char_length(notes) <= 2000);

create index if not exists reports_status_created_idx on public.reports (status, created_at desc);

-- The reporter may follow the status of their own report (reports_select_own), but
-- the review itself is staff-only: who reviewed it, the decision ('user_suspended'
-- on a Buzz report would point at the anonymous author) and the free-text notes.
-- Column privileges keep those four columns out of the API; the admin functions
-- are security definer and unaffected. The apps only insert into reports, and a
-- `select *` on reports as a user now fails by design.
revoke select on public.reports from public, anon, authenticated;

grant select (id, reporter_id, target_type, target_id, reason, details, status, created_at) on public.reports to authenticated;

-- The queue. Newest first; pass the oldest created_at you have as p_before for
-- older rows. The preview comes from the content itself (empty once it is gone).
-- target_author_id is null for Buzz targets: the list never reveals Buzz authors.
create or replace function public.admin_reports_list(p_status text default 'open', p_limit int default 50, p_before timestamptz default null)
returns table (
  id uuid, reporter_id uuid, reporter_name text, reporter_email text, target_type text, target_id uuid, reason text, details text,
  status text, decision text, notes text, reviewed_by uuid, reviewer_name text, reviewed_at timestamptz, created_at timestamptz,
  target_preview text, target_hidden boolean, target_exists boolean, target_author_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := coalesce(p_status, 'open');
begin
  perform public.staff_require('moderator');
  if v_status not in ('open', 'reviewed', 'dismissed', 'all') then
    raise exception 'Invalid status';
  end if;
  return query
    select r.id, r.reporter_id, rp.full_name, lower(ru.email::text), r.target_type, r.target_id, r.reason, r.details,
      r.status, r.decision, r.notes, r.reviewed_by, vp.full_name, r.reviewed_at, r.created_at,
      case when r.target_type = 'profile' then coalesce(left(tp.full_name, 140), '')
           else coalesce(left(coalesce(nullif(s.snap ->> 'title', ''), s.snap ->> 'body'), 140), '') end,
      case when r.target_type = 'profile' then tp.id is not null and public.is_suspended(tp.id)
           else s.snap ->> 'hidden_at' is not null end,
      case when r.target_type = 'profile' then tp.id is not null else s.snap is not null end,
      case when r.target_type = 'profile' then tp.id
           when r.target_type in ('buzz', 'buzz_comment') then null
           else (s.snap ->> 'author_id')::uuid end
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join auth.users ru on ru.id = r.reporter_id
    left join public.profiles vp on vp.id = r.reviewed_by
    left join public.profiles tp on r.target_type = 'profile' and tp.id = r.target_id
    left join lateral (select case when r.target_type <> 'profile' then public.admin_content_snapshot(r.target_type, r.target_id) end as snap) s on true
    where (v_status = 'all' or r.status = v_status)
      and (p_before is null or r.created_at < p_before)
    order by r.created_at desc, r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_reports_list(text, int, timestamptz) from public, anon;

grant execute on function public.admin_reports_list(text, int, timestamptz) to authenticated;

create or replace function public.admin_report_resolve(p_id uuid, p_decision text, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_report public.reports;
begin
  v_caller := public.staff_require('moderator');
  if p_decision is null or p_decision not in ('dismissed', 'content_hidden', 'content_deleted', 'user_suspended', 'warning', 'no_action') then
    raise exception 'Invalid decision';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'Keep the notes under 2,000 characters';
  end if;
  select * into v_report from public.reports r where r.id = p_id;
  if v_report.id is null then
    raise exception 'Report not found';
  end if;
  update public.reports
  set status = case when p_decision = 'dismissed' then 'dismissed' else 'reviewed' end,
      reviewed_by = v_caller.user_id, reviewed_at = now(), decision = p_decision, notes = p_notes
  where id = p_id;
  perform public.staff_log('report.resolve', 'report', p_id::text,
    jsonb_build_object('decision', p_decision, 'notes', p_notes, 'target_type', v_report.target_type, 'target_id', v_report.target_id));
end;
$$;

revoke all on function public.admin_report_resolve(uuid, text, text) from public, anon;

grant execute on function public.admin_report_resolve(uuid, text, text) to authenticated;

create or replace function public.admin_report_reopen(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.staff;
  v_report public.reports;
begin
  v_caller := public.staff_require('moderator');
  select * into v_report from public.reports r where r.id = p_id;
  if v_report.id is null then
    raise exception 'Report not found';
  end if;
  update public.reports
  set status = 'open', reviewed_by = null, reviewed_at = null, decision = null, notes = null
  where id = p_id;
  perform public.staff_log('report.reopen', 'report', p_id::text,
    jsonb_build_object('target_type', v_report.target_type, 'target_id', v_report.target_id, 'previous_status', v_report.status, 'previous_decision', v_report.decision));
end;
$$;

revoke all on function public.admin_report_reopen(uuid) from public, anon;

grant execute on function public.admin_report_reopen(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- D. Media jobs: the cleanup queue, generalised
-- -----------------------------------------------------------------------------
-- Supabase forbids touching storage.objects from SQL (migration 11) and Mux
-- lives outside the database, so the database queues the work and an app-side
-- worker (service role + Mux credentials) performs it and retries failures.
--
-- Worker contract, one job at a time (claim -> do -> done / failed):
--   quarantine    move uploads/<ref> -> quarantine/<ref>   (already moved = done)
--   release       move it back                             (already back = done)
--   delete_object remove <ref> from both buckets           (not found = done)
--   delete_prefix list + remove everything under <ref> in both buckets
--   mux_disable   delete every playback id of asset <ref>
--   mux_enable    create a public playback id (if none), write it to
--                 public.media.playback_id and refresh the `videos` jsonb of
--                 (target_type, target_id)
--   mux_delete    delete the asset, then the media row, then mark the job done
--                 (the media trigger's own mux_delete collapses into this one)
create table if not exists public.media_jobs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('quarantine', 'release', 'delete_object', 'delete_prefix', 'mux_disable', 'mux_enable', 'mux_delete')),
  ref text not null,                      -- storage path 'apartments/<uid>/<file>.jpg', prefix 'avatars/<uid>/', or Mux asset id
  target_type text,
  target_id uuid,                         -- the content it belongs to (mux_enable: the row whose videos snapshot the worker refreshes)
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,                 -- last time a worker took it (a retry while it runs would start it twice)
  created_at timestamptz not null default now(),
  done_at timestamptz
);

alter table public.media_jobs add column if not exists claimed_at timestamptz;

-- One pending job per (kind, ref): re-hiding, re-deleting and cascades collapse.
create unique index if not exists media_jobs_pending_idx on public.media_jobs (kind, ref) where done_at is null;

create index if not exists media_jobs_due_idx on public.media_jobs (next_attempt_at) where done_at is null;

alter table public.media_jobs enable row level security;

revoke all on public.media_jobs from public, anon, authenticated;

-- Like the audit log's sequence (migration 14): the queue's id sequence must not
-- tell the API how many jobs were ever queued, nor be reset to break enqueueing.
revoke all on sequence public.media_jobs_id_seq from public, anon, authenticated;

-- 'apartments/<uid>/photo.jpg' from a public URL of THIS project's uploads bucket
-- (buzz_secrets.storage_origin, the same check buzz_create makes), decoded; null
-- for anything else (another bucket, another host, not a URL).
create or replace function public.storage_path_from_url(p_url text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_marker constant text := '/storage/v1/object/public/uploads/';
  v_origin text;
  v_rest text;
  v_decoded text;
begin
  if p_url is null then
    return null;
  end if;
  select s.storage_origin into v_origin from public.buzz_secrets s where s.id = 1;
  if v_origin is null or left(p_url, length(v_origin) + length(v_marker)) <> v_origin || v_marker then
    return null;
  end if;
  v_rest := split_part(split_part(substr(p_url, length(v_origin) + length(v_marker) + 1), '?', 1), '#', 1);
  if v_rest = '' then
    return null;
  end if;
  begin
    select convert_from(decode(string_agg(
        case when m[1] is not null then m[1] else encode(convert_to(m[2], 'UTF8'), 'hex') end, '' order by ord), 'hex'), 'UTF8')
    into v_decoded
    from regexp_matches(v_rest, '%([0-9a-fA-F]{2})|([^%]+)', 'g') with ordinality as t(m, ord);
  exception when others then
    v_decoded := v_rest;
  end;
  return nullif(v_decoded, '');
end;
$$;

revoke all on function public.storage_path_from_url(text) from public, anon, authenticated;

-- Does this storage path belong to the row's author? Files are uploaded under
-- <kind>/<owner uuid>/<file> (the insert policy allows nothing else), Buzz files
-- under buzz/anon/<random>. Rows carry whatever URL the client wrote, so only
-- paths the author could have uploaded become jobs the worker performs with the
-- service role. Dot segments are refused outright.
create or replace function public.media_path_owned(p_path text, p_owner uuid, p_buzz boolean)
returns boolean
language sql
immutable
as $$
  select p_path is not null
    and p_path ~ '^[^/]+(/[^/]+)+$'
    and p_path !~ '(^|/)\.\.?(/|$)'
    and case
      when coalesce(p_buzz, false) then split_part(p_path, '/', 1) = 'buzz' and split_part(p_path, '/', 2) = 'anon' and split_part(p_path, '/', 4) = ''
      else p_owner is not null and split_part(p_path, '/', 1) <> 'buzz' and split_part(p_path, '/', 2) = p_owner::text and split_part(p_path, '/', 3) <> ''
    end;
$$;

revoke all on function public.media_path_owned(text, uuid, boolean) from public, anon, authenticated;

create or replace function public.media_enqueue(p_kind text, p_ref text, p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind is null or nullif(btrim(coalesce(p_ref, '')), '') is null then
    return;
  end if;
  insert into public.media_jobs (kind, ref, target_type, target_id)
  values (p_kind, p_ref, p_target_type, p_target_id)
  on conflict (kind, ref) where done_at is null do nothing;
end;
$$;

revoke all on function public.media_enqueue(text, text, text, uuid) from public, anon, authenticated;

-- A newer decision replaces pending jobs of the opposite kind for the same file or asset.
create or replace function public.media_cancel(p_kinds text[], p_ref text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.media_jobs
  set done_at = now(), last_error = 'superseded'
  where done_at is null and kind = any (p_kinds) and ref = p_ref;
$$;

revoke all on function public.media_cancel(text[], text) from public, anon, authenticated;

-- Deleting a row (by its owner, by staff, or by a cascading account deletion)
-- queues its files and videos for removal. One function for every table. Only
-- media the row's author owns is queued (media_path_owned, media_asset_for_video
-- with the owner): the worker deletes with the service role, so a row that
-- names someone else's photo or video must not become their deletion.
create or replace function public.enqueue_media_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(old);
  v_type text := case tg_table_name
    when 'apartments' then 'apartment'
    when 'roommate_posts' then 'roommate'
    when 'items' then 'item'
    when 'feed_posts' then 'post'
    when 'buzz_posts' then 'buzz'
    when 'messages' then 'message'
    when 'media' then 'media'
    when 'profiles' then 'profile'
  end;
  v_owner uuid := case tg_table_name
    when 'apartments' then (v_row ->> 'owner_id')::uuid
    when 'roommate_posts' then (v_row ->> 'author_id')::uuid
    when 'items' then (v_row ->> 'seller_id')::uuid
    when 'feed_posts' then (v_row ->> 'author_id')::uuid
    when 'buzz_posts' then (v_row ->> 'author_id')::uuid
    when 'messages' then (v_row ->> 'sender_id')::uuid
    when 'profiles' then (v_row ->> 'id')::uuid
  end;
  v_url text;
  v_path text;
  v_video jsonb;
  v_asset text;
  v_prefix text;
begin
  if tg_table_name in ('apartments', 'roommate_posts', 'items', 'feed_posts', 'buzz_posts') then
    for v_url in select jsonb_array_elements_text(case when jsonb_typeof(v_row -> 'images') = 'array' then v_row -> 'images' else '[]'::jsonb end) loop
      v_path := public.storage_path_from_url(v_url);
      if v_path is not null and public.media_path_owned(v_path, v_owner, tg_table_name = 'buzz_posts') then
        perform public.media_cancel(array['quarantine', 'release'], v_path);
        perform public.media_enqueue('delete_object', v_path, v_type, old.id);
      end if;
    end loop;
    for v_video in select jsonb_array_elements(case when jsonb_typeof(v_row -> 'videos') = 'array' then v_row -> 'videos' else '[]'::jsonb end) loop
      v_asset := public.media_asset_for_video(v_video, v_owner);
      if v_asset is not null then
        perform public.media_cancel(array['mux_disable', 'mux_enable'], v_asset);
        perform public.media_enqueue('mux_delete', v_asset, v_type, old.id);
      end if;
    end loop;
  elsif tg_table_name = 'messages' then
    v_path := public.storage_path_from_url(v_row ->> 'image_url');
    if v_path is not null and public.media_path_owned(v_path, v_owner, false) then
      perform public.media_cancel(array['quarantine', 'release'], v_path);
      perform public.media_enqueue('delete_object', v_path, v_type, old.id);
    end if;
  elsif tg_table_name = 'media' then
    v_asset := nullif(v_row ->> 'provider_asset_id', '');
    if v_asset is not null then
      perform public.media_cancel(array['mux_disable', 'mux_enable'], v_asset);
      perform public.media_enqueue('mux_delete', v_asset, v_type, old.id);
    end if;
  elsif tg_table_name = 'profiles' then
    -- Account deletion: the avatar, then everything the person ever uploaded under
    -- their own folders. Never buzz/: those files are anonymous and go per post.
    v_path := public.storage_path_from_url(v_row ->> 'avatar_url');
    if v_path is not null and public.media_path_owned(v_path, v_owner, false) then
      perform public.media_enqueue('delete_object', v_path, v_type, old.id);
    end if;
    foreach v_prefix in array array['apartments', 'items', 'roommates', 'avatars', 'messages', 'posts'] loop
      perform public.media_enqueue('delete_prefix', v_prefix || '/' || old.id::text || '/', v_type, old.id);
    end loop;
  end if;
  return old;
end;
$$;

revoke all on function public.enqueue_media_on_delete() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['apartments', 'roommate_posts', 'items', 'feed_posts', 'buzz_posts', 'messages', 'media', 'profiles'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_enqueue_media', t);
    execute format('create trigger %I after delete on public.%I for each row execute function public.enqueue_media_on_delete()', t || '_enqueue_media', t);
  end loop;
end $$;

-- Worker functions: service role only. Claiming bumps the attempt counter and
-- books the next try (10, 40, 90 ... minutes, capped at six hours), so a job
-- the worker never reports on simply comes back later.
create or replace function public.media_jobs_claim(p_limit int default 20)
returns setof public.media_jobs
language sql
security definer
set search_path = public
as $$
  with due as (
    select j.id
    from public.media_jobs j
    where j.done_at is null and j.next_attempt_at <= now()
    order by j.id
    limit least(greatest(coalesce(p_limit, 20), 1), 200)
    for update skip locked
  )
  update public.media_jobs j
  set attempts = j.attempts + 1,
      claimed_at = now(),
      next_attempt_at = now() + (least(j.attempts + 1, 6) ^ 2) * interval '10 minutes'
  from due
  where j.id = due.id
  returning j.*;
$$;

revoke all on function public.media_jobs_claim(int) from public, anon, authenticated;

create or replace function public.media_jobs_done(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.media_jobs set done_at = now(), last_error = null where id = p_id and done_at is null;
$$;

revoke all on function public.media_jobs_done(bigint) from public, anon, authenticated;

create or replace function public.media_jobs_failed(p_id bigint, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.media_jobs set last_error = left(p_error, 1000) where id = p_id and done_at is null;
$$;

revoke all on function public.media_jobs_failed(bigint, text) from public, anon, authenticated;

-- Staff view of the queue (moderators and up).
drop function if exists public.admin_media_jobs_list(boolean, int);

create function public.admin_media_jobs_list(p_pending_only boolean default true, p_limit int default 50)
returns table (
  id bigint, kind text, ref text, target_type text, target_id uuid, attempts int, last_error text,
  next_attempt_at timestamptz, created_at timestamptz, done_at timestamptz, claimed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require('moderator');
  return query
    select j.id, j.kind, j.ref, j.target_type, j.target_id, j.attempts, j.last_error, j.next_attempt_at, j.created_at, j.done_at, j.claimed_at
    from public.media_jobs j
    where not coalesce(p_pending_only, true) or j.done_at is null
    order by j.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_media_jobs_list(boolean, int) from public, anon;

grant execute on function public.admin_media_jobs_list(boolean, int) to authenticated;

create or replace function public.admin_media_jobs_retry(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.media_jobs;
begin
  perform public.staff_require('moderator');
  select * into v_job from public.media_jobs j where j.id = p_id and j.done_at is null;
  if v_job.id is null then
    raise exception 'Job not found';
  end if;
  -- Claimed a moment ago and not reported failed: a worker is still on it.
  if v_job.claimed_at is not null and v_job.claimed_at > now() - interval '15 minutes' and v_job.last_error is null then
    raise exception 'This job is running right now. Try again in a few minutes.';
  end if;
  update public.media_jobs set next_attempt_at = now(), last_error = null where id = p_id;
  perform public.staff_log('media.retry', 'media_job', p_id::text,
    jsonb_build_object('kind', v_job.kind, 'ref', v_job.ref, 'attempts', v_job.attempts, 'last_error', v_job.last_error));
end;
$$;

revoke all on function public.admin_media_jobs_retry(bigint) from public, anon;

grant execute on function public.admin_media_jobs_retry(bigint) to authenticated;

create or replace function public.admin_media_jobs_stats()
returns table (pending bigint, failing bigint, done bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require('moderator');
  return query
    select
      count(*) filter (where j.done_at is null),
      count(*) filter (where j.done_at is null and j.attempts >= 3),
      count(*) filter (where j.done_at is not null)
    from public.media_jobs j;
end;
$$;

revoke all on function public.admin_media_jobs_stats() from public, anon;

grant execute on function public.admin_media_jobs_stats() to authenticated;

-- -----------------------------------------------------------------------------
-- E. Audit log
-- -----------------------------------------------------------------------------
-- Nothing to create: every function above writes through public.staff_log()
-- (migration 14) with the actor and details that answer "who changed what and
-- why". Actions: user.suspend, user.unsuspend, content.hide, content.restore,
-- content.delete, content.view, report.resolve, report.reopen, media.retry.
-- Read them back with admin_audit_list().

-- -----------------------------------------------------------------------------
-- Like migration 14: the internal helpers are for the database owner only, even
-- for the service role. The worker functions (media_jobs_claim/done/failed) are
-- deliberately NOT in this list: the worker calls them with the service key.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function
      public.block_suspended_writes(), public.keep_moderation_columns(), public.admin_content_table(text),
      public.admin_content_snapshot(text, uuid), public.media_asset_for_video(jsonb, uuid), public.moderation_sync_copies(text, uuid, jsonb, boolean),
      public.storage_path_from_url(text), public.media_enqueue(text, text, text, uuid), public.media_cancel(text[], text),
      public.media_path_owned(text, uuid, boolean), public.enqueue_media_on_delete()
      from service_role;
  end if;
end $$;

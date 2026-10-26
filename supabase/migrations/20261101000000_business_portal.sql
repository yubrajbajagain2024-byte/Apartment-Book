-- =============================================================================
-- CampConnect - migration 39: the business portal (business.campconnect.com)
--  * profiles.role: student (everyone so far) | business_owner | business_staff | admin.
--    Nobody can change a role through the API: a trigger keeps it, and only
--    grant_role() (database owner only) and the sign-up trigger set it.
--  * businesses: one per owner, created by the sign-up trigger with
--    account_type = 'business' in the user metadata, pending until an admin
--    approves it (admin_review_business, only once the owner confirmed their
--    email). Its standing decides everything its team may do:
--      pending    the profile, deal drafts and the team; nothing students see
--      approved   listings, deals, inquiries, the numbers
--      rejected   the owner may edit the profile; nothing else
--      suspended  nothing: listings archived and hidden, deals paused, chats,
--                 numbers and uploads closed, the moment it is suspended
--  * Labels: "Verified Partner" only for a business an admin verified, with what
--    was checked on record (admin_set_verified); "Sponsored" only for a listing
--    or deal with a paid promotion running now, recorded by an admin with its
--    payment reference (admin_record_promotion). listing_sponsored() and
--    deal_sponsored() are the computed fields the apps read.
--  * business_members: the team (owner + staff; one business per account).
--    business_invites: an address the owner invited. Whoever signs up with that
--    address from the invite's link becomes business_staff, and joins the team
--    (the invite used up) only once that address is confirmed.
--  * apartments.business_id: a listing posted from the portal, owned by the
--    business's owner whoever on the team posts it.
--  * deals: offers with campus targeting (university_ids, empty = every campus).
--  * Inquiries: a student starts a chat with a business from one of its listings
--    or deals (start_business_inquiry); every team member is in it. Businesses
--    cannot start chats, be messaged directly, be added to groups or call, and
--    write only after the student, only while approved; a student cannot write
--    to a business that is not approved.
--  * Business accounts stay out of the student side: a signed-in business
--    session reads no student content (feeds, comments, likes, roommate posts,
--    items, classes, follows, student listings) and sees only the profiles of its
--    team and of students in its inquiries; it writes nothing there, never shows
--    or sees presence and activity status, and people search leaves it out.
--    Public content stays public to signed-out visitors, as it always was.
--  * Analytics for the portal: per-listing and per-deal views, saves, contacts
--    and inquiries (business_listing_stats, business_deal_stats, business_overview).
-- Every new rule on an existing table is a policy of its own (restrictive where
-- it narrows): the policies before this migration, including those the
-- admin/moderation migrations applied outside this repo, are left as they were.
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Roles
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'business_owner', 'business_staff', 'admin'));
create index if not exists profiles_role_idx on public.profiles (role) where role <> 'student';
-- profiles is readable column by column (migration 22): the new column needs its own grant.
grant select (role) on table public.profiles to anon, authenticated;

-- The role of an account ('student' for an unknown id or a signed-out caller). Readable by everyone, like the column.
create or replace function public.role_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.role from public.profiles p where p.id = p_user), 'student');
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.role_of(auth.uid());
$$;

create or replace function public.is_business_account(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.role_of(p_user) in ('business_owner', 'business_staff');
$$;

-- The caller may use the student side: anyone but a business account (signed out included).
create or replace function public.student_side_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_business_account(auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.role_of(auth.uid()) = 'admin';
$$;

-- Every administrative function starts here.
create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only CampConnect admins can do this' using errcode = '42501';
  end if;
end;
$$;

-- The role is an ordinary column under profiles_update_own, so a trigger keeps it unless the transaction-local flag
-- app.role_change is on, which only the sign-up trigger and grant_role() raise. A profile inserted any other way is a
-- student.
create or replace function public.keep_role()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.role_change', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      new.role := 'student';
    else
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_keep_role on public.profiles;
create trigger profiles_keep_role
  before insert or update of role on public.profiles
  for each row execute function public.keep_role();

-- The only way to make someone an admin (or demote them): run as the database owner, for example in the SQL editor:
--   select public.grant_role('<profile id>', 'admin');
create or replace function public.grant_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role not in ('student', 'business_owner', 'business_staff', 'admin') then
    raise exception 'Unknown role %', p_role;
  end if;
  perform set_config('app.role_change', 'on', true);
  update public.profiles set role = p_role where id = p_user;
  if not found then
    raise exception 'No profile with id %', p_user;
  end if;
end;
$$;

-- A project with the staff table (the admin section applied outside this repo): its owners and admins are admins here too.
do $$
begin
  if to_regclass('public.staff') is not null then
    perform set_config('app.role_change', 'on', true);
    update public.profiles p
    set role = 'admin'
    from public.staff s
    where s.user_id = p.id and s.role in ('owner', 'admin') and p.role = 'student';
  end if;
end $$;

-- Has this account confirmed its email? (Read through to_jsonb so this file also runs where auth.users is a stand-in.)
create or replace function public.account_confirmed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (to_jsonb(u) ->> 'email_confirmed_at') is not null from auth.users u where u.id = p_user), false);
$$;

-- -----------------------------------------------------------------------------
-- 2. Businesses, teams, invites
-- -----------------------------------------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  category text not null default 'other'
    check (category in ('housing', 'food', 'retail', 'services', 'fitness', 'entertainment', 'education', 'other')),
  description text not null default '' check (char_length(description) <= 2000),
  website text check (website is null or char_length(website) <= 300),
  phone text check (phone is null or char_length(phone) <= 40),
  contact_email text check (contact_email is null or char_length(contact_email) <= 320),
  address text check (address is null or char_length(address) <= 240),
  city text check (city is null or char_length(city) <= 120),
  logo_url text check (logo_url is null or char_length(logo_url) <= 2000),
  -- The campuses it serves (the default targeting for its deals); empty = every campus.
  university_ids uuid[] not null default '{}' check (cardinality(university_ids) <= 50),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  verified_partner boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references public.profiles (id) on delete set null,
  -- What the admin checked (a licence, a site visit, a call to the leasing office). Never shown to students.
  verification_note text check (verification_note is null or char_length(verification_note) <= 1000),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.businesses add column if not exists verified_at timestamptz;
alter table public.businesses add column if not exists verified_by uuid references public.profiles (id) on delete set null;
alter table public.businesses add column if not exists verification_note text check (verification_note is null or char_length(verification_note) <= 1000);
-- "Verified Partner" means verified: only an approved business, with when, by whom and what was checked on record.
alter table public.businesses drop constraint if exists businesses_verified_check;
alter table public.businesses add constraint businesses_verified_check
  check (not verified_partner or (status = 'approved' and verified_at is not null and verification_note is not null));

create unique index if not exists businesses_owner_id_key on public.businesses (owner_id);
create index if not exists businesses_status_idx on public.businesses (status, created_at desc);

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

create table if not exists public.business_members (
  -- One business per account.
  user_id uuid primary key references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists business_members_business_id_idx on public.business_members (business_id);

create table if not exists public.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  -- 256 random bits; the join link carries it.
  token text not null unique default encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text)::bytea), 'hex'),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null
);

create unique index if not exists business_invites_pending_key on public.business_invites (business_id, email) where accepted_at is null;
create index if not exists business_invites_email_idx on public.business_invites (email) where accepted_at is null;

-- Helpers the policies use (security definer, so they never recurse into the policies).
create or replace function public.business_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.business_id from public.business_members m where m.user_id = p_user;
$$;

create or replace function public.business_status(p_business uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select b.status from public.businesses b where b.id = p_business;
$$;

create or replace function public.business_owner_id(p_business uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.owner_id from public.businesses b where b.id = p_business;
$$;

-- On the team, whatever the standing (to read its own business row and status).
create or replace function public.is_business_member(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_business is not null and auth.uid() is not null and public.business_of(auth.uid()) = p_business, false);
$$;

create or replace function public.is_business_owner_of(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_business is not null and auth.uid() is not null and exists (
    select 1 from public.business_members m where m.user_id = auth.uid() and m.business_id = p_business and m.role = 'owner'
  ), false);
$$;

create or replace function public.business_approved(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.business_status(p_business) = 'approved', false);
$$;

-- On the team of a business in good standing (pending or approved): the profile, deals, the team.
create or replace function public.team_can_manage(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_business_member(p_business) and public.business_status(p_business) in ('pending', 'approved'), false);
$$;

-- On the team of an approved business: listings, inquiries.
create or replace function public.team_can_operate(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_business_member(p_business) and public.business_status(p_business) = 'approved', false);
$$;

-- The owner of a business that is not suspended (a rejected one may fix its profile and ask again).
create or replace function public.owner_can_edit(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_business_owner_of(p_business) and public.business_status(p_business) in ('pending', 'approved', 'rejected'), false);
$$;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.business_invites enable row level security;

-- Approved businesses are public (the name and logo on their listings); a team sees its own at every standing (the
-- portal shows a suspended team why); admins see all. What students may read is column by column: the contact address,
-- the review and what verification checked stay with the team and the admins (my_business(), admin_list_businesses()).
drop policy if exists "businesses_select" on public.businesses;
create policy "businesses_select" on public.businesses
  for select using (status = 'approved' or public.is_business_member(id) or public.is_admin());

revoke select on table public.businesses from public, anon, authenticated;
grant select (id, owner_id, name, category, description, website, phone, address, city, logo_url, university_ids, status, verified_partner, verified_at, created_at, updated_at)
  on table public.businesses to anon, authenticated;
revoke insert, delete, truncate on table public.businesses from public, anon, authenticated;

-- The owner edits the profile. The review columns are kept by a trigger (below); nobody inserts or deletes rows directly.
drop policy if exists "businesses_update_owner" on public.businesses;
create policy "businesses_update_owner" on public.businesses
  for update to authenticated using (public.owner_can_edit(id)) with check (public.owner_can_edit(id));

drop policy if exists "business_members_select" on public.business_members;
create policy "business_members_select" on public.business_members
  for select to authenticated using (user_id = auth.uid() or public.team_can_manage(business_id) or public.is_admin());
revoke insert, update, delete, truncate on table public.business_members from public, anon, authenticated;

drop policy if exists "business_invites_select" on public.business_invites;
create policy "business_invites_select" on public.business_invites
  for select to authenticated using (public.is_business_owner_of(business_id) and public.team_can_manage(business_id));
revoke insert, update, delete, truncate on table public.business_invites from public, anon, authenticated;

-- Status, verification, the review and the owner change only through the admin functions (which raise the
-- transaction-local flag app.business_review); an owner's edit keeps them whatever it sends.
create or replace function public.businesses_keep_review()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.business_review', true) is distinct from 'on' then
    new.status := old.status;
    new.verified_partner := old.verified_partner;
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
    new.verification_note := old.verification_note;
    new.review_note := old.review_note;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_keep_review on public.businesses;
create trigger businesses_keep_review
  before update on public.businesses
  for each row execute function public.businesses_keep_review();

-- The signed-in person's business with every column, and their place on the team; null for anyone else.
create or replace function public.my_business()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('role', m.role, 'business', to_json(b))
  from public.business_members m
  join public.businesses b on b.id = m.business_id
  where m.user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 3. Deals
-- -----------------------------------------------------------------------------
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  -- "20% off", "Free delivery", ...
  discount_label text check (discount_label is null or char_length(discount_label) <= 60),
  code text check (code is null or char_length(code) <= 60),
  link_url text check (link_url is null or char_length(link_url) <= 2000),
  image_url text check (image_url is null or char_length(image_url) <= 2000),
  -- Campus targeting: the universities whose students see it; empty = every campus.
  university_ids uuid[] not null default '{}' check (cardinality(university_ids) <= 50),
  starts_at timestamptz not null default now(),
  ends_at timestamptz check (ends_at is null or ends_at > starts_at),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deals_business_id_idx on public.deals (business_id, created_at desc);
create index if not exists deals_live_idx on public.deals (status, starts_at, ends_at) where status = 'active';

drop trigger if exists deals_set_updated_at on public.deals;
create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

alter table public.deals enable row level security;

-- Students (signed in or not) see a deal while it is active, running and its business approved; a team in good standing
-- sees all of its own (a pending business drafts them); admins see everything. A suspended team sees none.
drop policy if exists "deals_select" on public.deals;
create policy "deals_select" on public.deals
  for select using (
    public.team_can_manage(business_id)
    or public.is_admin()
    or (status = 'active' and starts_at <= now() and (ends_at is null or ends_at > now()) and public.business_approved(business_id))
  );

drop policy if exists "deals_insert_member" on public.deals;
create policy "deals_insert_member" on public.deals
  for insert to authenticated with check (public.team_can_manage(business_id) and created_by = auth.uid());

drop policy if exists "deals_update_member" on public.deals;
create policy "deals_update_member" on public.deals
  for update to authenticated using (public.team_can_manage(business_id)) with check (public.team_can_manage(business_id));

drop policy if exists "deals_delete_member" on public.deals;
create policy "deals_delete_member" on public.deals
  for delete to authenticated using (public.team_can_manage(business_id));

-- Deals count views like listings do (one per viewer per day, never the business's own people).
alter table public.post_views drop constraint if exists post_views_target_type_check;
alter table public.post_views add constraint post_views_target_type_check
  check (target_type in ('apartment', 'item', 'roommate', 'post', 'deal'));

create or replace function public.listing_owner(p_target_type text, p_target_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_target_type
    when 'apartment' then (select owner_id from public.apartments where id = p_target_id)
    when 'item' then (select seller_id from public.items where id = p_target_id)
    when 'roommate' then (select author_id from public.roommate_posts where id = p_target_id)
    when 'post' then (select author_id from public.feed_posts where id = p_target_id)
    when 'deal' then (select b.owner_id from public.deals d join public.businesses b on b.id = d.business_id where d.id = p_target_id)
  end;
$$;

create or replace function public.record_view(p_target_type text, p_target_id uuid, p_viewer_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_owner uuid;
begin
  if p_target_type not in ('apartment', 'item', 'roommate', 'post', 'deal') or p_target_id is null then
    return;
  end if;
  v_owner := public.listing_owner(p_target_type, p_target_id);
  if v_owner is null or (auth.uid() is not null and v_owner = auth.uid()) then
    return;
  end if;
  -- A team looking at its own listing or deal does not count either.
  if auth.uid() is not null and public.is_business_account(auth.uid()) and public.business_of(auth.uid()) = public.business_of(v_owner) then
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

-- -----------------------------------------------------------------------------
-- 4. Signing up as a business, joining a team
-- -----------------------------------------------------------------------------
-- Sign-ups stay limited to university addresses (migration 2), with one more exception: a business sign-up
-- (account_type = 'business' in the user metadata), which can never become a student account. A project with the staff
-- table keeps its staff-invite exception.
do $$
declare
  v_staff text := case
    when to_regclass('public.staff_invites') is not null
      then ' and not exists (select 1 from public.staff_invites si where si.email = lower(btrim(coalesce(new.email::text, ''''))))'
    else ''
  end;
begin
  execute $f$
create or replace function public.enforce_university_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
begin
  if public.university_for_email(new.email) is null
     and coalesce(new.raw_user_meta_data ->> 'account_type', '') <> 'business'$f$ || v_staff || $f$ then
    raise exception 'Please sign up with your university email address (for example you@txstate.edu).'
      using errcode = 'P0001';
  end if;
  return new;
end;
$body$;
$f$;
end $$;

-- Joins the team an invite is for, using the invite up, when everything still holds: the token in the account's own
-- sign-up metadata, for this very address, unused and unexpired; the account made after the invite (so not one
-- someone registered first); the business still in good standing and the inviter still its owner; the account a
-- staff account on no team yet. Called once the address is confirmed, never before. Returns whether it joined.
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

-- The profile row for a new auth user (migration 2), plus the business side. A business sign-up from an invite link
-- (business_invite in the metadata) is a staff account that joins the team only once its address is confirmed (below);
-- any other business sign-up owns a new, pending business named in the metadata (business_name, business_category,
-- business_website, business_phone, business_city, business_university_id). Business accounts get no university.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text := lower(btrim(coalesce(new.email::text, '')));
  v_name text;
  v_business boolean := coalesce(v_meta ->> 'account_type', '') = 'business';
  v_role text := 'student';
  v_business_id uuid;
  v_campus uuid;
begin
  v_name := coalesce(
    nullif(v_meta ->> 'full_name', ''),
    nullif(v_meta ->> 'name', ''),
    split_part(v_email, '@', 1)
  );
  if v_business then
    v_role := case when coalesce(v_meta ->> 'business_invite', '') <> '' then 'business_staff' else 'business_owner' end;
  end if;

  perform set_config('app.role_change', 'on', true);
  insert into public.profiles (id, full_name, avatar_url, university_id, role)
  values (
    new.id,
    v_name,
    v_meta ->> 'avatar_url',
    case when v_business then null else public.university_for_email(new.email) end,
    v_role
  )
  on conflict (id) do nothing;

  if v_role = 'business_owner' then
    if (v_meta ->> 'business_university_id') ~ '^[0-9a-fA-F-]{36}$' then
      select id into v_campus from public.universities where id = (v_meta ->> 'business_university_id')::uuid;
    end if;
    insert into public.businesses (owner_id, name, category, website, phone, contact_email, city, university_ids)
    values (
      new.id,
      coalesce(nullif(left(btrim(v_meta ->> 'business_name'), 120), ''), v_name || '''s business'),
      case when v_meta ->> 'business_category' in ('housing', 'food', 'retail', 'services', 'fitness', 'entertainment', 'education', 'other')
        then v_meta ->> 'business_category' else 'other' end,
      nullif(left(btrim(v_meta ->> 'business_website'), 300), ''),
      nullif(left(btrim(v_meta ->> 'business_phone'), 40), ''),
      nullif(v_email, ''),
      nullif(left(btrim(v_meta ->> 'business_city'), 120), ''),
      case when v_campus is null then '{}'::uuid[] else array[v_campus] end
    )
    returning id into v_business_id;
    insert into public.business_members (user_id, business_id, role) values (new.id, v_business_id, 'owner')
    on conflict (user_id) do nothing;
  elsif v_role = 'business_staff' and (to_jsonb(new) ->> 'email_confirmed_at') is not null then
    -- A project that confirms addresses at sign-up (no confirmation email): the address is confirmed already.
    perform public.business_claim_invite(new.id, new.email, v_meta, (to_jsonb(new) ->> 'created_at')::timestamptz);
  end if;
  return new;
end;
$$;

create or replace function public.business_invite_claim_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.business_claim_invite(new.id, new.email, coalesce(new.raw_user_meta_data, '{}'::jsonb), (to_jsonb(new) ->> 'created_at')::timestamptz);
  return new;
end;
$$;

-- The moment an address is confirmed (Supabase Auth sets email_confirmed_at when the link is opened). Skipped where
-- auth.users has no such column (the offline test database adds it before checking this).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at') then
    execute 'drop trigger if exists business_invite_claim_on_confirm on auth.users';
    execute 'create trigger business_invite_claim_on_confirm after update of email_confirmed_at on auth.users
      for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
      execute function public.business_invite_claim_on_confirm()';
  end if;
end $$;

-- The join page reads an invite by its token before anyone is signed in: the business's name, the address it is for,
-- and whether it can still be used. Nothing else about the business or the team.
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

-- The owner invites a colleague by email; the portal shows the join link (business.campconnect.com/join/<token>).
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

-- The owner removes a staff member: they leave the team's chats at once (trigger below) and the portal.
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

-- -----------------------------------------------------------------------------
-- 5. Listings from the portal
-- -----------------------------------------------------------------------------
alter table public.apartments add column if not exists business_id uuid;
alter table public.apartments drop constraint if exists apartments_business_id_fkey;
alter table public.apartments add constraint apartments_business_id_fkey
  foreign key (business_id) references public.businesses (id) on delete set null;
create index if not exists apartments_business_id_idx on public.apartments (business_id) where business_id is not null;

-- Who may write a listing row: a student, their own (never in a business's name); a team member, one for their own
-- approved business, owned by the business's owner (so it never goes with a staff account, and stats and "saved your
-- listing" go to the business). A business account posts nothing as a plain student.
create or replace function public.listing_write_allowed(p_owner uuid, p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(case
    when p_business is null then auth.uid() = p_owner and public.student_side_ok()
    else public.team_can_operate(p_business) and p_owner = public.business_owner_id(p_business)
  end, false);
$$;

-- May the caller change or remove this listing at all: their own student listing, or one of their approved business.
create or replace function public.listing_row_editable(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_business is null then public.student_side_ok() else public.team_can_operate(p_business) end;
$$;

-- The policies before this migration stay as they were; these add the business's side. The team works on every
-- listing of an approved business, whoever posted it.
drop policy if exists "apartments_insert_team" on public.apartments;
create policy "apartments_insert_team" on public.apartments
  for insert to authenticated with check (business_id is not null and public.listing_write_allowed(owner_id, business_id));
drop policy if exists "apartments_update_team" on public.apartments;
create policy "apartments_update_team" on public.apartments
  for update to authenticated using (business_id is not null and public.team_can_operate(business_id)) with check (public.listing_write_allowed(owner_id, business_id));
drop policy if exists "apartments_delete_team" on public.apartments;
create policy "apartments_delete_team" on public.apartments
  for delete to authenticated using (business_id is not null and public.team_can_operate(business_id));

-- ...and what holds for everyone, whichever policy let the row through.
drop policy if exists "apartments_business_rules_insert" on public.apartments;
create policy "apartments_business_rules_insert" on public.apartments
  as restrictive for insert to authenticated with check (public.listing_write_allowed(owner_id, business_id));
drop policy if exists "apartments_business_rules_update" on public.apartments;
create policy "apartments_business_rules_update" on public.apartments
  as restrictive for update to authenticated using (public.listing_row_editable(business_id)) with check (public.listing_write_allowed(owner_id, business_id));
drop policy if exists "apartments_business_rules_delete" on public.apartments;
create policy "apartments_business_rules_delete" on public.apartments
  as restrictive for delete to authenticated using (public.listing_row_editable(business_id));
-- A listing of a business that is not approved is gone for students, whatever its status says.
drop policy if exists "apartments_business_standing" on public.apartments;
create policy "apartments_business_standing" on public.apartments
  as restrictive for select using (business_id is null or public.business_approved(business_id) or public.team_can_manage(business_id) or public.is_admin());
-- A business session reads its own business's listings and nobody else's.
drop policy if exists "apartments_business_session" on public.apartments;
create policy "apartments_business_session" on public.apartments
  as restrictive for select to authenticated using ((select public.student_side_ok()) or (business_id is not null and public.team_can_manage(business_id)));

-- -----------------------------------------------------------------------------
-- 6. Labels: Verified Partner and paid promotions
-- -----------------------------------------------------------------------------
-- A paid promotion of one listing or deal over a period, recorded by an admin once it is paid (the payment itself
-- happens outside CampConnect; payment_reference is the invoice or receipt). Only an active one running now makes the
-- label "Sponsored"; nothing else does.
create table if not exists public.listing_promotions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  apartment_id uuid references public.apartments (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  payment_reference text not null check (char_length(btrim(payment_reference)) between 3 and 200),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint listing_promotions_one_target check (num_nonnulls(apartment_id, deal_id) = 1),
  constraint listing_promotions_period check (ends_at > starts_at)
);

create index if not exists listing_promotions_apartment_idx on public.listing_promotions (apartment_id, ends_at) where apartment_id is not null;
create index if not exists listing_promotions_deal_idx on public.listing_promotions (deal_id, ends_at) where deal_id is not null;
create index if not exists listing_promotions_business_idx on public.listing_promotions (business_id, created_at desc);

alter table public.listing_promotions enable row level security;
revoke insert, update, delete, truncate on table public.listing_promotions from public, anon, authenticated;
drop policy if exists "listing_promotions_select" on public.listing_promotions;
create policy "listing_promotions_select" on public.listing_promotions
  for select to authenticated using (public.team_can_manage(business_id) or public.is_admin());

-- The computed fields the apps read (?select=…,sponsored:listing_sponsored): a paid promotion running now, for an
-- approved business.
create or replace function public.listing_sponsored(a public.apartments)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a.business_id is not null and public.business_approved(a.business_id) and exists (
    select 1 from public.listing_promotions p
    where p.apartment_id = a.id and p.status = 'active' and p.starts_at <= now() and p.ends_at > now()
  );
$$;

create or replace function public.deal_sponsored(d public.deals)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.business_approved(d.business_id) and exists (
    select 1 from public.listing_promotions p
    where p.deal_id = d.id and p.status = 'active' and p.starts_at <= now() and p.ends_at > now()
  );
$$;

-- -----------------------------------------------------------------------------
-- 7. Inquiries: the only chats a business is in
-- -----------------------------------------------------------------------------
alter table public.conversations
  add column if not exists business_id uuid,
  add column if not exists inquiry_target_type text,
  add column if not exists inquiry_target_id uuid;
alter table public.conversations drop constraint if exists conversations_business_id_fkey;
alter table public.conversations add constraint conversations_business_id_fkey
  foreign key (business_id) references public.businesses (id) on delete set null;
alter table public.conversations drop constraint if exists conversations_inquiry_target_type_check;
alter table public.conversations add constraint conversations_inquiry_target_type_check
  check (inquiry_target_type is null or inquiry_target_type in ('apartment', 'deal'));
create index if not exists conversations_business_id_idx on public.conversations (business_id) where business_id is not null;
create index if not exists conversations_inquiry_idx on public.conversations (inquiry_target_type, inquiry_target_id) where inquiry_target_id is not null;

-- A student's chat with the business behind a listing or a deal: one per student and business, named after the
-- business, with every team member in it. Businesses cannot call this.
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

-- A new team member joins every chat the business has; a removed one leaves them.
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

-- No cold messages: a business cannot open a chat, with anyone (migration 10's function, with that rule), and a student
-- reaches a business through its listings, never by messaging one of its people.
create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_business_account(v_me) then
    raise exception 'Businesses can only reply to students who contacted them.';
  end if;
  if p_other_user_id is null or p_other_user_id = v_me then
    raise exception 'Invalid user';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_user_id) then
    raise exception 'User not found';
  end if;
  if public.is_business_account(p_other_user_id) then
    raise exception 'Message this business from one of its listings.';
  end if;
  if public.is_blocked_either_way(p_other_user_id) then
    raise exception 'You cannot message this person';
  end if;

  v_key := least(v_me, p_other_user_id)::text || ':' || greatest(v_me, p_other_user_id)::text;

  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  begin
    insert into public.conversations (type, direct_key, created_by)
    values ('direct', v_key, v_me)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.conversations where direct_key = v_key;
    return v_id;
  end;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other_user_id);
  return v_id;
end;
$$;

-- Groups: never made by a business, and business accounts are left out of the members.
create or replace function public.create_group_conversation(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_business_account(v_me) then
    raise exception 'Businesses can only reply to students who contacted them.';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Group name is required';
  end if;

  insert into public.conversations (type, name, created_by)
  values ('group', trim(p_name), v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id)
  select v_id, u.id
  from (
    select distinct unnest(array_append(coalesce(p_member_ids, '{}'::uuid[]), v_me)) as id
  ) u
  join public.profiles p on p.id = u.id
  where p.role not in ('business_owner', 'business_staff');

  return v_id;
end;
$$;

-- Migration 24's version (no adding people to a course chat), plus the business rules.
create or replace function public.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_business_account(v_me) then
    raise exception 'Businesses can only reply to students who contacted them.';
  end if;
  if not public.is_conversation_member(p_conversation_id, v_me) then
    raise exception 'Not a member of this conversation';
  end if;
  if (select type from public.conversations where id = p_conversation_id) <> 'group' then
    raise exception 'Can only add members to group conversations';
  end if;
  if public.is_course_chat(p_conversation_id) then
    raise exception 'Course chats fill themselves: classmates join by adding the class to their profile.';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  select p_conversation_id, p.id
  from public.profiles p
  where p.id = any (coalesce(p_member_ids, '{}'::uuid[]))
    and p.role not in ('business_owner', 'business_staff')
  on conflict do nothing;
end;
$$;

-- Who may read a chat (its row, its members, its messages): a student, every chat they are in (a business's too, even
-- after it is suspended: the history is theirs); a business account, only its own business's inquiries, and only while
-- the business is approved.
create or replace function public.business_chat_readable(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when c.business_id is null then public.student_side_ok()
      when public.student_side_ok() then true
      else public.team_can_operate(c.business_id)
    end
    from public.conversations c where c.id = p_conversation
  ), false);
$$;

-- Why the caller may not write in this chat now, or null when they may: a student writes to an approved business only;
-- a business account writes only in its own approved business's inquiries, after the student did: a reply.
create or replace function public.chat_write_problem(p_conversation uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  select c.business_id into v_business from public.conversations c where c.id = p_conversation;
  if v_business is null then
    return case when public.student_side_ok() then null else 'Businesses can only reply to students who contacted them.' end;
  end if;
  if public.student_side_ok() then
    return case when public.business_approved(v_business) then null else 'This business isn''t taking messages right now.' end;
  end if;
  if not public.team_can_operate(v_business) then
    return 'Your business can''t send messages right now.';
  end if;
  if not exists (
    select 1 from public.messages m
    where m.conversation_id = p_conversation and m.sender_id is not null and not public.is_business_account(m.sender_id)
  ) then
    return 'Businesses can only reply to students who contacted them.';
  end if;
  return null;
end;
$$;

create or replace function public.chat_write_ok(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_write_problem(p_conversation) is null;
$$;

-- The same rule as a readable error before the row is written (the policy below is the backstop).
create or replace function public.messages_business_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_problem text := public.chat_write_problem(new.conversation_id);
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_business_rules on public.messages;
create trigger messages_business_rules
  before insert on public.messages
  for each row execute function public.messages_business_rules();

drop policy if exists "conversations_business_scope" on public.conversations;
create policy "conversations_business_scope" on public.conversations
  as restrictive for select to authenticated
  using (case when business_id is null then (select public.student_side_ok()) when (select public.student_side_ok()) then true else public.team_can_operate(business_id) end);
drop policy if exists "conversation_members_business_scope" on public.conversation_members;
create policy "conversation_members_business_scope" on public.conversation_members
  as restrictive for select to authenticated using ((select public.student_side_ok()) or public.business_chat_readable(conversation_id));
drop policy if exists "messages_business_scope" on public.messages;
create policy "messages_business_scope" on public.messages
  as restrictive for select to authenticated using ((select public.student_side_ok()) or public.business_chat_readable(conversation_id));
drop policy if exists "messages_business_write" on public.messages;
create policy "messages_business_write" on public.messages
  as restrictive for insert to authenticated with check (public.chat_write_ok(conversation_id));

-- No calls in an inquiry chat, either way (start_call() checks only membership): a business answers in writing.
create or replace function public.no_calls_with_businesses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.conversations c where c.id = new.conversation_id and c.business_id is not null) then
    raise exception 'Calls are not available in chats with a business.' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.calls') is not null then
    drop trigger if exists calls_no_business on public.calls;
    create trigger calls_no_business before insert on public.calls for each row execute function public.no_calls_with_businesses();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Business accounts stay out of the student side
-- -----------------------------------------------------------------------------
create or replace function public.block_business_social_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_business_account(auth.uid()) then
    raise exception 'Business accounts post listings and deals from the business portal; the student side is for students.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Nothing of the student side reaches a business session (signed out, the public pages show what they always did).
do $$
declare
  t text;
begin
  foreach t in array array[
    'feed_posts', 'post_comments', 'post_likes', 'post_comment_votes', 'buzz_posts', 'buzz_comments', 'buzz_votes',
    'buzz_comment_votes', 'roommate_posts', 'items', 'follows', 'profile_classes', 'saved_listings'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_block_business', t);
      execute format('create trigger %I before insert on public.%I for each row execute function public.block_business_social_writes()', t || '_block_business', t);
    end if;
  end loop;
  foreach t in array array[
    'feed_posts', 'post_comments', 'post_likes', 'post_comment_votes', 'roommate_posts', 'items', 'follows',
    'profile_classes', 'saved_listings', 'course_groups'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_no_business_session', t);
      execute format('create policy %I on public.%I as restrictive for select to authenticated using ((select public.student_side_ok()))', t || '_no_business_session', t);
    end if;
  end loop;
end $$;

-- Of the people on CampConnect, a business session sees itself, its team and the students in its own business's
-- inquiries (while it is approved), nobody else: no browsing the student directory.
create or replace function public.business_can_see_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile = auth.uid()
    or exists (
      select 1 from public.business_members me join public.business_members them on them.business_id = me.business_id
      where me.user_id = auth.uid() and them.user_id = p_profile
    )
    or exists (
      select 1
      from public.business_members me
      join public.conversations c on c.business_id = me.business_id
      join public.conversation_members cm on cm.conversation_id = c.id
      where me.user_id = auth.uid() and cm.user_id = p_profile and public.team_can_operate(me.business_id)
    );
$$;

drop policy if exists "profiles_business_scope" on public.profiles;
create policy "profiles_business_scope" on public.profiles
  as restrictive for select to authenticated using ((select public.student_side_ok()) or public.business_can_see_profile(id));

-- Uploads (listing photos, logos, chat files): a business account only while its business is in good standing (or
-- rejected, to fix its logo); a suspended team or an account on no team uploads nothing.
create or replace function public.business_uploads_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.student_side_ok() or coalesce(public.business_status(public.business_of(auth.uid())) in ('pending', 'approved', 'rejected'), false);
$$;

drop policy if exists "objects_business_uploads_insert" on storage.objects;
create policy "objects_business_uploads_insert" on storage.objects
  as restrictive for insert to authenticated with check ((select public.business_uploads_ok()));
drop policy if exists "objects_business_uploads_update" on storage.objects;
create policy "objects_business_uploads_update" on storage.objects
  as restrictive for update to authenticated using ((select public.business_uploads_ok()));

-- Nor do they see who is online. The presence channel and activity_status() (migration 22) answer only someone who
-- shows their own active status, so a business account never does: whatever an insert or an update (set_show_active_status()
-- included) asks, it stays off. Students never see a business's people as online either.
create or replace function public.business_accounts_stay_quiet()
returns trigger
language plpgsql
as $$
begin
  if new.role in ('business_owner', 'business_staff') then
    new.show_active_status := false;
  end if;
  return new;
end;
$$;

-- Named to run after profiles_keep_role, so it sees the role that will be stored.
drop trigger if exists profiles_quiet_business on public.profiles;
create trigger profiles_quiet_business
  before insert or update on public.profiles
  for each row execute function public.business_accounts_stay_quiet();

-- Business accounts made before this trigger existed (none outside a re-run), quiet too.
update public.profiles set show_active_status = false where role in ('business_owner', 'business_staff') and show_active_status;
delete from public.user_activity a using public.profiles p where p.id = a.user_id and p.role in ('business_owner', 'business_staff');

-- -----------------------------------------------------------------------------
-- 9. Analytics for the portal (a team in good standing, and admins)
-- -----------------------------------------------------------------------------
drop function if exists public.business_listing_stats(uuid);
create function public.business_listing_stats(p_business uuid)
returns table (
  listing_id uuid, title text, status text, created_at timestamptz,
  views bigint, views_7d bigint, saves bigint, contacts bigint, inquiries bigint, last_inquiry_at timestamptz, sponsored_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.team_can_manage(p_business) or public.is_admin()) then
    raise exception 'Only the business can see its stats' using errcode = '42501';
  end if;
  return query
  select a.id, a.title, a.status::text, a.created_at,
    (select count(*) from public.post_views v where v.target_type = 'apartment' and v.target_id = a.id),
    (select count(*) from public.post_views v where v.target_type = 'apartment' and v.target_id = a.id and v.created_at > now() - interval '7 days'),
    (select count(*) from public.saved_listings s where s.target_type = 'apartment' and s.target_id = a.id),
    (select count(*) from public.listing_contacts c where c.target_type = 'apartment' and c.target_id = a.id),
    (select count(*) from public.conversations c where c.business_id = p_business and c.inquiry_target_type = 'apartment' and c.inquiry_target_id = a.id),
    (select max(c.last_message_at) from public.conversations c where c.business_id = p_business and c.inquiry_target_type = 'apartment' and c.inquiry_target_id = a.id),
    (select max(p.ends_at) from public.listing_promotions p where p.apartment_id = a.id and p.status = 'active' and p.starts_at <= now() and p.ends_at > now())
  from public.apartments a
  where a.business_id = p_business
  order by a.created_at desc;
end;
$$;

drop function if exists public.business_deal_stats(uuid);
create function public.business_deal_stats(p_business uuid)
returns table (
  deal_id uuid, title text, status text, created_at timestamptz,
  views bigint, views_7d bigint, inquiries bigint, last_inquiry_at timestamptz, sponsored_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.team_can_manage(p_business) or public.is_admin()) then
    raise exception 'Only the business can see its stats' using errcode = '42501';
  end if;
  return query
  select d.id, d.title, d.status, d.created_at,
    (select count(*) from public.post_views v where v.target_type = 'deal' and v.target_id = d.id),
    (select count(*) from public.post_views v where v.target_type = 'deal' and v.target_id = d.id and v.created_at > now() - interval '7 days'),
    (select count(*) from public.conversations c where c.business_id = p_business and c.inquiry_target_type = 'deal' and c.inquiry_target_id = d.id),
    (select max(c.last_message_at) from public.conversations c where c.business_id = p_business and c.inquiry_target_type = 'deal' and c.inquiry_target_id = d.id),
    (select max(p.ends_at) from public.listing_promotions p where p.deal_id = d.id and p.status = 'active' and p.starts_at <= now() and p.ends_at > now())
  from public.deals d
  where d.business_id = p_business
  order by d.created_at desc;
end;
$$;

-- The dashboard's headline numbers.
create or replace function public.business_overview(p_business uuid)
returns table (active_listings bigint, active_deals bigint, views_30d bigint, inquiries bigint, inquiries_30d bigint, team bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.team_can_manage(p_business) or public.is_admin()) then
    raise exception 'Only the business can see its stats' using errcode = '42501';
  end if;
  return query
  select
    (select count(*) from public.apartments a where a.business_id = p_business and a.status = 'active'),
    (select count(*) from public.deals d where d.business_id = p_business and d.status = 'active' and (d.ends_at is null or d.ends_at > now())),
    (select count(*) from public.post_views v
      where v.created_at > now() - interval '30 days'
        and ((v.target_type = 'apartment' and v.target_id in (select a.id from public.apartments a where a.business_id = p_business))
          or (v.target_type = 'deal' and v.target_id in (select d.id from public.deals d where d.business_id = p_business)))),
    (select count(*) from public.conversations c where c.business_id = p_business),
    (select count(*) from public.conversations c where c.business_id = p_business and c.created_at > now() - interval '30 days'),
    (select count(*) from public.business_members m where m.business_id = p_business);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Admin: review, verification, promotions
-- -----------------------------------------------------------------------------
drop function if exists public.admin_list_businesses(text);
create function public.admin_list_businesses(p_status text default null)
returns table (
  id uuid, name text, category text, description text, website text, phone text, contact_email text, address text, city text,
  logo_url text, university_ids uuid[], status text, verified_partner boolean, verified_at timestamptz, verification_note text,
  review_note text, reviewed_at timestamptz, created_at timestamptz, owner_id uuid, owner_name text, owner_email text,
  owner_confirmed boolean, members bigint, listings bigint, deals bigint, active_promotions bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select b.id, b.name, b.category, b.description, b.website, b.phone, b.contact_email, b.address, b.city,
    b.logo_url, b.university_ids, b.status, b.verified_partner, b.verified_at, b.verification_note,
    b.review_note, b.reviewed_at, b.created_at, b.owner_id, p.full_name, u.email::text,
    public.account_confirmed(b.owner_id),
    (select count(*) from public.business_members m where m.business_id = b.id),
    (select count(*) from public.apartments a where a.business_id = b.id),
    (select count(*) from public.deals d where d.business_id = b.id),
    (select count(*) from public.listing_promotions lp where lp.business_id = b.id and lp.status = 'active' and lp.ends_at > now())
  from public.businesses b
  join public.profiles p on p.id = b.owner_id
  left join auth.users u on u.id = b.owner_id
  where p_status is null or b.status = p_status
  order by case b.status when 'pending' then 0 else 1 end, b.created_at desc;
end;
$$;

-- Approve, reject, suspend, or send a business back to review. Approving needs the owner's address confirmed and never
-- verifies anything by itself. Anything but approval clears the Verified Partner mark, archives the live listings and
-- pauses the deals; the team's access follows the standing at once (the policies above read it on every request).
drop function if exists public.admin_review_business(uuid, text, boolean, text);
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

-- Mark an approved business a Verified Partner, saying what was checked; or take the mark away.
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

-- What of a business can be promoted: its listings and deals.
create or replace function public.admin_business_targets(p_business uuid)
returns table (target_type text, target_id uuid, title text, status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select 'apartment'::text, a.id, a.title, a.status::text from public.apartments a where a.business_id = p_business
  union all
  select 'deal'::text, d.id, d.title, d.status from public.deals d where d.business_id = p_business;
end;
$$;

-- Record a paid promotion: what, when, how much, and the payment's reference. Only for an approved business.
create or replace function public.admin_record_promotion(
  p_target_type text, p_target_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_amount_cents integer, p_currency text, p_payment_reference text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_id uuid;
begin
  perform public.require_admin();
  if p_target_type = 'apartment' then
    select business_id into v_business from public.apartments where id = p_target_id;
  elsif p_target_type = 'deal' then
    select business_id into v_business from public.deals where id = p_target_id;
  else
    raise exception 'Promote a listing or a deal';
  end if;
  if v_business is null then
    raise exception 'Only a business''s listings and deals can be promoted';
  end if;
  if not public.business_approved(v_business) then
    raise exception 'Only an approved business can be promoted';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A promotion is paid: enter the amount';
  end if;
  if coalesce(btrim(p_payment_reference), '') = '' or char_length(btrim(p_payment_reference)) < 3 then
    raise exception 'Enter the payment reference (invoice or receipt number)';
  end if;
  insert into public.listing_promotions (business_id, apartment_id, deal_id, starts_at, ends_at, amount_cents, currency, payment_reference, created_by)
  values (
    v_business,
    case when p_target_type = 'apartment' then p_target_id end,
    case when p_target_type = 'deal' then p_target_id end,
    coalesce(p_starts_at, now()), p_ends_at, p_amount_cents, upper(coalesce(nullif(btrim(p_currency), ''), 'USD')), btrim(p_payment_reference), auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_cancel_promotion(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.listing_promotions set status = 'cancelled', cancelled_at = now() where id = p_id and status = 'active';
end;
$$;

create or replace function public.admin_list_promotions(p_business uuid)
returns table (
  id uuid, target_type text, target_id uuid, title text, starts_at timestamptz, ends_at timestamptz,
  amount_cents integer, currency text, payment_reference text, status text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select p.id,
    case when p.apartment_id is not null then 'apartment' else 'deal' end,
    coalesce(p.apartment_id, p.deal_id),
    coalesce((select a.title from public.apartments a where a.id = p.apartment_id), (select d.title from public.deals d where d.id = p.deal_id)),
    p.starts_at, p.ends_at, p.amount_cents, p.currency, p.payment_reference, p.status, p.created_at
  from public.listing_promotions p
  where p.business_id = p_business
  order by p.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Who may call what
-- -----------------------------------------------------------------------------
-- Internal: triggers, and helpers only other functions call.
revoke all on function public.require_admin() from public, anon, authenticated;
revoke all on function public.keep_role() from public, anon, authenticated;
revoke all on function public.grant_role(uuid, text) from public, anon, authenticated;
revoke all on function public.account_confirmed(uuid) from public, anon, authenticated;
revoke all on function public.business_of(uuid) from public, anon, authenticated;
revoke all on function public.business_status(uuid) from public, anon, authenticated;
revoke all on function public.business_owner_id(uuid) from public, anon, authenticated;
revoke all on function public.businesses_keep_review() from public, anon, authenticated;
revoke all on function public.enforce_university_email() from public, anon, authenticated;
revoke all on function public.business_claim_invite(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.business_invite_claim_on_confirm() from public, anon, authenticated;
revoke all on function public.business_members_sync_conversations() from public, anon, authenticated;
revoke all on function public.chat_write_problem(uuid) from public, anon, authenticated;
revoke all on function public.messages_business_rules() from public, anon, authenticated;
revoke all on function public.no_calls_with_businesses() from public, anon, authenticated;
revoke all on function public.block_business_social_writes() from public, anon, authenticated;
revoke all on function public.business_accounts_stay_quiet() from public, anon, authenticated;

-- Signed in only (the policies for signed-in people call some of them; each checks its caller).
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.student_side_ok()', 'public.team_can_operate(uuid)', 'public.owner_can_edit(uuid)', 'public.is_business_owner_of(uuid)',
    'public.listing_write_allowed(uuid, uuid)', 'public.listing_row_editable(uuid)', 'public.business_chat_readable(uuid)',
    'public.chat_write_ok(uuid)', 'public.business_can_see_profile(uuid)', 'public.business_uploads_ok()', 'public.my_business()',
    'public.business_invite_create(text)', 'public.business_invite_revoke(uuid)', 'public.business_member_remove(uuid)',
    'public.business_listing_stats(uuid)', 'public.business_deal_stats(uuid)', 'public.business_overview(uuid)',
    'public.start_business_inquiry(text, uuid)', 'public.admin_list_businesses(text)', 'public.admin_review_business(uuid, text, text)',
    'public.admin_set_verified(uuid, boolean, text)', 'public.admin_business_targets(uuid)',
    'public.admin_record_promotion(text, uuid, timestamptz, timestamptz, integer, text, text)', 'public.admin_cancel_promotion(uuid)',
    'public.admin_list_promotions(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Everyone (the policies anyone's reads pass through, the join page, the labels): role_of, my_role, is_business_account,
-- is_admin, is_business_member, business_approved, team_can_manage, business_invite_lookup, listing_sponsored,
-- deal_sponsored keep the default grant.

notify pgrst, 'reload schema';

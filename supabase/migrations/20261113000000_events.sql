-- Migration 61: Events. Follows 20261112000200_upload_folders.sql (60). Rollback: rollbacks/20261113000000_events.down.sql.
--
-- The Events tab: a campus's events in one place, from the university's own calendars (ICS and RSS feeds that staff add
-- in the console and the website syncs on a schedule), from verified clubs, departments and organizations (their members
-- publish and manage their own), nothing else. Students save events, follow organizations and pick interests; the For
-- You ranking in the app reads those together with what is soon and what others saved. Built for many campuses: every
-- event, feed and organization belongs to a university, and a university has a time zone for its calendars' local times.
--
-- Adds: universities.timezone; organizations, organization_members, organization_follows; event_feeds, closed to the API
-- (staff functions and the server's service role only); events; event_saves, event_interests, event_engagement; the
-- counters kept by triggers (events.save_count, organizations.follower_count); record_event_click(); the console
-- functions (events_console_*), which answer staff only, the way the Trust & Safety ones do (ts_require_staff(),
-- ts:<code>:<message> errors, an audit_log row per change). Safe to run more than once.

-- -----------------------------------------------------------------------------
-- 1. A campus's time zone
-- -----------------------------------------------------------------------------
-- Calendars publish "7 pm" in the campus's own zone; the sync turns that into an instant with this. The seeded campuses
-- get theirs here by city or country; a new campus is a seed row with its zone (America/Chicago until it is set).
alter table public.universities add column if not exists timezone text not null default 'America/Chicago';
alter table public.universities drop constraint if exists universities_timezone_check;
alter table public.universities add constraint universities_timezone_check check (timezone ~ '^[A-Za-z_]+(/[A-Za-z_+-]+){0,2}$');
update public.universities set timezone = case
    when city like '%, TX' then 'America/Chicago'
    when city like '%, MI' then 'America/Detroit'
    when city like '%, MA' or city like '%, NY' then 'America/New_York'
    when city like '%, CA' or city like '%, WA' then 'America/Los_Angeles'
    when city like '%, AZ' then 'America/Phoenix'
    when country = 'Canada' and city like '%, BC' then 'America/Vancouver'
    when country = 'Canada' then 'America/Toronto'
    when country = 'United Kingdom' then 'Europe/London'
    when country = 'Australia' then 'Australia/Sydney'
    when country = 'New Zealand' then 'Pacific/Auckland'
    when country = 'Nepal' then 'Asia/Kathmandu'
    when country = 'India' then 'Asia/Kolkata'
    when country = 'Singapore' then 'Asia/Singapore'
    when country = 'Germany' then 'Europe/Berlin'
    when country = 'Netherlands' then 'Europe/Amsterdam'
    else timezone end
  where timezone = 'America/Chicago';

-- -----------------------------------------------------------------------------
-- 2. Organizations: clubs, departments and student organizations, verified by staff
-- -----------------------------------------------------------------------------
-- Any student may create one and becomes its owner; until staff verify it, its events stay 'pending' and show to its
-- members alone. Staff may also hide one (status 'hidden'): it and its events then show to its members and staff only.
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null default 'club' check (kind in ('club', 'department', 'organization')),
  description text check (description is null or char_length(description) <= 1000),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2000),
  website text check (website is null or (website ~* '^https://' and char_length(website) <= 500)),
  verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid,
  status text not null default 'active' check (status in ('active', 'hidden')),
  follower_count integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One club of a name per campus: a second "Robotics Club" would only confuse, or impersonate.
create unique index if not exists organizations_name_once on public.organizations (university_id, lower(btrim(name)));
create index if not exists organizations_university_idx on public.organizations (university_id, verified, status);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members (user_id);

create table if not exists public.organization_follows (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_follows_user_idx on public.organization_follows (user_id);

-- -----------------------------------------------------------------------------
-- 3. Feeds: the university's calendars, synced by the website
-- -----------------------------------------------------------------------------
-- Closed to the API. Staff manage them through events_console_feed_save() and read them through events_console_feeds();
-- the website's sync (apps/web/src/lib/events-server) reads and writes them with the service role, which bypasses RLS.
create table if not exists public.event_feeds (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  url text not null check (url ~* '^https://' and char_length(url) <= 2000),
  kind text not null check (kind in ('ics', 'rss')),
  enabled boolean not null default true,
  default_category text not null default 'other',
  etag text,
  last_synced_at timestamptz,
  last_status text,
  last_error text,
  items_seen integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists event_feeds_url_once on public.event_feeds (university_id, url);
alter table public.event_feeds enable row level security;
revoke all on table public.event_feeds from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Events
-- -----------------------------------------------------------------------------
-- source: 'feed' rows are the sync's (feed_id and external_uid set; the sync updates and cancels them); 'organization'
-- rows are made in the app by an organization's members. status: 'scheduled' and 'cancelled' show to everyone (a
-- cancellation is worth knowing); 'pending' is an unverified organization's event, for its members; 'hidden' is
-- staff's, for staff and the organization's members. Category values are the app's EVENT_CATEGORIES.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  feed_id uuid references public.event_feeds (id) on delete cascade,
  external_uid text check (external_uid is null or char_length(external_uid) <= 500),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 5000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text check (location is null or char_length(location) <= 200),
  category text not null default 'other' check (category in ('academic', 'career', 'arts', 'music', 'sports', 'social', 'wellness', 'service', 'cultural', 'tech', 'faith', 'other')),
  image_url text check (image_url is null or char_length(image_url) <= 2000),
  registration_url text check (registration_url is null or (registration_url ~* '^https?://' and char_length(registration_url) <= 2000)),
  source text not null check (source in ('feed', 'organization')),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'pending', 'hidden')),
  save_count integer not null default 0,
  click_count integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- For the search box: title, words and place, language-neutral.
  tsv tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))) stored,
  -- For the sync's duplicate check across feeds: the same title at the same moment on the same campus is one event.
  title_key text generated always as (lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))) stored,
  constraint events_ends_after_start check (ends_at is null or ends_at > starts_at),
  constraint events_feed_fields_check check ((source = 'feed') = (feed_id is not null and external_uid is not null)),
  constraint events_needs_organization_check check (source = 'feed' or organization_id is not null)
);
create unique index if not exists events_feed_uid_once on public.events (feed_id, external_uid) where feed_id is not null;
create index if not exists events_campus_time_idx on public.events (university_id, starts_at) where status in ('scheduled', 'cancelled');
create index if not exists events_organization_idx on public.events (organization_id, starts_at) where organization_id is not null;
create index if not exists events_title_key_idx on public.events (university_id, title_key, starts_at);
create index if not exists events_tsv_idx on public.events using gin (tsv);

create table if not exists public.event_saves (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_saves_user_idx on public.event_saves (user_id, created_at desc);

-- What a student says they are into, from the same list as events.category.
create table if not exists public.event_interests (
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('academic', 'career', 'arts', 'music', 'sports', 'social', 'wellness', 'service', 'cultural', 'tech', 'faith', 'other')),
  created_at timestamptz not null default now(),
  primary key (user_id, category)
);

-- One row per student, event, kind and day, written by record_event_click() alone: what was opened, registered for or
-- shared. The student reads their own rows (the ranking learns which categories they open); nobody else reads any.
create table if not exists public.event_engagement (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('open', 'register', 'share')),
  day date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id, kind, day)
);
create index if not exists event_engagement_user_idx on public.event_engagement (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 5. Who may do what
-- -----------------------------------------------------------------------------
-- Staff, for the policies: anyone with a Trust & Safety role. Wrapped in (select …) in the policies, so it runs once a
-- query. These three helpers stay callable by the API roles: a policy runs them as the caller, and each tells the
-- caller only about themselves.
create or replace function public.events_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ts_role_of(auth.uid()) is not null;
$$;

-- The caller's role in an organization: 'owner', 'editor' or null.
create or replace function public.organization_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.organization_members m where m.organization_id = p_org and m.user_id = auth.uid();
$$;

-- Members of either role manage the organization's events; owners alone change the organization and its members.
create or replace function public.organization_can_edit(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and public.organization_role(p_org) is not null;
$$;

-- Whether a write comes from a console function (which checked the staff role itself) rather than a client.
create or replace function public.events_console_write()
returns boolean
language sql
stable
as $$
  select current_setting('app.events_console', true) = 'on';
$$;
revoke all on function public.events_console_write() from public, anon, authenticated;

-- Organizations ---------------------------------------------------------------
-- What a client may set on an organization: the words, the picture, the website, the kind. Everything else (verified,
-- status, campus, the counter, who made it) is the server's, so a client's values are replaced by the right ones.
create or replace function public.organizations_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  if v_me is null or public.events_console_write() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := v_me;
    new.verified := false;
    new.verified_at := null;
    new.verified_by := null;
    new.status := 'active';
    new.follower_count := 0;
    new.created_at := now();
    -- The creator's own campus: an organization lives where its owner studies.
    select p.university_id into new.university_id from public.profiles p where p.id = v_me;
    if new.university_id is null then
      raise exception 'Join a campus before creating an organization.' using errcode = '22023';
    end if;
  else
    new.university_id := old.university_id;
    new.verified := old.verified;
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
    new.status := old.status;
    new.follower_count := old.follower_count;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  -- The picture must be the caller's own upload in the organizations folder (migration 60's rule for a post's photos).
  if new.avatar_url is not null and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url) and not public.own_upload_ok(new.avatar_url, v_me, 'organizations') then
    raise exception 'Upload the picture first.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists organizations_before_write on public.organizations;
create trigger organizations_before_write before insert or update on public.organizations
  for each row execute function public.organizations_before_write();

-- Whoever creates an organization owns it.
create or replace function public.organizations_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.organization_members (organization_id, user_id, role) values (new.id, new.created_by, 'owner') on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists organizations_after_insert on public.organizations;
create trigger organizations_after_insert after insert on public.organizations
  for each row execute function public.organizations_after_insert();

-- An organization always keeps an owner; a member must be a student account.
create or replace function public.organization_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (select 1 from public.organization_members m where m.organization_id = old.organization_id and m.user_id <> old.user_id and m.role = 'owner')
     -- Not while the organization or the person is being deleted (the cascade must go through).
     and exists (select 1 from public.organizations o where o.id = old.organization_id)
     and exists (select 1 from public.profiles p where p.id = old.user_id) then
    raise exception 'An organization needs at least one owner.' using errcode = '22023';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.is_business_account(new.user_id) then
    raise exception 'Only students can be members.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists organization_members_guard on public.organization_members;
create trigger organization_members_guard before insert or update or delete on public.organization_members
  for each row execute function public.organization_members_guard();

create or replace function public.organization_follows_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flag text := current_setting('app.events_console', true);
begin
  -- The counter is the server's: the write trigger would keep a client's row from changing it, so say this is ours.
  perform set_config('app.events_console', 'on', true);
  if tg_op = 'INSERT' then
    update public.organizations set follower_count = follower_count + 1 where id = new.organization_id;
  else
    update public.organizations set follower_count = greatest(0, follower_count - 1) where id = old.organization_id;
  end if;
  perform set_config('app.events_console', coalesce(v_flag, ''), true);
  return null;
end;
$$;
drop trigger if exists organization_follows_count on public.organization_follows;
create trigger organization_follows_count after insert or delete on public.organization_follows
  for each row execute function public.organization_follows_count();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_follows enable row level security;

drop policy if exists "organizations_read" on public.organizations;
create policy "organizations_read" on public.organizations for select
  using (status = 'active' or public.organization_role(id) is not null or (select public.events_staff()));
drop policy if exists "organizations_insert_student" on public.organizations;
create policy "organizations_insert_student" on public.organizations for insert to authenticated
  with check ((select public.student_side_ok()));
drop policy if exists "organizations_update_owner" on public.organizations;
create policy "organizations_update_owner" on public.organizations for update to authenticated
  using (public.organization_role(id) = 'owner') with check (public.organization_role(id) = 'owner');
drop policy if exists "organizations_delete_owner" on public.organizations;
create policy "organizations_delete_owner" on public.organizations for delete to authenticated
  using (public.organization_role(id) = 'owner');

-- A club's officers are no secret: whoever sees the organization sees its members.
drop policy if exists "organization_members_read" on public.organization_members;
create policy "organization_members_read" on public.organization_members for select
  using (exists (select 1 from public.organizations o where o.id = organization_id));
drop policy if exists "organization_members_owner" on public.organization_members;
create policy "organization_members_owner" on public.organization_members for all to authenticated
  using (public.organization_role(organization_id) = 'owner') with check (public.organization_role(organization_id) = 'owner');
-- Anyone may leave (the guard keeps the last owner).
drop policy if exists "organization_members_leave" on public.organization_members;
create policy "organization_members_leave" on public.organization_members for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "organization_follows_own" on public.organization_follows;
create policy "organization_follows_own" on public.organization_follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (select public.student_side_ok()));

-- Events ----------------------------------------------------------------------
-- A client's event is its organization's: the campus comes from the organization, the author is the caller, the source
-- is 'organization' and the status follows the organization's verification. The sync (service role, no auth.uid()) and
-- the console functions write what they say.
create or replace function public.events_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_verified boolean;
begin
  new.title := btrim(new.title);
  new.updated_at := now();
  if v_me is null or public.events_console_write() then
    return new;
  end if;
  if new.organization_id is null then
    raise exception 'An event belongs to an organization.' using errcode = '22023';
  end if;
  select o.verified, o.university_id into v_verified, new.university_id from public.organizations o where o.id = new.organization_id;
  new.source := 'organization';
  new.feed_id := null;
  new.external_uid := null;
  if tg_op = 'INSERT' then
    new.created_by := v_me;
    new.created_at := now();
    new.save_count := 0;
    new.click_count := 0;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.save_count := old.save_count;
    new.click_count := old.click_count;
  end if;
  -- Members choose between scheduled and cancelled; the rest is the server's: pending until the organization is
  -- verified, and hidden stays hidden once staff hid it.
  if tg_op = 'UPDATE' and old.status = 'hidden' then
    new.status := 'hidden';
  elsif not coalesce(v_verified, false) then
    new.status := 'pending';
  elsif new.status not in ('scheduled', 'cancelled') then
    new.status := 'scheduled';
  end if;
  if new.image_url is not null and (tg_op = 'INSERT' or new.image_url is distinct from old.image_url) and not public.own_upload_ok(new.image_url, v_me, 'events') then
    raise exception 'Upload the photo first.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists events_before_write on public.events;
create trigger events_before_write before insert or update on public.events
  for each row execute function public.events_before_write();

create or replace function public.event_saves_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flag text := current_setting('app.events_console', true);
begin
  perform set_config('app.events_console', 'on', true);
  if tg_op = 'INSERT' then
    update public.events set save_count = save_count + 1 where id = new.event_id;
  else
    update public.events set save_count = greatest(0, save_count - 1) where id = old.event_id;
  end if;
  perform set_config('app.events_console', coalesce(v_flag, ''), true);
  return null;
end;
$$;
drop trigger if exists event_saves_count on public.event_saves;
create trigger event_saves_count after insert or delete on public.event_saves
  for each row execute function public.event_saves_count();

alter table public.events enable row level security;
alter table public.event_saves enable row level security;
alter table public.event_interests enable row level security;
alter table public.event_engagement enable row level security;

drop policy if exists "events_read" on public.events;
create policy "events_read" on public.events for select
  using (
    (status in ('scheduled', 'cancelled') and (organization_id is null or exists (select 1 from public.organizations o where o.id = organization_id and o.status = 'active')))
    or public.organization_can_edit(organization_id)
    or (select public.events_staff())
  );
drop policy if exists "events_write_member" on public.events;
create policy "events_write_member" on public.events for insert to authenticated
  with check (public.organization_can_edit(organization_id) and (select public.student_side_ok()));
drop policy if exists "events_update_member" on public.events;
create policy "events_update_member" on public.events for update to authenticated
  using (public.organization_can_edit(organization_id)) with check (public.organization_can_edit(organization_id));
drop policy if exists "events_delete_member" on public.events;
create policy "events_delete_member" on public.events for delete to authenticated
  using (public.organization_can_edit(organization_id));

drop policy if exists "event_saves_own" on public.event_saves;
create policy "event_saves_own" on public.event_saves for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (select public.student_side_ok()));
drop policy if exists "event_interests_own" on public.event_interests;
create policy "event_interests_own" on public.event_interests for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Read one's own; written by record_event_click() only.
drop policy if exists "event_engagement_read_own" on public.event_engagement;
create policy "event_engagement_read_own" on public.event_engagement for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on table public.event_engagement from public, anon, authenticated;
-- The counters and the sync's columns are the server's; the write triggers keep them on client writes.

-- A signed-in student opened an event, its registration link or its share sheet: once a day per kind counts.
create or replace function public.record_event_click(p_event uuid, p_kind text default 'open')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_flag text := current_setting('app.events_console', true);
begin
  if v_me is null or p_kind not in ('open', 'register', 'share') or not public.student_side_ok() then
    return;
  end if;
  if not exists (select 1 from public.events e where e.id = p_event and e.status in ('scheduled', 'cancelled')) then
    return;
  end if;
  insert into public.event_engagement (event_id, user_id, kind) values (p_event, v_me, p_kind) on conflict do nothing;
  if found then
    perform set_config('app.events_console', 'on', true);
    update public.events set click_count = click_count + 1 where id = p_event;
    perform set_config('app.events_console', coalesce(v_flag, ''), true);
  end if;
end;
$$;
grant execute on function public.record_event_click(uuid, text) to authenticated;
revoke all on function public.record_event_click(uuid, text) from public, anon;

-- -----------------------------------------------------------------------------
-- 6. The console: staff monitor and moderate events, feeds and organizations
-- -----------------------------------------------------------------------------
-- A console function runs as the staff member, who passed ts_require_staff() (role and two-factor), sets the
-- transaction-local flag the write triggers read, writes, and appends the audit row in the same transaction.
create or replace function public.events_console_events(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := nullif(p_filter ->> 'status', '');
  v_source text := nullif(p_filter ->> 'source', '');
  v_university uuid := nullif(p_filter ->> 'university_id', '')::uuid;
  v_q text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
  v_offset integer := greatest(0, coalesce((p_filter ->> 'offset')::integer, 0));
  v_limit integer := least(100, greatest(1, coalesce((p_filter ->> 'limit')::integer, 50)));
  v_upcoming boolean := coalesce((p_filter ->> 'upcoming')::boolean, true);
  v_items jsonb;
  v_total integer;
begin
  perform public.ts_require_staff();
  select count(*) into v_total from public.events e
  where (v_status is null or e.status = v_status) and (v_source is null or e.source = v_source)
    and (v_university is null or e.university_id = v_university)
    and (not v_upcoming or coalesce(e.ends_at, e.starts_at) >= now() - interval '1 day')
    and (v_q is null or e.tsv @@ websearch_to_tsquery('simple', v_q));
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into v_items from (
    select e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.category, e.image_url, e.registration_url, e.source, e.status,
      e.save_count, e.click_count, e.created_at, e.updated_at, e.university_id, u.name as university_name,
      e.organization_id, o.name as organization_name, o.verified as organization_verified, e.feed_id, f.name as feed_name
    from public.events e
    join public.universities u on u.id = e.university_id
    left join public.organizations o on o.id = e.organization_id
    left join public.event_feeds f on f.id = e.feed_id
    where (v_status is null or e.status = v_status) and (v_source is null or e.source = v_source)
      and (v_university is null or e.university_id = v_university)
      and (not v_upcoming or coalesce(e.ends_at, e.starts_at) >= now() - interval '1 day')
      and (v_q is null or e.tsv @@ websearch_to_tsquery('simple', v_q))
    order by e.starts_at asc
    offset v_offset limit v_limit
  ) x;
  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;
revoke all on function public.events_console_events(jsonb) from public, anon;
grant execute on function public.events_console_events(jsonb) to authenticated;

-- Hide, cancel or restore an event. Hiding a feed's event sticks: the sync leaves hidden rows alone.
create or replace function public.events_console_set_event(p_event uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_old text;
begin
  if p_status not in ('scheduled', 'cancelled', 'hidden') then
    perform public.ts_fail('validation_failed', 'Unknown status.');
  end if;
  select e.status into v_old from public.events e where e.id = p_event;
  if v_old is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  perform set_config('app.events_console', 'on', true);
  update public.events set status = p_status where id = p_event;
  perform public.ts_audit(auth.uid(), v_role, 'event.' || p_status, 'event', p_event::text, null, null, null, nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('from', v_old));
  return jsonb_build_object('id', p_event, 'status', p_status);
end;
$$;
revoke all on function public.events_console_set_event(uuid, text, text) from public, anon;
grant execute on function public.events_console_set_event(uuid, text, text) to authenticated;

create or replace function public.events_console_feeds()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.ts_require_staff();
  return (
    select coalesce(jsonb_agg(row_to_json(x) order by x.university_name, x.name), '[]'::jsonb) from (
      select f.id, f.university_id, u.name as university_name, f.organization_id, o.name as organization_name, f.name, f.url, f.kind, f.enabled,
        f.default_category, f.last_synced_at, f.last_status, f.last_error, f.items_seen, f.created_at, f.updated_at,
        (select count(*) from public.events e where e.feed_id = f.id and e.status in ('scheduled', 'cancelled') and coalesce(e.ends_at, e.starts_at) >= now()) as upcoming
      from public.event_feeds f
      join public.universities u on u.id = f.university_id
      left join public.organizations o on o.id = f.organization_id
    ) x
  );
end;
$$;
revoke all on function public.events_console_feeds() from public, anon;
grant execute on function public.events_console_feeds() to authenticated;

-- Add or change a feed (admins). p_feed: {id?, university_id, organization_id?, name, url, kind, enabled?, default_category?}.
create or replace function public.events_console_feed_save(p_feed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_admin();
  v_id uuid := nullif(p_feed ->> 'id', '')::uuid;
  v_university uuid := nullif(p_feed ->> 'university_id', '')::uuid;
  v_org uuid := nullif(p_feed ->> 'organization_id', '')::uuid;
  v_name text := btrim(coalesce(p_feed ->> 'name', ''));
  v_url text := btrim(coalesce(p_feed ->> 'url', ''));
  v_kind text := coalesce(p_feed ->> 'kind', 'ics');
  v_enabled boolean := coalesce((p_feed ->> 'enabled')::boolean, true);
  v_category text := coalesce(nullif(p_feed ->> 'default_category', ''), 'other');
begin
  if v_university is null or not exists (select 1 from public.universities u where u.id = v_university) then
    perform public.ts_fail('validation_failed', 'Pick a university.');
  end if;
  if v_org is not null and not exists (select 1 from public.organizations o where o.id = v_org and o.university_id = v_university) then
    perform public.ts_fail('validation_failed', 'That organization is not on this campus.');
  end if;
  if char_length(v_name) not between 1 and 80 then
    perform public.ts_fail('validation_failed', 'Give the feed a name (up to 80 characters).');
  end if;
  if v_url !~* '^https://' or char_length(v_url) > 2000 then
    perform public.ts_fail('validation_failed', 'The feed address must start with https://.');
  end if;
  if v_kind not in ('ics', 'rss') then
    perform public.ts_fail('validation_failed', 'A feed is an ICS calendar or an RSS feed.');
  end if;
  if v_category not in ('academic', 'career', 'arts', 'music', 'sports', 'social', 'wellness', 'service', 'cultural', 'tech', 'faith', 'other') then
    perform public.ts_fail('validation_failed', 'Unknown category.');
  end if;
  if v_id is null then
    insert into public.event_feeds (university_id, organization_id, name, url, kind, enabled, default_category, created_by)
    values (v_university, v_org, v_name, v_url, v_kind, v_enabled, v_category, auth.uid())
    returning id into v_id;
    perform public.ts_audit(auth.uid(), v_role, 'event_feed.create', 'event_feed', v_id::text, null, null, null, null, jsonb_build_object('name', v_name, 'url', v_url, 'kind', v_kind));
  else
    update public.event_feeds set university_id = v_university, organization_id = v_org, name = v_name, url = v_url, kind = v_kind, enabled = v_enabled,
      default_category = v_category, updated_at = now(), etag = case when url = v_url then etag else null end
    where id = v_id;
    if not found then
      perform public.ts_fail('not_found', 'Not found');
    end if;
    perform public.ts_audit(auth.uid(), v_role, 'event_feed.update', 'event_feed', v_id::text, null, null, null, null, jsonb_build_object('name', v_name, 'url', v_url, 'kind', v_kind, 'enabled', v_enabled));
  end if;
  return jsonb_build_object('id', v_id);
exception
  when unique_violation then
    perform public.ts_fail('validation_failed', 'That address is already a feed on this campus.');
    return null;
end;
$$;
revoke all on function public.events_console_feed_save(jsonb) from public, anon;
grant execute on function public.events_console_feed_save(jsonb) to authenticated;

-- Removing a feed removes its events (cascade): students who saved one lose it from Saved.
create or replace function public.events_console_feed_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_admin();
  v_name text;
  v_events integer;
begin
  select f.name into v_name from public.event_feeds f where f.id = p_id;
  if v_name is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  select count(*) into v_events from public.events e where e.feed_id = p_id;
  delete from public.event_feeds where id = p_id;
  perform public.ts_audit(auth.uid(), v_role, 'event_feed.delete', 'event_feed', p_id::text, null, null, null, null, jsonb_build_object('name', v_name, 'events', v_events));
  return jsonb_build_object('id', p_id, 'events', v_events);
end;
$$;
revoke all on function public.events_console_feed_delete(uuid) from public, anon;
grant execute on function public.events_console_feed_delete(uuid) to authenticated;

create or replace function public.events_console_organizations(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_verified boolean := (p_filter ->> 'verified')::boolean;
  v_status text := nullif(p_filter ->> 'status', '');
  v_q text := nullif(btrim(coalesce(p_filter ->> 'q', '')), '');
begin
  perform public.ts_require_staff();
  return (
    select coalesce(jsonb_agg(row_to_json(x) order by x.verified, x.created_at desc), '[]'::jsonb) from (
      select o.id, o.university_id, u.name as university_name, o.name, o.kind, o.description, o.avatar_url, o.website, o.verified, o.verified_at,
        o.status, o.follower_count, o.created_at, o.created_by,
        (select p.username from public.profiles p where p.id = o.created_by) as creator_username,
        (select count(*) from public.organization_members m where m.organization_id = o.id) as members,
        (select count(*) from public.events e where e.organization_id = o.id) as events
      from public.organizations o
      join public.universities u on u.id = o.university_id
      where (v_verified is null or o.verified = v_verified) and (v_status is null or o.status = v_status)
        and (v_q is null or o.name ilike '%' || v_q || '%')
      limit 200
    ) x
  );
end;
$$;
revoke all on function public.events_console_organizations(jsonb) from public, anon;
grant execute on function public.events_console_organizations(jsonb) to authenticated;

-- Verify or unverify an organization, hide or restore it. Verifying publishes its pending events; unverifying or hiding
-- takes its scheduled ones back to pending (hidden organizations' events are already out of sight through the policy).
create or replace function public.events_console_set_organization(p_org uuid, p_verified boolean default null, p_status text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_old public.organizations;
  v_verified boolean;
  v_status text;
begin
  select * into v_old from public.organizations o where o.id = p_org;
  if v_old.id is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  v_verified := coalesce(p_verified, v_old.verified);
  v_status := coalesce(p_status, v_old.status);
  if v_status not in ('active', 'hidden') then
    perform public.ts_fail('validation_failed', 'Unknown status.');
  end if;
  perform set_config('app.events_console', 'on', true);
  update public.organizations set verified = v_verified,
    verified_at = case when v_verified and not v_old.verified then now() when v_verified then verified_at else null end,
    verified_by = case when v_verified and not v_old.verified then auth.uid() when v_verified then verified_by else null end,
    status = v_status
  where id = p_org;
  if v_verified and not v_old.verified then
    update public.events set status = 'scheduled' where organization_id = p_org and status = 'pending';
  elsif v_old.verified and not v_verified then
    update public.events set status = 'pending' where organization_id = p_org and status in ('scheduled', 'cancelled');
  end if;
  perform public.ts_audit(auth.uid(), v_role, 'organization.' || case when v_verified <> v_old.verified then (case when v_verified then 'verify' else 'unverify' end) else v_status end,
    'organization', p_org::text, null, null, null, nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('name', v_old.name, 'verified', v_verified, 'status', v_status));
  return jsonb_build_object('id', p_org, 'verified', v_verified, 'status', v_status);
end;
$$;
revoke all on function public.events_console_set_organization(uuid, boolean, text, text) from public, anon;
grant execute on function public.events_console_set_organization(uuid, boolean, text, text) to authenticated;

-- The staff console's entry shows how much is waiting: organizations to verify.
create or replace function public.events_console_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.ts_require_staff();
  return jsonb_build_object(
    'organizations_pending', (select count(*) from public.organizations o where not o.verified and o.status = 'active'),
    'feeds_failing', (select count(*) from public.event_feeds f where f.enabled and f.last_status = 'error'),
    'events_upcoming', (select count(*) from public.events e where e.status = 'scheduled' and e.starts_at >= now())
  );
end;
$$;
revoke all on function public.events_console_counts() from public, anon;
grant execute on function public.events_console_counts() to authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
-- Apartment Book - migration 2
--  * PostGIS: campus + listing coordinates, "within N miles of campus" search
--  * distance to campus is computed automatically from the pinned location
--  * device push tokens (for the future iOS/Android apps)
--  * sign-ups restricted to university email domains (e.g. @txstate.edu)
-- Safe to run once on a project that already has migration 1.
-- =============================================================================

create extension if not exists postgis with schema extensions;

-- -----------------------------------------------------------------------------
-- Universities: campus location + verified email domain
-- -----------------------------------------------------------------------------
alter table public.universities
  add column if not exists latitude double precision check (latitude is null or (latitude between -90 and 90)),
  add column if not exists longitude double precision check (longitude is null or (longitude between -180 and 180)),
  add column if not exists email_domain text,
  add column if not exists geog extensions.geography(Point, 4326)
    generated always as (
      case
        when latitude is null or longitude is null then null
        else extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
      end
    ) stored;

create unique index if not exists universities_email_domain_key
  on public.universities (lower(email_domain)) where email_domain is not null;
create index if not exists universities_geog_idx on public.universities using gist (geog);

-- -----------------------------------------------------------------------------
-- Apartments + roommate posts: pinned location
-- -----------------------------------------------------------------------------
alter table public.apartments
  add column if not exists latitude double precision check (latitude is null or (latitude between -90 and 90)),
  add column if not exists longitude double precision check (longitude is null or (longitude between -180 and 180)),
  add column if not exists geog extensions.geography(Point, 4326)
    generated always as (
      case
        when latitude is null or longitude is null then null
        else extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
      end
    ) stored;
create index if not exists apartments_geog_idx on public.apartments using gist (geog);

alter table public.roommate_posts
  add column if not exists latitude double precision check (latitude is null or (latitude between -90 and 90)),
  add column if not exists longitude double precision check (longitude is null or (longitude between -180 and 180)),
  add column if not exists distance_km numeric(6, 2) check (distance_km is null or distance_km >= 0),
  add column if not exists geog extensions.geography(Point, 4326)
    generated always as (
      case
        when latitude is null or longitude is null then null
        else extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
      end
    ) stored;
create index if not exists roommate_posts_geog_idx on public.roommate_posts using gist (geog);

-- Fill distance_km from the pinned location and the university's campus point.
create or replace function public.set_distance_to_campus()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_campus extensions.geography;
begin
  if new.latitude is not null and new.longitude is not null and new.university_id is not null then
    select u.geog into v_campus from public.universities u where u.id = new.university_id;
    if v_campus is not null then
      new.distance_km := round(
        (extensions.st_distance(
          extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography,
          v_campus
        ) / 1000.0)::numeric,
        2
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists apartments_set_distance on public.apartments;
create trigger apartments_set_distance
  before insert or update of latitude, longitude, university_id on public.apartments
  for each row execute function public.set_distance_to_campus();

drop trigger if exists roommate_posts_set_distance on public.roommate_posts;
create trigger roommate_posts_set_distance
  before insert or update of latitude, longitude, university_id on public.roommate_posts
  for each row execute function public.set_distance_to_campus();

-- Listings within a radius (metres) of a university's campus. Row level
-- security still applies because these run as the calling user.
create or replace function public.apartments_within(p_university_id uuid, p_radius_m double precision)
returns setof public.apartments
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select a.*
  from public.apartments a
  join public.universities u on u.id = p_university_id
  where a.geog is not null
    and u.geog is not null
    and extensions.st_dwithin(a.geog, u.geog, p_radius_m);
$$;

create or replace function public.roommate_posts_within(p_university_id uuid, p_radius_m double precision)
returns setof public.roommate_posts
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select r.*
  from public.roommate_posts r
  join public.universities u on u.id = p_university_id
  where r.geog is not null
    and u.geog is not null
    and extensions.st_dwithin(r.geog, u.geog, p_radius_m);
$$;

-- -----------------------------------------------------------------------------
-- Device push tokens (stored now, used by the mobile apps later)
-- -----------------------------------------------------------------------------
create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint device_push_tokens_token_key unique (token),
  constraint device_push_tokens_user_id_fkey foreign key (user_id)
    references public.profiles (id) on delete cascade
);
create index if not exists device_push_tokens_user_id_idx on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;
drop policy if exists "device_push_tokens_all_own" on public.device_push_tokens;
create policy "device_push_tokens_all_own" on public.device_push_tokens
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Verified university emails: only domains listed on a university may sign up,
-- and new users are attached to that university automatically.
-- -----------------------------------------------------------------------------
create or replace function public.university_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.universities
  where email_domain is not null
    and lower(email_domain) = lower(split_part(coalesce(p_email, ''), '@', 2))
  limit 1;
$$;

create or replace function public.enforce_university_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.university_for_email(new.email) is null then
    raise exception 'Please sign up with your university email address (for example you@txstate.edu).'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_university_email on auth.users;
create trigger enforce_university_email
  before insert on auth.users
  for each row execute function public.enforce_university_email();

-- Attach the university automatically when the profile row is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, university_id)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    public.university_for_email(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Allowed domains are public (shown on the sign-up page).
create or replace function public.allowed_email_domains()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select lower(email_domain) from public.universities where email_domain is not null order by 1;
$$;

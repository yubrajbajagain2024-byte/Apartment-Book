-- =============================================================================
-- Apartment Book - migration 6: post stats
--  * views (one per viewer per listing per day), contacts (Message clicks)
--  * listing_stats(): views / saves / messages for a listing, owner only
--  * video_vs_photo_stats(): real comparison for the "add a tour" nudge,
--    reported only once there is enough data to be honest
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.post_views (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('apartment', 'item', 'roommate')),
  target_id uuid not null,
  viewer_id uuid,
  viewer_key text not null,
  view_day date not null default current_date,
  created_at timestamptz not null default now(),
  constraint post_views_viewer_id_fkey foreign key (viewer_id) references public.profiles (id) on delete set null,
  constraint post_views_unique_per_day unique (target_type, target_id, viewer_key, view_day)
);
create index if not exists post_views_target_idx on public.post_views (target_type, target_id);

create table if not exists public.listing_contacts (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('apartment', 'item', 'roommate')),
  target_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint listing_contacts_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint listing_contacts_unique unique (target_type, target_id, user_id)
);
create index if not exists listing_contacts_target_idx on public.listing_contacts (target_type, target_id);

alter table public.post_views enable row level security;
alter table public.listing_contacts enable row level security;
-- No direct client access: rows are written through the functions below and
-- read back only as aggregates by the listing owner.

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
  end;
$$;

-- Count a view. Signed-in viewers are keyed by their id; anonymous visitors by
-- a random key the client keeps for the session. One row per viewer per day.
create or replace function public.record_view(p_target_type text, p_target_id uuid, p_viewer_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if p_target_type not in ('apartment', 'item', 'roommate') or p_target_id is null then
    return;
  end if;
  -- Owners looking at their own listing do not count.
  if auth.uid() is not null and public.listing_owner(p_target_type, p_target_id) = auth.uid() then
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

-- Record that a signed-in user started a conversation from a listing.
create or replace function public.record_contact(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_target_type not in ('apartment', 'item', 'roommate') or p_target_id is null then
    return;
  end if;
  insert into public.listing_contacts (target_type, target_id, user_id)
  values (p_target_type, p_target_id, auth.uid())
  on conflict do nothing;
end;
$$;



-- Views, saves and messages for one listing. Only the owner may ask.
create or replace function public.listing_stats(p_target_type text, p_target_id uuid)
returns table (views bigint, saves bigint, contacts bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.listing_owner(p_target_type, p_target_id) is distinct from auth.uid() then
    raise exception 'Only the owner can see listing stats';
  end if;
  return query
  select
    (select count(*) from public.post_views v where v.target_type = p_target_type and v.target_id = p_target_id),
    (select count(*) from public.saved_listings s where s.target_type = p_target_type and s.target_id = p_target_id),
    (select count(*) from public.listing_contacts c where c.target_type = p_target_type and c.target_id = p_target_id);
end;
$$;

-- How much more often video apartment listings get messaged than photo-only
-- ones, from our own data. Returns nulls until both groups have at least
-- p_min listings, so the nudge never quotes a made-up number.
create or replace function public.video_vs_photo_stats(p_min integer default 20)
returns table (video_listings bigint, photo_listings bigint, video_contact_rate numeric, photo_contact_rate numeric, contact_multiplier numeric)
language sql
stable
security definer
set search_path = public
as $$
  with per_listing as (
    select a.id, a.has_video,
      (select count(*) from public.listing_contacts c where c.target_type = 'apartment' and c.target_id = a.id) as contacts
    from public.apartments a
    where a.created_at < now() - interval '3 days'
  ),
  agg as (
    select
      count(*) filter (where has_video) as video_listings,
      count(*) filter (where not has_video) as photo_listings,
      avg(contacts) filter (where has_video) as video_rate,
      avg(contacts) filter (where not has_video) as photo_rate
    from per_listing
  )
  select
    video_listings,
    photo_listings,
    case when video_listings >= p_min and photo_listings >= p_min then round(video_rate::numeric, 2) end,
    case when video_listings >= p_min and photo_listings >= p_min then round(photo_rate::numeric, 2) end,
    case when video_listings >= p_min and photo_listings >= p_min and photo_rate > 0 then round((video_rate / photo_rate)::numeric, 1) end
  from agg;
$$;

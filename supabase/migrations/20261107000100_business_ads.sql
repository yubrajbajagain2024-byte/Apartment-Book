-- =============================================================================
-- UniBuzz - migration 50: business posts, the Ads Manager and what students see of it (UniBuzz Business v2, part 2)
-- Follows 20261107000000_business_teams.sql (migration 49: business_can(), the audit log, notify_team).
-- Rollback: supabase/rollbacks/20261107000100_business_ads.down.sql. Safe to run more than once.
--  * Categories: 'startup' joins migration 39's list (restaurants and cafés are 'food', apartments 'housing').
--  * Posts: the deals table holds every business post now (the name stays): kind (update, product, service, deal,
--    event, promotion), up to 10 photos or one video (media), a price, an event date; image_url mirrors the first photo
--    for older apps. 30 new posts a day per business.
--  * Ads (public.ads): name, objective, campuses (campus targeting only: nothing about who a student is or what they
--    did), placements, headline, caption, media, a call to action, a budget and a start and end date, optionally
--    promoting one of the business's posts or listings. Statuses:
--      draft -> pending_review -> scheduled -> active -> completed      rejected (with the reason), paused
--    The team writes drafts (and rejected ads) directly; every other change goes through the functions below, which
--    are the only way the status moves (a trigger keeps it otherwise).
--  * Placement rules, enforced on every write and at submission: a housing ad (from a housing business, or promoting a
--    listing) runs only in Housing; any other ad runs in For You and/or Reels; Reels needs one vertical video. Housing
--    ads are screened for phrases the Fair Housing Act forbids (fair_housing_flags()); an admin must confirm the check
--    before approving one, and give a reason to approve one that was flagged.
--  * Payment: still the admin's (no payment provider yet). Approving an ad records its payment, amount and reference,
--    in listing_promotions (now the ledger of ad payments, ad_id), so "Sponsored" keeps meaning paid.
--    admin_record_promotion() and admin_cancel_promotion() keep working on top of ads.
--  * Time: ads_sweep() moves scheduled ads to active at their start, ends every ad at its end date and returns a
--    pending ad whose dates passed to draft, telling the team (pg_cron every 5 minutes where it is installed). What
--    students see never waits for it: ads_for_feed() checks the dates itself.
--  * Serving: ads_for_feed(placement, limit, offset) returns the running, paid ads of approved businesses for the
--    caller's campus, minus those they hid or reported and businesses they blocked, in a daily rotation that is the
--    same for every student on the campus. Signed-in students only. The apps place them about one per 9 posts.
--  * Students: hide an ad, save one, report an ad, a post or a business (business_reports, 20 a day, for the UniBuzz
--    team: the business never learns who), and block a business (business_blocks: its ads and posts disappear and it
--    cannot be messaged).
--  * Analytics: business_events (impressions, clicks, saves, profile visits, inquiries; closed to the API, one per
--    viewer per hour or day, written by record_business_event()) and the functions that count them. A business sees
--    numbers only, never who.
--  * Inquiries: a student may also message a business from its profile or an ad (inquiry target 'business' or 'ad');
--    15 new business chats an hour per student.
--  * Data: every v1 promotion becomes an ad (its payment row linked); any without an end date (none can exist: v1
--    required one) would wait in review with needs_review_reason instead of being given one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Categories
-- -----------------------------------------------------------------------------
create or replace function public.business_category_ok(p_category text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_category in ('housing', 'food', 'retail', 'services', 'fitness', 'entertainment', 'education', 'startup', 'other'), false);
$$;

alter table public.businesses drop constraint if exists businesses_category_check;
alter table public.businesses add constraint businesses_category_check check (public.business_category_ok(category));

-- Migration 39's sign-up trigger, accepting the new category (everything else as it was).
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
      case when public.business_category_ok(v_meta ->> 'business_category') then v_meta ->> 'business_category' else 'other' end,
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

-- -----------------------------------------------------------------------------
-- 2. Media shared by posts and ads
-- -----------------------------------------------------------------------------
-- What is wrong with a media list, or null: up to 10 photos, or one video uploaded by someone on the business's team.
-- Photos of an ad must come from UniBuzz's own storage (p_any_host false); posts keep v1's rule (any https address).
create or replace function public.business_media_problem(p_media jsonb, p_business uuid, p_any_host boolean, p_require_ready boolean)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e jsonb;
  v_images integer := 0;
  v_videos integer := 0;
  v_status text;
begin
  if p_media is null or jsonb_typeof(p_media) <> 'array' then
    return 'Media must be a list.';
  end if;
  if jsonb_array_length(p_media) > 10 then
    return 'Add 10 photos at most.';
  end if;
  for e in select * from jsonb_array_elements(p_media) loop
    if jsonb_typeof(e) <> 'object' then
      return 'Media must be photos or a video.';
    end if;
    if e ->> 'type' = 'image' then
      v_images := v_images + 1;
      if coalesce(e ->> 'url', '') !~* '^https://' or char_length(e ->> 'url') > 2000 then
        return 'A photo needs an https address.';
      end if;
      if not p_any_host and (e ->> 'url') !~ '^https://[^/]+/storage/v1/object/public/uploads/' then
        return 'Upload photos to UniBuzz rather than linking them.';
      end if;
    elsif e ->> 'type' = 'video' then
      v_videos := v_videos + 1;
      if coalesce(e ->> 'media_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return 'That video was not uploaded to UniBuzz.';
      end if;
      select m.status into v_status
      from public.media m
      where m.id = (e ->> 'media_id')::uuid
        and m.owner_id in (select bm.user_id from public.business_members bm where bm.business_id = p_business);
      if v_status is null then
        return 'That video is not your business''s.';
      end if;
      if v_status = 'failed' then
        return 'The video could not be processed. Upload it again.';
      end if;
      if p_require_ready and v_status <> 'ready' then
        return 'The video is still processing. Try again in a minute.';
      end if;
    else
      return 'Media must be photos or a video.';
    end if;
  end loop;
  if v_videos > 1 then
    return 'Add one video at most.';
  end if;
  if v_videos = 1 and v_images > 0 then
    return 'Use either photos or one video, not both.';
  end if;
  return null;
end;
$$;

-- A media list with each video's details read from the media table (the provider's numbers, not the client's).
create or replace function public.business_media_snapshot(p_media jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    case
      when t.e ->> 'type' = 'video' and coalesce(t.e ->> 'media_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then coalesce((
        select jsonb_build_object('type', 'video', 'media_id', m.id, 'playback_id', m.playback_id, 'poster_url', m.poster_url,
          'width', m.width, 'height', m.height, 'duration_seconds', m.duration_seconds)
        from public.media m where m.id = (t.e ->> 'media_id')::uuid
      ), t.e)
      else t.e
    end order by t.ord), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_media) = 'array' then p_media else '[]'::jsonb end) with ordinality as t(e, ord);
$$;

-- -----------------------------------------------------------------------------
-- 3. Posts (the deals table)
-- -----------------------------------------------------------------------------
alter table public.deals
  add column if not exists kind text not null default 'deal',
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists price_cents integer,
  add column if not exists currency text not null default 'USD',
  add column if not exists event_at timestamptz;
alter table public.deals drop constraint if exists deals_kind_check;
alter table public.deals add constraint deals_kind_check check (kind in ('update', 'product', 'service', 'deal', 'event', 'promotion'));
alter table public.deals drop constraint if exists deals_media_check;
alter table public.deals add constraint deals_media_check check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10);
alter table public.deals drop constraint if exists deals_price_check;
alter table public.deals add constraint deals_price_check check (price_cents is null or price_cents between 0 and 100000000);
alter table public.deals drop constraint if exists deals_currency_check;
alter table public.deals add constraint deals_currency_check check (currency ~ '^[A-Z]{3}$');

-- Every v1 deal's picture becomes its media (once).
update public.deals set media = jsonb_build_array(jsonb_build_object('type', 'image', 'url', image_url))
where image_url is not null and media = '[]'::jsonb;

-- Media checked and snapshotted, image_url kept as the first photo (or the video's poster) for older apps, and 30 new
-- posts a day per business.
create or replace function public.deals_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_problem text;
begin
  if tg_op = 'UPDATE' and new.image_url is distinct from old.image_url and new.media is not distinct from old.media then
    -- An older app changed only the picture.
    new.media := case when new.image_url is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type', 'image', 'url', new.image_url)) end;
  elsif tg_op = 'INSERT' and new.media = '[]'::jsonb and new.image_url is not null then
    new.media := jsonb_build_array(jsonb_build_object('type', 'image', 'url', new.image_url));
  end if;
  if tg_op = 'INSERT' or new.media is distinct from old.media then
    v_problem := public.business_media_problem(new.media, new.business_id, true, false);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    new.media := public.business_media_snapshot(new.media);
  end if;
  new.image_url := coalesce(
    (select e ->> 'url' from jsonb_array_elements(new.media) e where e ->> 'type' = 'image' limit 1),
    (select e ->> 'poster_url' from jsonb_array_elements(new.media) e where e ->> 'type' = 'video' limit 1)
  );
  new.currency := upper(new.currency);
  if new.kind <> 'event' then
    new.event_at := null;
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('business_posts:' || new.business_id::text));
    if (select count(*) from public.deals d where d.business_id = new.business_id and d.created_at > now() - interval '1 day') >= 30 then
      raise exception 'Your business has published 30 posts today. Try again tomorrow.' using errcode = '42501', hint = 'RATE_LIMITED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists deals_before_write on public.deals;
create trigger deals_before_write
  before insert or update on public.deals
  for each row execute function public.deals_before_write();

-- The team's posts in the audit log (an admin's bulk changes are logged by the admin's function).
create or replace function public.deals_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.deals := case when tg_op = 'DELETE' then old else new end;
begin
  if public.business_role(v_row.business_id) is null then
    return null;
  end if;
  perform public.business_audit_write(v_row.business_id, 'team',
    case tg_op when 'INSERT' then 'post_created' when 'UPDATE' then 'post_updated' else 'post_deleted' end,
    'post', v_row.id, jsonb_build_object('title', v_row.title, 'kind', v_row.kind, 'status', v_row.status));
  return null;
end;
$$;

drop trigger if exists deals_audit on public.deals;
create trigger deals_audit
  after insert or update or delete on public.deals
  for each row execute function public.deals_audit();

-- -----------------------------------------------------------------------------
-- 4. Ads
-- -----------------------------------------------------------------------------
create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  objective text not null default 'awareness' check (objective in ('awareness', 'traffic', 'engagement', 'messages')),
  -- 'housing' when the business is a housing business or the ad promotes a listing (set by the trigger).
  vertical text not null default 'general' check (vertical in ('general', 'housing')),
  placements text[] not null default '{for_you}',
  -- The campuses whose students see it. New ads name at least one; '{}' (every campus) only for v1's promotions.
  university_ids uuid[] not null default '{}' check (cardinality(university_ids) <= 50),
  headline text check (headline is null or char_length(headline) <= 80),
  caption text not null default '' check (char_length(caption) <= 2200),
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10),
  cta text not null default 'learn_more'
    check (cta in ('learn_more', 'shop_now', 'order_now', 'book_now', 'sign_up', 'get_offer', 'view_listing', 'message', 'visit_profile')),
  cta_url text check (cta_url is null or (char_length(cta_url) <= 2000 and cta_url ~* '^https://')),
  promoted_deal_id uuid references public.deals (id) on delete set null,
  promoted_apartment_id uuid references public.apartments (id) on delete set null,
  budget_cents integer not null default 0 check (budget_cents between 0 and 10000000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'scheduled', 'active', 'paused', 'completed', 'rejected')),
  paused_by text check (paused_by is null or paused_by in ('business', 'admin')),
  -- Why it is rejected, paused by the UniBuzz team, ended early, or back in draft.
  status_reason text check (status_reason is null or char_length(status_reason) <= 1000),
  -- The reviewer's note (a Fair Housing override says why).
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  -- Set by this migration for a v1 promotion it could not place (none expected).
  needs_review_reason text check (needs_review_reason is null or char_length(needs_review_reason) <= 300),
  fair_housing_flags text[] not null default '{}',
  fair_housing_checked_by uuid references public.profiles (id) on delete set null,
  fair_housing_checked_at timestamptz,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  legacy_promotion_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ads_period check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint ads_one_promoted check (num_nonnulls(promoted_deal_id, promoted_apartment_id) <= 1),
  -- Past draft, an ad has its dates (a v1 promotion without an end date would wait in review, flagged).
  constraint ads_dates_when_live check (
    status in ('draft', 'rejected') or (starts_at is not null and (ends_at is not null or needs_review_reason is not null))
  ),
  constraint ads_placements_known check (placements <@ array['for_you', 'reels', 'housing']::text[])
);

create index if not exists ads_business_idx on public.ads (business_id, created_at desc);
create index if not exists ads_serving_idx on public.ads (status, starts_at, ends_at) where status in ('scheduled', 'active');
create index if not exists ads_review_idx on public.ads (status, submitted_at) where status = 'pending_review';
create index if not exists ads_promoted_apartment_idx on public.ads (promoted_apartment_id) where promoted_apartment_id is not null;
create index if not exists ads_promoted_deal_idx on public.ads (promoted_deal_id) where promoted_deal_id is not null;

drop trigger if exists ads_set_updated_at on public.ads;
create trigger ads_set_updated_at before update on public.ads for each row execute function public.set_updated_at();

-- Payments: listing_promotions is the ledger now. A payment is for an ad (ad_id); a v1 one also names its listing or
-- deal, and an ad promoting one does too.
alter table public.listing_promotions add column if not exists ad_id uuid;
alter table public.listing_promotions drop constraint if exists listing_promotions_ad_id_fkey;
alter table public.listing_promotions add constraint listing_promotions_ad_id_fkey foreign key (ad_id) references public.ads (id) on delete cascade;
alter table public.listing_promotions drop constraint if exists listing_promotions_one_target;
alter table public.listing_promotions add constraint listing_promotions_one_target
  check (num_nonnulls(apartment_id, deal_id) <= 1 and (ad_id is not null or num_nonnulls(apartment_id, deal_id) = 1));
create index if not exists listing_promotions_ad_idx on public.listing_promotions (ad_id) where ad_id is not null;

-- Words the Fair Housing Act does not allow in a housing ad (42 U.S.C. 3604(c)): preferences by race, color, national
-- origin, religion, sex, familial status or disability, plus source of income, which some cities protect. A hit is
-- "Category: "phrase"". It flags for the reviewer; it does not decide.
create or replace function public.fair_housing_flags(p_text text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct f.label || ': "' || f.hit || '"' order by f.label || ': "' || f.hit || '"'), '{}'::text[])
  from (
    select r.label, substring(lower(coalesce(p_text, '')) from r.pattern) as hit
    from (values
      ('Familial status', '(\m(no|not for)\s+(kids|children|child|families|babies|toddlers|teens|teenagers)\M)'),
      ('Familial status', '(\madults?\s+only\M)'),
      ('Familial status', '(\madult\s+(community|building|living|complex)\M)'),
      ('Familial status', '(\m(singles?|couples?)\s+only\M)'),
      ('Familial status', '(\mperfect\s+for\s+(singles|couples)\M)'),
      ('Familial status', '(\mempty[- ]nesters?\M)'),
      ('Familial status', '(\mmature\s+(tenants?|residents?|persons?|people|couples?|individuals?)\M)'),
      ('Race, color or national origin', '(\m(whites?|blacks?|asians?|hispanics?|latinos?|latinas?|caucasians?|mexicans?|arabs?)\s+only\M)'),
      ('Race, color or national origin', '(\mno\s+(blacks|whites|asians|hispanics|latinos|mexicans|immigrants|foreigners|international students)\M)'),
      ('Race, color or national origin', '(\m(english[- ]speaking|english speakers?)\s+only\M)'),
      ('Race, color or national origin', '(\mmust\s+speak\s+english\M)'),
      ('Race, color or national origin', '(\m(u\.?s\.?\s+citizens?|citizens?|americans?)\s+only\M)'),
      ('Religion', '(\m(christians?|muslims?|jews?|jewish|catholics?|hindus?|buddhists?|mormons?|protestants?)\s+(only|preferred)\M)'),
      ('Religion', '(\mno\s+(christians|muslims|jews|catholics|hindus|buddhists|atheists)\M)'),
      ('Sex', '(\m(males?|females?|men|women|guys|girls|ladies|gentlemen)\s+only\M)'),
      ('Sex', '(\mno\s+(men|women|males|females|guys|girls)\M)'),
      ('Disability', '(\mno\s+(wheelchairs?|disabled|handicapped|disabilities|service animals?|emotional support animals?|esas?)\M)'),
      ('Disability', '(\mable[- ]bodied\M)'),
      ('Disability', '(\mmust\s+(be\s+able\s+to\s+)?(walk|climb\s+stairs)\M)'),
      ('Disability', '(\mno\s+(mentally ill|mental illness|psychiatric)\M)'),
      ('Disability', '(\mhealthy\s+(tenants?|residents?)\s+only\M)'),
      ('Source of income (local laws)', '(\mno\s+(section\s*8|vouchers?|housing\s+assistance)\M)')
    ) as r(label, pattern)
  ) f
  where f.hit is not null;
$$;

-- The ad's status as it stands now, whether or not ads_sweep() has run since its dates came.
create or replace function public.ad_effective_status(p_status text, p_starts_at timestamptz, p_ends_at timestamptz)
returns text
language sql
stable
as $$
  select case
    when p_status in ('scheduled', 'active', 'paused') and p_ends_at is not null and p_ends_at <= now() then 'completed'
    when p_status = 'scheduled' and p_starts_at <= now() then 'active'
    else p_status
  end;
$$;

-- Every write: the team edits only drafts and rejected ads, and never the status or the review (the functions below
-- move those, raising app.ad_transition); vertical, placements for housing, Fair Housing flags and the videos'
-- details are worked out here; the campuses must exist and what it promotes must be the business's own.
create or replace function public.ads_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A setting this connection never set reads as null, and "not null" is not true: coalesce, so the checks below run
  -- unless a transition is under way.
  v_transition boolean := coalesce(current_setting('app.ad_transition', true), '') = 'on';
  v_category text;
  v_problem text;
  v_text text;
begin
  if not v_transition then
    if tg_op = 'INSERT' then
      new.status := 'draft';
      new.paused_by := null;
      new.status_reason := null;
      new.review_note := null;
      new.needs_review_reason := null;
      new.submitted_at := null;
      new.submitted_by := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.started_at := null;
      new.completed_at := null;
      new.legacy_promotion_id := null;
      new.fair_housing_checked_by := null;
      new.fair_housing_checked_at := null;
      -- 50 new ads a day per business.
      perform pg_advisory_xact_lock(hashtext('business_ads:' || new.business_id::text));
      if (select count(*) from public.ads a where a.business_id = new.business_id and a.created_at > now() - interval '1 day') >= 50 then
        raise exception 'Your business has started 50 ads today. Try again tomorrow.' using errcode = '42501', hint = 'RATE_LIMITED';
      end if;
    else
      -- A foreign key letting go (a promoted post or listing deleted, a person's account deleted) is not an edit.
      if (to_jsonb(new) - array['promoted_deal_id', 'promoted_apartment_id', 'created_by', 'submitted_by', 'reviewed_by', 'fair_housing_checked_by'])
           = (to_jsonb(old) - array['promoted_deal_id', 'promoted_apartment_id', 'created_by', 'submitted_by', 'reviewed_by', 'fair_housing_checked_by'])
         and (new.promoted_deal_id is null or new.promoted_deal_id is not distinct from old.promoted_deal_id)
         and (new.promoted_apartment_id is null or new.promoted_apartment_id is not distinct from old.promoted_apartment_id)
         and (new.created_by is null or new.created_by is not distinct from old.created_by)
         and (new.submitted_by is null or new.submitted_by is not distinct from old.submitted_by)
         and (new.reviewed_by is null or new.reviewed_by is not distinct from old.reviewed_by)
         and (new.fair_housing_checked_by is null or new.fair_housing_checked_by is not distinct from old.fair_housing_checked_by) then
        return new;
      end if;
      if old.status not in ('draft', 'rejected') then
        raise exception 'Only a draft or a rejected ad can be edited. Pause it, or copy it into a new draft.' using errcode = '42501';
      end if;
      new.status := old.status;
      new.paused_by := old.paused_by;
      new.status_reason := old.status_reason;
      new.review_note := old.review_note;
      new.needs_review_reason := old.needs_review_reason;
      new.submitted_at := old.submitted_at;
      new.submitted_by := old.submitted_by;
      new.reviewed_at := old.reviewed_at;
      new.reviewed_by := old.reviewed_by;
      new.started_at := old.started_at;
      new.completed_at := old.completed_at;
      new.legacy_promotion_id := old.legacy_promotion_id;
      new.fair_housing_checked_by := old.fair_housing_checked_by;
      new.fair_housing_checked_at := old.fair_housing_checked_at;
      new.business_id := old.business_id;
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
  end if;

  -- A status change (a function below, the sweep, a suspension) leaves the content as it is and only refreshes the
  -- videos' details: what was valid when written stays valid, so a business can always be paused or suspended.
  if tg_op = 'UPDATE' and v_transition then
    new.media := public.business_media_snapshot(new.media);
    return new;
  end if;

  select b.category into v_category from public.businesses b where b.id = new.business_id;
  if not v_transition then
    if new.promoted_apartment_id is not null
       and not exists (select 1 from public.apartments a where a.id = new.promoted_apartment_id and a.business_id = new.business_id) then
      raise exception 'You can promote only your own business''s listings.' using errcode = '42501';
    end if;
    if new.promoted_deal_id is not null
       and not exists (select 1 from public.deals d where d.id = new.promoted_deal_id and d.business_id = new.business_id) then
      raise exception 'You can promote only your own business''s posts.' using errcode = '42501';
    end if;
  end if;
  new.vertical := case when new.promoted_apartment_id is not null or v_category = 'housing' then 'housing' else 'general' end;
  new.placements := coalesce((select array_agg(distinct p order by p) from unnest(new.placements) p where p is not null), '{}'::text[]);
  if new.vertical = 'housing' then
    -- Housing ads run in Housing and nowhere else.
    new.placements := array['housing'];
  elsif 'housing' = any (new.placements) then
    raise exception 'Only housing ads run in Housing. Choose For You, Reels or both.' using errcode = '22023';
  end if;
  if cardinality(new.placements) = 0 then
    raise exception 'Choose where the ad runs: For You, Reels or both.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.university_ids) u where not exists (select 1 from public.universities x where x.id = u)) then
    raise exception 'One of the campuses does not exist.' using errcode = '22023';
  end if;
  new.university_ids := coalesce((select array_agg(distinct u) from unnest(new.university_ids) u), '{}'::uuid[]);
  new.currency := upper(new.currency);
  if not v_transition and (tg_op = 'INSERT' or new.media is distinct from old.media) then
    v_problem := public.business_media_problem(new.media, new.business_id, false, false);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;
  new.media := public.business_media_snapshot(new.media);
  if new.vertical = 'housing' then
    v_text := concat_ws(' ', new.name, new.headline, new.caption,
      (select concat_ws(' ', a.title, a.description) from public.apartments a where a.id = new.promoted_apartment_id),
      (select concat_ws(' ', d.title, d.description) from public.deals d where d.id = new.promoted_deal_id));
    new.fair_housing_flags := public.fair_housing_flags(v_text);
  else
    new.fair_housing_flags := '{}';
  end if;
  return new;
end;
$$;

drop trigger if exists ads_before_write on public.ads;
create trigger ads_before_write
  before insert or update on public.ads
  for each row execute function public.ads_before_write();

alter table public.ads enable row level security;

-- The team (every role) reads its business's ads, budgets included; the UniBuzz team reads all. Students read none:
-- they get ads only through ads_for_feed(), which leaves the budget out.
drop policy if exists "ads_select" on public.ads;
create policy "ads_select" on public.ads
  for select to authenticated using (public.business_can(business_id, 'view') or public.is_admin());

drop policy if exists "ads_insert_team" on public.ads;
create policy "ads_insert_team" on public.ads
  for insert to authenticated with check (public.business_can(business_id, 'publish') and created_by = auth.uid());

drop policy if exists "ads_update_team" on public.ads;
create policy "ads_update_team" on public.ads
  for update to authenticated using (public.business_can(business_id, 'publish')) with check (public.business_can(business_id, 'publish'));

drop policy if exists "ads_delete_team" on public.ads;
create policy "ads_delete_team" on public.ads
  for delete to authenticated using (public.business_can(business_id, 'publish') and status in ('draft', 'rejected'));

revoke truncate on table public.ads from public, anon, authenticated;
revoke all on table public.ads from anon;

-- The team's ads in the audit log (the functions below log their own transitions).
create or replace function public.ads_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ads := case when tg_op = 'DELETE' then old else new end;
begin
  if current_setting('app.ad_transition', true) = 'on' or public.business_role(v_row.business_id) is null then
    return null;
  end if;
  perform public.business_audit_write(v_row.business_id, 'team',
    case tg_op when 'INSERT' then 'ad_created' when 'UPDATE' then 'ad_updated' else 'ad_deleted' end,
    'ad', v_row.id, jsonb_build_object('name', v_row.name));
  return null;
end;
$$;

drop trigger if exists ads_audit on public.ads;
create trigger ads_audit
  after insert or update or delete on public.ads
  for each row execute function public.ads_audit();

-- -----------------------------------------------------------------------------
-- 5. Students: hidden ads, saved ads, blocked businesses, reports
-- -----------------------------------------------------------------------------
create table if not exists public.ad_hides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ad_id uuid not null references public.ads (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ad_id)
);

create table if not exists public.ad_saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ad_id uuid not null references public.ads (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ad_id)
);

create table if not exists public.business_blocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);
create index if not exists business_blocks_business_idx on public.business_blocks (business_id);

-- What students tell the UniBuzz team about an ad, a post or a business. The business never reads these.
create table if not exists public.business_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  ad_id uuid references public.ads (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
  reason text not null check (reason in ('spam', 'misleading', 'offensive', 'scam', 'discrimination', 'prohibited', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists business_reports_once_ad on public.business_reports (reporter_id, ad_id) where ad_id is not null;
create unique index if not exists business_reports_once_deal on public.business_reports (reporter_id, deal_id) where deal_id is not null;
create unique index if not exists business_reports_once_business on public.business_reports (reporter_id, business_id) where ad_id is null and deal_id is null;
create index if not exists business_reports_open_idx on public.business_reports (status, created_at desc);

alter table public.ad_hides enable row level security;
alter table public.ad_saves enable row level security;
alter table public.business_blocks enable row level security;
alter table public.business_reports enable row level security;
revoke all on table public.business_reports from public, anon, authenticated;
revoke all on table public.ad_hides, public.ad_saves, public.business_blocks from anon;

drop policy if exists "ad_hides_own" on public.ad_hides;
create policy "ad_hides_own" on public.ad_hides for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (select public.student_side_ok()));
drop policy if exists "ad_saves_own" on public.ad_saves;
create policy "ad_saves_own" on public.ad_saves for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (select public.student_side_ok()));
drop policy if exists "business_blocks_own" on public.business_blocks;
create policy "business_blocks_own" on public.business_blocks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (select public.student_side_ok()));

-- Has the signed-in student blocked this business (or one of its people, the person-to-person block)?
create or replace function public.business_blocked_by_me(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.business_blocks k where k.user_id = auth.uid() and k.business_id = p_business)
    or exists (
      select 1 from public.business_members m join public.blocks b on b.blocked_id = m.user_id or b.blocker_id = m.user_id
      where m.business_id = p_business
        and ((b.blocker_id = auth.uid() and b.blocked_id = m.user_id) or (b.blocked_id = auth.uid() and b.blocker_id = m.user_id))
    )
  );
$$;

-- A blocked business's posts are gone for that student.
drop policy if exists "deals_not_blocked" on public.deals;
create policy "deals_not_blocked" on public.deals
  as restrictive for select to authenticated using (not public.business_blocked_by_me(business_id));

-- -----------------------------------------------------------------------------
-- 6. Events and the numbers
-- -----------------------------------------------------------------------------
-- One row per viewer per hour (impressions, clicks) or per day (the rest). Closed to the API; viewer_id is there to
-- count reach and keep one row per person, and never leaves the database.
create table if not exists public.business_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  ad_id uuid references public.ads (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete cascade,
  apartment_id uuid references public.apartments (id) on delete cascade,
  event text not null check (event in ('impression', 'click', 'save', 'profile_visit', 'inquiry')),
  placement text check (placement is null or placement in ('for_you', 'reels', 'housing', 'profile', 'deals', 'other')),
  viewer_id uuid not null,
  bucket timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index if not exists business_events_once on public.business_events (
  event, business_id,
  coalesce(ad_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(deal_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(apartment_id, '00000000-0000-0000-0000-000000000000'::uuid),
  viewer_id, bucket
);
create index if not exists business_events_business_idx on public.business_events (business_id, created_at);
create index if not exists business_events_ad_idx on public.business_events (ad_id, event) where ad_id is not null;
create index if not exists business_events_viewer_idx on public.business_events (viewer_id, created_at);
alter table public.business_events enable row level security;
revoke all on table public.business_events from public, anon, authenticated;

-- A signed-in student saw, tapped, saved or messaged a business's ad, post or listing, or opened its profile. The
-- business comes from the ad, post or listing when one is named. The business's own people, signed-out visitors,
-- ads that are not running and anything over 600 events an hour from one person are left out.
create or replace function public.record_business_event(
  p_event text, p_business uuid default null, p_ad uuid default null, p_deal uuid default null,
  p_apartment uuid default null, p_placement text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_business uuid := p_business;
  v_now timestamptz := now();
begin
  if v_me is null or not public.student_side_ok() then
    return;
  end if;
  if p_event not in ('impression', 'click', 'save', 'profile_visit', 'inquiry') then
    raise exception 'Unknown event %', p_event;
  end if;
  if p_placement is not null and p_placement not in ('for_you', 'reels', 'housing', 'profile', 'deals', 'other') then
    raise exception 'Unknown placement %', p_placement;
  end if;
  if p_ad is not null then
    select a.business_id into v_business from public.ads a
    where a.id = p_ad and (p_event not in ('impression', 'click') or (a.status in ('scheduled', 'active') and a.starts_at <= v_now and a.ends_at > v_now));
  elsif p_deal is not null then
    select d.business_id into v_business from public.deals d where d.id = p_deal;
  elsif p_apartment is not null then
    select a.business_id into v_business from public.apartments a where a.id = p_apartment;
  end if;
  if v_business is null or not public.business_approved(v_business) then
    return;
  end if;
  if exists (select 1 from public.business_members m where m.user_id = v_me and m.business_id = v_business) then
    return;
  end if;
  if (select count(*) from public.business_events e where e.viewer_id = v_me and e.created_at > v_now - interval '1 hour') >= 600 then
    return;
  end if;
  insert into public.business_events (business_id, ad_id, deal_id, apartment_id, event, placement, viewer_id, bucket)
  values (v_business, p_ad, p_deal, p_apartment, p_event, p_placement, v_me,
    date_trunc(case when p_event in ('impression', 'click') then 'hour' else 'day' end, v_now))
  on conflict do nothing;
end;
$$;

-- Per ad: what students did with it, over its whole life.
create or replace function public.business_ad_stats(p_business uuid)
returns table (
  ad_id uuid, name text, status text, placements text[], starts_at timestamptz, ends_at timestamptz, budget_cents integer,
  currency text, impressions bigint, reach bigint, clicks bigint, saves bigint, profile_visits bigint, inquiries bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.business_can(p_business, 'analytics') or public.is_admin()) then
    raise exception 'Only the business can see its stats' using errcode = '42501';
  end if;
  return query
  select a.id, a.name, public.ad_effective_status(a.status, a.starts_at, a.ends_at), a.placements, a.starts_at, a.ends_at,
    a.budget_cents, a.currency,
    count(*) filter (where e.event = 'impression'),
    count(distinct e.viewer_id) filter (where e.event = 'impression'),
    count(*) filter (where e.event = 'click'),
    count(*) filter (where e.event = 'save'),
    count(*) filter (where e.event = 'profile_visit'),
    count(*) filter (where e.event = 'inquiry')
  from public.ads a
  left join public.business_events e on e.ad_id = a.id
  where a.business_id = p_business
  group by a.id
  order by a.created_at desc;
end;
$$;

-- Day by day over the last p_days (1-90), for the whole business or one ad. Days with nothing are there, at zero.
create or replace function public.business_daily_stats(p_business uuid, p_days integer default 30, p_ad uuid default null)
returns table (day date, impressions bigint, reach bigint, clicks bigint, saves bigint, profile_visits bigint, inquiries bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
begin
  if not (public.business_can(p_business, 'analytics') or public.is_admin()) then
    raise exception 'Only the business can see its stats' using errcode = '42501';
  end if;
  return query
  select d.day::date,
    count(e.id) filter (where e.event = 'impression'),
    count(distinct e.viewer_id) filter (where e.event = 'impression'),
    count(e.id) filter (where e.event = 'click'),
    count(e.id) filter (where e.event = 'save'),
    count(e.id) filter (where e.event = 'profile_visit'),
    count(e.id) filter (where e.event = 'inquiry')
  from generate_series(current_date - (v_days - 1), current_date, interval '1 day') as d(day)
  left join public.business_events e
    on e.business_id = p_business and e.created_at >= d.day and e.created_at < d.day + interval '1 day'
    and (p_ad is null or e.ad_id = p_ad)
  group by d.day
  order by d.day;
end;
$$;

-- The headline numbers over the last p_days: the events, plus views of posts and listings (migration 4's views) and
-- the chats students opened (every inquiry, whatever it started from).
create or replace function public.business_analytics_overview(p_business uuid, p_days integer default 30)
returns table (
  impressions bigint, reach bigint, clicks bigint, saves bigint, profile_visits bigint, inquiries bigint, post_views bigint,
  active_ads bigint, spend_cents bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  if not (public.business_can(p_business, 'analytics') or public.is_admin()) then
    raise exception 'Only the business can see its stats' using errcode = '42501';
  end if;
  return query
  select
    (select count(*) from public.business_events e where e.business_id = p_business and e.event = 'impression' and e.created_at >= v_since),
    (select count(distinct e.viewer_id) from public.business_events e where e.business_id = p_business and e.event = 'impression' and e.created_at >= v_since),
    (select count(*) from public.business_events e where e.business_id = p_business and e.event = 'click' and e.created_at >= v_since),
    (select count(*) from public.business_events e where e.business_id = p_business and e.event = 'save' and e.created_at >= v_since)
      + (select count(*) from public.saved_listings s join public.apartments a on a.id = s.target_id
         where s.target_type = 'apartment' and a.business_id = p_business and s.created_at >= v_since),
    (select count(*) from public.business_events e where e.business_id = p_business and e.event = 'profile_visit' and e.created_at >= v_since),
    (select count(*) from public.conversations c where c.business_id = p_business and c.created_at >= v_since),
    (select count(*) from public.post_views v
      where v.created_at >= v_since
        and ((v.target_type = 'apartment' and v.target_id in (select a.id from public.apartments a where a.business_id = p_business))
          or (v.target_type = 'deal' and v.target_id in (select d.id from public.deals d where d.business_id = p_business)))),
    (select count(*) from public.ads a where a.business_id = p_business
      and public.ad_effective_status(a.status, a.starts_at, a.ends_at) = 'active'),
    (select coalesce(sum(p.amount_cents), 0)::bigint from public.listing_promotions p
      where p.business_id = p_business and p.status = 'active' and p.created_at >= v_since);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. The lifecycle: the team's side
-- -----------------------------------------------------------------------------
-- Everything that stops this ad from being submitted, in the words the portal shows; empty when it is ready. Fair
-- Housing flags are not here: they go to the reviewer.
create or replace function public.ad_problems(p_ad uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.ads;
  v public.media;
  v_out text[] := '{}';
  v_media_problem text;
  v_video jsonb;
  v_images integer;
  v_has_promoted_media boolean := false;
begin
  select * into a from public.ads where id = p_ad;
  if a.id is null or not (public.business_can(a.business_id, 'view') or public.is_admin()) then
    raise exception 'No such ad' using errcode = '42501';
  end if;
  if btrim(a.caption) = '' then
    v_out := array_append(v_out, 'Write a caption.');
  end if;
  if cardinality(a.university_ids) = 0 and a.legacy_promotion_id is null then
    v_out := array_append(v_out, 'Choose at least one campus.');
  end if;
  if a.starts_at is null then
    v_out := array_append(v_out, 'Choose a start date.');
  end if;
  if a.ends_at is null then
    v_out := array_append(v_out, 'Choose an end date.');
  elsif a.ends_at <= now() + interval '1 hour' then
    v_out := array_append(v_out, 'The end date has to be in the future.');
  elsif a.starts_at is not null and a.ends_at - greatest(a.starts_at, now()) > interval '90 days' then
    v_out := array_append(v_out, 'An ad runs for 90 days at most.');
  end if;
  if a.starts_at is not null and a.starts_at > now() + interval '180 days' then
    v_out := array_append(v_out, 'Start within the next six months.');
  end if;
  if a.budget_cents < 1000 then
    v_out := array_append(v_out, 'The budget is at least $10.');
  end if;
  if a.cta in ('learn_more', 'shop_now', 'order_now', 'book_now', 'sign_up') and a.cta_url is null then
    v_out := array_append(v_out, 'Add the link the button opens.');
  end if;
  if a.cta = 'get_offer' and a.cta_url is null and a.promoted_deal_id is null then
    v_out := array_append(v_out, 'Add the link the button opens, or promote one of your posts.');
  end if;
  if a.cta = 'view_listing' and a.promoted_apartment_id is null then
    v_out := array_append(v_out, 'Choose the listing "View listing" opens.');
  end if;
  if a.promoted_apartment_id is not null and not exists (select 1 from public.apartments x where x.id = a.promoted_apartment_id and x.status = 'active') then
    v_out := array_append(v_out, 'The listing you promote is not active.');
  end if;
  if a.promoted_deal_id is not null then
    if not exists (
      select 1 from public.deals d where d.id = a.promoted_deal_id and d.status = 'active' and (d.ends_at is null or d.ends_at > now())
    ) then
      v_out := array_append(v_out, 'The post you promote is not live.');
    end if;
    select jsonb_array_length(d.media) > 0 into v_has_promoted_media from public.deals d where d.id = a.promoted_deal_id;
  end if;
  v_media_problem := public.business_media_problem(a.media, a.business_id, false, true);
  if v_media_problem is not null then
    v_out := array_append(v_out, v_media_problem);
  end if;
  select e into v_video from jsonb_array_elements(a.media) e where e ->> 'type' = 'video' limit 1;
  select count(*) into v_images from jsonb_array_elements(a.media) e where e ->> 'type' = 'image';
  if v_video is not null and coalesce(v_video ->> 'media_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v from public.media m where m.id = (v_video ->> 'media_id')::uuid;
  end if;
  if 'reels' = any (a.placements) then
    if v_video is null then
      v_out := array_append(v_out, 'Reels needs one vertical video.');
    elsif v.id is not null and v.status = 'ready' then
      if v.width is null or v.height is null or v.height <= v.width then
        v_out := array_append(v_out, 'Reels needs a vertical video (taller than it is wide).');
      end if;
      if coalesce(v.duration_seconds, 0) > 60 then
        v_out := array_append(v_out, 'Reels videos are 60 seconds at most.');
      end if;
    end if;
  end if;
  if 'for_you' = any (a.placements) and v_video is null and v_images = 0 and not v_has_promoted_media then
    v_out := array_append(v_out, 'Add a photo or a video.');
  end if;
  if v_video is not null and v.id is not null and coalesce(v.duration_seconds, 0) > 120 then
    v_out := array_append(v_out, 'Ad videos are 2 minutes at most.');
  end if;
  if 'housing' = any (a.placements) and v_images = 0 and v_video is null and a.promoted_apartment_id is null then
    v_out := array_append(v_out, 'Add photos, or promote one of your listings.');
  end if;
  return v_out;
end;
$$;

-- Moves an ad's status (internal): the trigger lets the change through and the log records it.
create or replace function public.ad_transition(p_ad uuid, p_actor_kind text, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.ads where id = p_ad;
  perform public.business_audit_write(v_business, p_actor_kind, p_action, 'ad', p_ad,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('name', (select a.name from public.ads a where a.id = p_ad)));
end;
$$;

-- The owner or an admin sends a finished ad to the UniBuzz team (10 a day per business). An ad that should already
-- have started starts as soon as it is approved.
create or replace function public.ad_submit(p_ad uuid)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
  v_problems text[];
  v_pending bigint;
begin
  select * into a from public.ads where id = p_ad for update;
  if a.id is null or not public.business_can(a.business_id, 'view') then
    raise exception 'No such ad' using errcode = '42501';
  end if;
  if not public.business_can(a.business_id, 'manage_ads') then
    raise exception 'Only the owner or an admin of an approved business can submit ads' using errcode = '42501';
  end if;
  if a.status not in ('draft', 'rejected') then
    raise exception 'This ad has been submitted already';
  end if;
  v_problems := public.ad_problems(p_ad);
  if cardinality(v_problems) > 0 then
    raise exception '%', v_problems[1] using errcode = '22023';
  end if;
  if (select count(*) from public.business_audit_log l
      where l.business_id = a.business_id and l.action = 'ad_submitted' and l.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Your business has submitted 10 ads today. Try again tomorrow.' using errcode = '42501', hint = 'RATE_LIMITED';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads
  set status = 'pending_review', starts_at = greatest(starts_at, date_trunc('minute', now())), status_reason = null,
      paused_by = null, submitted_at = now(), submitted_by = auth.uid(), media = media
  where id = p_ad
  returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'team', 'ad_submitted', jsonb_build_object('budget_cents', a.budget_cents, 'currency', a.currency));
  -- The UniBuzz team's admins hear about the queue once (the unread notification is refreshed, not repeated).
  select count(*) into v_pending from public.ads where status = 'pending_review';
  perform public.notify(p.id, auth.uid(), 'business', 'Ads waiting for review',
    format('%s %s waiting in the UniBuzz Business review queue.', v_pending, case when v_pending = 1 then 'ad is' else 'ads are' end),
    '/business/admin/ads', jsonb_build_object('portal', false), 'business-ads-review')
  from public.profiles p where p.role = 'admin';
  return a;
end;
$$;

-- Takes a submitted ad back to draft (anyone who publishes).
create or replace function public.ad_withdraw(p_ad uuid)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
begin
  select * into a from public.ads where id = p_ad for update;
  if a.id is null or not public.business_can(a.business_id, 'publish') then
    raise exception 'No such ad' using errcode = '42501';
  end if;
  if a.status <> 'pending_review' then
    raise exception 'Only an ad waiting for review can be taken back';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads set status = 'draft', submitted_at = null, submitted_by = null where id = p_ad returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'team', 'ad_withdrawn');
  return a;
end;
$$;

-- Pauses a scheduled or running ad (anyone who publishes: stopping spend is never risky).
create or replace function public.ad_pause(p_ad uuid)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
begin
  select * into a from public.ads where id = p_ad for update;
  if a.id is null or not public.business_can(a.business_id, 'publish') then
    raise exception 'No such ad' using errcode = '42501';
  end if;
  if public.ad_effective_status(a.status, a.starts_at, a.ends_at) not in ('scheduled', 'active') then
    raise exception 'Only a scheduled or running ad can be paused';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads set status = 'paused', paused_by = 'business', status_reason = null where id = p_ad returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'team', 'ad_paused');
  return a;
end;
$$;

-- Resumes an ad the business paused (the owner or an admin): scheduled or running by its dates, or over.
create or replace function public.ad_resume(p_ad uuid)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
begin
  select * into a from public.ads where id = p_ad for update;
  if a.id is null or not public.business_can(a.business_id, 'view') then
    raise exception 'No such ad' using errcode = '42501';
  end if;
  if not public.business_can(a.business_id, 'manage_ads') then
    raise exception 'Only the owner or an admin of an approved business can resume ads' using errcode = '42501';
  end if;
  if a.status <> 'paused' then
    raise exception 'This ad is not paused';
  end if;
  if a.paused_by = 'admin' then
    raise exception 'The UniBuzz team paused this ad: %', coalesce(a.status_reason, 'write to them to resume it.') using errcode = '42501';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads
  set status = case when ends_at <= now() then 'completed' when starts_at > now() then 'scheduled' else 'active' end,
      paused_by = null,
      started_at = case when ends_at > now() and starts_at <= now() then coalesce(started_at, now()) else started_at end,
      completed_at = case when ends_at <= now() then now() else completed_at end
  where id = p_ad returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'team', 'ad_resumed', jsonb_build_object('status', a.status));
  return a;
end;
$$;

-- Ends an ad before its end date (the owner or an admin). It cannot be started again; copy it into a new draft.
create or replace function public.ad_end(p_ad uuid)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
begin
  select * into a from public.ads where id = p_ad for update;
  if a.id is null or not public.business_can(a.business_id, 'view') then
    raise exception 'No such ad' using errcode = '42501';
  end if;
  if not public.business_can(a.business_id, 'manage_ads') then
    raise exception 'Only the owner or an admin can end ads' using errcode = '42501';
  end if;
  if a.status not in ('scheduled', 'active', 'paused') then
    raise exception 'Only a scheduled, running or paused ad can be ended';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads set status = 'completed', completed_at = now(), status_reason = 'Ended early by the business.'
  where id = p_ad returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'team', 'ad_ended');
  return a;
end;
$$;

-- A new draft with this ad's content and no dates: how an approved ad is changed.
create or replace function public.ad_duplicate(p_ad uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
  v_id uuid;
begin
  select * into a from public.ads where id = p_ad;
  if a.id is null or not public.business_can(a.business_id, 'publish') then
    raise exception 'No such ad' using errcode = '42501';
  end if;
  insert into public.ads (business_id, created_by, name, objective, placements, university_ids, headline, caption, media, cta, cta_url,
    promoted_deal_id, promoted_apartment_id, budget_cents, currency)
  values (a.business_id, auth.uid(), left('Copy of ' || a.name, 80), a.objective, a.placements, a.university_ids, a.headline, a.caption, a.media,
    a.cta, a.cta_url, a.promoted_deal_id, a.promoted_apartment_id, a.budget_cents, a.currency)
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. The lifecycle: the UniBuzz team's side
-- -----------------------------------------------------------------------------
-- Every ad (or those with one status), the business, the payment and the open reports.
create or replace function public.admin_list_ads(p_status text default null)
returns table (
  id uuid, business_id uuid, business_name text, business_category text, business_status text, business_logo_url text,
  name text, objective text, vertical text, placements text[], university_ids uuid[], headline text, caption text, media jsonb,
  cta text, cta_url text, promoted_deal_id uuid, promoted_apartment_id uuid, promoted_title text, budget_cents integer,
  currency text, starts_at timestamptz, ends_at timestamptz, status text, paused_by text, status_reason text,
  review_note text, needs_review_reason text, fair_housing_flags text[], submitted_at timestamptz, reviewed_at timestamptz,
  paid_cents bigint, payment_reference text, open_reports bigint, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select a.id, b.id, b.name, b.category, b.status, b.logo_url, a.name, a.objective, a.vertical, a.placements, a.university_ids,
    a.headline, a.caption, a.media, a.cta, a.cta_url, a.promoted_deal_id, a.promoted_apartment_id,
    coalesce((select x.title from public.apartments x where x.id = a.promoted_apartment_id), (select d.title from public.deals d where d.id = a.promoted_deal_id)),
    a.budget_cents, a.currency, a.starts_at, a.ends_at, public.ad_effective_status(a.status, a.starts_at, a.ends_at), a.paused_by,
    a.status_reason, a.review_note, a.needs_review_reason, a.fair_housing_flags, a.submitted_at, a.reviewed_at,
    (select coalesce(sum(p.amount_cents), 0)::bigint from public.listing_promotions p where p.ad_id = a.id and p.status = 'active'),
    (select string_agg(p.payment_reference, ', ' order by p.created_at) from public.listing_promotions p where p.ad_id = a.id and p.status = 'active'),
    (select count(*) from public.business_reports r where r.ad_id = a.id and r.status = 'open'),
    a.created_at
  from public.ads a
  join public.businesses b on b.id = a.business_id
  where p_status is null or public.ad_effective_status(a.status, a.starts_at, a.ends_at) = p_status
  order by case when a.status = 'pending_review' then 0 else 1 end, a.submitted_at nulls last, a.created_at desc;
end;
$$;

-- Approves an ad, recording its payment (no payment provider yet: the amount and the invoice or receipt reference).
-- A housing ad needs the reviewer's Fair Housing check; one with flags also needs a note saying why it is fine.
create or replace function public.admin_approve_ad(
  p_ad uuid, p_amount_cents integer, p_currency text, p_payment_reference text, p_note text default null,
  p_fair_housing_checked boolean default false
)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
  v_problems text[];
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_reference text := btrim(coalesce(p_payment_reference, ''));
begin
  perform public.require_admin();
  select * into a from public.ads where id = p_ad for update;
  if a.id is null then
    raise exception 'No such ad';
  end if;
  if a.status <> 'pending_review' then
    raise exception 'Only an ad waiting for review can be approved';
  end if;
  if not public.business_approved(a.business_id) then
    raise exception 'Only an approved business''s ads can run';
  end if;
  if a.ends_at is null then
    raise exception 'This ad has no end date. Reject it and ask the business to set one.';
  end if;
  v_problems := public.ad_problems(p_ad);
  if cardinality(v_problems) > 0 then
    raise exception 'Not ready: %', v_problems[1];
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'An ad is paid: enter the amount received';
  end if;
  if char_length(v_reference) < 3 or char_length(v_reference) > 200 then
    raise exception 'Enter the payment reference (invoice or receipt number)';
  end if;
  if a.vertical = 'housing' and not coalesce(p_fair_housing_checked, false) then
    raise exception 'Confirm you checked this housing ad against the Fair Housing rules';
  end if;
  if cardinality(a.fair_housing_flags) > 0 and (v_note is null or char_length(v_note) < 10) then
    raise exception 'This ad was flagged for Fair Housing wording. Say why it is fine to approve (at least 10 characters), or reject it.';
  end if;
  insert into public.listing_promotions (business_id, apartment_id, deal_id, ad_id, starts_at, ends_at, amount_cents, currency, payment_reference, created_by)
  values (a.business_id, a.promoted_apartment_id, a.promoted_deal_id, a.id, a.starts_at, a.ends_at, p_amount_cents,
    upper(coalesce(nullif(btrim(p_currency), ''), a.currency)), v_reference, auth.uid());
  perform set_config('app.ad_transition', 'on', true);
  update public.ads
  set status = case when starts_at <= now() then 'active' else 'scheduled' end,
      started_at = case when starts_at <= now() then now() else null end,
      reviewed_at = now(), reviewed_by = auth.uid(), review_note = v_note, status_reason = null,
      needs_review_reason = null,
      fair_housing_checked_by = case when vertical = 'housing' then auth.uid() end,
      fair_housing_checked_at = case when vertical = 'housing' then now() end
  where id = p_ad returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'admin', 'ad_approved',
    jsonb_build_object('amount_cents', p_amount_cents, 'payment_reference', v_reference, 'status', a.status, 'note', v_note));
  perform public.business_notify_team(a.business_id, 'ad',
    case when a.status = 'active' then 'Your ad is live' else 'Your ad is approved' end,
    case when a.status = 'active' then format('"%s" is running now.', a.name)
      else format('"%s" starts %s.', a.name, to_char(a.starts_at at time zone 'America/Chicago', 'Mon FMDD at FMHH12:MI AM')) end,
    '/ads/' || a.id, jsonb_build_object('ad_id', a.id, 'status', a.status), array['owner', 'admin', 'editor']);
  return a;
end;
$$;

-- Rejects a submitted ad, with the reason the business sees.
create or replace function public.admin_reject_ad(p_ad uuid, p_reason text)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
begin
  perform public.require_admin();
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Say why the ad is rejected (the business sees it).';
  end if;
  select * into a from public.ads where id = p_ad for update;
  if a.id is null then
    raise exception 'No such ad';
  end if;
  if a.status <> 'pending_review' then
    raise exception 'Only an ad waiting for review can be rejected';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads set status = 'rejected', status_reason = v_reason, reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_ad returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'admin', 'ad_rejected', jsonb_build_object('reason', v_reason));
  perform public.business_notify_team(a.business_id, 'ad', 'Your ad was not approved', v_reason,
    '/ads/' || a.id, jsonb_build_object('ad_id', a.id, 'status', 'rejected'), array['owner', 'admin', 'editor']);
  return a;
end;
$$;

-- Pauses a scheduled or running ad for a policy reason; only the UniBuzz team can resume it.
create or replace function public.admin_pause_ad(p_ad uuid, p_reason text)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
begin
  perform public.require_admin();
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Say why the ad is paused (the business sees it).';
  end if;
  select * into a from public.ads where id = p_ad for update;
  if a.id is null then
    raise exception 'No such ad';
  end if;
  if a.status not in ('scheduled', 'active', 'paused') then
    raise exception 'Only a scheduled or running ad can be paused';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads set status = 'paused', paused_by = 'admin', status_reason = v_reason where id = p_ad returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'admin', 'ad_paused_by_admin', jsonb_build_object('reason', v_reason));
  perform public.business_notify_team(a.business_id, 'ad', 'Your ad was paused by the UniBuzz team', v_reason,
    '/ads/' || a.id, jsonb_build_object('ad_id', a.id, 'status', 'paused'), array['owner', 'admin', 'editor']);
  return a;
end;
$$;

-- Resumes an ad the UniBuzz team paused.
create or replace function public.admin_resume_ad(p_ad uuid)
returns public.ads
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ads;
begin
  perform public.require_admin();
  select * into a from public.ads where id = p_ad for update;
  if a.id is null or a.status <> 'paused' then
    raise exception 'This ad is not paused';
  end if;
  if not public.business_approved(a.business_id) then
    raise exception 'Only an approved business''s ads can run';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  update public.ads
  set status = case when ends_at <= now() then 'completed' when starts_at > now() then 'scheduled' else 'active' end,
      paused_by = null, status_reason = null,
      started_at = case when ends_at > now() and starts_at <= now() then coalesce(started_at, now()) else started_at end,
      completed_at = case when ends_at <= now() then now() else completed_at end
  where id = p_ad returning * into a;
  perform set_config('app.ad_transition', '', true);
  perform public.ad_transition(p_ad, 'admin', 'ad_resumed_by_admin', jsonb_build_object('status', a.status));
  perform public.business_notify_team(a.business_id, 'ad', 'Your ad was resumed', format('"%s" is %s again.', a.name, a.status),
    '/ads/' || a.id, jsonb_build_object('ad_id', a.id, 'status', a.status), array['owner', 'admin', 'editor']);
  return a;
end;
$$;

-- Students' reports, newest first (open ones by default), with what they are about.
create or replace function public.admin_list_business_reports(p_status text default 'open')
returns table (
  id uuid, business_id uuid, business_name text, ad_id uuid, ad_name text, deal_id uuid, deal_title text, reason text, details text,
  status text, resolution_note text, reporter_name text, created_at timestamptz, resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select r.id, r.business_id, b.name, r.ad_id, a.name, r.deal_id, d.title, r.reason, r.details, r.status, r.resolution_note,
    p.full_name, r.created_at, r.resolved_at
  from public.business_reports r
  join public.businesses b on b.id = r.business_id
  left join public.ads a on a.id = r.ad_id
  left join public.deals d on d.id = r.deal_id
  left join public.profiles p on p.id = r.reporter_id
  where p_status is null or r.status = p_status
  order by r.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_resolve_business_report(p_report uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  perform public.require_admin();
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'Mark the report actioned or dismissed';
  end if;
  update public.business_reports
  set status = p_status, resolution_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''), resolved_by = auth.uid(), resolved_at = now()
  where id = p_report and status = 'open'
  returning business_id into v_business;
  if v_business is null then
    raise exception 'No open report with that id';
  end if;
  -- No reporter, reason or note in the log: the business's owner can read it.
  perform public.business_audit_write(v_business, 'admin', 'report_' || p_status, 'report', p_report, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. v1's promotion functions, on top of ads
-- -----------------------------------------------------------------------------
-- Records a paid promotion of one listing or deal (v1's call): an approved, paid ad for it, Sponsored while it runs.
-- Returns the payment's id, as v1 did.
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
  v_title text;
  v_campuses uuid[];
  v_ad uuid;
  v_id uuid;
  v_starts timestamptz := coalesce(p_starts_at, now());
begin
  perform public.require_admin();
  if p_target_type = 'apartment' then
    select business_id, title, case when university_id is null then '{}'::uuid[] else array[university_id] end
    into v_business, v_title, v_campuses from public.apartments where id = p_target_id;
  elsif p_target_type = 'deal' then
    select business_id, title, university_ids into v_business, v_title, v_campuses from public.deals where id = p_target_id;
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
  if p_ends_at is null or p_ends_at <= v_starts then
    raise exception 'Choose a start and a later end date';
  end if;
  perform set_config('app.ad_transition', 'on', true);
  insert into public.ads (business_id, created_by, name, objective, placements, university_ids, caption, cta,
    promoted_apartment_id, promoted_deal_id, budget_cents, currency, starts_at, ends_at, status, started_at, completed_at,
    reviewed_at, reviewed_by, fair_housing_checked_by, fair_housing_checked_at)
  values (v_business, auth.uid(), left('Promotion: ' || v_title, 80), 'awareness', array['for_you'], coalesce(v_campuses, '{}'),
    v_title, case when p_target_type = 'apartment' then 'view_listing' else 'get_offer' end,
    case when p_target_type = 'apartment' then p_target_id end, case when p_target_type = 'deal' then p_target_id end,
    least(p_amount_cents, 10000000), upper(coalesce(nullif(btrim(p_currency), ''), 'USD')), v_starts, p_ends_at,
    case when p_ends_at <= now() then 'completed' when v_starts <= now() then 'active' else 'scheduled' end,
    case when v_starts <= now() then now() end, case when p_ends_at <= now() then now() end,
    now(), auth.uid(), auth.uid(), now())
  returning id into v_ad;
  perform set_config('app.ad_transition', '', true);
  insert into public.listing_promotions (business_id, apartment_id, deal_id, ad_id, starts_at, ends_at, amount_cents, currency, payment_reference, created_by)
  values (
    v_business,
    case when p_target_type = 'apartment' then p_target_id end,
    case when p_target_type = 'deal' then p_target_id end,
    v_ad, v_starts, p_ends_at, p_amount_cents, upper(coalesce(nullif(btrim(p_currency), ''), 'USD')), btrim(p_payment_reference), auth.uid()
  )
  returning id into v_id;
  perform public.ad_transition(v_ad, 'admin', 'promotion_recorded', jsonb_build_object('amount_cents', p_amount_cents, 'payment_reference', btrim(p_payment_reference)));
  return v_id;
end;
$$;

-- Cancels a payment (v1's call): it no longer pays for anything, and its ad ends now.
create or replace function public.admin_cancel_promotion(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad uuid;
begin
  perform public.require_admin();
  update public.listing_promotions set status = 'cancelled', cancelled_at = now() where id = p_id and status = 'active'
  returning ad_id into v_ad;
  if v_ad is not null then
    perform set_config('app.ad_transition', 'on', true);
    update public.ads set status = 'completed', completed_at = now(), status_reason = 'The payment was cancelled.'
    where id = v_ad and status in ('pending_review', 'scheduled', 'active', 'paused');
    perform set_config('app.ad_transition', '', true);
    perform public.ad_transition(v_ad, 'admin', 'promotion_cancelled', jsonb_build_object('payment_id', p_id));
  end if;
end;
$$;

-- v1's list of a business's payments, with the ad's name where no listing or deal is named.
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
    case when p.apartment_id is not null then 'apartment' when p.deal_id is not null then 'deal' else 'ad' end,
    coalesce(p.apartment_id, p.deal_id, p.ad_id),
    coalesce((select a.title from public.apartments a where a.id = p.apartment_id), (select d.title from public.deals d where d.id = p.deal_id),
      (select x.name from public.ads x where x.id = p.ad_id)),
    p.starts_at, p.ends_at, p.amount_cents, p.currency, p.payment_reference, p.status, p.created_at
  from public.listing_promotions p
  where p.business_id = p_business
  order by p.created_at desc;
end;
$$;

-- "Sponsored" (v1's computed fields): a paid ad promoting this listing or deal runs now, for an approved business.
create or replace function public.listing_sponsored(a public.apartments)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a.business_id is not null and public.business_approved(a.business_id) and exists (
    select 1 from public.ads x
    join public.listing_promotions p on p.ad_id = x.id and p.status = 'active'
    where x.promoted_apartment_id = a.id and x.status in ('scheduled', 'active') and x.starts_at <= now() and x.ends_at > now()
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
    select 1 from public.ads x
    join public.listing_promotions p on p.ad_id = x.id and p.status = 'active'
    where x.promoted_deal_id = d.id and x.status in ('scheduled', 'active') and x.starts_at <= now() and x.ends_at > now()
  );
$$;

-- A business that is not approved shows no ad (ads_for_feed() and the Sponsored fields check its standing); when it is
-- approved again, its paid ads run again within their dates, as v1's promotions did.

-- -----------------------------------------------------------------------------
-- 10. Time: starting and ending ads
-- -----------------------------------------------------------------------------
-- Every few minutes (pg_cron below): scheduled ads that reached their start go live, every ad past its end date is
-- completed, and a pending ad whose dates passed goes back to draft; the team hears about each. p_now is for tests.
create or replace function public.ads_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_started integer := 0;
  v_completed integer := 0;
  v_expired integer := 0;
begin
  perform set_config('app.ad_transition', 'on', true);
  for r in
    update public.ads set status = 'active', started_at = coalesce(started_at, p_now)
    where status = 'scheduled' and starts_at <= p_now and ends_at > p_now
    returning id, business_id, name
  loop
    v_started := v_started + 1;
    perform public.business_audit_write(r.business_id, 'system', 'ad_started', 'ad', r.id, jsonb_build_object('name', r.name));
    perform public.business_notify_team(r.business_id, 'ad', 'Your ad is live', format('"%s" is running now.', r.name),
      '/ads/' || r.id, jsonb_build_object('ad_id', r.id, 'status', 'active'), array['owner', 'admin', 'editor']);
  end loop;
  for r in
    update public.ads set status = 'completed', completed_at = p_now
    where status in ('scheduled', 'active', 'paused') and ends_at <= p_now
    returning id, business_id, name
  loop
    v_completed := v_completed + 1;
    perform public.business_audit_write(r.business_id, 'system', 'ad_completed', 'ad', r.id, jsonb_build_object('name', r.name));
    perform public.business_notify_team(r.business_id, 'ad', 'Your ad has ended', format('"%s" reached its end date. Its numbers stay in Analytics.', r.name),
      '/ads/' || r.id, jsonb_build_object('ad_id', r.id, 'status', 'completed'), array['owner', 'admin', 'editor']);
  end loop;
  for r in
    update public.ads set status = 'draft', submitted_at = null, submitted_by = null,
      status_reason = 'Its dates passed before review. Choose new dates and submit it again.'
    where status = 'pending_review' and ends_at is not null and ends_at <= p_now
    returning id, business_id, name
  loop
    v_expired := v_expired + 1;
    perform public.business_audit_write(r.business_id, 'system', 'ad_expired_in_review', 'ad', r.id, jsonb_build_object('name', r.name));
    perform public.business_notify_team(r.business_id, 'ad', 'Your ad needs new dates', format('"%s" was not reviewed before its end date.', r.name),
      '/ads/' || r.id, jsonb_build_object('ad_id', r.id, 'status', 'draft'), array['owner', 'admin', 'editor']);
  end loop;
  perform set_config('app.ad_transition', '', true);
  return jsonb_build_object('started', v_started, 'completed', v_completed, 'expired', v_expired);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. What students see
-- -----------------------------------------------------------------------------
-- Running, paid ads of approved businesses for one placement and the caller's campus, minus what they hid, reported
-- or blocked, in a rotation that changes daily and is the same for every student on that campus (nothing about the
-- student but their campus decides). p_offset continues the rotation as the feed grows. No budget, no targeting.
create or replace function public.ads_for_feed(p_placement text, p_limit integer default 1, p_offset integer default 0)
returns table (
  id uuid, business_id uuid, business_name text, business_logo_url text, business_category text, verified_partner boolean,
  objective text, headline text, caption text, media jsonb, cta text, cta_url text, placement text, ends_at timestamptz,
  promoted jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.university_id
    from public.profiles p
    where p.id = auth.uid() and p.university_id is not null and public.student_side_ok()
  )
  select a.id, b.id, b.name, b.logo_url, b.category, b.verified_partner, a.objective, a.headline, a.caption, a.media,
    a.cta, a.cta_url, p_placement, a.ends_at,
    case
      when a.promoted_apartment_id is not null then (
        select jsonb_build_object('type', 'apartment', 'id', x.id, 'title', x.title, 'price', x.price_per_month, 'currency', x.currency,
          'city', x.city, 'bedrooms', x.bedrooms, 'bathrooms', x.bathrooms, 'images', to_jsonb(x.images[1:6]), 'image_meta', x.image_meta)
        from public.apartments x where x.id = a.promoted_apartment_id)
      when a.promoted_deal_id is not null then (
        select jsonb_build_object('type', 'deal', 'id', d.id, 'title', d.title, 'kind', d.kind, 'discount_label', d.discount_label,
          'media', d.media, 'price_cents', d.price_cents, 'currency', d.currency, 'link_url', d.link_url, 'event_at', d.event_at)
        from public.deals d where d.id = a.promoted_deal_id)
    end
  from me
  join public.ads a
    on a.status in ('scheduled', 'active') and a.starts_at <= now() and a.ends_at > now()
    and p_placement = any (a.placements)
    and (cardinality(a.university_ids) = 0 or me.university_id = any (a.university_ids))
  join public.businesses b on b.id = a.business_id and b.status = 'approved'
  where exists (select 1 from public.listing_promotions pay where pay.ad_id = a.id and pay.status = 'active')
    and (a.promoted_apartment_id is null or exists (select 1 from public.apartments x where x.id = a.promoted_apartment_id and x.status = 'active'))
    and (a.promoted_deal_id is null or exists (
      select 1 from public.deals d where d.id = a.promoted_deal_id and d.status = 'active' and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())))
    and (jsonb_array_length(a.media) > 0 or a.promoted_apartment_id is not null or a.promoted_deal_id is not null)
    and not exists (select 1 from public.ad_hides h where h.user_id = me.id and h.ad_id = a.id)
    and not exists (select 1 from public.business_reports r where r.reporter_id = me.id and r.ad_id = a.id)
    and not public.business_blocked_by_me(a.business_id)
  order by md5(a.id::text || current_date::text || me.university_id::text)
  limit least(greatest(coalesce(p_limit, 1), 1), 10)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- The ads a student saved, while they can still be shown (an approved business, an ad that was approved).
create or replace function public.my_saved_ads()
returns table (
  id uuid, business_id uuid, business_name text, business_logo_url text, verified_partner boolean, headline text, caption text,
  media jsonb, cta text, cta_url text, promoted_deal_id uuid, promoted_apartment_id uuid, running boolean, saved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, b.id, b.name, b.logo_url, b.verified_partner, a.headline, a.caption, a.media, a.cta, a.cta_url,
    a.promoted_deal_id, a.promoted_apartment_id,
    (a.status in ('scheduled', 'active') and a.starts_at <= now() and a.ends_at > now()), s.created_at
  from public.ad_saves s
  join public.ads a on a.id = s.ad_id and a.status in ('scheduled', 'active', 'paused', 'completed')
  join public.businesses b on b.id = a.business_id and b.status = 'approved'
  where s.user_id = auth.uid()
  order by s.created_at desc;
$$;

create or replace function public.hide_ad(p_ad uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.student_side_ok() then
    raise exception 'Sign in as a student to hide ads' using errcode = '42501';
  end if;
  insert into public.ad_hides (user_id, ad_id) select auth.uid(), a.id from public.ads a where a.id = p_ad on conflict do nothing;
end;
$$;

create or replace function public.save_ad(p_ad uuid, p_saved boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.student_side_ok() then
    raise exception 'Sign in as a student to save ads' using errcode = '42501';
  end if;
  if coalesce(p_saved, true) then
    insert into public.ad_saves (user_id, ad_id) select auth.uid(), a.id from public.ads a where a.id = p_ad on conflict do nothing;
    if found then
      perform public.record_business_event('save', null, p_ad);
    end if;
  else
    delete from public.ad_saves where user_id = auth.uid() and ad_id = p_ad;
  end if;
end;
$$;

-- Block or unblock a business: its ads and posts disappear for the student, and it cannot be messaged.
create or replace function public.set_business_blocked(p_business uuid, p_blocked boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.student_side_ok() then
    raise exception 'Sign in as a student to block businesses' using errcode = '42501';
  end if;
  if coalesce(p_blocked, true) then
    insert into public.business_blocks (user_id, business_id) select auth.uid(), b.id from public.businesses b where b.id = p_business
    on conflict do nothing;
  else
    delete from public.business_blocks where user_id = auth.uid() and business_id = p_business;
  end if;
end;
$$;

-- A student reports an ad, a post or a business to the UniBuzz team (20 a day; the same thing once). Reporting an ad
-- also hides it for them.
create or replace function public.report_business(
  p_business uuid, p_reason text, p_details text default null, p_ad uuid default null, p_deal uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_business uuid := p_business;
begin
  if v_me is null or not public.student_side_ok() then
    raise exception 'Sign in as a student to report' using errcode = '42501';
  end if;
  if p_reason not in ('spam', 'misleading', 'offensive', 'scam', 'discrimination', 'prohibited', 'other') then
    raise exception 'Choose a reason';
  end if;
  if p_ad is not null then
    select business_id into v_business from public.ads where id = p_ad;
  elsif p_deal is not null then
    select business_id into v_business from public.deals where id = p_deal;
  end if;
  if v_business is null or not exists (select 1 from public.businesses b where b.id = v_business) then
    raise exception 'Nothing to report there';
  end if;
  perform pg_advisory_xact_lock(hashtext('business_reports:' || v_me::text));
  if (select count(*) from public.business_reports r where r.reporter_id = v_me and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent a lot of reports today. Try again tomorrow.' using errcode = '42501', hint = 'RATE_LIMITED';
  end if;
  insert into public.business_reports (reporter_id, business_id, ad_id, deal_id, reason, details)
  values (v_me, v_business, p_ad, case when p_ad is null then p_deal end, p_reason, nullif(left(btrim(coalesce(p_details, '')), 1000), ''))
  on conflict do nothing;
  if p_ad is not null then
    insert into public.ad_hides (user_id, ad_id) values (v_me, p_ad) on conflict do nothing;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Inquiries from a profile or an ad
-- -----------------------------------------------------------------------------
-- Migration 47's list (anonymous roommate and Marketplace chats) plus a business's profile and its ads.
alter table public.conversations drop constraint if exists conversations_inquiry_target_type_check;
alter table public.conversations add constraint conversations_inquiry_target_type_check
  check (inquiry_target_type is null or inquiry_target_type in ('apartment', 'deal', 'roommate', 'item', 'business', 'ad'));

-- Migration 49's function: also from a business's profile ('business') or an ad ('ad', counted as the ad's inquiry);
-- never with a business the student blocked; 15 new business chats an hour per student.
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
  elsif p_target_type = 'business' then
    v_business := p_target_id;
  elsif p_target_type = 'ad' then
    select business_id into v_business from public.ads where id = p_target_id and status in ('scheduled', 'active', 'paused', 'completed');
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
  if public.business_blocked_by_me(v_business) then
    raise exception 'You blocked this business. Unblock it to send a message.' using errcode = '42501';
  end if;
  if p_target_type = 'ad' then
    perform public.record_business_event('inquiry', null, p_target_id, null, null, null);
  end if;

  v_key := 'biz:' || v_business::text || ':' || v_me::text;
  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('business_inquiries:' || v_me::text));
  if (select count(*) from public.conversations c
      where c.created_by = v_me and c.business_id is not null and c.created_at > now() - interval '1 hour') >= 15 then
    raise exception 'You have contacted a lot of businesses in the last hour. Try again later.' using errcode = '42501', hint = 'RATE_LIMITED';
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

-- -----------------------------------------------------------------------------
-- 13. Notifications of type 'ad'
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
  from unnest(coalesce(v_have, '{}'::text[]) || array['message', 'listing_saved', 'nearby_listing', 'system', 'business', 'ad']) as t;
  alter table public.notifications drop constraint if exists notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_all) as t));
end
$$;

-- -----------------------------------------------------------------------------
-- 14. v1's promotions become ads
-- -----------------------------------------------------------------------------
-- Each payment recorded in v1 becomes the approved ad it paid for: the listing or deal it promoted, its campus or
-- campuses (a deal's empty list stays "every campus"), its period and amount, and the status its dates and
-- cancellation give it. A promotion without an end date (v1 required one, so none is expected) would wait in review
-- with needs_review_reason rather than be given a date.
do $$
declare
  p record;
  v_ad uuid;
  v_title text;
  v_campuses uuid[];
  v_status text;
begin
  perform set_config('app.ad_transition', 'on', true);
  for p in select * from public.listing_promotions where ad_id is null order by created_at loop
    if p.apartment_id is not null then
      select title, case when university_id is null then '{}'::uuid[] else array[university_id] end into v_title, v_campuses
      from public.apartments where id = p.apartment_id;
    else
      select title, university_ids into v_title, v_campuses from public.deals where id = p.deal_id;
    end if;
    v_status := case
      when p.ends_at is null then 'pending_review'
      when p.status = 'cancelled' or p.ends_at <= now() then 'completed'
      when p.starts_at > now() then 'scheduled'
      else 'active'
    end;
    insert into public.ads (business_id, created_by, name, objective, placements, university_ids, caption, cta,
      promoted_apartment_id, promoted_deal_id, budget_cents, currency, starts_at, ends_at, status, status_reason,
      needs_review_reason, submitted_at, reviewed_at, reviewed_by, started_at, completed_at, legacy_promotion_id, created_at)
    values (p.business_id, p.created_by, left('Promotion: ' || coalesce(v_title, 'listing'), 80), 'awareness', array['for_you'],
      coalesce(v_campuses, '{}'), coalesce(v_title, ''), case when p.apartment_id is not null then 'view_listing' else 'get_offer' end,
      p.apartment_id, p.deal_id, least(p.amount_cents, 10000000), p.currency, p.starts_at, p.ends_at, v_status,
      case when p.status = 'cancelled' then 'The payment was cancelled.' end,
      case when p.ends_at is null then 'Migrated from a v1 promotion with no end date: set one before it runs.' end,
      p.created_at, case when p.ends_at is not null then p.created_at end, case when p.ends_at is not null then p.created_by end,
      case when v_status in ('active', 'completed') and p.status <> 'cancelled' then p.starts_at end,
      case when v_status = 'completed' then coalesce(p.cancelled_at, p.ends_at) end,
      p.id, p.created_at)
    on conflict (legacy_promotion_id) do nothing
    returning id into v_ad;
    if v_ad is not null then
      update public.listing_promotions set ad_id = v_ad where id = p.id;
    end if;
  end loop;
  perform set_config('app.ad_transition', '', true);
end $$;

-- -----------------------------------------------------------------------------
-- 15. Every 5 minutes where pg_cron is installed (it is on production: migrations 26, 41, 42, 44 use it). Without it,
--     run `select public.ads_sweep()` every few minutes some other way; students never see an ad past its end date
--     either way.
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available: run public.ads_sweep() every few minutes another way (%).', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ads-sweep';
    perform cron.schedule('ads-sweep', '*/5 * * * *', 'select public.ads_sweep()');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 16. Who may call what
-- -----------------------------------------------------------------------------
revoke all on function public.business_media_problem(jsonb, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.business_media_snapshot(jsonb) from public, anon, authenticated;
revoke all on function public.deals_before_write() from public, anon, authenticated;
revoke all on function public.deals_audit() from public, anon, authenticated;
revoke all on function public.ads_before_write() from public, anon, authenticated;
revoke all on function public.ads_audit() from public, anon, authenticated;
revoke all on function public.ad_transition(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ads_sweep(timestamptz) from public, anon, authenticated;


do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ad_problems(uuid)', 'public.ad_submit(uuid)', 'public.ad_withdraw(uuid)', 'public.ad_pause(uuid)', 'public.ad_resume(uuid)',
    'public.ad_end(uuid)', 'public.ad_duplicate(uuid)', 'public.admin_list_ads(text)',
    'public.admin_approve_ad(uuid, integer, text, text, text, boolean)', 'public.admin_reject_ad(uuid, text)',
    'public.admin_pause_ad(uuid, text)', 'public.admin_resume_ad(uuid)', 'public.admin_list_business_reports(text)',
    'public.admin_resolve_business_report(uuid, text, text)', 'public.business_ad_stats(uuid)',
    'public.business_daily_stats(uuid, integer, uuid)', 'public.business_analytics_overview(uuid, integer)',
    'public.record_business_event(text, uuid, uuid, uuid, uuid, text)', 'public.ads_for_feed(text, integer, integer)',
    'public.my_saved_ads()', 'public.hide_ad(uuid)', 'public.save_ad(uuid, boolean)', 'public.set_business_blocked(uuid, boolean)',
    'public.report_business(uuid, text, text, uuid, uuid)', 'public.business_blocked_by_me(uuid)', 'public.fair_housing_flags(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Everyone (the labels students read signed out, and the display status): listing_sponsored, deal_sponsored,
-- ad_effective_status and business_category_ok keep the default grant.

notify pgrst, 'reload schema';

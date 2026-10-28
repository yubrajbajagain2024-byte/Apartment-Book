-- =============================================================================
-- Rollback of 20261107000100_business_ads.sql (UniBuzz Business v2, part 2: posts, ads, events, reports, blocks).
-- Run as one transaction, and before 20261107000000_business_teams.down.sql if that goes too.
--  * Removes the ads and everything attached to them (hides, saves, reports, events, the ads-sweep job), the posts' new
--    columns (a post keeps its first photo in image_url), the 'ad' notifications and the 'startup' category (those
--    businesses become 'other').
--  * Puts back exactly as they were: migration 39's Sponsored fields, promotion functions and sign-up trigger, and
--    migration 49's start_business_inquiry; conversations.inquiry_target_type goes back to migration 47's list (a chat
--    a student opened from a profile or an ad keeps going, without saying what it was about).
--  * Payments stay in listing_promotions: one for a running ad that promoted a listing or a deal is v1's promotion of it
--    again; those of ads that were not running are cancelled first.
--  * Refuses while a payment exists for an ad that promoted no listing or deal (v1 cannot hold it): end or refund those
--    ads and delete their payments on purpose first.
-- =============================================================================
do $$
begin
  if to_regclass('public.ads') is null then
    raise exception 'public.ads is missing: this database did not run 20261107000100_business_ads.sql';
  end if;
  if exists (select 1 from public.listing_promotions where apartment_id is null and deal_id is null) then
    raise exception 'payments for ads that promoted no listing or deal exist: end or refund those ads and delete their payments before rolling back';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ads-sweep';
  end if;
end $$;

-- A payment whose ad is not running (ended early, paused by the UniBuzz team, rejected) would make its listing or post
-- Sponsored again under v1's rule, which reads only the payment's dates: it is cancelled first.
update public.listing_promotions p set status = 'cancelled', cancelled_at = coalesce(p.cancelled_at, now())
from public.ads a
where p.ad_id = a.id and p.status = 'active' and a.status not in ('scheduled', 'active');

-- Inquiries from a profile or an ad
update public.conversations set inquiry_target_type = null, inquiry_target_id = null where inquiry_target_type in ('business', 'ad');
alter table public.conversations drop constraint if exists conversations_inquiry_target_type_check;
alter table public.conversations add constraint conversations_inquiry_target_type_check
  check (inquiry_target_type is null or inquiry_target_type in ('apartment', 'deal', 'roommate', 'item'));

-- Migration 49's start_business_inquiry, migration 39's Sponsored fields and promotion functions
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

-- Students' side
drop policy if exists "deals_not_blocked" on public.deals;
drop function if exists public.ads_for_feed(text, integer, integer);
drop function if exists public.my_saved_ads();
drop function if exists public.hide_ad(uuid);
drop function if exists public.save_ad(uuid, boolean);
drop function if exists public.set_business_blocked(uuid, boolean);
drop function if exists public.report_business(uuid, text, text, uuid, uuid);
drop function if exists public.business_blocked_by_me(uuid);
drop function if exists public.record_business_event(text, uuid, uuid, uuid, uuid, text);

-- The numbers
drop function if exists public.business_ad_stats(uuid);
drop function if exists public.business_daily_stats(uuid, integer, uuid);
drop function if exists public.business_analytics_overview(uuid, integer);

-- The lifecycle
drop function if exists public.ads_sweep(timestamptz);
drop function if exists public.ad_problems(uuid);
drop function if exists public.ad_submit(uuid);
drop function if exists public.ad_withdraw(uuid);
drop function if exists public.ad_pause(uuid);
drop function if exists public.ad_resume(uuid);
drop function if exists public.ad_end(uuid);
drop function if exists public.ad_duplicate(uuid);
drop function if exists public.ad_transition(uuid, text, text, jsonb);
drop function if exists public.admin_list_ads(text);
drop function if exists public.admin_approve_ad(uuid, integer, text, text, text, boolean);
drop function if exists public.admin_reject_ad(uuid, text);
drop function if exists public.admin_pause_ad(uuid, text);
drop function if exists public.admin_resume_ad(uuid);
drop function if exists public.admin_list_business_reports(text);
drop function if exists public.admin_resolve_business_report(uuid, text, text);

-- The tables
drop table if exists public.business_events;
drop table if exists public.business_reports;
drop table if exists public.business_blocks;
drop table if exists public.ad_saves;
drop table if exists public.ad_hides;
alter table public.listing_promotions drop constraint if exists listing_promotions_one_target;
alter table public.listing_promotions drop constraint if exists listing_promotions_ad_id_fkey;
drop index if exists public.listing_promotions_ad_idx;
alter table public.listing_promotions drop column if exists ad_id;
alter table public.listing_promotions add constraint listing_promotions_one_target check (num_nonnulls(apartment_id, deal_id) = 1);
drop table if exists public.ads;
drop function if exists public.ads_before_write();
drop function if exists public.ads_audit();
drop function if exists public.ad_effective_status(text, timestamptz, timestamptz);
drop function if exists public.fair_housing_flags(text);

-- Posts
drop trigger if exists deals_before_write on public.deals;
drop trigger if exists deals_audit on public.deals;
drop function if exists public.deals_before_write();
drop function if exists public.deals_audit();
alter table public.deals drop constraint if exists deals_kind_check;
alter table public.deals drop constraint if exists deals_media_check;
alter table public.deals drop constraint if exists deals_price_check;
alter table public.deals drop constraint if exists deals_currency_check;
alter table public.deals drop column if exists kind, drop column if exists media, drop column if exists price_cents,
  drop column if exists currency, drop column if exists event_at;
drop function if exists public.business_media_problem(jsonb, uuid, boolean, boolean);
drop function if exists public.business_media_snapshot(jsonb);

-- Categories and migration 39's sign-up trigger
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

update public.businesses set category = 'other' where category = 'startup';
alter table public.businesses drop constraint if exists businesses_category_check;
alter table public.businesses add constraint businesses_category_check
  check (category in ('housing', 'food', 'retail', 'services', 'fitness', 'entertainment', 'education', 'other'));
drop function if exists public.business_category_ok(text);

-- Notifications of type 'ad'
delete from public.notifications where type = 'ad';
do $$
declare
  v_have text[];
begin
  select array_agg(distinct m[1] order by m[1]) into v_have
  from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  alter table public.notifications drop constraint if exists notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_have) as t where t <> 'ad'));
end
$$;

notify pgrst, 'reload schema';

-- =============================================================================
-- Rollback of 20261109000100_business_hardening.sql (UniBuzz Business v2 hardening).
-- Run as one transaction, before rolling back 55, 50 or 49.
--  * Puts back, exactly as they were, the functions this migration replaced: migration 50's business_media_problem, deals_before_write, ads_before_write, ad_submit, admin_approve_ad, admin_resume_ad, admin_record_promotion, ads_for_feed, my_saved_ads, record_business_event;
--    migration 49's business_audit, business_audit_write, business_notify_team; migration 39's business_chat_readable, business_can_see_profile, chat_write_problem, and 39's
--    conversations_business_scope policy.
--  * Removes what it added: the re-review triggers, the website cleaning, the storage check, the ads' promoted copy.
--  * Payments keep the listing and post they name (the references go back to being deleted with them).
-- =============================================================================


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

create or replace function public.ads_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transition boolean := current_setting('app.ad_transition', true) = 'on';
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

drop policy if exists "conversations_business_scope" on public.conversations;
create policy "conversations_business_scope" on public.conversations
  as restrictive for select to authenticated
  using (case when business_id is null then (select public.student_side_ok()) when (select public.student_side_ok()) then true else public.team_can_operate(business_id) end);

drop trigger if exists deals_rereview_ads on public.deals;
drop trigger if exists apartments_rereview_ads on public.apartments;
drop trigger if exists businesses_rereview_ads on public.businesses;
drop trigger if exists businesses_clean_website on public.businesses;
drop function if exists public.deals_rereview_ads();
drop function if exists public.apartments_rereview_ads();
drop function if exists public.businesses_rereview_ads();
drop function if exists public.businesses_clean_website();
drop function if exists public.ads_pause_for_review(uuid[], text);
drop function if exists public.ad_promoted_snapshot(public.ads);
drop function if exists public.ad_screen_text(public.ads);
drop function if exists public.storage_upload_url_ok(text, uuid[]);
alter table public.ads drop column if exists promoted_snapshot;

alter table public.listing_promotions drop constraint if exists listing_promotions_apartment_id_fkey;
alter table public.listing_promotions add constraint listing_promotions_apartment_id_fkey
  foreign key (apartment_id) references public.apartments (id) on delete cascade;
alter table public.listing_promotions drop constraint if exists listing_promotions_deal_id_fkey;
alter table public.listing_promotions add constraint listing_promotions_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete cascade;

notify pgrst, 'reload schema';

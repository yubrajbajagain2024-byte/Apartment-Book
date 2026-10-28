-- Report auto-hide backstop: content that 10 different legitimate people report is hidden at once, flagged for
-- review in CampConnect Admin, its owner told, and the hide audited. Follows 20261108000300_buzz_categories.sql;
-- rollback: supabase/rollbacks/20261109000000_report_auto_hide.down.sql.
--
-- What it builds on, and does not change:
--   - Trust & Safety (migration 41) already keeps one report per person and thing (reports_one_per_reporter), decides
--     server-side whether a report is eligible (account 24 h+, trust not low, no mute/suspension/ban, not blocked either
--     way, not the author), rate-limits reporters, and hides Buzz at a weighted 3 (2 for threat/minor/doxxing). Those
--     thresholds stay exactly as they are: this is a backstop on top of them.
--   - CampConnect Admin (production only: supabase/applied-outside-repo/) gives posts, reels, comments and listings a
--     hidden state (hidden_at, content_visible() in every select policy), so a hidden item disappears from the website
--     and the app for everyone but its owner.
--
-- What it adds:
--   1. report_auto_hides: one row per automatic hide (closed to the API). It never stores an author, so a Buzz flag
--      cannot name anyone. Status: pending (waiting for staff), upheld (kept hidden), restored, deleted.
--   2. After every new report (and a reopened one), report_auto_hide_evaluate() counts distinct reporters whose reports
--      are open, eligible and weighted, not "self_harm" (a wellbeing report never hides, as in migration 41), and who
--      are still legitimate now: confirmed email, not banned or suspended, no active mute/suspension/ban, trust not low.
--      Blocks are deliberately not re-checked here: an author could otherwise block reporters to cancel their reports.
--      At 10 it hides the item through Trust & Safety's own path (ts_apply_content_status: Buzz through its adapter,
--      public content through the bridge in 3), which also sends the owner the usual "hidden while our team reviews it"
--      notice with no actor. A Buzz item Trust & Safety itself just hid is flagged too, so the review list is complete.
--      Every flag writes CampConnect Admin's audit log (actor null = System; Buzz rows never carry an author) and Trust &
--      Safety's (actor_role system). Advisory locks per item make concurrent reports count once each.
--   3. Trust & Safety's console and CampConnect Admin agree on public content: ts_snapshot() reports a hidden post as
--      'hidden' (so the console's auto-hidden view lists it), and ts_set_content_status() hides and restores it through
--      CampConnect Admin's hidden_at instead of doing nothing.
--   4. CampConnect Admin's restore closes the item's open reports as dismissed (feeding reporter trust) and its queue
--      item: each person can report a thing once, so it takes 10 new people to hide restored content again. Delete
--      closes them as actioned. Both settle the flag and, for flagged content, tell the owner. New staff functions:
--      admin_auto_hidden_list, admin_auto_hidden_counts and admin_auto_hide_uphold ("keep hidden").
--
-- Without CampConnect Admin's schema (this repo's own boot(), no public.staff_audit_log) there is nothing to hide public
-- content with: the CampConnect Admin parts are not created and the evaluation returns at once. Safe to run twice.

-- -----------------------------------------------------------------------------
-- 1. The flags
-- -----------------------------------------------------------------------------
create table if not exists public.report_auto_hides (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'comment', 'apartment', 'item', 'roommate', 'buzz', 'buzz_comment')),
  target_id uuid not null,
  source text not null check (source in ('report_threshold', 'trust_safety')),
  reporter_count int not null default 0,
  reasons jsonb not null default '{}'::jsonb,
  hidden_at timestamptz not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'upheld', 'restored', 'deleted')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 2000)
);
create unique index if not exists report_auto_hides_one_pending on public.report_auto_hides (target_type, target_id) where status = 'pending';
create index if not exists report_auto_hides_target_idx on public.report_auto_hides (target_type, target_id, hidden_at desc);
create index if not exists report_auto_hides_status_idx on public.report_auto_hides (status, created_at desc);
alter table public.report_auto_hides enable row level security;
revoke all on table public.report_auto_hides from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Helpers (internal)
-- -----------------------------------------------------------------------------
create or replace function public.report_auto_hide_threshold()
returns int
language sql
immutable
as $$
  select 10;
$$;

-- The table behind a reportable type, in either vocabulary ('buzz_reply' is Trust & Safety's word for a Buzz reply,
-- 'buzz_comment' CampConnect Admin's and the reports table's).
create or replace function public.report_target_table(p_type text)
returns text
language sql
immutable
as $$
  select case p_type
    when 'post' then 'feed_posts'
    when 'comment' then 'post_comments'
    when 'apartment' then 'apartments'
    when 'item' then 'items'
    when 'roommate' then 'roommate_posts'
    when 'message' then 'messages'
    when 'buzz' then 'buzz_posts'
    when 'buzz_comment' then 'buzz_comments'
    when 'buzz_reply' then 'buzz_comments'
  end;
$$;

-- When the item was hidden, or null. Read through to_jsonb so it also answers (null) where hidden_at does not exist.
create or replace function public.report_hidden_at(p_type text, p_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_table text := public.report_target_table(p_type);
  v timestamptz;
begin
  if v_table is null or p_id is null then
    return null;
  end if;
  execute format('select (to_jsonb(x) ->> ''hidden_at'')::timestamptz from public.%I x where x.id = $1', v_table) into v using p_id;
  return v;
end;
$$;

-- Migration 41's ts_snapshot(), unchanged for Buzz; public content says 'hidden' while CampConnect Admin hides it, so
-- Trust & Safety's auto-hide skips it, its console lists it under auto-hidden, and a restore there tells the owner.
create or replace function public.ts_snapshot(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s jsonb;
begin
  if p_id is null or p_type is null then
    return null;
  end if;
  if public.ts_is_anon(p_type) then
    begin
      s := public.buzz_v2_snapshot(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id);
    exception when undefined_function then
      return null;
    end;
    if s is null or jsonb_typeof(s) <> 'object' or s ->> 'entityId' is null then
      return null;
    end if;
    return s;
  end if;
  s := public.ts_public_snapshot(p_type, p_id);
  if s is not null and p_type in ('post', 'comment', 'apartment', 'item', 'roommate') and public.report_hidden_at(p_type, p_id) is not null then
    s := s || jsonb_build_object('status', 'hidden');
  end if;
  return s;
end;
$$;

-- Settle the item's pending flag (restored, upheld or deleted). Returns the flag's id, or null when there was none.
create or replace function public.report_auto_hide_settle(p_type text, p_id uuid, p_status text, p_actor uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.report_auto_hides f
  set status = p_status, reviewed_by = p_actor, reviewed_at = now(), review_note = coalesce(left(nullif(btrim(p_note), ''), 2000), f.review_note)
  where f.target_type = case when p_type = 'buzz_reply' then 'buzz_comment' else p_type end and f.target_id = p_id and f.status = 'pending'
  returning f.id into v_id;
  return v_id;
end;
$$;

-- Close the item's open reports (each reporter told the outcome by migration 41's ts_close_reports, never what happened
-- to whom), record CampConnect Admin's review on them, and close Trust & Safety's queue item.
create or replace function public.report_auto_hide_close(
  p_type text, p_id uuid, p_outcome text, p_decision text, p_actor uuid, p_note text, p_resolution text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ts_type text := case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end;
begin
  if to_regclass('public.staff_audit_log') is not null then
    update public.reports r
    set reviewed_by = p_actor, reviewed_at = now(), decision = p_decision, notes = coalesce(left(nullif(btrim(p_note), ''), 2000), r.notes)
    where r.target_type in (p_type, v_ts_type, case when v_ts_type = 'buzz_reply' then 'buzz_comment' end) and r.target_id = p_id and r.status = 'open';
  end if;
  perform public.ts_close_reports(v_ts_type, p_id, p_outcome);
  update public.mod_queue q
  set status = 'closed', closed_at = now(), resolution = p_resolution, claimed_by = null, claimed_at = null
  where q.entity_type = v_ts_type and q.entity_id = p_id and q.status <> 'closed';
end;
$$;

-- The owner's notice after a review of flagged content, in migration 41's words and channel (type 'moderation', no
-- actor, their own text quoted back, data.anonymous for Buzz).
create or replace function public.report_auto_hide_tell_owner(p_type text, p_author uuid, p_snap jsonb, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := coalesce(p_snap ->> 'label', case when public.ts_is_anon(p_type) then 'buzz' else 'post' end);
begin
  if p_author is null then
    return;
  end if;
  perform public.ts_notify(
    p_author, 'moderation',
    case p_event
      when 'content_restored' then 'Your ' || v_label || ' is back up.'
      when 'content_kept_hidden' then 'Your ' || v_label || ' stays hidden after review.'
      else 'Your ' || v_label || ' was removed after review.'
    end,
    case when p_event = 'content_restored' then null else nullif('“' || public.ts_excerpt(p_snap) || '”', '“”') end,
    '/settings/account-status',
    jsonb_build_object('event', p_event, 'label', v_label, 'category', null, 'sanctionId', null, 'anonymous', public.ts_is_anon(p_type)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. The evaluation and its triggers
-- -----------------------------------------------------------------------------
create or replace function public.report_auto_hide_evaluate(p_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := case when p_type = 'buzz_reply' then 'buzz_comment' else p_type end;
  v_ts_type text := case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end;
  v_anon boolean := public.ts_is_anon(p_type);
  s jsonb;
  v_count int;
  v_reasons jsonb;
  v_queue public.mod_queue;
  v_source text;
  v_hidden_at timestamptz;
  v_flag uuid;
  v_details jsonb;
begin
  if p_id is null or v_type is null or v_type not in ('post', 'comment', 'apartment', 'item', 'roommate', 'buzz', 'buzz_comment') then
    return;
  end if;
  if to_regclass('public.staff_audit_log') is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('report_auto_hide:' || v_type || ':' || p_id::text, 0));
  s := public.ts_snapshot(v_type, p_id);
  if s is null then
    return;
  end if;
  select c.reporters, c.reasons into v_count, v_reasons from public.report_auto_hide_count(v_type, p_id) c;
  select * into v_queue from public.mod_queue q where q.entity_type = v_ts_type and q.entity_id = p_id and q.status <> 'closed';
  if s ->> 'status' = 'active' then
    if coalesce(v_count, 0) < public.report_auto_hide_threshold() then
      return;
    end if;
    perform public.ts_apply_content_status(v_type, p_id, 'hidden', null, v_queue.category, null, s);
    v_source := 'report_threshold';
  elsif v_anon and s ->> 'status' = 'hidden' then
    v_source := 'trust_safety';
  else
    return;
  end if;
  v_hidden_at := public.report_hidden_at(v_type, p_id);
  if v_hidden_at is null or exists (
    select 1 from public.report_auto_hides f
    where f.target_type = v_type and f.target_id = p_id and (f.status = 'pending' or f.hidden_at >= v_hidden_at)
  ) then
    return;
  end if;
  insert into public.report_auto_hides (target_type, target_id, source, reporter_count, reasons, hidden_at)
  values (v_type, p_id, v_source, coalesce(v_count, 0), coalesce(v_reasons, '{}'::jsonb), v_hidden_at)
  returning id into v_flag;
  if v_queue.id is not null then
    update public.mod_queue set priority = least(priority, 'p1') where id = v_queue.id;
  end if;
  v_details := jsonb_build_object('target_type', v_type, 'target_id', p_id, 'flag_id', v_flag, 'source', v_source,
    'reporter_count', coalesce(v_count, 0), 'reasons', coalesce(v_reasons, '{}'::jsonb), 'threshold', public.report_auto_hide_threshold());
  if not v_anon then
    v_details := v_details || jsonb_build_object('author_id', public.ts_author_of(v_type, p_id));
  end if;
  insert into public.staff_audit_log (actor_id, actor_email, action, target_type, target_id, details)
  values (null, null, 'content.auto_hide', v_type, p_id::text, v_details);
  perform public.ts_audit(null, 'system', 'auto_hide', v_ts_type, p_id::text, v_queue.id, null, v_source, null,
    jsonb_build_object('flagId', v_flag, 'reporterCount', coalesce(v_count, 0), 'threshold', public.report_auto_hide_threshold()));
end;
$$;

-- Runs after migration 41's reports_after_insert (triggers fire in name order). A failure never loses the report and
-- never changes what the reporter is told: Buzz reporters must not learn anything from the response.
create or replace function public.reports_auto_hide()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.report_auto_hide_evaluate(new.target_type, new.target_id);
  exception when others then
    raise warning 'report auto-hide of % % failed: %', new.target_type, new.target_id, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists reports_auto_hide on public.reports;
create trigger reports_auto_hide after insert on public.reports for each row execute function public.reports_auto_hide();
-- A report staff reopen counts again.
drop trigger if exists reports_auto_hide_reopen on public.reports;
create trigger reports_auto_hide_reopen after update of status on public.reports
  for each row when (new.status = 'open' and old.status is distinct from 'open') execute function public.reports_auto_hide();

-- Content deleted by any path (its author, a cascade) leaves no pending flag behind.
create or replace function public.report_auto_hide_target_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.report_auto_hides f
  set status = 'deleted', reviewed_at = now(), review_note = coalesce(f.review_note, 'The content was deleted')
  where f.target_type = tg_argv[0] and f.target_id = old.id and f.status = 'pending';
  return null;
end;
$$;
drop trigger if exists feed_posts_auto_hide_gone on public.feed_posts;
create trigger feed_posts_auto_hide_gone after delete on public.feed_posts for each row execute function public.report_auto_hide_target_gone('post');
drop trigger if exists post_comments_auto_hide_gone on public.post_comments;
create trigger post_comments_auto_hide_gone after delete on public.post_comments for each row execute function public.report_auto_hide_target_gone('comment');
drop trigger if exists apartments_auto_hide_gone on public.apartments;
create trigger apartments_auto_hide_gone after delete on public.apartments for each row execute function public.report_auto_hide_target_gone('apartment');
drop trigger if exists items_auto_hide_gone on public.items;
create trigger items_auto_hide_gone after delete on public.items for each row execute function public.report_auto_hide_target_gone('item');
drop trigger if exists roommate_posts_auto_hide_gone on public.roommate_posts;
create trigger roommate_posts_auto_hide_gone after delete on public.roommate_posts for each row execute function public.report_auto_hide_target_gone('roommate');
drop trigger if exists buzz_posts_auto_hide_gone on public.buzz_posts;
create trigger buzz_posts_auto_hide_gone after delete on public.buzz_posts for each row execute function public.report_auto_hide_target_gone('buzz');
drop trigger if exists buzz_comments_auto_hide_gone on public.buzz_comments;
create trigger buzz_comments_auto_hide_gone after delete on public.buzz_comments for each row execute function public.report_auto_hide_target_gone('buzz_comment');

-- Migration 41's ts_set_content_status(), unchanged for Buzz and for removals. Where CampConnect Admin's schema exists,
-- public content is hidden and restored through its hidden_at (its media queued as for a staff hide), so the console's
-- approve, restore and granted appeals bring back what reports hid. Either way a pending flag is settled.
create or replace function public.ts_set_content_status(p_type text, p_id uuid, p_status text, p_immune boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hidden timestamptz;
begin
  if public.ts_is_anon(p_type) then
    perform public.buzz_v2_set_status(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id, p_status, p_immune);
  elsif p_status = 'removed' then
    perform public.ts_public_remove(p_type, p_id);
  elsif p_status in ('hidden', 'active') and p_type in ('post', 'comment', 'apartment', 'item', 'roommate')
        and to_regclass('public.staff_audit_log') is not null then
    v_hidden := public.report_hidden_at(p_type, p_id);
    if p_status = 'hidden' and v_hidden is null then
      perform public.moderation_content_hide(p_type, p_id, 'Hidden by reports, waiting for review');
    elsif p_status = 'active' and v_hidden is not null then
      perform public.moderation_content_restore(p_type, p_id);
    end if;
  end if;
  if p_status = 'active' then
    perform public.report_auto_hide_settle(p_type, p_id, 'restored', auth.uid());
  elsif p_status in ('removed', 'deleted') then
    perform public.report_auto_hide_settle(p_type, p_id, 'deleted', auth.uid());
  end if;
end;
$$;

revoke all on function
  public.report_auto_hide_threshold(), public.report_target_table(text), public.report_hidden_at(text, uuid),
  public.ts_snapshot(text, uuid), public.ts_set_content_status(text, uuid, text, boolean),
  public.report_auto_hide_settle(text, uuid, text, uuid, text), public.report_auto_hide_close(text, uuid, text, text, uuid, text, text),
  public.report_auto_hide_tell_owner(text, uuid, jsonb, text), public.report_auto_hide_evaluate(text, uuid),
  public.reports_auto_hide(), public.report_auto_hide_target_gone()
from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. CampConnect Admin (only where its schema exists)
-- -----------------------------------------------------------------------------
-- Who counts. Only reports that are open, eligible and weighted (migration 41's insert-time checks), not about
-- self-harm, from people who are still legitimate now. One per person, whichever alias a Buzz reply was reported under.
do $do$
begin
  if to_regclass('public.staff_audit_log') is null then
    return;
  end if;
  execute $ddl$
create or replace function public.report_auto_hide_count(p_type text, p_id uuid)
returns table (reporters int, reasons jsonb)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query
    with legit as (
      select distinct on (r.reporter_id) r.reporter_id, r.reason
      from public.reports r
      join auth.users u on u.id = r.reporter_id
      where r.target_type in (p_type, case when p_type in ('buzz_comment', 'buzz_reply') then 'buzz_comment' end,
                              case when p_type in ('buzz_comment', 'buzz_reply') then 'buzz_reply' end)
        and r.target_id = p_id
        and r.status = 'open' and r.eligible and r.weight > 0 and r.reason <> 'self_harm'
        and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until <= now())
        and not public.is_suspended(r.reporter_id)
        and not exists (
          select 1 from public.user_sanctions x
          where x.user_id = r.reporter_id and x.kind in ('mute', 'suspension', 'ban') and x.lifted_at is null
            and x.effective_at <= now() and (x.expires_at is null or x.expires_at > now())
        )
        and public.ts_reporter_trust(r.reporter_id) <> 'low'
      order by r.reporter_id, r.created_at
    )
    select (select count(*)::int from legit),
           coalesce((select jsonb_object_agg(g.reason, g.n) from (select l.reason, count(*)::int as n from legit l group by l.reason) g), '{}'::jsonb);
end;
$fn$
  $ddl$;
  execute 'revoke all on function public.report_auto_hide_count(text, uuid) from public, anon, authenticated';
end
$do$;

-- Hide and restore without a staff check, for the staff functions below and the reports path above: migration 15's
-- admin_content_hide / admin_content_restore bodies (the update under app.moderation, the copies, the media jobs for
-- what the author owns), returning the audit details instead of writing them.
do $do$
begin
  if to_regclass('public.staff_audit_log') is null then
    return;
  end if;
  execute $ddl$
create or replace function public.moderation_content_hide(p_target_type text, p_target_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
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
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  v_snap := public.admin_content_snapshot(p_target_type, p_target_id);
  if v_snap is null then
    raise exception 'Content not found';
  end if;
  v_owner := (v_snap ->> 'author_id')::uuid;
  perform set_config('app.moderation', 'on', true);
  execute format('update public.%I set hidden_at = coalesce(hidden_at, now()), hidden_reason = $1 where id = $2', public.admin_content_table(p_target_type))
    using p_reason, p_target_id;
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
  v_details := jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'reason', p_reason,
    'photos', to_jsonb(v_photos), 'videos', to_jsonb(v_videos));
  if cardinality(v_skipped) > 0 then
    v_details := v_details || jsonb_build_object('skipped_refs', to_jsonb(v_skipped));
  end if;
  if p_target_type not in ('buzz', 'buzz_comment') then
    v_details := v_details || jsonb_build_object('author_id', v_snap -> 'author_id');
  end if;
  return v_details;
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.moderation_content_restore(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
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
  return v_details;
end;
$fn$
  $ddl$;
  execute 'revoke all on function public.moderation_content_hide(text, uuid, text), public.moderation_content_restore(text, uuid) from public, anon, authenticated';
end
$do$;

-- Migration 15's staff functions on top of those helpers. Hide is unchanged. Restore also closes the item's open
-- reports as dismissed and its queue item as approved (so the reports that hid it cannot hide it again), settles a
-- flag and tells that owner it is back. Delete closes them as actioned, settles a flag and tells that owner.
do $do$
begin
  if to_regclass('public.staff_audit_log') is null then
    return;
  end if;
  execute $ddl$
create or replace function public.admin_content_hide(p_target_type text, p_target_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_reason text := btrim(p_reason);
begin
  v_caller := public.staff_require('moderator');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Give a reason of 3 to 500 characters';
  end if;
  perform public.staff_log('content.hide', p_target_type, p_target_id::text, public.moderation_content_hide(p_target_type, p_target_id, v_reason));
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_content_restore(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_before jsonb;
  v_author uuid;
  v_flag uuid;
begin
  v_caller := public.staff_require('moderator');
  if public.admin_content_table(p_target_type) is null then
    raise exception 'Invalid content type';
  end if;
  v_before := public.ts_snapshot(p_target_type, p_target_id);
  perform public.staff_log('content.restore', p_target_type, p_target_id::text, public.moderation_content_restore(p_target_type, p_target_id));
  v_flag := public.report_auto_hide_settle(p_target_type, p_target_id, 'restored', v_caller.user_id);
  perform public.report_auto_hide_close(p_target_type, p_target_id, 'dismissed', 'dismissed', v_caller.user_id, 'Content restored after review', 'approved');
  if v_flag is not null then
    v_author := public.ts_author_of(p_target_type, p_target_id);
    perform public.report_auto_hide_tell_owner(p_target_type, v_author, v_before, 'content_restored');
  end if;
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_content_delete(p_target_type text, p_target_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_reason text := btrim(p_reason);
  v_snap jsonb;
  v_before jsonb;
  v_author uuid;
  v_flag uuid;
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
  -- Who to tell and what they wrote, read before the row goes.
  v_before := public.ts_snapshot(p_target_type, p_target_id);
  v_author := public.ts_author_of(p_target_type, p_target_id);
  v_flag := public.report_auto_hide_settle(p_target_type, p_target_id, 'deleted', v_caller.user_id, v_reason);
  perform public.report_auto_hide_close(p_target_type, p_target_id, 'actioned', 'content_deleted', v_caller.user_id, v_reason, 'removed');
  if v_flag is not null then
    perform public.report_auto_hide_tell_owner(p_target_type, v_author, v_before, 'content_removed');
  end if;
  perform public.moderation_sync_copies(p_target_type, p_target_id, v_snap, true);
  execute format('delete from public.%I where id = $1', public.admin_content_table(p_target_type)) using p_target_id;
end;
$fn$
  $ddl$;
  -- Migration 15's queue, where "reviewed" now also lists what Trust & Safety closed as actioned.
  execute $ddl$
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
as $fn$
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
    where (v_status = 'all' or r.status = v_status or (v_status = 'reviewed' and r.status = 'actioned'))
      and (p_before is null or r.created_at < p_before)
    order by r.created_at desc, r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$
  $ddl$;
end
$do$;

-- The review list (all of it, or one item's flags), its counts and "keep hidden". Buzz rows never name an author.
do $do$
begin
  if to_regclass('public.staff_audit_log') is null then
    return;
  end if;
  execute $ddl$
create or replace function public.admin_auto_hidden_list(
  p_status text default 'pending', p_limit int default 50, p_before timestamptz default null, p_target_type text default null, p_target_id uuid default null
)
returns table (
  id uuid, target_type text, target_id uuid, source text, reporter_count int, reasons jsonb, hidden_at timestamptz, created_at timestamptz,
  status text, reviewed_by uuid, reviewer_name text, reviewed_at timestamptz, review_note text,
  target_exists boolean, target_hidden boolean, title text, preview text, author_id uuid, author_name text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_status text := coalesce(p_status, 'pending');
begin
  perform public.staff_require('moderator');
  if v_status not in ('pending', 'upheld', 'restored', 'deleted', 'all') then
    raise exception 'Invalid status';
  end if;
  return query
    select f.id, f.target_type, f.target_id, f.source, f.reporter_count, f.reasons, f.hidden_at, f.created_at,
      f.status, f.reviewed_by, vp.full_name, f.reviewed_at, f.review_note,
      s.snap is not null,
      coalesce(s.snap ->> 'hidden_at' is not null, false),
      nullif(s.snap ->> 'title', ''),
      coalesce(left(s.snap ->> 'body', 140), ''),
      case when f.target_type in ('buzz', 'buzz_comment') then null else (s.snap ->> 'author_id')::uuid end,
      case when f.target_type in ('buzz', 'buzz_comment') then null else s.snap ->> 'author_name' end
    from public.report_auto_hides f
    left join public.profiles vp on vp.id = f.reviewed_by
    left join lateral (select public.admin_content_snapshot(f.target_type, f.target_id) as snap) s on true
    where (v_status = 'all' or f.status = v_status)
      and (p_before is null or f.created_at < p_before)
      and (p_target_type is null or f.target_type = p_target_type)
      and (p_target_id is null or f.target_id = p_target_id)
    order by f.created_at desc, f.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_auto_hidden_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v jsonb;
begin
  perform public.staff_require('moderator');
  select jsonb_build_object(
    'pending', count(*) filter (where f.status = 'pending'),
    'upheld', count(*) filter (where f.status = 'upheld'),
    'restored', count(*) filter (where f.status = 'restored'),
    'deleted', count(*) filter (where f.status = 'deleted'))
  into v
  from public.report_auto_hides f;
  return v;
end;
$fn$
  $ddl$;
  execute $ddl$
create or replace function public.admin_auto_hide_uphold(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller public.staff;
  v_note text := nullif(btrim(p_note), '');
  v_flag public.report_auto_hides;
  v_before jsonb;
begin
  v_caller := public.staff_require('moderator');
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'Keep the note under 2,000 characters';
  end if;
  select * into v_flag from public.report_auto_hides f where f.id = p_id for update;
  if v_flag.id is null then
    raise exception 'Flag not found';
  end if;
  if v_flag.status <> 'pending' then
    raise exception 'This flag was already reviewed';
  end if;
  if public.report_hidden_at(v_flag.target_type, v_flag.target_id) is null then
    raise exception 'Content is not hidden';
  end if;
  v_before := public.ts_snapshot(v_flag.target_type, v_flag.target_id);
  update public.report_auto_hides f
  set status = 'upheld', reviewed_by = v_caller.user_id, reviewed_at = now(), review_note = v_note
  where f.id = p_id;
  perform set_config('app.moderation', 'on', true);
  execute format('update public.%I set hidden_reason = $1 where id = $2 and hidden_at is not null', public.admin_content_table(v_flag.target_type))
    using 'Kept hidden after review', v_flag.target_id;
  perform set_config('app.moderation', '', true);
  perform public.report_auto_hide_close(v_flag.target_type, v_flag.target_id, 'actioned', 'content_hidden', v_caller.user_id, v_note, 'removed');
  perform public.report_auto_hide_tell_owner(v_flag.target_type, public.ts_author_of(v_flag.target_type, v_flag.target_id), v_before, 'content_kept_hidden');
  perform public.staff_log('content.auto_hide_upheld', v_flag.target_type, v_flag.target_id::text,
    jsonb_build_object('target_type', v_flag.target_type, 'target_id', v_flag.target_id, 'flag_id', v_flag.id,
      'reporter_count', v_flag.reporter_count, 'note', v_note));
end;
$fn$
  $ddl$;
  execute 'revoke all on function public.admin_auto_hidden_list(text, int, timestamptz, text, uuid), public.admin_auto_hidden_counts(), public.admin_auto_hide_uphold(uuid, text) from public, anon';
  execute 'grant execute on function public.admin_auto_hidden_list(text, int, timestamptz, text, uuid), public.admin_auto_hidden_counts(), public.admin_auto_hide_uphold(uuid, text) to authenticated';
end
$do$;

notify pgrst, 'reload schema';

-- Rollback of 20261110000000_report_auto_hide.sql: no more automatic hides at 10 reports and no flags. Restores, verbatim,
-- migration 41's ts_snapshot() and ts_set_content_status() and, where CampConnect Admin's schema exists, migration 15's
-- admin_content_hide/restore/delete and admin_reports_list (supabase/applied-outside-repo/20261024000000_moderation_support.sql).
-- Content hidden automatically stays hidden (restore it in CampConnect Admin first if it should come back); reports
-- closed by a restore or a deletion stay closed. The flags table and its history are dropped.
begin;

drop trigger if exists reports_auto_hide on public.reports;
drop trigger if exists reports_auto_hide_reopen on public.reports;
drop trigger if exists feed_posts_auto_hide_gone on public.feed_posts;
drop trigger if exists post_comments_auto_hide_gone on public.post_comments;
drop trigger if exists apartments_auto_hide_gone on public.apartments;
drop trigger if exists items_auto_hide_gone on public.items;
drop trigger if exists roommate_posts_auto_hide_gone on public.roommate_posts;
drop trigger if exists buzz_posts_auto_hide_gone on public.buzz_posts;
drop trigger if exists buzz_comments_auto_hide_gone on public.buzz_comments;

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
  return public.ts_public_snapshot(p_type, p_id);
end;
$$;

create or replace function public.ts_set_content_status(p_type text, p_id uuid, p_status text, p_immune boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.ts_is_anon(p_type) then
    perform public.buzz_v2_set_status(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id, p_status, p_immune);
  elsif p_status = 'removed' then
    perform public.ts_public_remove(p_type, p_id);
  end if;
end;
$$;

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
$fn$
  $ddl$;
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
    where (v_status = 'all' or r.status = v_status)
      and (p_before is null or r.created_at < p_before)
    order by r.created_at desc, r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$fn$
  $ddl$;
end
$do$;

drop function if exists public.admin_auto_hidden_list(text, int, timestamptz, text, uuid);
drop function if exists public.admin_auto_hidden_counts();
drop function if exists public.admin_auto_hide_uphold(uuid, text);
drop function if exists public.moderation_content_hide(text, uuid, text);
drop function if exists public.moderation_content_restore(text, uuid);
drop function if exists public.report_auto_hide_count(text, uuid);
drop function if exists public.reports_auto_hide();
drop function if exists public.report_auto_hide_target_gone();
drop function if exists public.report_auto_hide_evaluate(text, uuid);
drop function if exists public.report_auto_hide_tell_owner(text, uuid, jsonb, text);
drop function if exists public.report_auto_hide_close(text, uuid, text, text, uuid, text, text);
drop function if exists public.report_auto_hide_settle(text, uuid, text, uuid, text);
drop function if exists public.report_hidden_at(text, uuid);
drop function if exists public.report_target_table(text);
drop function if exists public.report_auto_hide_threshold();
drop table if exists public.report_auto_hides;

commit;

notify pgrst, 'reload schema';

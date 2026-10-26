-- =============================================================================
-- Migration 33: what happens to a Snap, logged on its message for both sides. Safe to re-run.
--   messages.snap gains `activity`, a list of {type, at[, detect]} the database appends to as the Snap goes along, so
--   the chat on either side shows it live (the chat already follows its messages' updates):
--     * delivered  the recipient's app received the message (snap_delivered(), once);
--     * opened     the one view (open_snap(), which now takes what the viewer's device can tell about captures:
--                  "ios" reports screenshots and blacks out recordings, "android" blocks both, "none" can do neither;
--                  the sender is told exactly that and nothing more);
--     * screenshot, recording  the viewer's device saw one while the Snap was open (report_snap_capture(), only by
--                  the recipient and only within five minutes of opening); the sender gets a "snap_activity"
--                  notification at once;
--     * deleted    the sender took it back (delete_snap(), new: every chat it went to shows "Snap deleted" and the file
--                  goes at once), or their account went;
--     * expired    nobody opened it in time (purge_snaps()).
--   "sent" is never stored: the message's own time says it. The list stays on the message after the Snap is over.
--   Everything is still written only by these functions (the guard from migration 28 refuses the column from the API).
-- =============================================================================

-- Appends one entry to a message's Snap activity, keeping the newest 40.
create or replace function public.snap_log(p_message_id uuid, p_entry jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list jsonb;
begin
  select coalesce(m.snap -> 'activity', '[]'::jsonb) || jsonb_build_array(p_entry) into v_list
  from public.messages m where m.id = p_message_id and m.snap is not null;
  if v_list is null then
    return;
  end if;
  if jsonb_array_length(v_list) > 40 then
    select jsonb_agg(x.e order by x.i) into v_list
    from (select e, i from jsonb_array_elements(v_list) with ordinality as t(e, i) order by i desc limit 40) x;
  end if;
  update public.messages set snap = snap || jsonb_build_object('activity', v_list) where id = p_message_id;
end;
$$;

-- The message of a Snap in the chat I belong to, by the Snap's id (the chat's one message carries it for both sides).
create or replace function public.snap_message_for(p_snap_id uuid, p_user_id uuid)
returns public.messages
language sql
stable
security definer
set search_path = public
as $$
  select m.* from public.messages m
  where m.snap ->> 'id' = p_snap_id::text
    and public.is_conversation_member(m.conversation_id, p_user_id)
  order by m.created_at desc
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- The one view, now saying what the viewer's device can detect. The one-argument form goes (a call with one argument
-- would otherwise be ambiguous); older apps calling with one argument get the default.
-- -----------------------------------------------------------------------------
drop function if exists public.open_snap(uuid);
create or replace function public.open_snap(p_snap_id uuid, p_detect text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_now timestamptz := now();
  v_recipient public.snap_recipients%rowtype;
  v_snap public.snaps%rowtype;
  v_sender record;
  v_detect text := case when p_detect in ('ios', 'android', 'none') then p_detect end;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_recipient from public.snap_recipients r where r.snap_id = p_snap_id and r.recipient_id = v_me for update;
  if not found then
    raise exception 'This Snap isn''t available' using errcode = 'no_data_found';
  end if;
  select * into v_snap from public.snaps s where s.id = p_snap_id;
  if v_snap.expires_at <= v_now then
    raise exception 'This Snap expired' using errcode = 'no_data_found';
  end if;
  if public.is_blocked_either_way(v_snap.sender_id)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'snaps' and o.name = v_snap.media_path) then
    raise exception 'This Snap isn''t available' using errcode = 'no_data_found';
  end if;
  if v_recipient.opened_at is null then
    update public.snap_recipients set opened_at = v_now where snap_id = p_snap_id and recipient_id = v_me;
    -- Marked opened; the blurred preview stays (migration 32); the view goes on the activity with what this device can detect.
    update public.messages set snap = snap || jsonb_build_object('opened_at', v_now) where id = v_recipient.message_id;
    perform public.snap_log(v_recipient.message_id, jsonb_strip_nulls(jsonb_build_object('type', 'opened', 'at', v_now, 'detect', v_detect)));
    v_recipient.opened_at := v_now;
  elsif v_recipient.closed_at is not null or v_recipient.opened_at <= v_now - interval '2 minutes' then
    raise exception 'You already opened this Snap' using errcode = 'no_data_found';
  end if;
  select p.id, p.full_name, p.avatar_url into v_sender from public.profiles p where p.id = v_snap.sender_id;
  return jsonb_build_object(
    'id', v_snap.id,
    'path', v_snap.media_path,
    'kind', v_snap.kind,
    'mime', v_snap.mime,
    'width', v_snap.width,
    'height', v_snap.height,
    'duration', v_snap.duration,
    'sent_at', v_snap.created_at,
    'opened_at', v_recipient.opened_at,
    'view_until', v_recipient.opened_at + interval '2 minutes',
    'conversation_id', v_recipient.conversation_id,
    'message_id', v_recipient.message_id,
    'sender', jsonb_build_object('id', v_sender.id, 'full_name', v_sender.full_name, 'avatar_url', v_sender.avatar_url)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Delivered: the recipient's app received the message. Once per Snap; anyone else, or a Snap that is over, does nothing.
-- -----------------------------------------------------------------------------
create or replace function public.snap_delivered(p_snap_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_message uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select r.message_id into v_message from public.snap_recipients r where r.snap_id = p_snap_id and r.recipient_id = v_me;
  if v_message is null then
    return;
  end if;
  if exists (
    select 1 from public.messages m, jsonb_array_elements(coalesce(m.snap -> 'activity', '[]'::jsonb)) e
    where m.id = v_message and e ->> 'type' = 'delivered'
  ) then
    return;
  end if;
  perform public.snap_log(v_message, jsonb_build_object('type', 'delivered', 'at', now()));
end;
$$;

-- -----------------------------------------------------------------------------
-- A screenshot or a screen recording, as the viewer's device saw it: only its recipient can say so, only within five
-- minutes of opening (the two-minute view and a little after, for a report that arrives as the viewer closes), and the
-- sender is told at once.
-- -----------------------------------------------------------------------------
create or replace function public.report_snap_capture(p_snap_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_message public.messages;
  v_opened timestamptz;
  v_name text;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_kind is null or p_kind not in ('screenshot', 'recording') then
    raise exception 'A capture is a screenshot or a recording' using errcode = 'invalid_parameter_value';
  end if;
  v_message := public.snap_message_for(p_snap_id, v_me);
  if v_message.id is null or v_message.sender_id = v_me then
    raise exception 'This Snap isn''t available' using errcode = 'no_data_found';
  end if;
  v_opened := nullif(v_message.snap ->> 'opened_at', '')::timestamptz;
  if v_opened is null or v_opened < now() - interval '5 minutes' then
    raise exception 'This Snap isn''t open' using errcode = 'no_data_found';
  end if;
  perform public.snap_log(v_message.id, jsonb_build_object('type', p_kind, 'at', now()));
  select full_name into v_name from public.profiles where id = v_me;
  perform public.notify(
    v_message.sender_id, v_me, 'snap_activity', coalesce(v_name, 'Someone'),
    case p_kind when 'screenshot' then 'Took a screenshot of your Snap' else 'Recorded your Snap' end,
    '/messages/' || v_message.conversation_id,
    jsonb_build_object('conversation_id', v_message.conversation_id, 'message_id', v_message.id, 'snap_id', p_snap_id, 'kind', p_kind),
    'snap_activity:' || p_snap_id || ':' || p_kind
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Taking a Snap back: its sender, while the Snap is still there. The file is deleted at once (through the Storage API
-- with pg_net, as close_snap() does), its rows go, and every chat it went to shows "Snap deleted" (the trigger below,
-- told why).
-- -----------------------------------------------------------------------------
create or replace function public.delete_snap(p_snap_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_snap public.snaps%rowtype;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_snap from public.snaps s where s.id = p_snap_id and s.sender_id = v_me for update;
  if not found then
    raise exception 'This Snap isn''t yours, or it is already over' using errcode = 'no_data_found';
  end if;
  perform set_config('campconnect.snap_gone', 'deleted', true);
  perform public.snap_delete_file(v_snap.media_path);
  delete from public.snaps where id = p_snap_id;
end;
$$;

-- A recipient row going: told why by whoever deletes (delete_snap(): deleted; purge_snaps(): expired, or done when
-- everyone opened it), else deleted (the sender's account went). Nothing is logged for a Snap that is simply done.
create or replace function public.snap_recipient_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := coalesce(nullif(current_setting('campconnect.snap_gone', true), ''), 'deleted');
begin
  if v_reason = 'done' then
    return old;
  end if;
  if old.opened_at is null then
    update public.messages set snap = (snap - 'preview') || jsonb_build_object('gone', true) where id = old.message_id and snap is not null;
  end if;
  if v_reason = 'deleted' or old.opened_at is null then
    perform public.snap_log(old.message_id, jsonb_build_object('type', v_reason, 'at', now()));
  end if;
  return old;
end;
$$;

-- purge_snaps(), as migration 28 had it, now saying why each Snap goes: expired ones first, then the ones everyone
-- opened (done: nothing to tell).
create or replace function public.purge_snaps(p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_over integer := 0;
  v_done integer := 0;
  v_unused integer := 0;
  v_cleared integer := 0;
  v_asked integer := 0;
  v_url text;
  v_key text;
  v_path text;
begin
  -- One run at a time.
  if not pg_try_advisory_xact_lock(hashtext('public.purge_snaps')) then
    return 'already running';
  end if;

  -- 1a. Snaps that expired (nobody opened them in time): their rows go now, told so; their files are queued.
  perform set_config('campconnect.snap_gone', 'expired', true);
  with over as (
    delete from public.snaps s
    where s.expires_at <= p_now
    returning s.media_path
  ), queued as (
    insert into public.snap_purges (path, queued_at)
    select media_path, p_now from over
    on conflict (path) do nothing
    returning 1
  )
  select count(*) into v_over from over;

  -- 1b. Snaps that are done: opened by everyone they went to more than 10 minutes ago (a view lasts two), or with nobody
  --     left to open them. Their rows go quietly; their files are queued.
  perform set_config('campconnect.snap_gone', 'done', true);
  with over as (
    delete from public.snaps s
    where not exists (
      select 1 from public.snap_recipients r
      where r.snap_id = s.id and (r.opened_at is null or r.opened_at > p_now - interval '10 minutes')
    )
    returning s.media_path
  ), queued as (
    insert into public.snap_purges (path, queued_at)
    select media_path, p_now from over
    on conflict (path) do nothing
    returning 1
  )
  select count(*) into v_done from over;
  perform set_config('campconnect.snap_gone', '', true);
  v_over := v_over + v_done;

  -- 2. Files no Snap uses, an hour after they were uploaded: taken and never sent, or their sender's account is gone.
  insert into public.snap_purges (path, queued_at)
  select o.name, p_now
  from storage.objects o
  where o.bucket_id = 'snaps'
    and o.created_at <= p_now - interval '1 hour'
    and not exists (select 1 from public.snaps s where s.media_path = o.name)
  on conflict (path) do nothing;
  get diagnostics v_unused = row_count;

  -- 3. Checked off: files Storage no longer has (and any a Snap still uses).
  delete from public.snap_purges q
  where not exists (select 1 from storage.objects o where o.bucket_id = 'snaps' and o.name = q.path)
     or exists (select 1 from public.snaps s where s.media_path = q.path);
  get diagnostics v_cleared = row_count;

  -- 4. Ask Storage to delete the rest: new ones now, the others again after 30 minutes, 200 a run. Without pg_net or the
  --    Vault secrets the files wait (and stay out of reach: no policy lets anyone read them).
  if to_regnamespace('net') is not null and to_regclass('vault.decrypted_secrets') is not null then
    select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'snaps_project_url';
    select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'snaps_service_key';
  end if;
  if v_url is null or v_key is null then
    return format('%s snaps over, %s unused files, %s files gone; Storage cleanup is not set up (pg_net and the Vault secrets)', v_over, v_unused, v_cleared);
  end if;
  for v_path in
    select q.path from public.snap_purges q
    where q.last_attempt_at is null or q.last_attempt_at <= p_now - interval '30 minutes'
    order by q.queued_at, q.path
    limit 200
  loop
    -- A legacy service_role key is a JWT and goes in both headers; a new sb_secret_ key only as the apikey.
    perform net.http_delete(
      url := rtrim(v_url, '/') || '/storage/v1/object/snaps/' || v_path,
      headers := case
        when v_key like 'sb\_%' then jsonb_build_object('apikey', v_key)
        else jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key)
      end
    );
    update public.snap_purges set attempts = attempts + 1, last_attempt_at = p_now where path = v_path;
    v_asked := v_asked + 1;
  end loop;
  return format('%s snaps over, %s unused files, %s files gone, %s deletions asked for', v_over, v_unused, v_cleared, v_asked);
end;
$$;

-- The sender's notification when their Snap is captured.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'listing_saved', 'nearby_listing', 'system', 'like', 'comment', 'follow', 'snap', 'snap_activity'));

revoke all on function public.snap_log(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.snap_message_for(uuid, uuid) from public, anon, authenticated;
revoke all on function public.open_snap(uuid, text) from public, anon;
grant execute on function public.open_snap(uuid, text) to authenticated;
revoke all on function public.snap_delivered(uuid) from public, anon;
grant execute on function public.snap_delivered(uuid) to authenticated;
revoke all on function public.report_snap_capture(uuid, text) from public, anon;
grant execute on function public.report_snap_capture(uuid, text) to authenticated;
revoke all on function public.delete_snap(uuid) from public, anon;
grant execute on function public.delete_snap(uuid) to authenticated;
revoke all on function public.snap_recipient_gone() from public, anon, authenticated;
revoke all on function public.purge_snaps(timestamptz) from public, anon, authenticated;

-- PostgREST learns the new function signatures at once (Supabase listens on this channel).
notify pgrst, 'reload schema';

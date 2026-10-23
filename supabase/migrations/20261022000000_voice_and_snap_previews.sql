-- =============================================================================
-- Migration 29: voice messages, and Snaps that show as a blurred picture until opened. Safe to re-run.
--   * Voice messages are chat attachments of a new kind, "audio" (AAC in an .m4a, MP4 audio or MP3), in the same private
--     message-media bucket with the same rules: only the chat's members upload and read them. Inbox rows and
--     notifications read "Sent a voice message" (attachmentPreview() in packages/shared says the same).
--   * A Snap message can carry its picture's shape (width, height) and a tiny blurred JPEG, `preview` (a data URL of at
--     most 8000 characters, checked by send_snap()), so the chat shows it at its own size, blurred, until it is
--     opened. Opening it (open_snap()) and its going unopened (expired, or its sender's account deleted) take the
--     preview off the message at once: from then on the chat has nothing of it but "Opened" or "Expired".
--   * send_snap() takes the preview as an eighth, optional argument; older apps keep calling it with seven.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Voice messages
-- -----------------------------------------------------------------------------
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct t order by t)
  from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg']) as t
)
where id = 'message-media';

create or replace function public.check_message_attachments()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_item jsonb;
  v_prefix text;
  v_path text;
  v_rest text;
  v_size numeric;
  v_key text;
  v_type text;
  v_extra jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if tg_op = 'UPDATE' and new.attachments is not distinct from old.attachments then
    return new;
  end if;
  if new.attachments is null then
    new.attachments := '[]'::jsonb;
  end if;
  if jsonb_typeof(new.attachments) <> 'array' then
    raise exception 'Invalid attachments: expected a list' using errcode = 'check_violation', constraint = 'messages_attachments_check';
  end if;
  if jsonb_array_length(new.attachments) = 0 then
    return new;
  end if;
  if jsonb_array_length(new.attachments) > 10 then
    raise exception 'Invalid attachments: at most 10 per message' using errcode = 'check_violation', constraint = 'messages_attachments_check';
  end if;
  if new.sender_id is null then
    raise exception 'Invalid attachments: a message with files needs a sender' using errcode = 'check_violation', constraint = 'messages_attachments_check';
  end if;

  v_prefix := new.conversation_id::text || '/' || new.sender_id::text || '/';
  for v_item in select value from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Invalid attachment: expected an object' using errcode = 'check_violation', constraint = 'messages_attachments_check';
    end if;
    if jsonb_typeof(v_item -> 'kind') is distinct from 'string' or v_item ->> 'kind' not in ('image', 'video', 'file', 'audio') then
      raise exception 'Invalid attachment: kind must be image, video, audio or file' using errcode = 'check_violation', constraint = 'messages_attachments_check';
    end if;
    v_path := case when jsonb_typeof(v_item -> 'path') = 'string' then v_item ->> 'path' end;
    v_rest := case when left(v_path, length(v_prefix)) = v_prefix then substr(v_path, length(v_prefix) + 1) end;
    if v_rest is null or v_rest in ('', '.', '..') or position('/' in v_rest) > 0 or char_length(v_path) > 1024 then
      raise exception 'Invalid attachment: the file must be in your own folder of this chat' using errcode = 'check_violation', constraint = 'messages_attachments_check';
    end if;
    if jsonb_typeof(v_item -> 'name') is distinct from 'string' or char_length(v_item ->> 'name') not between 1 and 255 then
      raise exception 'Invalid attachment: the name must be 1 to 255 characters' using errcode = 'check_violation', constraint = 'messages_attachments_check';
    end if;
    if jsonb_typeof(v_item -> 'size') is distinct from 'number' then
      raise exception 'Invalid attachment: the size must be a number of bytes' using errcode = 'check_violation', constraint = 'messages_attachments_check';
    end if;
    v_size := (v_item ->> 'size')::numeric;
    if v_size <> trunc(v_size) or v_size < 1 or v_size > 52428800 then
      raise exception 'Invalid attachment: files are 1 byte to 50 MB' using errcode = 'check_violation', constraint = 'messages_attachments_check';
    end if;
    if jsonb_typeof(v_item -> 'mime') is distinct from 'string' or btrim(v_item ->> 'mime') = '' or char_length(v_item ->> 'mime') > 255 then
      raise exception 'Invalid attachment: the file type is missing' using errcode = 'check_violation', constraint = 'messages_attachments_check';
    end if;
    v_extra := '{}'::jsonb;
    foreach v_key in array array['width', 'height', 'duration'] loop
      v_type := jsonb_typeof(v_item -> v_key);
      if v_type = 'number' then
        if (v_item ->> v_key)::numeric < 0 then
          raise exception 'Invalid attachment: % cannot be negative', v_key using errcode = 'check_violation', constraint = 'messages_attachments_check';
        end if;
        v_extra := v_extra || jsonb_build_object(v_key, v_item -> v_key);
      elsif v_type is not null and v_type <> 'null' then
        raise exception 'Invalid attachment: % must be a number', v_key using errcode = 'check_violation', constraint = 'messages_attachments_check';
      end if;
    end loop;
    v_out := v_out || jsonb_build_array(
      jsonb_build_object('kind', v_item ->> 'kind', 'path', v_path, 'name', v_item ->> 'name', 'size', v_item -> 'size', 'mime', v_item ->> 'mime') || v_extra
    );
  end loop;
  new.attachments := v_out;
  return new;
end;
$$;

-- "Sent a voice message" for voice alone; a mix of kinds stays "Sent N attachments". Replaces migration 20's.
create or replace function public.message_attachments_preview(p_attachments jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when x.n = 0 then null
    when x.images = x.n then case when x.n = 1 then 'Sent a photo' else 'Sent ' || x.n || ' photos' end
    when x.videos = x.n then case when x.n = 1 then 'Sent a video' else 'Sent ' || x.n || ' videos' end
    when x.audios = x.n then case when x.n = 1 then 'Sent a voice message' else 'Sent ' || x.n || ' voice messages' end
    when x.images = 0 and x.videos = 0 and x.audios = 0 then case when x.n = 1 then 'Sent a file' else 'Sent ' || x.n || ' files' end
    else 'Sent ' || x.n || ' attachments'
  end
  from (
    select count(*) as n,
           count(*) filter (where e.item ->> 'kind' = 'image') as images,
           count(*) filter (where e.item ->> 'kind' = 'video') as videos,
           count(*) filter (where e.item ->> 'kind' = 'audio') as audios
    from jsonb_array_elements(case when jsonb_typeof(p_attachments) = 'array' then p_attachments else '[]'::jsonb end) as e(item)
  ) x;
$$;

-- -----------------------------------------------------------------------------
-- Snaps with a blurred preview
-- -----------------------------------------------------------------------------
-- Seven arguments before, eight now (the last optional): the old one goes so a call with seven is not ambiguous.
drop function if exists public.send_snap(text, text, text, integer, integer, numeric, uuid[]);
create or replace function public.send_snap(
  p_path text,
  p_kind text,
  p_mime text,
  p_width integer,
  p_height integer,
  p_duration numeric,
  p_recipient_ids uuid[],
  p_preview text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_ext text;
  v_people uuid[];
  v_person uuid;
  v_snap uuid;
  v_expires timestamptz := now() + interval '31 days';
  v_snap_json jsonb;
  v_chat uuid;
  v_message uuid;
  v_sent jsonb := '[]'::jsonb;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  v_ext := case p_mime when 'image/jpeg' then 'jpg' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' end;
  if p_kind is null or p_kind not in ('image', 'video') or v_ext is null or (p_kind = 'image') <> (v_ext = 'jpg') then
    raise exception 'A Snap is a JPEG photo or an MP4 or QuickTime video' using errcode = 'invalid_parameter_value';
  end if;
  if not public.snap_path_ok(p_path, v_me) or right(p_path, length(v_ext) + 1) <> '.' || v_ext then
    raise exception 'That is not a Snap file of yours' using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'video' and (p_duration is null or p_duration <= 0 or p_duration > 31) then
    raise exception 'Snap videos are up to 30 seconds long' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_width, 1) <= 0 or coalesce(p_height, 1) <= 0 then
    raise exception 'Invalid Snap size' using errcode = 'invalid_parameter_value';
  end if;
  -- The blurred preview the chats show until it is opened: a tiny JPEG as a data URL, nothing bigger.
  if p_preview is not null and (char_length(p_preview) > 8000 or p_preview !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$') then
    raise exception 'Invalid Snap preview' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'snaps' and o.name = p_path) then
    raise exception 'Upload the Snap before sending it' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.snaps s where s.media_path = p_path) then
    raise exception 'This Snap was already sent' using errcode = 'unique_violation';
  end if;
  -- Uploaded so long ago that purge_snaps() is deleting it as never sent.
  if exists (select 1 from public.snap_purges q where q.path = p_path) then
    raise exception 'This Snap took too long to send. Take it again.' using errcode = 'no_data_found';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_people
  from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as x
  where x is not null and x <> v_me;
  if cardinality(v_people) = 0 then
    raise exception 'Choose who to send it to' using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(v_people) > 50 then
    raise exception 'A Snap can go to at most 50 people at a time' using errcode = 'invalid_parameter_value';
  end if;
  foreach v_person in array v_people loop
    if not public.can_snap(v_person) then
      raise exception 'You can send Snaps only to friends and people you chat with' using errcode = 'insufficient_privilege';
    end if;
  end loop;

  insert into public.snaps (sender_id, media_path, kind, mime, width, height, duration, expires_at)
  values (v_me, p_path, p_kind, p_mime, p_width, p_height, case when p_kind = 'video' then round(p_duration, 1) end, v_expires)
  returning id into v_snap;
  v_snap_json := jsonb_strip_nulls(jsonb_build_object('id', v_snap, 'kind', p_kind, 'expires_at', v_expires, 'width', p_width, 'height', p_height, 'preview', p_preview))
    || jsonb_build_object('opened_at', null);

  foreach v_person in array v_people loop
    v_chat := public.get_or_create_direct_conversation(v_person);
    -- A direct chat someone left still exists: a Snap there would never reach them.
    if not exists (select 1 from public.conversation_members m where m.conversation_id = v_chat and m.user_id = v_me)
       or not exists (select 1 from public.conversation_members m where m.conversation_id = v_chat and m.user_id = v_person) then
      raise exception 'You can''t send Snaps to % right now', coalesce((select p.full_name from public.profiles p where p.id = v_person), 'this person')
        using errcode = 'insufficient_privilege';
    end if;
    insert into public.messages (conversation_id, sender_id, content, snap)
    values (v_chat, v_me, '', v_snap_json)
    returning id into v_message;
    insert into public.snap_recipients (snap_id, recipient_id, conversation_id, message_id)
    values (v_snap, v_person, v_chat, v_message);
    v_sent := v_sent || jsonb_build_array(jsonb_build_object('recipient_id', v_person, 'conversation_id', v_chat, 'message_id', v_message));
  end loop;

  return jsonb_build_object('snap_id', v_snap, 'expires_at', v_expires, 'sent', v_sent);
end;
$$;

create or replace function public.open_snap(p_snap_id uuid)
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
    update public.messages set snap = (snap - 'preview') || jsonb_build_object('opened_at', v_now) where id = v_recipient.message_id;
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

create or replace function public.snap_recipient_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.opened_at is null then
    update public.messages set snap = (snap - 'preview') || jsonb_build_object('gone', true) where id = old.message_id and snap is not null;
  end if;
  return old;
end;
$$;

revoke all on function public.send_snap(text, text, text, integer, integer, numeric, uuid[], text) from public, anon;
grant execute on function public.send_snap(text, text, text, integer, integer, numeric, uuid[], text) to authenticated;
revoke all on function public.open_snap(uuid) from public, anon;
grant execute on function public.open_snap(uuid) to authenticated;
revoke all on function public.snap_recipient_gone() from public, anon, authenticated;
revoke all on function public.check_message_attachments() from public, anon, authenticated;

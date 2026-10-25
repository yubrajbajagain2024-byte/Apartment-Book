-- =============================================================================
-- Migration 32: a Snap keeps its blurred preview after it is opened. Safe to re-run.
--   Until now open_snap() took the preview (the tiny JPEG made on the phone, shown heavily blurred) off the message the
--   moment its recipient opened it, so the chat showed only a plain "Opened" card. The chats now show the same blurred
--   preview before and after the one view, at its own shape and colours: open_snap() leaves it on the message and only
--   marks it opened. The Snap itself still opens once, for two minutes at most, and its file is still deleted as soon as
--   everyone it went to is done with it (migration 30); the preview never was the Snap (32 pixels on its long side).
--   A Snap that goes unopened (it expired, or its sender's account was deleted) still loses its preview at once
--   (snap_recipient_gone(), migration 29, unchanged). Previews taken off by earlier opens stay gone.
-- =============================================================================

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
    -- Marked opened; the blurred preview stays, so the chat keeps showing it (migration 32).
    update public.messages set snap = snap || jsonb_build_object('opened_at', v_now) where id = v_recipient.message_id;
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

revoke all on function public.open_snap(uuid) from public, anon;
grant execute on function public.open_snap(uuid) to authenticated;

-- PostgREST learns the new function signatures at once (Supabase listens on this channel).
notify pgrst, 'reload schema';

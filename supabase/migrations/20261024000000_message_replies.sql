-- =============================================================================
-- Migration 31: replies in chats. Safe to re-run.
--   A message can answer another message of the same chat (a swipe on it in the app). messages.reply_to then holds a
--   snapshot of the original, {id, sender_id, kind, text}, built here the moment the reply is inserted: the app sends
--   only {"id": "<the original's id>"} and the database writes the rest from the original row, so nobody can quote
--   words that were never said. `kind` says what the original was when it had no words ("snap", "post", "reel",
--   "listing", "voice", "video", "photo", "file", else "text"), in the same order replyKindOf() follows in
--   packages/shared/src/message-replies.ts; `text` is its first 140 characters, or null. The original must be in the
--   chat the reply goes to; a reply never changes what it answers; the snapshot stays if the original is deleted.
--   The inbox line, the notification and search are untouched: they read the reply's own words.
-- =============================================================================

alter table public.messages add column if not exists reply_to jsonb;

-- The snapshot of one message of a chat, or an error when it is not there (or is in another chat).
create or replace function public.message_reply_snapshot(p_conversation_id uuid, p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_m public.messages%rowtype;
  v_kind text;
  v_files jsonb;
  v_n int;
begin
  select * into v_m from public.messages m where m.id = p_message_id and m.conversation_id = p_conversation_id;
  if not found then
    raise exception 'You can only reply to a message in this chat' using errcode = 'foreign_key_violation', constraint = 'messages_reply_to_check';
  end if;
  v_files := case when jsonb_typeof(v_m.attachments) = 'array' then v_m.attachments else '[]'::jsonb end;
  v_n := jsonb_array_length(v_files);
  if jsonb_typeof(v_m.snap) = 'object' then
    v_kind := 'snap';
  elsif jsonb_typeof(v_m.shared_post) = 'object' then
    v_kind := case
      when coalesce(v_m.shared_post ->> 'target_type', '') not in ('', 'post') then 'listing'
      when v_m.shared_post ->> 'kind' = 'reel' then 'reel'
      else 'post'
    end;
  elsif v_n > 0 then
    v_kind := case
      when (select count(*) from jsonb_array_elements(v_files) e where e.value ->> 'kind' = 'audio') = v_n then 'voice'
      when exists (select 1 from jsonb_array_elements(v_files) e where e.value ->> 'kind' = 'video') then 'video'
      when exists (select 1 from jsonb_array_elements(v_files) e where e.value ->> 'kind' = 'image') then 'photo'
      when (select count(*) from jsonb_array_elements(v_files) e where e.value ->> 'kind' = 'file') = v_n then 'file'
      else 'photo'
    end;
  elsif v_m.image_url ~* '^https://' then
    v_kind := 'photo';
  else
    v_kind := 'text';
  end if;
  return jsonb_build_object(
    'id', v_m.id,
    'sender_id', v_m.sender_id,
    'kind', v_kind,
    'text', nullif(left(coalesce(v_m.content, ''), 140), '')
  );
end;
$$;

-- On insert the app's {id} becomes the snapshot (anything else in it is dropped); on update the reply keeps what it had.
-- Definer rights, so the snapshot function can stay closed to the API (only this trigger may read another message's words
-- for a reply, and only one of the chat the reply goes to).
create or replace function public.check_message_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_op = 'UPDATE' then
    new.reply_to := old.reply_to;
    return new;
  end if;
  if new.reply_to is null then
    return new;
  end if;
  if jsonb_typeof(new.reply_to) <> 'object' or jsonb_typeof(new.reply_to -> 'id') is distinct from 'string' then
    raise exception 'Invalid reply: expected the id of the message it answers' using errcode = 'check_violation', constraint = 'messages_reply_to_check';
  end if;
  begin
    v_id := (new.reply_to ->> 'id')::uuid;
  exception when others then
    raise exception 'Invalid reply: expected the id of the message it answers' using errcode = 'check_violation', constraint = 'messages_reply_to_check';
  end;
  if v_id = new.id then
    raise exception 'A message cannot reply to itself' using errcode = 'check_violation', constraint = 'messages_reply_to_check';
  end if;
  new.reply_to := public.message_reply_snapshot(new.conversation_id, v_id);
  return new;
end;
$$;

drop trigger if exists messages_check_reply on public.messages;
create trigger messages_check_reply
  before insert or update of reply_to on public.messages
  for each row execute function public.check_message_reply();

revoke all on function public.message_reply_snapshot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.check_message_reply() from public, anon, authenticated;

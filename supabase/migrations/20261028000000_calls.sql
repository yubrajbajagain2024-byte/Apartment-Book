-- =============================================================================
-- Migration 35: audio and video calls in chats, direct and group. Safe to re-run.
--   The media travels over LiveKit (the apps join a room named after the call, with a token the livekit-token
--   function mints after checking here that they are in the call). The database keeps the call itself:
--     * calls: one per call, in a chat; ringing until someone answers, active while anyone is in it, then ended, with
--       why (completed, missed: nobody answered before the caller gave up or the ring ran out, declined: everyone it
--       rang declined, expired: left hanging and closed by the database);
--     * call_participants: everyone the call rang (every other member of the chat when it started) and where each of
--       them stands (ringing, joined, left, declined, missed); the caller is joined from the start. Anyone in the chat
--       can join a call that is not over, late or after declining, as in group calls elsewhere.
--     * messages.call: the call's row in the chat, inserted when the call starts and kept up to date as it goes on, so
--       both chats (and the inbox line: "Audio call", "Missed video call", "Video call declined") follow it live.
--       Written only by the functions below (the API is refused, as for Snaps).
--   The apps listen to their own call_participants rows (realtime) to ring, and to a chat's calls row for its banner.
--   A missed call notifies whoever missed it ("Missed audio call", type "call"); nothing else about a call notifies:
--   the ring itself is live. Every change goes through start_call(), answer_call(), decline_call() and leave_call();
--   expire_stale_calls() closes what was left hanging (a ring over 60 seconds old, a call over six hours old).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  started_by uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended')),
  ended_reason text check (ended_reason in ('completed', 'missed', 'declined', 'expired')),
  message_id uuid references public.messages (id) on delete set null,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index if not exists calls_conversation_idx on public.calls (conversation_id, started_at desc);
create index if not exists calls_open_idx on public.calls (status) where status <> 'ended';

create table if not exists public.call_participants (
  call_id uuid not null references public.calls (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'ringing' check (state in ('ringing', 'joined', 'left', 'declined', 'missed')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, user_id)
);
create index if not exists call_participants_user_idx on public.call_participants (user_id, state);

alter table public.calls enable row level security;
alter table public.call_participants enable row level security;
-- Everyone in the chat can read a call and who it rang; nobody writes them from the API.
drop policy if exists calls_select_member on public.calls;
create policy calls_select_member on public.calls
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists call_participants_select_member on public.call_participants;
create policy call_participants_select_member on public.call_participants
  for select to authenticated using (exists (select 1 from public.calls c where c.id = call_id and public.is_conversation_member(c.conversation_id, auth.uid())));
revoke all on public.calls, public.call_participants from public, anon, authenticated;
grant select on public.calls, public.call_participants to authenticated;
-- Realtime carries whole rows on every change (the apps filter by user_id and conversation_id).
alter table public.calls replica identity full;
alter table public.call_participants replica identity full;
do $$
declare
  t text;
begin
  foreach t in array array['calls', 'call_participants'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when others then
  raise notice 'calls not added to supabase_realtime (%).', sqlerrm;
end
$$;

-- -----------------------------------------------------------------------------
-- messages.call: the call's row in the chat
-- -----------------------------------------------------------------------------
alter table public.messages add column if not exists call jsonb;
alter table public.messages drop constraint if exists messages_call_check;
alter table public.messages add constraint messages_call_check check (
  call is null or (jsonb_typeof(call) = 'object' and jsonb_typeof(call -> 'id') = 'string' and coalesce(call ->> 'kind', '') in ('audio', 'video'))
);

create or replace function public.guard_message_call()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.call is not null then
      raise exception 'Calls are started with start_call()' using errcode = 'insufficient_privilege';
    end if;
  elsif new.call is distinct from old.call then
    raise exception 'Calls are started with start_call()' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_guard_call on public.messages;
create trigger messages_guard_call
  before insert or update of call on public.messages
  for each row execute function public.guard_message_call();

-- A message may carry only a call's row: no text. Every check on the text is dropped first, as migrations 17, 20 and 28 did.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(content)%'
  loop
    execute format('alter table public.messages drop constraint %I', r.conname);
  end loop;
end
$$;
alter table public.messages add constraint messages_content_check check (
  char_length(content) <= 4000 and (char_length(content) >= 1 or shared_post is not null or attachments <> '[]'::jsonb or snap is not null or call is not null)
);

-- The inbox line for a call's row: "Audio call" / "Video call" while it goes on and once it was answered, "Missed audio
-- call" when nobody answered, "Video call declined" when everyone it rang declined. The same wording as callPreview()
-- in packages/shared/src/calls.ts. Null for a message that is not a call.
create or replace function public.call_preview(p_call jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_call is null then null
    when p_call ->> 'status' = 'ended' and coalesce(p_call ->> 'ended_reason', 'missed') in ('missed', 'expired')
      then 'Missed ' || case p_call ->> 'kind' when 'video' then 'video call' else 'audio call' end
    when p_call ->> 'status' = 'ended' and p_call ->> 'ended_reason' = 'declined'
      then (case p_call ->> 'kind' when 'video' then 'Video call' else 'Audio call' end) || ' declined'
    else case p_call ->> 'kind' when 'video' then 'Video call' else 'Audio call' end
  end;
$$;

create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      last_message_preview = coalesce(nullif(left(new.content, 120), ''), public.call_preview(new.call), public.message_preview(new.content, new.shared_post, new.attachments, new.snap))
  where id = new.conversation_id;

  -- The sender has obviously read (and received) their own message.
  update public.conversation_members
  set last_read_at = new.created_at, last_delivered_at = new.created_at
  where conversation_id = new.conversation_id
    and user_id = new.sender_id;

  return new;
end;
$$;

-- New message -> every other member of the conversation, except those it is muted for. A Snap is its own kind of
-- notification; a call's row notifies nobody (the ring is live, and a missed call has its own notification).
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender text;
  v_conversation record;
  v_member uuid;
  v_title text;
begin
  if new.call is not null then
    return new;
  end if;
  select full_name into v_sender from public.profiles where id = new.sender_id;
  select type, name into v_conversation from public.conversations where id = new.conversation_id;
  v_title := case
    when v_conversation.type = 'group' then coalesce(v_sender, 'Someone') || ' in ' || coalesce(v_conversation.name, 'group chat')
    else coalesce(v_sender, 'New message')
  end;
  for v_member in
    select user_id from public.conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    if public.message_muted(v_member, new.sender_id, new.conversation_id) then
      continue;
    end if;
    if new.snap is not null then
      perform public.notify(
        v_member, new.sender_id, 'snap', v_title, 'Sent you a Snap',
        '/messages/' || new.conversation_id,
        jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'snap_id', new.snap ->> 'id'),
        'snap:' || new.conversation_id
      );
    else
      perform public.notify(
        v_member, new.sender_id, 'message', v_title, public.message_preview(new.content, new.shared_post, new.attachments, new.snap, 140),
        '/messages/' || new.conversation_id,
        jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id),
        'message:' || new.conversation_id
      );
    end if;
  end loop;
  return new;
end;
$$;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'listing_saved', 'nearby_listing', 'system', 'like', 'comment', 'follow', 'snap', 'snap_activity', 'call'));

-- -----------------------------------------------------------------------------
-- Internal helpers (closed to the API)
-- -----------------------------------------------------------------------------
-- A call as its message carries it.
create or replace function public.call_json(c public.calls)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'status', c.status,
    'ended_reason', c.ended_reason,
    'duration', case when c.ended_reason = 'completed' and c.answered_at is not null and c.ended_at is not null then round(extract(epoch from c.ended_at - c.answered_at)) end,
    'started_by', c.started_by
  );
$$;

-- The call's row in the chat follows the call, and so does the inbox line when that row is the chat's newest.
create or replace function public.sync_call_message(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call public.calls%rowtype;
  v_message public.messages%rowtype;
begin
  select * into v_call from public.calls where id = p_call_id;
  if v_call.message_id is null then
    return;
  end if;
  update public.messages set call = public.call_json(v_call) where id = v_call.message_id returning * into v_message;
  update public.conversations
  set last_message_preview = public.call_preview(v_message.call)
  where id = v_call.conversation_id and last_message_at <= v_message.created_at;
end;
$$;

-- The call is over: everyone still ringing missed it (and is told), everyone still in it has left.
create or replace function public.end_call(p_call_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call public.calls%rowtype;
  v_now timestamptz := now();
  v_caller text;
  v_missed uuid;
begin
  select * into v_call from public.calls where id = p_call_id for update;
  if not found or v_call.status = 'ended' then
    return;
  end if;
  update public.calls set status = 'ended', ended_reason = p_reason, ended_at = v_now where id = p_call_id;
  update public.call_participants set state = 'left', left_at = coalesce(left_at, v_now) where call_id = p_call_id and state = 'joined';
  select full_name into v_caller from public.profiles where id = v_call.started_by;
  for v_missed in select user_id from public.call_participants where call_id = p_call_id and state = 'ringing' loop
    update public.call_participants set state = 'missed' where call_id = p_call_id and user_id = v_missed;
    perform public.notify(
      v_missed, v_call.started_by, 'call', coalesce(v_caller, 'Someone'),
      'Missed ' || case v_call.kind when 'video' then 'video call' else 'audio call' end,
      '/messages/' || v_call.conversation_id,
      jsonb_build_object('conversation_id', v_call.conversation_id, 'call_id', v_call.id, 'kind', v_call.kind),
      'call:' || v_call.id
    );
  end loop;
  perform public.sync_call_message(p_call_id);
end;
$$;

-- Calls left hanging: a ring nobody answered within 60 seconds is missed; a call over six hours old is closed.
create or replace function public.expire_stale_calls()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  for v_id in select id from public.calls where status = 'ringing' and started_at < now() - interval '60 seconds' loop
    perform public.end_call(v_id, 'missed');
  end loop;
  for v_id in select id from public.calls where status = 'active' and started_at < now() - interval '6 hours' loop
    perform public.end_call(v_id, 'expired');
  end loop;
end;
$$;

-- Nobody ringing any more while nobody has answered: the call ends, declined if anyone declined, else missed.
create or replace function public.settle_call(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call public.calls%rowtype;
begin
  select * into v_call from public.calls where id = p_call_id;
  if v_call.status <> 'ringing' then
    return;
  end if;
  if not exists (select 1 from public.call_participants where call_id = p_call_id and state = 'ringing') then
    perform public.end_call(p_call_id, case when exists (select 1 from public.call_participants where call_id = p_call_id and state = 'declined') then 'declined' else 'missed' end);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- What the apps call
-- -----------------------------------------------------------------------------
create or replace function public.get_call(p_call_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'conversation_id', c.conversation_id,
    'started_by', c.started_by,
    'kind', c.kind,
    'status', c.status,
    'ended_reason', c.ended_reason,
    'started_at', c.started_at,
    'answered_at', c.answered_at,
    'ended_at', c.ended_at,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'state', p.state, 'joined_at', p.joined_at, 'left_at', p.left_at,
        'profile', (select jsonb_build_object('id', pr.id, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url) from public.profiles pr where pr.id = p.user_id)
      ) order by p.invited_at, p.user_id)
      from public.call_participants p where p.call_id = c.id
    ), '[]'::jsonb)
  )
  from public.calls c
  where c.id = p_call_id and public.is_conversation_member(c.conversation_id, auth.uid());
$$;

create or replace function public.current_call(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.is_conversation_member(p_conversation_id, auth.uid()) then
    return null;
  end if;
  perform public.expire_stale_calls();
  select id into v_id from public.calls where conversation_id = p_conversation_id and status <> 'ended' order by started_at desc limit 1;
  if v_id is null then
    return null;
  end if;
  return public.get_call(v_id);
end;
$$;

create or replace function public.start_call(p_conversation_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_now timestamptz := now();
  v_existing public.calls%rowtype;
  v_call public.calls%rowtype;
  v_message uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_kind is null or p_kind not in ('audio', 'video') then
    raise exception 'A call is audio or video' using errcode = 'invalid_parameter_value';
  end if;
  if not public.is_conversation_member(p_conversation_id, v_me) then
    raise exception 'You can only call in your own chats' using errcode = 'insufficient_privilege';
  end if;
  perform public.expire_stale_calls();

  -- A call already going on here: join it (a second tap, or someone calling into a call that rang them).
  select * into v_existing from public.calls where conversation_id = p_conversation_id and status <> 'ended' order by started_at desc limit 1 for update;
  if found then
    perform public.answer_call(v_existing.id);
    return jsonb_build_object('call_id', v_existing.id, 'message_id', v_existing.message_id, 'conversation_id', p_conversation_id, 'joined', true);
  end if;

  insert into public.calls (conversation_id, started_by, kind, status, started_at)
  values (p_conversation_id, v_me, p_kind, 'ringing', v_now)
  returning * into v_call;
  insert into public.call_participants (call_id, user_id, state, invited_at, joined_at)
  values (v_call.id, v_me, 'joined', v_now, v_now);
  insert into public.call_participants (call_id, user_id, state, invited_at)
  select v_call.id, m.user_id, 'ringing', v_now
  from public.conversation_members m
  where m.conversation_id = p_conversation_id and m.user_id <> v_me;
  if not exists (select 1 from public.call_participants where call_id = v_call.id and state = 'ringing') then
    raise exception 'There is nobody to call in this chat' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.messages (conversation_id, sender_id, content, call)
  values (p_conversation_id, v_me, '', public.call_json(v_call))
  returning id into v_message;
  update public.calls set message_id = v_message where id = v_call.id;
  return jsonb_build_object('call_id', v_call.id, 'message_id', v_message, 'conversation_id', p_conversation_id, 'joined', false);
end;
$$;

create or replace function public.answer_call(p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_now timestamptz := now();
  v_call public.calls%rowtype;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  perform public.expire_stale_calls();
  select * into v_call from public.calls where id = p_call_id for update;
  if not found or not public.is_conversation_member(v_call.conversation_id, v_me) then
    raise exception 'This call isn''t available' using errcode = 'no_data_found';
  end if;
  -- Over (perhaps closed this very moment, a ring that ran out): handed back as it is, so that closing is kept, and the
  -- app reads its status. Raising here would undo the closing with the rest of this call.
  if v_call.status = 'ended' then
    return public.get_call(p_call_id);
  end if;
  insert into public.call_participants (call_id, user_id, state, invited_at, joined_at, left_at)
  values (p_call_id, v_me, 'joined', v_now, v_now, null)
  on conflict (call_id, user_id) do update set state = 'joined', joined_at = coalesce(public.call_participants.joined_at, v_now), left_at = null;
  if v_call.status = 'ringing' then
    update public.calls set status = 'active', answered_at = coalesce(answered_at, v_now) where id = p_call_id;
  end if;
  perform public.sync_call_message(p_call_id);
  return public.get_call(p_call_id);
end;
$$;

create or replace function public.decline_call(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_call public.calls%rowtype;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_call from public.calls where id = p_call_id for update;
  if not found or not public.is_conversation_member(v_call.conversation_id, v_me) then
    raise exception 'This call isn''t available' using errcode = 'no_data_found';
  end if;
  if v_call.status = 'ended' then
    return;
  end if;
  update public.call_participants set state = 'declined' where call_id = p_call_id and user_id = v_me and state = 'ringing';
  perform public.settle_call(p_call_id);
  perform public.sync_call_message(p_call_id);
end;
$$;

create or replace function public.leave_call(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_now timestamptz := now();
  v_call public.calls%rowtype;
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_call from public.calls where id = p_call_id for update;
  if not found or not public.is_conversation_member(v_call.conversation_id, v_me) then
    raise exception 'This call isn''t available' using errcode = 'no_data_found';
  end if;
  if v_call.status = 'ended' then
    return;
  end if;
  update public.call_participants set state = 'left', left_at = v_now where call_id = p_call_id and user_id = v_me and state = 'joined';
  if v_call.status = 'ringing' then
    -- The caller hung up before anyone answered: everyone it rang missed it.
    perform public.end_call(p_call_id, 'missed');
    return;
  end if;
  if not exists (select 1 from public.call_participants where call_id = p_call_id and state = 'joined') then
    perform public.end_call(p_call_id, 'completed');
    return;
  end if;
  perform public.sync_call_message(p_call_id);
end;
$$;

revoke all on function public.guard_message_call() from public, anon, authenticated;
revoke all on function public.call_json(public.calls) from public, anon, authenticated;
revoke all on function public.sync_call_message(uuid) from public, anon, authenticated;
revoke all on function public.end_call(uuid, text) from public, anon, authenticated;
revoke all on function public.expire_stale_calls() from public, anon, authenticated;
revoke all on function public.settle_call(uuid) from public, anon, authenticated;
revoke all on function public.call_preview(jsonb) from public, anon, authenticated;
revoke all on function public.get_call(uuid) from public, anon;
grant execute on function public.get_call(uuid) to authenticated;
revoke all on function public.current_call(uuid) from public, anon;
grant execute on function public.current_call(uuid) to authenticated;
revoke all on function public.start_call(uuid, text) from public, anon;
grant execute on function public.start_call(uuid, text) to authenticated;
revoke all on function public.answer_call(uuid) from public, anon;
grant execute on function public.answer_call(uuid) to authenticated;
revoke all on function public.decline_call(uuid) from public, anon;
grant execute on function public.decline_call(uuid) to authenticated;
revoke all on function public.leave_call(uuid) from public, anon;
grant execute on function public.leave_call(uuid) to authenticated;

notify pgrst, 'reload schema';

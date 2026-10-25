-- Push notifications (migration 36). Every notification the database makes with notify() now also reaches the
-- person's phones through Expo's push service (https://exp.host/--/api/v2/push/send), sent with pg_net to the Expo
-- push tokens the apps store in device_push_tokens; and a call rings the phones of everyone it is for, so a phone
-- whose app is closed rings too (the push opens the call in the app, which rings on its own while it is open; the
-- push is dropped unseen once the 45-second ring has run out). Where pg_net is not installed nothing is sent, and a
-- push that cannot be sent never fails what it rides on. With Expo's "enhanced push security" turned on for the
-- project, its access token goes along from Vault (a secret named expo_push_token).

create or replace function public.send_push(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_data jsonb,
  p_channel text default 'default',
  p_sound text default 'default',
  p_ttl integer default null,
  p_interruption text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages jsonb;
  v_headers jsonb := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json');
  v_token text;
begin
  if p_user_id is null or to_regnamespace('net') is null then
    return;
  end if;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'to', t.token,
    'title', p_title,
    'body', p_body,
    'data', coalesce(p_data, '{}'::jsonb),
    'sound', p_sound,
    'priority', 'high',
    'ttl', p_ttl,
    'channelId', case when t.platform = 'android' then p_channel end,
    'interruptionLevel', case when t.platform = 'ios' then p_interruption end
  )))
  into v_messages
  from public.device_push_tokens t
  where t.user_id = p_user_id and t.token like 'ExponentPushToken[%]';
  if v_messages is null then
    return;
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'expo_push_token';
    if coalesce(v_token, '') <> '' then
      v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_token);
    end if;
  end if;
  perform net.http_post(url := 'https://exp.host/--/api/v2/push/send', body := v_messages, headers := v_headers);
exception when others then
  raise warning 'send_push: %', sqlerrm;
end;
$$;
revoke all on function public.send_push(uuid, text, text, jsonb, text, text, integer, text) from public, anon, authenticated;

-- notify() as before (migration 9: one unread entry per dedupe key, refreshed), now pushing every time it is called.
create or replace function public.notify(
  p_user_id uuid,
  p_actor_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link text,
  p_data jsonb,
  p_dedupe text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if p_user_id is null or p_user_id = p_actor_id then
    return;
  end if;
  if p_dedupe is not null then
    v_data := v_data || jsonb_build_object('dedupe', p_dedupe);
    update public.notifications
    set title = p_title,
        body = p_body,
        actor_id = p_actor_id,
        data = v_data,
        created_at = now()
    where user_id = p_user_id
      and read_at is null
      and data ->> 'dedupe' = p_dedupe;
    if found then
      perform public.send_push(p_user_id, p_title, p_body, jsonb_build_object('type', p_type, 'link', p_link));
      return;
    end if;
  end if;
  insert into public.notifications (user_id, actor_id, type, title, body, link, data)
  values (p_user_id, p_actor_id, p_type, p_title, p_body, p_link, v_data);
  -- …and to their phones (migration 36).
  perform public.send_push(p_user_id, p_title, p_body, jsonb_build_object('type', p_type, 'link', p_link));
end;
$$;

-- start_call() as before (migration 35), now ringing the phones of everyone it rings.
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
  v_caller text;
  v_conversation record;
  v_line text;
  v_rung uuid;
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

  -- Their phones ring, app open or not: a push for the ring (migration 36), gone unseen once the ring has run out.
  select coalesce(nullif(p.full_name, ''), 'Someone') into v_caller from public.profiles p where p.id = v_me;
  select c.type, c.name into v_conversation from public.conversations c where c.id = p_conversation_id;
  v_line := v_caller || case when v_conversation.type = 'group' then ' is calling ' || coalesce(nullif(v_conversation.name, ''), 'your group') else ' is calling' end;
  for v_rung in select user_id from public.call_participants where call_id = v_call.id and state = 'ringing' loop
    perform public.send_push(
      v_rung,
      case when p_kind = 'video' then 'Incoming video call' else 'Incoming audio call' end,
      v_line,
      jsonb_build_object('type', 'call_ring', 'call_id', v_call.id, 'conversation_id', p_conversation_id, 'kind', p_kind),
      'calls', 'ring.wav', 45, 'time-sensitive'
    );
  end loop;

  insert into public.messages (conversation_id, sender_id, content, call)
  values (p_conversation_id, v_me, '', public.call_json(v_call))
  returning id into v_message;
  update public.calls set message_id = v_message where id = v_call.id;
  return jsonb_build_object('call_id', v_call.id, 'message_id', v_message, 'conversation_id', p_conversation_id, 'joined', false);
end;
$$;

notify pgrst, 'reload schema';

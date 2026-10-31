-- =============================================================================
-- Rollback of 20261114000000_story_actions.sql (what a viewer can do with a story).
-- Run as one transaction. Drops the likes and the mutes with their rows, and the story-card guard; restores migration
-- 17's card check, migration 30's message_preview(), migration 31's message_reply_snapshot() and migration 41's
-- ts_snapshot(), ts_author_of() and ts_set_content_status() (verbatim), and the report types without 'story'.
-- Refuses while a chat still holds a story card or a story report exists: those rows would break the restored checks.
-- Delete them first if the rollback must go ahead (`delete from public.messages where shared_post ->> 'target_type' =
-- 'story'`, `delete from public.reports where target_type = 'story'`).
-- =============================================================================
do $$
begin
  if exists (select 1 from public.messages where shared_post ->> 'target_type' = 'story') then
    raise exception 'Chats still hold story cards: delete those messages before rolling back.';
  end if;
  if exists (select 1 from public.reports where target_type = 'story') then
    raise exception 'Story reports exist: close and delete them before rolling back.';
  end if;
end
$$;

drop trigger if exists messages_guard_story_card on public.messages;
drop function if exists public.guard_message_story_card();

alter table public.messages drop constraint if exists messages_shared_post_check;
alter table public.messages add constraint messages_shared_post_check check (
  shared_post is null
  or coalesce(
    jsonb_typeof(shared_post) = 'object'
    and shared_post->>'target_type' in ('post', 'apartment', 'roommate', 'item')
    and shared_post->>'target_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and shared_post->>'path' = (case shared_post->>'target_type' when 'post' then '/posts/' when 'apartment' then '/apartments/' when 'roommate' then '/roommates/' else '/marketplace/' end) || (shared_post->>'target_id')
    and coalesce(shared_post->>'kind', 'post') in ('post', 'reel', 'listing'),
    false
  )
);

create or replace function public.message_preview(p_content text, p_shared jsonb, p_attachments jsonb, p_snap jsonb, p_len int default 120)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(left(p_content, p_len), ''),
    case when p_snap is not null then 'Sent a Snap' end,
    case when p_shared is not null then
      case p_shared ->> 'kind' when 'reel' then 'Sent a reel' when 'listing' then 'Sent a listing' else 'Sent a post' end
    end,
    public.message_attachments_preview(p_attachments)
  );
$$;

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

create or replace function public.ts_author_of(p_type text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_id is null then
    return null;
  end if;
  if public.ts_is_anon(p_type) then
    return public.buzz_v2_author_of(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id);
  end if;
  return public.ts_public_author_of(p_type, p_id);
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

drop function if exists public.ts_story_snapshot(uuid);

do $$
declare
  v_all text[];
begin
  select array_agg(distinct m[1] order by m[1]) into v_all
  from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
  where c.conrelid = 'public.reports'::regclass and c.conname = 'reports_target_type_check' and m[1] <> 'story';
  alter table public.reports drop constraint if exists reports_target_type_check;
  execute format('alter table public.reports add constraint reports_target_type_check check (target_type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_all) as t));
end
$$;

drop table if exists public.story_mutes;
drop table if exists public.story_likes;

notify pgrst, 'reload schema';

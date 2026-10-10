-- Migration 17: share a post, reel or listing into a chat. The share button offers your friends (people you follow who
-- follow you back) and sends each of them a message carrying a snapshot of what was shared. Safe to re-run.

alter table public.messages add column if not exists shared_post jsonb;
alter table public.messages drop constraint if exists messages_shared_post_check;
-- Anyone in a chat can write this JSON, so the link must be the shared thing's own page, rebuilt from its type and id
-- (an outside address would turn a friendly "View post" card into a phishing link). coalesce: a missing key makes the
-- expression NULL, and a CHECK lets NULL through.
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

-- A share needs no words: the text may be empty when a shared post rides along. The original check had an automatic
-- name, so every check on the text is dropped before the new one goes in.
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
  char_length(content) <= 4000 and (char_length(content) >= 1 or shared_post is not null)
);

-- What the inbox row (120 characters) and the notification (140, as before) say; a share without words names what was sent.
drop function if exists public.message_preview(text, jsonb);
create or replace function public.message_preview(p_content text, p_shared jsonb, p_len int default 120)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(left(p_content, p_len), ''),
    case p_shared->>'kind' when 'reel' then 'Sent a reel' when 'listing' then 'Sent a listing' else 'Sent a post' end
  );
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
      last_message_preview = public.message_preview(new.content, new.shared_post)
  where id = new.conversation_id;

  -- The sender has obviously read (and received) their own message.
  update public.conversation_members
  set last_read_at = new.created_at, last_delivered_at = new.created_at
  where conversation_id = new.conversation_id
    and user_id = new.sender_id;

  return new;
end;
$$;

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
  select full_name into v_sender from public.profiles where id = new.sender_id;
  select type, name into v_conversation from public.conversations where id = new.conversation_id;
  v_title := case
    when v_conversation.type = 'group' then coalesce(v_sender, 'Someone') || ' in ' || coalesce(v_conversation.name, 'group chat')
    else coalesce(v_sender, 'New message')
  end;
  for v_member in
    select user_id from public.conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.notify(
      v_member, new.sender_id, 'message', v_title, public.message_preview(new.content, new.shared_post, 140),
      '/messages/' || new.conversation_id,
      jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id),
      'message:' || new.conversation_id
    );
  end loop;
  return new;
end;
$$;

-- Friends: the people you follow who follow you back, minus anyone blocked either way. Optional name filter.
-- Security invoker, so the profiles and follows policies still apply; signed out it returns nothing.
create or replace function public.list_friends(p_q text default null)
returns setof public.profiles
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.profiles p
  join public.follows f1 on f1.follower_id = auth.uid() and f1.followee_id = p.id
  join public.follows f2 on f2.follower_id = p.id and f2.followee_id = auth.uid()
  where not public.is_blocked_either_way(p.id)
    and (coalesce(p_q, '') = '' or p.full_name ilike '%' || p_q || '%')
  order by p.full_name;
$$;
grant execute on function public.list_friends(text) to authenticated;

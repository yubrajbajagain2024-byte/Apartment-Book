-- Migration 20: photos, videos and files in chats, plus search and "shared in this chat". Safe to re-run.
--   * A private storage bucket, message-media, with one folder per chat and per sender:
--       {conversation_id}/{user_id}/{id}-{file name}
--     Only members of a chat can upload into it (into their own folder, unless someone in the chat is blocked either
--     way) and read from it; people delete only their own files. The apps show files through short-lived signed URLs.
--   * messages.attachments: what a message carries, [{kind, path, name, size, mime, width?, height?, duration?}]
--     (at most 10, each up to 50 MB), checked by a trigger: every path must be in the sender's own folder of that chat.
--     A message carrying attachments needs no words.
--   * Inbox rows and notifications read "Sent a photo", "Sent 3 photos", "Sent a video", "Sent a file",
--     "Sent 4 attachments" for a mix (words, when there are any, still win).
--   * search_messages(): newest messages whose text contains the words, in one chat or in all of mine.
--   * conversation_shared_messages(): the messages behind a chat's Media, Files and Links tabs, newest first, with
--     partial indexes so they do not walk the whole chat.

-- -----------------------------------------------------------------------------
-- Storage
-- -----------------------------------------------------------------------------
-- No SVG (it can carry scripts) and nothing a browser would run; 50 MB matches the apps' limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-media',
  'message-media',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm',
    'application/pdf', 'text/plain', 'text/csv', 'application/rtf', 'text/rtf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-zip-compressed'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- The chat a message-media object belongs to: its first folder when that is a UUID, else null. Never an error, so a
-- malformed path simply fails the policies below instead of breaking the upload with a cast error.
create or replace function public.message_media_chat(p_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- Upload: exactly {chat}/{me}/{file}, into a chat I belong to, and not while anyone in it is blocked either way
-- (the same rule as sending a message). No update policy: a sent file is never replaced.
drop policy if exists "message_media_insert_member" on storage.objects;
create policy "message_media_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-media'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_conversation_member(public.message_media_chat(name), auth.uid())
    -- objects.name, not name: inside the subquery a bare "name" could bind to a column of a joined table.
    and not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = public.message_media_chat(objects.name)
        and cm.user_id <> auth.uid()
        and public.is_blocked_either_way(cm.user_id)
    )
  );

-- Read (and sign URLs): members of the chat, plus the uploader for their own files (so someone who left a chat can
-- still clean up what they sent).
drop policy if exists "message_media_select_member" on storage.objects;
create policy "message_media_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-media'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.is_conversation_member(public.message_media_chat(name), auth.uid())
    )
  );

drop policy if exists "message_media_delete_own" on storage.objects;
create policy "message_media_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'message-media' and (storage.foldername(name))[2] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- messages.attachments
-- -----------------------------------------------------------------------------
alter table public.messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.messages drop constraint if exists messages_attachments_check;
-- A case, not "and": jsonb_array_length() fails on anything that is not an array, and "and" may run it first.
alter table public.messages add constraint messages_attachments_check check (
  case when jsonb_typeof(attachments) = 'array' then jsonb_array_length(attachments) <= 10 else false end
);

-- Anyone in a chat can write this JSON, so nothing in it is taken on trust: each path must be a file in the sender's
-- own folder of this chat (so a message can never point at someone else's file or another chat), and each entry is
-- rebuilt from the known keys only. Runs on insert and when the attachments themselves change, never when an account
-- deletion only clears sender_id.
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
    if jsonb_typeof(v_item -> 'kind') is distinct from 'string' or v_item ->> 'kind' not in ('image', 'video', 'file') then
      raise exception 'Invalid attachment: kind must be image, video or file' using errcode = 'check_violation', constraint = 'messages_attachments_check';
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

drop trigger if exists messages_check_attachments on public.messages;
create trigger messages_check_attachments
  before insert or update of attachments on public.messages
  for each row execute function public.check_message_attachments();

-- A message may now be only files: the text may be empty when attachments (or, as before, a shared post) ride along.
-- Every check on the text is dropped first, as migration 17 did, so this stays right whatever ran before.
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
  char_length(content) <= 4000 and (char_length(content) >= 1 or shared_post is not null or attachments <> '[]'::jsonb)
);

-- -----------------------------------------------------------------------------
-- Previews: the inbox row (120 characters) and the notification (140)
-- -----------------------------------------------------------------------------
-- The same wording as attachmentPreview() in packages/shared/src/message-media.ts; null when there are none.
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
    when x.images = 0 and x.videos = 0 then case when x.n = 1 then 'Sent a file' else 'Sent ' || x.n || ' files' end
    else 'Sent ' || x.n || ' attachments'
  end
  from (
    select count(*) as n,
           count(*) filter (where e.item ->> 'kind' = 'image') as images,
           count(*) filter (where e.item ->> 'kind' = 'video') as videos
    from jsonb_array_elements(case when jsonb_typeof(p_attachments) = 'array' then p_attachments else '[]'::jsonb end) as e(item)
  ) x;
$$;

-- Words first, then a share ("Sent a post"), then the files. Replaces migration 17's three-argument version.
drop function if exists public.message_preview(text, jsonb, int);
create or replace function public.message_preview(p_content text, p_shared jsonb, p_attachments jsonb, p_len int default 120)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(left(p_content, p_len), ''),
    case when p_shared is not null then
      case p_shared ->> 'kind' when 'reel' then 'Sent a reel' when 'listing' then 'Sent a listing' else 'Sent a post' end
    end,
    public.message_attachments_preview(p_attachments)
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
      last_message_preview = public.message_preview(new.content, new.shared_post, new.attachments)
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
      v_member, new.sender_id, 'message', v_title, public.message_preview(new.content, new.shared_post, new.attachments, 140),
      '/messages/' || new.conversation_id,
      jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id),
      'message:' || new.conversation_id
    );
  end loop;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Shared in this chat: Media, Files, Links
-- -----------------------------------------------------------------------------
-- Partial indexes: a chat's media and files, and its messages with links, newest first. The queries below repeat
-- these predicates word for word so the planner can use them.
create index if not exists messages_media_idx on public.messages (conversation_id, created_at desc, id desc)
  where attachments <> '[]'::jsonb or image_url is not null;
create index if not exists messages_links_idx on public.messages (conversation_id, created_at desc, id desc)
  where content ~* 'https?://' or shared_post is not null;

-- One page of the messages behind a tab, newest first, older than p_before (the created_at of the last message of
-- the previous page). Media: photos and videos, including photos sent from the website as image_url. Files: other
-- files. Links: text with an http(s) address, and shared posts. The app picks the items out of each message.
-- Security invoker: the messages policies decide what anyone sees, so a non-member gets nothing.
create or replace function public.conversation_shared_messages(p_conversation_id uuid, p_kind text, p_before timestamptz default null, p_limit int default 30)
returns setof public.messages
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if p_kind = 'media' then
    return query
      select m.* from public.messages m
      where m.conversation_id = p_conversation_id
        and m.created_at < v_before
        and (m.attachments <> '[]'::jsonb or m.image_url is not null)
        and (m.image_url is not null or m.attachments @> '[{"kind": "image"}]'::jsonb or m.attachments @> '[{"kind": "video"}]'::jsonb)
      order by m.created_at desc, m.id desc
      limit v_limit;
  elsif p_kind = 'files' then
    return query
      select m.* from public.messages m
      where m.conversation_id = p_conversation_id
        and m.created_at < v_before
        and (m.attachments <> '[]'::jsonb or m.image_url is not null)
        and m.attachments @> '[{"kind": "file"}]'::jsonb
      order by m.created_at desc, m.id desc
      limit v_limit;
  elsif p_kind = 'links' then
    return query
      select m.* from public.messages m
      where m.conversation_id = p_conversation_id
        and m.created_at < v_before
        and (m.content ~* 'https?://' or m.shared_post is not null)
      order by m.created_at desc, m.id desc
      limit v_limit;
  else
    raise exception 'Unknown kind of shared content: %', p_kind using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Search
-- -----------------------------------------------------------------------------
-- Messages whose text contains p_q (any case; % and _ are plain characters), newest first, in one chat when
-- p_conversation_id is given, else in every chat I belong to. Walks my memberships, never the whole table.
create or replace function public.search_messages(p_q text, p_conversation_id uuid default null, p_limit int default 30)
returns setof public.messages
language sql
stable
security invoker
set search_path = public
as $$
  select m.*
  from public.conversation_members cm
  join public.messages m on m.conversation_id = cm.conversation_id
  where cm.user_id = auth.uid()
    and (p_conversation_id is null or cm.conversation_id = p_conversation_id)
    and btrim(coalesce(p_q, '')) <> ''
    and m.content ilike '%' || replace(replace(replace(left(btrim(p_q), 200), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.check_message_attachments() from public, anon, authenticated;
grant execute on function public.message_media_chat(text) to authenticated;
revoke all on function public.conversation_shared_messages(uuid, text, timestamptz, int) from public, anon;
grant execute on function public.conversation_shared_messages(uuid, text, timestamptz, int) to authenticated;
revoke all on function public.search_messages(text, uuid, int) from public, anon;
grant execute on function public.search_messages(text, uuid, int) to authenticated;

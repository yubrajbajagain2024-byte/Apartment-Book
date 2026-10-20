-- =============================================================================
-- Migration 28: Snaps. A photo or video taken with the camera and sent straight into the direct chats of friends and
-- people you chat with; each of them can open it once. Safe to re-run.
--   * A private storage bucket, snaps: {sender}/{32 hex}.{jpg|mp4|mov}, up to 50 MB. The sender uploads into their own
--     folder (and can read their own files back); a recipient can read one only during the two minutes after opening
--     it, until they close it. The app loads it then through Storage's signed-in download, so every request is checked
--     against this (a signed URL would outlive it: its lifetime is the asker's to choose). Nobody else, ever. No client
--     replaces or deletes a file: purge_snaps() does.
--   * snaps (one per capture) and snap_recipients (one per person it went to: the chat and the message it arrived as,
--     when they opened it and when they closed it). Row-level security with no policies, and no grants: only the
--     functions below read or write them.
--   * messages.snap: what the chats show, {id, kind, expires_at, opened_at, gone?}. Written only by those functions (a
--     trigger refuses it from the API); a message carrying one has no text. `gone` marks a Snap that went before its
--     recipient opened it (it expired, or its sender's account was deleted). Inbox rows read "Sent a Snap"; the
--     recipient gets a "snap" notification, "Sent you a Snap" (a muted chat stays quiet, as for messages).
--   * list_snap_recipients(): who the Send To list offers. send_snap(): checks the uploaded file and every recipient (a
--     friend, or someone I already have a direct chat with; nobody blocked either way), then sends one message per
--     person, in our direct chat. open_snap(): the one view; marks it opened (both chats update) and says where the
--     file is. Refused once closed, after the two minutes, once it expired (31 days after sending) or once the file is
--     gone. close_snap() ends the view at once.
--   * purge_snaps(), every 10 minutes (pg_cron): forgets Snaps everyone has opened (10 minutes on), Snaps that expired
--     and files never sent (an hour on), and deletes their files through the Storage API (pg_net, with the project URL
--     and service key that scripts/supabase-setup.mjs keeps in Vault). A file is checked off once Storage no longer has
--     it; until then it is asked for again every 30 minutes. The chats keep their "Opened" / "Expired" marks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Storage
-- -----------------------------------------------------------------------------
-- The camera's own formats: JPEG photos (the app converts HEIC), and QuickTime or MP4 videos. 50 MB matches the apps.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('snaps', 'snaps', false, 52428800, array['image/jpeg', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.snaps (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null,
  media_path text not null,
  kind text not null,
  mime text not null,
  width integer,
  height integer,
  -- Seconds, for videos.
  duration numeric,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint snaps_sender_id_fkey foreign key (sender_id) references public.profiles (id) on delete cascade,
  constraint snaps_media_path_key unique (media_path),
  constraint snaps_kind_check check (kind in ('image', 'video')),
  constraint snaps_mime_check check (mime in ('image/jpeg', 'video/mp4', 'video/quicktime')),
  constraint snaps_size_check check ((width is null or width > 0) and (height is null or height > 0) and (duration is null or duration >= 0))
);
create index if not exists snaps_expires_at_idx on public.snaps (expires_at);
create index if not exists snaps_sender_id_idx on public.snaps (sender_id);

create table if not exists public.snap_recipients (
  snap_id uuid not null,
  recipient_id uuid not null,
  conversation_id uuid not null,
  message_id uuid not null,
  opened_at timestamptz,
  closed_at timestamptz,
  primary key (snap_id, recipient_id),
  constraint snap_recipients_snap_id_fkey foreign key (snap_id) references public.snaps (id) on delete cascade,
  constraint snap_recipients_recipient_id_fkey foreign key (recipient_id) references public.profiles (id) on delete cascade,
  constraint snap_recipients_conversation_id_fkey foreign key (conversation_id) references public.conversations (id) on delete cascade,
  -- Deleting the message (its sender may) takes the Snap away from its recipient too.
  constraint snap_recipients_message_id_fkey foreign key (message_id) references public.messages (id) on delete cascade,
  constraint snap_recipients_message_id_key unique (message_id)
);
create index if not exists snap_recipients_recipient_id_idx on public.snap_recipients (recipient_id);

-- A Snap that goes before its recipient opened it (purge_snaps() after it expired, or with its sender's account) says so
-- in their chat at once: both people's bubbles update.
create or replace function public.snap_recipient_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.opened_at is null then
    update public.messages set snap = snap || jsonb_build_object('gone', true) where id = old.message_id and snap is not null;
  end if;
  return old;
end;
$$;

drop trigger if exists snap_recipients_gone on public.snap_recipients;
create trigger snap_recipients_gone
  after delete on public.snap_recipients
  for each row execute function public.snap_recipient_gone();

-- Files purge_snaps() has to delete from Storage, and when it last asked.
create table if not exists public.snap_purges (
  path text primary key,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz
);

alter table public.snaps enable row level security;
alter table public.snap_recipients enable row level security;
alter table public.snap_purges enable row level security;
revoke all on table public.snaps, public.snap_recipients, public.snap_purges from anon, authenticated;

-- -----------------------------------------------------------------------------
-- messages.snap
-- -----------------------------------------------------------------------------
alter table public.messages add column if not exists snap jsonb;
alter table public.messages drop constraint if exists messages_snap_check;
alter table public.messages add constraint messages_snap_check check (
  snap is null or (jsonb_typeof(snap) = 'object' and jsonb_typeof(snap -> 'id') = 'string' and coalesce(snap ->> 'kind', '') in ('image', 'video'))
);

-- Anyone in a chat can insert messages, so messages.snap is not taken from the API at all: send_snap() writes it (and
-- open_snap() marks it opened), running as the functions' owner. From anon or authenticated it is refused.
create or replace function public.guard_message_snap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.snap is not null then
      raise exception 'Snaps are sent with send_snap()' using errcode = 'insufficient_privilege';
    end if;
  elsif new.snap is distinct from old.snap then
    raise exception 'Snaps are sent with send_snap()' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard_snap on public.messages;
create trigger messages_guard_snap
  before insert or update of snap on public.messages
  for each row execute function public.guard_message_snap();

-- A message may now carry only a Snap: no text. Every check on the text is dropped first, as migrations 17 and 20 did.
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
  char_length(content) <= 4000 and (char_length(content) >= 1 or shared_post is not null or attachments <> '[]'::jsonb or snap is not null)
);

-- -----------------------------------------------------------------------------
-- Who can send what to whom, and who can see a file
-- -----------------------------------------------------------------------------
-- A Snap file is {sender}/{32 hex}.{jpg|mp4|mov}: the sender's own folder, a random name, one of the three types.
create or replace function public.snap_path_ok(p_name text, p_user uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_name ~ ('^' || p_user::text || '/[0-9a-f]{32}\.(jpg|mp4|mov)$'), false);
$$;

-- Whether I may send a Snap to p_other: a friend (we follow each other) or someone I already have a direct chat with
-- (both of us still in it); never myself, never anyone blocked either way.
create or replace function public.can_snap(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_other is not null
    and p_other <> auth.uid()
    and exists (select 1 from public.profiles p where p.id = p_other)
    and not public.is_blocked_either_way(p_other)
    and (
      exists (
        select 1
        from public.follows f1
        join public.follows f2 on f2.follower_id = p_other and f2.followee_id = auth.uid()
        where f1.follower_id = auth.uid() and f1.followee_id = p_other
      )
      or exists (
        select 1
        from public.conversations c
        join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
        join public.conversation_members theirs on theirs.conversation_id = c.id and theirs.user_id = p_other
        where c.type = 'direct'
      )
    );
$$;

-- The one view: a recipient may read the file from opening it until they close it, two minutes at most, and never
-- after the Snap expired. Security definer, so the storage policy below can look at the Snap tables.
create or replace function public.snap_viewable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.snaps s
    join public.snap_recipients r on r.snap_id = s.id
    where s.media_path = p_name
      and r.recipient_id = auth.uid()
      and r.opened_at is not null
      and r.closed_at is null
      and r.opened_at > now() - interval '2 minutes'
      and s.expires_at > now()
  );
$$;

-- Upload: exactly {me}/{32 hex}.{jpg|mp4|mov}. No update policy (a file is never replaced) and no delete policy.
drop policy if exists "snaps_insert_own" on storage.objects;
create policy "snaps_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'snaps' and public.snap_path_ok(name, auth.uid()));

-- Read: the sender's own files, and a recipient's during their one view (each request of a download is checked).
drop policy if exists "snaps_select_own_or_viewing" on storage.objects;
create policy "snaps_select_own_or_viewing" on storage.objects
  for select to authenticated
  using (bucket_id = 'snaps' and ((storage.foldername(name))[1] = auth.uid()::text or public.snap_viewable(name)));

-- -----------------------------------------------------------------------------
-- Previews and notifications
-- -----------------------------------------------------------------------------
-- Words first, then a Snap ("Sent a Snap", SNAP_PREVIEW in packages/shared/src/snaps.ts), a share, then the files.
-- The two triggers below call this one.
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

-- Migration 20's four-argument form stays for anything still calling it (re-running an older migration does): the
-- same, without a Snap.
create or replace function public.message_preview(p_content text, p_shared jsonb, p_attachments jsonb, p_len int default 120)
returns text
language sql
immutable
set search_path = public
as $$
  select public.message_preview(p_content, p_shared, p_attachments, null::jsonb, p_len);
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
      last_message_preview = public.message_preview(new.content, new.shared_post, new.attachments, new.snap)
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
-- notification ("Sent you a Snap", one per chat until read), so it stands out in the list.
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
  check (type in ('message', 'listing_saved', 'nearby_listing', 'system', 'like', 'comment', 'follow', 'snap'));

-- -----------------------------------------------------------------------------
-- Sending, opening, closing
-- -----------------------------------------------------------------------------
-- Who the Send To list offers: everyone I have a direct chat with (the most recent chat first), then my friends A to Z;
-- nobody blocked either way. p_q narrows it by name (% and _ are plain characters).
create or replace function public.list_snap_recipients(p_q text default null)
returns table (id uuid, full_name text, avatar_url text, is_friend boolean, last_message_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with chats as (
    select theirs.user_id as person, max(c.last_message_at) as last_message_at
    from public.conversation_members mine
    join public.conversations c on c.id = mine.conversation_id and c.type = 'direct'
    join public.conversation_members theirs on theirs.conversation_id = c.id and theirs.user_id <> mine.user_id
    where mine.user_id = auth.uid()
    group by theirs.user_id
  ),
  friends as (
    select f1.followee_id as person
    from public.follows f1
    join public.follows f2 on f2.follower_id = f1.followee_id and f2.followee_id = f1.follower_id
    where f1.follower_id = auth.uid()
  ),
  people as (
    select coalesce(c.person, f.person) as person, c.last_message_at, f.person is not null as is_friend
    from chats c
    full join friends f on f.person = c.person
  )
  select p.id, p.full_name, p.avatar_url, x.is_friend, x.last_message_at
  from people x
  join public.profiles p on p.id = x.person
  where auth.uid() is not null
    and p.id <> auth.uid()
    and not public.is_blocked_either_way(p.id)
    and (
      btrim(coalesce(p_q, '')) = ''
      or p.full_name ilike '%' || replace(replace(replace(left(btrim(p_q), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    )
  order by x.last_message_at desc nulls last, p.full_name, p.id
  limit 500;
$$;

-- Sends the file I just uploaded to p_path as a Snap: one message in my direct chat with each person (the chat is made
-- when there is none yet), each opened on its own. All or nothing. Returns {snap_id, expires_at, sent: [{recipient_id,
-- conversation_id, message_id}]}.
create or replace function public.send_snap(
  p_path text,
  p_kind text,
  p_mime text,
  p_width integer,
  p_height integer,
  p_duration numeric,
  p_recipient_ids uuid[]
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
  v_snap_json := jsonb_build_object('id', v_snap, 'kind', p_kind, 'expires_at', v_expires, 'opened_at', null);

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

-- The one view. The first call marks the Snap opened (in snap_recipients and in both people's chat) and starts the two
-- minutes in which the recipient may read the file; calling again inside them (a retry after a failed download) is
-- allowed until close_snap(). Returns the file and its sender.
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

-- Closing the Snap ends its view at once: from now on the file is out of reach for this recipient.
create or replace function public.close_snap(p_snap_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.snap_recipients
  set closed_at = now()
  where snap_id = p_snap_id and recipient_id = auth.uid() and opened_at is not null and closed_at is null;
$$;

-- -----------------------------------------------------------------------------
-- Deleting what is over
-- -----------------------------------------------------------------------------
-- Every 10 minutes (pg_cron, below). p_now is for tests. Returns what it did, for cron.job_run_details.
create or replace function public.purge_snaps(p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_over integer := 0;
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

  -- 1. Snaps that are over: expired, or opened by everyone they went to more than 10 minutes ago (a view lasts two),
  --    or with nobody left to open them. Their rows go now; their files are queued.
  with over as (
    delete from public.snaps s
    where s.expires_at <= p_now
       or not exists (
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
  select count(*) into v_over from over;

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

-- Where purge_snaps() reaches the Storage API and with which key, kept in Vault. scripts/supabase-setup.mjs calls this
-- with the project's URL and service key; nothing in the API can.
create or replace function public.set_snap_purge_credentials(p_url text, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if to_regclass('vault.secrets') is null then
    raise exception 'Vault is not available on this database';
  end if;
  if coalesce(btrim(p_url), '') = '' or coalesce(btrim(p_key), '') = '' then
    raise exception 'Both the project URL and the service key are needed';
  end if;
  select s.id into v_id from vault.secrets s where s.name = 'snaps_project_url';
  if v_id is null then
    perform vault.create_secret(p_url, 'snaps_project_url', 'Snaps: where purge_snaps() reaches the Storage API');
  else
    perform vault.update_secret(v_id, p_url);
  end if;
  v_id := null;
  select s.id into v_id from vault.secrets s where s.name = 'snaps_service_key';
  if v_id is null then
    perform vault.create_secret(p_key, 'snaps_service_key', 'Snaps: the key purge_snaps() deletes files with');
  else
    perform vault.update_secret(v_id, p_key);
  end if;
end;
$$;

-- Every 10 minutes where pg_cron is installed; pg_net makes the Storage calls. Without them, run
-- `select public.purge_snaps()` every few minutes some other way.
do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net is not available: purge_snaps() cannot delete Snap files from Storage until it is (%).', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available: run public.purge_snaps() every few minutes another way (%).', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-snaps';
    perform cron.schedule('purge-snaps', '*/10 * * * *', 'select public.purge_snaps()');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.guard_message_snap() from public, anon, authenticated;
revoke all on function public.snap_recipient_gone() from public, anon, authenticated;
-- The storage policies run these as the signed-in user.
revoke all on function public.snap_path_ok(text, uuid) from public, anon;
grant execute on function public.snap_path_ok(text, uuid) to authenticated;
revoke all on function public.snap_viewable(text) from public, anon;
grant execute on function public.snap_viewable(text) to authenticated;
revoke all on function public.can_snap(uuid) from public, anon, authenticated;
revoke all on function public.list_snap_recipients(text) from public, anon;
grant execute on function public.list_snap_recipients(text) to authenticated;
revoke all on function public.send_snap(text, text, text, integer, integer, numeric, uuid[]) from public, anon;
grant execute on function public.send_snap(text, text, text, integer, integer, numeric, uuid[]) to authenticated;
revoke all on function public.open_snap(uuid) from public, anon;
grant execute on function public.open_snap(uuid) to authenticated;
revoke all on function public.close_snap(uuid) from public, anon;
grant execute on function public.close_snap(uuid) to authenticated;
revoke all on function public.purge_snaps(timestamptz) from public, anon, authenticated;
revoke all on function public.set_snap_purge_credentials(text, text) from public, anon, authenticated;

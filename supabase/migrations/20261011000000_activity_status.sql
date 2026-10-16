-- Migration 22: activity status, Messenger style ("Active now", "Active 5 min ago"). Safe to re-run.
--   * Exact last-active times live in a new table, user_activity, that the API can neither read nor write, signed in
--     or not. Only the functions below touch it.
--   * touch_activity(): the apps' heartbeat. Stamps the caller's time while they show their active status (a stamp
--     under 20 seconds old is kept) and answers whether they do. touch_presence(), the heartbeat of installed old
--     builds, now does the same. Neither touches profiles in any way, not even a row lock (a lock leaves the locking
--     transaction's id in the row's xmax).
--   * profiles.last_seen_at (public, even signed out) is emptied and never written again. Old builds still select it,
--     so the column stays. Heartbeats no longer update profiles at all, so profiles.updated_at stops following
--     people's activity too.
--   * profiles and notifications are granted to the API column by column, so their system columns (xmin, xmax: who
--     locked or wrote a row last, and when) are unreadable. They named anonymous Buzz repliers, dated their replies
--     and traced heartbeats.
--   * Hiding your active status deletes your time, and your devices stop marking messages "Delivered" (people still
--     see "Seen" once you read them). Only set_show_active_status() turns it back on, so a stale save from an installed
--     old build cannot undo a hide made since.
--   * activity_status(ids), Instagram's way: nothing about anyone unless you show your status, they show theirs and
--     neither of you has blocked the other. Then whether they are recent (active within about two minutes: "Active
--     now" needs it as well as presence, since anyone can claim presence for anyone) for anyone you share a chat with,
--     and their last-active time, to the minute, only once they have messaged you: sent a message in a chat you are
--     both still in, since you joined it. Everyone else is left out, and a missing row never says why. Signed out, the
--     API cannot call it.
--   * Presence moves to the private realtime topic 'presence:active'. Only signed-in people who show their active
--     status can see who is there or appear there. Old builds keep the public 'online' topic and no longer see new
--     clients. blocked_either_way_ids() lets the apps leave out of what they show the people blocked either way.
--   * Chats: members may change only their own receipts and a group's name, so nobody can move a membership into
--     another chat or turn a direct chat into a group. "Seen" moves only when there was something new to read, and a
--     message is never dated later than when it was sent, so none stays "new" for good to keep moving it.
--   * Notifications: only read_at may be changed, and only once a notification shows, so a scheduled one (an anonymous
--     Buzz reply's) can be neither surfaced nor counted early.

-- -----------------------------------------------------------------------------
-- Last-active times: private
-- -----------------------------------------------------------------------------
-- The key points at auth.users, not profiles: checking a key locks the row it points at, and a lock on a profile row
-- shows in its xmax (see "profiles and notifications: column by column" below). Deleting the account still deletes the
-- time.
create table if not exists public.user_activity (
  user_id uuid primary key,
  last_active_at timestamptz not null
);
alter table public.user_activity drop constraint if exists user_activity_user_id_fkey;
alter table public.user_activity
  add constraint user_activity_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
-- Row-level security with no policies, and no grants: nothing reaches it through the API.
alter table public.user_activity enable row level security;
revoke all on table public.user_activity from public, anon, authenticated;

-- Never in the realtime publication: deleted rows would reach every subscriber whatever the policies say.
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_activity')
     and not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
    alter publication supabase_realtime drop table public.user_activity;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Heartbeats
-- -----------------------------------------------------------------------------
-- The apps call this when they open or come back to the front, every minute while in front, and when they leave. It
-- stamps the caller's time only while they show their active status, keeps a stamp under 20 seconds old (a phone and
-- a laptop open at once would otherwise write twice a minute each), and answers whether they show it, so a device
-- that missed a "hide" made on another one stops appearing within a minute.
-- A heartbeat racing a hide: both take the same per-user advisory lock (never a lock on the profile row), so either the
-- heartbeat finishes first and the hide deletes its stamp, or it waits for the hide and then sees it (each statement
-- reads what was committed before it started) and writes nothing.
create or replace function public.touch_activity()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('user_activity:' || auth.uid()::text, 0));
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.show_active_status) then
    return false;
  end if;
  insert into public.user_activity as a (user_id, last_active_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_active_at = excluded.last_active_at
    where a.last_active_at < excluded.last_active_at - interval '20 seconds';
  return true;
end;
$$;

-- Installed old builds call touch_presence() every two minutes. It now does the same, and writes nothing public.
create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.touch_activity();
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles.last_seen_at: retired
-- -----------------------------------------------------------------------------
-- Migration 9's trigger on the column (it already cleared it for hidden profiles) now clears it on every write, so
-- the API cannot fill it either.
create or replace function public.clear_last_seen_when_hidden()
returns trigger
language plpgsql
as $$
begin
  new.last_seen_at := null;
  return new;
end;
$$;
update public.profiles set last_seen_at = null where last_seen_at is not null;

-- -----------------------------------------------------------------------------
-- profiles and notifications: column by column
-- -----------------------------------------------------------------------------
-- profiles is public (its select policy is `using (true)`), and a table-wide SELECT also let the API read each row's
-- system columns (?select=xmin,xmax, or filter on them). xmax holds the id of the last transaction that locked the row,
-- and checking a foreign key locks the profile of whoever writes a row pointing at it: a message, a Buzz reply, a vote.
-- Matched against the xmin of a row you may read (the "Someone replied" notification of an anonymous reply), it named
-- the writer, and successive values traced when someone was active. That notification's own xmin, bracketed by the
-- ids of your own writes, also dated the reply however late the notification was scheduled to show. SELECT granted on
-- the columns themselves leaves every system column unreadable ("permission denied"), while select=*, filters,
-- embedding and Realtime (which sends the columns a subscriber may select) work as before. The grant names whatever
-- columns each table has when this runs, so a column added outside these migrations keeps working. A column added
-- later needs its own grant (or select=* on that table fails):
--   grant select (new_column) on table public.profiles to anon, authenticated;   -- or public.notifications
-- (and a table-wide `grant select` would open the system columns again).
do $$
declare
  t text;
  cols text;
begin
  foreach t in array array['profiles', 'notifications'] loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
    from pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped;
    execute format('revoke select on table public.%I from public, anon, authenticated', t);
    execute format('grant select (%s) on table public.%I to anon, authenticated', cols, t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Hiding your active status forgets your time
-- -----------------------------------------------------------------------------
-- The same advisory lock as touch_activity, taken before the delete (see the heartbeat above).
create or replace function public.forget_activity_when_hidden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('user_activity:' || new.id::text, 0));
  delete from public.user_activity where user_id = new.id;
  return null;
end;
$$;
drop trigger if exists forget_activity_when_hidden on public.profiles;
create trigger forget_activity_when_hidden
  after update of show_active_status on public.profiles
  for each row when (not new.show_active_status)
  execute function public.forget_activity_when_hidden();

-- -----------------------------------------------------------------------------
-- Showing your active status again: only on purpose
-- -----------------------------------------------------------------------------
-- Installed old builds send show_active_status with every Settings save, as it was when they loaded the profile, so a
-- save there would quietly undo a hide made since on another device. Hiding works from anywhere; showing it again only
-- through set_show_active_status(), which the apps call when the switch itself is flipped. A stale save keeps the rest
-- of what it changed. Only the API's signed-in role is held to this (the database's owner and the service role are not).
create or replace function public.keep_active_status_hidden()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' and new.show_active_status and not old.show_active_status
     and coalesce(current_setting('app.show_active_status_chosen', true), '') <> 'on' then
    new.show_active_status := false;
  end if;
  return new;
end;
$$;
drop trigger if exists keep_active_status_hidden on public.profiles;
create trigger keep_active_status_hidden
  before update of show_active_status on public.profiles
  for each row execute function public.keep_active_status_hidden();

create or replace function public.set_show_active_status(p_show boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_show is null then
    raise exception 'Say whether to show your activity status';
  end if;
  perform set_config('app.show_active_status_chosen', 'on', true);
  update public.profiles set show_active_status = p_show where id = auth.uid();
  perform set_config('app.show_active_status_chosen', '', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- "Delivered" while you hide your active status
-- -----------------------------------------------------------------------------
-- The apps mark every chat delivered whenever they open, come back to the front or receive a message, and each member
-- of a chat reads the others' last_delivered_at (live, through the realtime publication): to the microsecond, when
-- their app was open. While you hide your active status nothing marks it any more, so your chats go from "Sent"
-- straight to "Seen" (mark_conversation_read, when you read something new: see "Chats" below), as on Instagram.
-- Migration 9's function otherwise, and a message dated later than now is not there yet (see "Chats" below).
create or replace function public.mark_delivered_all()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.conversation_members cm
  set last_delivered_at = now()
  where cm.user_id = auth.uid()
    and exists (select 1 from public.profiles me where me.id = auth.uid() and me.show_active_status)
    and exists (
      select 1 from public.messages m
      where m.conversation_id = cm.conversation_id and m.created_at > cm.last_delivered_at and m.created_at <= now()
    );
$$;

-- -----------------------------------------------------------------------------
-- Chats: what members may change
-- -----------------------------------------------------------------------------
-- Members could update every column of their own membership row, and an UPDATE that reads no column is not held to the
-- select policy (supabase-js .update() with no filter sends exactly that). So a member could move their row into any
-- chat whose id they learned (realtime DELETE events carry it): reading it all, and passing activity_status()'s "they
-- messaged you" rule without the other person doing anything. A member of a direct chat could also turn it into a
-- group and then add anyone to it. Members may now change their own receipts and a group's name, nothing else (the
-- apps write nothing else; the receipt functions run as the caller, the rest as the definer).
revoke update on table public.conversation_members from public, anon, authenticated;
grant update (last_read_at, last_delivered_at) on table public.conversation_members to authenticated;
revoke update on table public.conversations from public, anon, authenticated;
grant update (name) on table public.conversations to authenticated;
drop policy if exists "conversations_update_member" on public.conversations;
create policy "conversations_update_member" on public.conversations
  for update to authenticated
  using (type = 'group' and public.is_conversation_member(id, auth.uid()))
  with check (type = 'group' and public.is_conversation_member(id, auth.uid()));

-- A message is dated when it is sent, never later. The sender's insert could set created_at to anything, and one dated
-- ahead stayed newer than everyone's receipts until that date: each time another member opened the chat or their app
-- woke, "Seen" and "Delivered" (below and above) moved to now() again, so the sender learned the exact moments even
-- someone hiding their status had the app open; the chat also stayed unread and first in the inbox. An earlier date
-- is kept (it never makes anything new to read, and the tests space their messages with it).
create or replace function public.clamp_message_created_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := least(new.created_at, now());
  return new;
end;
$$;
drop trigger if exists messages_clamp_created_at on public.messages;
create trigger messages_clamp_created_at
  before insert on public.messages
  for each row execute function public.clamp_message_created_at();
-- Any sent before this migration are dated now, and so is the last message time of their chats.
update public.messages set created_at = now() where created_at > now();
update public.conversations c
set last_message_at = (select max(m.created_at) from public.messages m where m.conversation_id = c.id)
where c.last_message_at > now();

-- "Seen" moves only when there was something new from someone else to read. Both apps mark a chat read whenever it
-- opens (the website on every page load while a chat stays open in its dock), and every member receives the change
-- live: with nothing to read, it said only when someone had the app open, to the microsecond, even someone hiding their
-- status. A message dated later than now, however it got there, is not something to read yet (nor unread, below).
-- Migration 9's function otherwise.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.conversation_members cm
  set last_read_at = now(), last_delivered_at = now()
  where cm.conversation_id = p_conversation_id
    and cm.user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.conversation_id = cm.conversation_id
        and m.created_at > cm.last_read_at
        and m.created_at <= now()
        and (m.sender_id is null or m.sender_id <> auth.uid())
    );
$$;

-- The unread counts agree with what reading clears. Migration 1's function otherwise.
create or replace function public.get_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.conversation_id, count(*)::bigint as unread_count
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id
   and cm.user_id = auth.uid()
  where m.created_at > cm.last_read_at
    and m.created_at <= now()
    and (m.sender_id is null or m.sender_id <> auth.uid())
  group by m.conversation_id;
$$;

-- -----------------------------------------------------------------------------
-- Notifications: changed only once shown
-- -----------------------------------------------------------------------------
-- A notification can be scheduled (visible_at, migration 15): an anonymous Buzz reply's shows a while after the reply,
-- so the thread's author cannot clock it. The update and delete policies did not wait for that, and a statement that
-- reads no column skips the select policy: a filterless PATCH setting visible_at surfaced the reply at once, and a
-- filterless DELETE counted it. Now only read_at may be changed (mark_notifications_read, which runs as the caller,
-- writes nothing else), and neither reaches a notification before it shows.
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (user_id = auth.uid() and visible_at <= now())
  with check (user_id = auth.uid());
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated
  using (user_id = auth.uid() and visible_at <= now());
revoke update on table public.notifications from public, anon, authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Reading last-active times
-- -----------------------------------------------------------------------------
-- Only the first 100 ids count, and your own is never answered. Nothing about anyone unless you show your status, they
-- show theirs and neither of you has blocked the other. Then:
--   * recent: their time is no more than two minutes before this minute, both cut to the minute (so it says nothing
--     finer than the time itself). An app in front stamps every minute, so someone online always has one; presence
--     without it is a claim nobody stamped (anyone can track anyone's id on the channel), or a stamp still on its way.
--   * last_active_at, cut to the minute ("Active 5 min ago" needs no more, and seconds would show exactly when someone
--     closed the app), only once they have messaged you: sent a message in a chat you both still belong to, since you
--     joined it. Being added to a chat, or sent one, is not enough: anyone may open an empty chat with anyone, or put
--     the whole school in one group, and what a group said before you joined was not said to you.
-- Someone who shares a chat with you but has not messaged you is answered only while recent, with no time: "Active
-- now" is no more than presence already shows everyone. Anyone else is left out, and a missing row never says why.
-- The return type changed while this migration was unreleased, so drop the old function first.
drop function if exists public.activity_status(uuid[]);
create function public.activity_status(p_user_ids uuid[])
returns table (user_id uuid, last_active_at timestamptz, recent boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, case when s.wrote then s.minute end, s.recent
  from (
    select
      a.user_id,
      date_trunc('minute', a.last_active_at) as minute,
      date_trunc('minute', a.last_active_at) >= date_trunc('minute', now()) - interval '2 minutes' as recent,
      exists (
        select 1
        from public.conversation_members mine
        join public.conversation_members theirs on theirs.conversation_id = mine.conversation_id and theirs.user_id = a.user_id
        where mine.user_id = auth.uid()
          and exists (
            select 1 from public.messages m
            where m.sender_id = a.user_id and m.conversation_id = mine.conversation_id and m.created_at >= mine.joined_at
          )
      ) as wrote,
      exists (
        select 1
        from public.conversation_members mine
        join public.conversation_members theirs on theirs.conversation_id = mine.conversation_id and theirs.user_id = a.user_id
        where mine.user_id = auth.uid()
      ) as shared
    from (
      select distinct u.id
      from (select x.id from unnest(p_user_ids) with ordinality as x(id, n) order by x.n limit 100) u
    ) asked
    join public.user_activity a on a.user_id = asked.id
    join public.profiles them on them.id = a.user_id and them.show_active_status
    where a.user_id <> auth.uid()
      and exists (select 1 from public.profiles me where me.id = auth.uid() and me.show_active_status)
      and not public.is_blocked_either_way(a.user_id)
  ) s
  where s.wrote or (s.shared and s.recent);
$$;
-- "Has this person written in this chat": one index probe, however long the chat. Also serves the account deletion's
-- update of messages.sender_id.
create index if not exists messages_sender_conversation_idx on public.messages (sender_id, conversation_id);

-- -----------------------------------------------------------------------------
-- Presence and blocks
-- -----------------------------------------------------------------------------
-- The presence channel is one topic for everyone, so it cannot leave anyone out. The apps leave out of what they show
-- (green dots, online lists, "Active now") the people blocked either way with the viewer: these ids, the caller's own
-- blocks in both directions. Anyone could already ask is_blocked_either_way() about each id.
create or replace function public.blocked_either_way_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.blocked_id from public.blocks b where b.blocker_id = auth.uid()
  union
  select b.blocker_id from public.blocks b where b.blocked_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Presence: a private realtime topic
-- -----------------------------------------------------------------------------
-- The apps meet on 'presence:active' (PRESENCE_TOPIC in packages/shared/src/queries/presence.ts) as a private
-- channel, which Realtime Authorization checks against these policies. A signed-in user receives presence there
-- (select) and appears there (insert, which is what track does) only while their own profile shows their active
-- status. Nothing else is allowed on that topic, broadcasts included. Every other channel in the apps is public
-- (postgres_changes), and these policies never apply to public channels. Skipped where there is no realtime schema
-- (the offline test database).
do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;
  drop policy if exists "presence_active_select" on realtime.messages;
  create policy "presence_active_select" on realtime.messages
    for select to authenticated
    using (
      (select realtime.topic()) = 'presence:active'
      and realtime.messages.extension = 'presence'
      and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.show_active_status)
    );
  drop policy if exists "presence_active_insert" on realtime.messages;
  create policy "presence_active_insert" on realtime.messages
    for insert to authenticated
    with check (
      (select realtime.topic()) = 'presence:active'
      and realtime.messages.extension = 'presence'
      and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.show_active_status)
    );
end
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.touch_activity() from public, anon;
grant execute on function public.touch_activity() to authenticated;
revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;
revoke all on function public.activity_status(uuid[]) from public, anon;
grant execute on function public.activity_status(uuid[]) to authenticated;
revoke all on function public.blocked_either_way_ids() from public, anon;
grant execute on function public.blocked_either_way_ids() to authenticated;
revoke all on function public.set_show_active_status(boolean) from public, anon;
grant execute on function public.set_show_active_status(boolean) to authenticated;
-- Run as triggers only.
revoke all on function public.forget_activity_when_hidden() from public, anon, authenticated;
revoke all on function public.keep_active_status_hidden() from public, anon, authenticated;
revoke all on function public.clamp_message_created_at() from public, anon, authenticated;

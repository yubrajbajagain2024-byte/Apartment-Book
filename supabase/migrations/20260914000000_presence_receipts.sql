-- =============================================================================
-- Apartment Book - migration 9: active status and message delivery receipts
-- Safe to run more than once.
-- =============================================================================

-- Who was active when (Messenger's "Active 5m ago"). Null when the user hides it.
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists show_active_status boolean not null default true;

-- When each member's app last received messages from a conversation ("Delivered").
alter table public.conversation_members add column if not exists last_delivered_at timestamptz not null default now();

-- Heartbeat from an open app. Does nothing for people who hide their active status.
create or replace function public.touch_presence()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.profiles
  set last_seen_at = now()
  where id = auth.uid() and show_active_status;
$$;

-- Turning active status off also clears the last-seen time so nobody can read it.
create or replace function public.clear_last_seen_when_hidden()
returns trigger
language plpgsql
as $$
begin
  if not new.show_active_status then
    new.last_seen_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists clear_last_seen_when_hidden on public.profiles;
create trigger clear_last_seen_when_hidden
  before insert or update of show_active_status, last_seen_at on public.profiles
  for each row execute function public.clear_last_seen_when_hidden();

-- The app received every message in every conversation I belong to.
create or replace function public.mark_delivered_all()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.conversation_members cm
  set last_delivered_at = now()
  where cm.user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.conversation_id = cm.conversation_id and m.created_at > cm.last_delivered_at
    );
$$;

-- Reading implies delivered.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.conversation_members
  set last_read_at = now(), last_delivered_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid();
$$;

-- The sender has obviously read (and received) their own message.
create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      last_message_preview = left(new.content, 120)
  where id = new.conversation_id;

  update public.conversation_members
  set last_read_at = new.created_at, last_delivered_at = new.created_at
  where conversation_id = new.conversation_id
    and user_id = new.sender_id;

  return new;
end;
$$;

-- Senders watch other members' read/delivered times live.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members') then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end $$;

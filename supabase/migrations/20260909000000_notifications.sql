-- =============================================================================
-- Apartment Book - migration 4: notifications
--  * notifications table (recipient-only access; rows are created by triggers)
--  * triggers: new message, someone saved your listing, new place near campus
--  * RPCs: mark_notifications_read, unread_notification_count
--  * realtime on notifications for live badges
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  actor_id uuid,
  type text not null check (type in ('message', 'listing_saved', 'nearby_listing', 'system')),
  title text not null,
  body text,
  link text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint notifications_actor_id_fkey foreign key (actor_id) references public.profiles (id) on delete set null
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_dedupe_idx on public.notifications (user_id, (data ->> 'dedupe')) where read_at is null;

alter table public.notifications enable row level security;
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());
-- No insert policy: only the triggers below (security definer) create rows.

alter table public.profiles
  add column if not exists notify_nearby_listings boolean not null default true;

-- Create a notification, or refresh an unread one with the same dedupe key
-- (so ten messages in one chat make one notification, not ten).
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
      return;
    end if;
  end if;
  insert into public.notifications (user_id, actor_id, type, title, body, link, data)
  values (p_user_id, p_actor_id, p_type, p_title, p_body, p_link, v_data);
end;
$$;

-- New message -> every other member of the conversation.
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
      v_member, new.sender_id, 'message', v_title, left(new.content, 140),
      '/messages/' || new.conversation_id,
      jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id),
      'message:' || new.conversation_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists notify_on_message on public.messages;
create trigger notify_on_message
  after insert on public.messages
  for each row execute function public.notify_on_message();

-- Someone saved your listing -> the owner.
create or replace function public.notify_on_saved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_link text;
  v_saver text;
begin
  if new.target_type = 'apartment' then
    select owner_id, title into v_owner, v_title from public.apartments where id = new.target_id;
    v_link := '/apartments/' || new.target_id;
  elsif new.target_type = 'item' then
    select seller_id, title into v_owner, v_title from public.items where id = new.target_id;
    v_link := '/marketplace/' || new.target_id;
  elsif new.target_type = 'roommate' then
    select author_id, title into v_owner, v_title from public.roommate_posts where id = new.target_id;
    v_link := '/roommates/' || new.target_id;
  end if;
  if v_owner is null then
    return new;
  end if;
  select full_name into v_saver from public.profiles where id = new.user_id;
  perform public.notify(
    v_owner, new.user_id, 'listing_saved',
    coalesce(v_saver, 'Someone') || ' saved your listing', v_title, v_link,
    jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id),
    'saved:' || new.target_type || ':' || new.target_id
  );
  return new;
end;
$$;

drop trigger if exists notify_on_saved on public.saved_listings;
create trigger notify_on_saved
  after insert on public.saved_listings
  for each row execute function public.notify_on_saved();

-- New apartment pinned within 2 miles of a campus -> students there who opted in.
create or replace function public.notify_on_new_apartment()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid;
  v_body text;
begin
  if new.geog is null or new.status <> 'active' then
    return new;
  end if;
  v_body := new.title || ' · ' || new.currency || ' ' || trim(to_char(new.price_per_month, 'FM999999990')) || '/mo'
    || case when new.distance_km is not null then ' · ' || trim(to_char(new.distance_km / 1.609344, 'FM990.0')) || ' mi from campus' else '' end;
  for v_user in
    select p.id
    from public.profiles p
    join public.universities u on u.id = p.university_id
    where p.notify_nearby_listings
      and p.id <> new.owner_id
      and u.geog is not null
      and extensions.st_dwithin(new.geog, u.geog, 3218.69)
  loop
    perform public.notify(
      v_user, new.owner_id, 'nearby_listing', 'New place near campus', v_body,
      '/apartments/' || new.id,
      jsonb_build_object('apartment_id', new.id),
      null
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists notify_on_new_apartment on public.apartments;
create trigger notify_on_new_apartment
  after insert on public.apartments
  for each row execute function public.notify_on_new_apartment();

-- Mark some (or all) of my notifications as read.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid()
    and read_at is null
    and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.unread_notification_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer from public.notifications where user_id = auth.uid() and read_at is null;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

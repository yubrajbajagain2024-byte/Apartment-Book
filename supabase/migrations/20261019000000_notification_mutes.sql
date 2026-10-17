-- =============================================================================
-- CampConnect - migration 26: muting message notifications
--  * notification_mutes: one row per thing a person has muted, their own to read
--    and write: a person (no notices for their messages anywhere), one chat, or
--    every group chat, each until a time or until unmuted (null)
--  * notify_on_message skips a recipient the message is muted for; the message,
--    the chat and its unread count are untouched, only the notice is withheld
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.notification_mutes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  scope text not null,
  /** The person for 'user', the chat for 'conversation', nothing for 'all_groups'. */
  target_id uuid,
  /** When the mute lifts; null means until unmuted. */
  until timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_mutes_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint notification_mutes_scope_check check (scope in ('user', 'conversation', 'all_groups')),
  constraint notification_mutes_target_check check ((scope = 'all_groups') = (target_id is null))
);
create unique index if not exists notification_mutes_unique on public.notification_mutes (user_id, scope, coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.notification_mutes enable row level security;
drop policy if exists "notification_mutes_select_own" on public.notification_mutes;
create policy "notification_mutes_select_own" on public.notification_mutes
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "notification_mutes_insert_own" on public.notification_mutes;
create policy "notification_mutes_insert_own" on public.notification_mutes
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "notification_mutes_update_own" on public.notification_mutes;
create policy "notification_mutes_update_own" on public.notification_mutes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notification_mutes_delete_own" on public.notification_mutes;
create policy "notification_mutes_delete_own" on public.notification_mutes
  for delete to authenticated using (user_id = auth.uid());

-- Is a message from p_sender in p_conversation muted for p_user right now?
create or replace function public.message_muted(p_user uuid, p_sender uuid, p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.notification_mutes m
    where m.user_id = p_user
      and (m.until is null or m.until > now())
      and (
        (m.scope = 'user' and m.target_id = p_sender)
        or (m.scope = 'conversation' and m.target_id = p_conversation)
        or (m.scope = 'all_groups' and exists (select 1 from public.conversations c where c.id = p_conversation and c.type = 'group'))
      )
  );
$$;
revoke all on function public.message_muted(uuid, uuid, uuid) from public, anon, authenticated;

-- New message -> every other member of the conversation, except those it is muted for.
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

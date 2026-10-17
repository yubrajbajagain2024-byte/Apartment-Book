-- =============================================================================
-- CampConnect - migration 27: "Mark all as read" in Messages
--  * mark_conversations_read(uuid[]): your own receipts in the chats named (every
--    chat of yours when null) move to now in one statement, as
--    mark_conversation_read moves one chat's; a chat with nothing new from
--    someone else is left alone (migration 22: clearing chats tells nobody when
--    you had the app open) and nobody else's row is touched. Returns how many
--    chats changed. Runs as the caller: members may update only their own
--    last_read_at and last_delivered_at (migration 22).
-- Safe to run more than once.
-- =============================================================================

create or replace function public.mark_conversations_read(p_conversation_ids uuid[] default null)
returns integer
language sql
security invoker
set search_path = public
as $$
  with marked as (
    update public.conversation_members cm
    set last_read_at = now(), last_delivered_at = now()
    where cm.user_id = auth.uid()
      and (p_conversation_ids is null or cm.conversation_id = any (p_conversation_ids))
      and exists (
        select 1 from public.messages m
        where m.conversation_id = cm.conversation_id
          and m.created_at > cm.last_read_at
          and m.created_at <= now()
          and (m.sender_id is null or m.sender_id <> auth.uid())
      )
    returning 1
  )
  select count(*)::integer from marked;
$$;
revoke all on function public.mark_conversations_read(uuid[]) from public, anon;
grant execute on function public.mark_conversations_read(uuid[]) to authenticated;

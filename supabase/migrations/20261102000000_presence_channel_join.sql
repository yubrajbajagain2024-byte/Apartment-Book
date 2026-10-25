-- =============================================================================
-- CampConnect - migration 40: joining the presence channel again
-- Migration 22 lets someone who shows their active status read the private
-- 'presence:active' topic only for presence messages (extension = 'presence').
-- Supabase Realtime's own check when a client joins a private channel asks
-- whether it may read the topic with a broadcast message, so that policy
-- refused every join ("You do not have permissions to read from this Channel
-- topic"): nobody received presence, and "Active now" and the green dots never
-- showed. Measured on a fresh project on 2026-10-25 (supabase/tests/staging/).
--
-- Reading the topic is now allowed for either kind, still only on that topic
-- and only for someone who shows their status (a business account never does,
-- migration 39). Sending stays presence only, so there are no broadcasts on the
-- topic to read. Skipped where there is no realtime schema. Safe to re-run.
-- =============================================================================

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
      and realtime.messages.extension in ('presence', 'broadcast')
      and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.show_active_status)
    );
end
$$;

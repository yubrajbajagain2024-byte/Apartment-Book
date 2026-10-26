-- =============================================================================
-- Rollback of migration 40 (joining the presence channel): migration 22's read policy again, exactly as production had
-- it before 40 (from the backup). Run as one transaction, before migration 39's rollback.
-- =============================================================================
do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;
  drop policy if exists "presence_active_select" on realtime.messages;
  create policy "presence_active_select" on realtime.messages
    for select to authenticated
    using (((( SELECT realtime.topic() AS topic) = 'presence:active'::text) AND (extension = 'presence'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND p.show_active_status)))));
end
$$;

delete from public._migrations where name = '20261102000000_presence_channel_join.sql';

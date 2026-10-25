-- =============================================================================
-- Migration 34: a Snap that was simply viewed and closed logs nothing more. Safe to re-run.
--   Migration 33's trigger logged "deleted" whenever a recipient row went without a stated reason. close_snap()
--   (migration 30) deletes a Snap's rows the moment its last recipient closes it, with no reason stated, so a Snap
--   that was viewed and closed showed "Snap deleted" after "Opened" (seen on the live project the day it went up). Now a
--   row that had been opened logs only an explicit deletion (delete_snap(): the sender taking it back); a row never
--   opened still logs why it went (expired from the purge, deleted otherwise, including the sender's account going).
-- =============================================================================

create or replace function public.snap_recipient_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(current_setting('campconnect.snap_gone', true), '');
begin
  if v_reason = 'done' then
    return old;
  end if;
  if old.opened_at is null then
    update public.messages set snap = (snap - 'preview') || jsonb_build_object('gone', true) where id = old.message_id and snap is not null;
    perform public.snap_log(old.message_id, jsonb_build_object('type', coalesce(v_reason, 'deleted'), 'at', now()));
  elsif v_reason = 'deleted' then
    perform public.snap_log(old.message_id, jsonb_build_object('type', 'deleted', 'at', now()));
  end if;
  return old;
end;
$$;

revoke all on function public.snap_recipient_gone() from public, anon, authenticated;

notify pgrst, 'reload schema';

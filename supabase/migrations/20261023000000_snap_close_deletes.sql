-- =============================================================================
-- Migration 30: a Snap's file is deleted the moment its last recipient closes it. Safe to re-run.
--   Supabase's CDN keeps serving a file it has handed out to the same person, under any of their sessions, for about a
--   minute after the file is deleted (and until then for as long as the file exists, whatever the policies say now).
--   So the file must go as early as it can: close_snap() now deletes it (through the Storage API with pg_net, as
--   purge_snaps() does) as soon as everyone the Snap went to is done with it, instead of leaving it to the next purge,
--   up to ten minutes later. What is left is that the recipient who just watched it could fetch the same bytes once
--   more for up to a minute, with a tampered app; nobody else ever could (the CDN checks who is asking).
-- =============================================================================

-- Asks Storage to delete one Snap file now (queued first, so purge_snaps() checks it off, or asks again if this call
-- went nowhere). True when a request was sent; false without pg_net or the Vault secrets, where the purge job will
-- report what is missing.
create or replace function public.snap_delete_file(p_path text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  insert into public.snap_purges (path, queued_at) values (p_path, now()) on conflict (path) do nothing;
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'snaps_project_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'snaps_service_key';
  if v_url is null or v_key is null then
    return false;
  end if;
  -- A legacy service_role key is a JWT and goes in both headers; a new sb_secret_ key only as the apikey.
  perform net.http_delete(
    url := rtrim(v_url, '/') || '/storage/v1/object/snaps/' || p_path,
    headers := case
      when v_key like 'sb\_%' then jsonb_build_object('apikey', v_key)
      else jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key)
    end
  );
  update public.snap_purges set attempts = attempts + 1, last_attempt_at = now() where path = p_path;
  return true;
end;
$$;

-- Closing the Snap ends the view at once: from now on the file is out of reach for this recipient. When nobody it went
-- to can still view it (everyone opened it and closed it, or their two minutes passed), the Snap is over: its rows go
-- (the chats keep their "Opened" marks) and its file is deleted now.
create or replace function public.close_snap(p_snap_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_path text;
begin
  if v_me is null then
    return;
  end if;
  update public.snap_recipients
  set closed_at = now()
  where snap_id = p_snap_id and recipient_id = v_me and opened_at is not null and closed_at is null;
  if not found then
    return;
  end if;
  if exists (
    select 1 from public.snap_recipients r
    where r.snap_id = p_snap_id
      and (r.opened_at is null or (r.closed_at is null and r.opened_at > now() - interval '2 minutes'))
  ) then
    return;
  end if;
  delete from public.snaps s where s.id = p_snap_id returning s.media_path into v_path;
  if v_path is not null then
    perform public.snap_delete_file(v_path);
  end if;
end;
$$;

revoke all on function public.snap_delete_file(text) from public, anon, authenticated;
revoke all on function public.close_snap(uuid) from public, anon;
grant execute on function public.close_snap(uuid) to authenticated;

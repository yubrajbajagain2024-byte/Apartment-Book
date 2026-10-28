-- =============================================================================
-- UniBuzz - migration 51: a video's processing details come from the server only
-- Follows 20261107000100_business_ads.sql (migration 50), whose ads read a video's size and length from public.media.
-- Rollback: supabase/rollbacks/20261107000200_media_server_fields.down.sql. Safe to run more than once.
--  * public.media's processing state and the video provider's details (status, the upload and asset ids, playback id,
--    duration, width, height, aspect ratio, poster, error, size) are written by the website's server, which talks to
--    the provider with the service role: the provider's webhook and the status check behind /api/video/<id>. A signed-in
--    session's insert starts as 'uploading' with none of them, and its updates leave them as they are.
--  * 30 new videos a day per person (an upload starts with an insert from the uploader's session).
--  * A video is 10 minutes at most: whoever writes it, a ready video that is longer is stored as failed, with the
--    reason (the server also deletes it at the provider).
-- =============================================================================

create or replace function public.media_server_fields()
returns trigger
language plpgsql
as $$
begin
  -- The API's roles; the service role (the server), definer functions and the database owner are left alone.
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.status := 'uploading';
      new.provider_upload_id := null;
      new.provider_asset_id := null;
      new.playback_id := null;
      new.duration_seconds := null;
      new.width := null;
      new.height := null;
      new.aspect_ratio := null;
      new.poster_url := null;
      new.error := null;
      perform pg_advisory_xact_lock(hashtext('media_uploads:' || new.owner_id::text));
      if (select count(*) from public.media m where m.owner_id = new.owner_id and m.created_at > now() - interval '1 day') >= 30 then
        raise exception 'You have uploaded 30 videos today. Try again tomorrow.' using errcode = '42501', hint = 'RATE_LIMITED';
      end if;
    else
      new.owner_id := old.owner_id;
      new.kind := old.kind;
      new.provider := old.provider;
      new.status := old.status;
      new.provider_upload_id := old.provider_upload_id;
      new.provider_asset_id := old.provider_asset_id;
      new.playback_id := old.playback_id;
      new.duration_seconds := old.duration_seconds;
      new.width := old.width;
      new.height := old.height;
      new.aspect_ratio := old.aspect_ratio;
      new.poster_url := old.poster_url;
      new.error := old.error;
      new.size_bytes := old.size_bytes;
    end if;
  end if;
  if new.status = 'ready' and coalesce(new.duration_seconds, 0) > 600 then
    new.status := 'failed';
    new.error := 'Videos can be 10 minutes at most.';
  end if;
  return new;
end;
$$;

drop trigger if exists media_server_fields on public.media;
create trigger media_server_fields
  before insert or update on public.media
  for each row execute function public.media_server_fields();

revoke all on function public.media_server_fields() from public, anon, authenticated;

-- =============================================================================
-- Rollback of 20261107000200_media_server_fields.sql (a video's processing details come from the server only).
-- Run as one transaction. Removes the trigger and its function: public.media is written as before it ran. Rows stay as
-- they are (a video stored as failed for its length stays failed).
-- =============================================================================
drop trigger if exists media_server_fields on public.media;
drop function if exists public.media_server_fields();

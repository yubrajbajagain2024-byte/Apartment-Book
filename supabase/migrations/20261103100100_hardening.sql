-- =============================================================================
-- Migration 17: privilege hardening from the production-readiness audit (2026-10-25)
-- =============================================================================
-- 1. TRUNCATE is not governed by row-level security, and Supabase's default grants
--    give the API roles ALL privileges on new tables, TRUNCATE included. PostgREST
--    never issues TRUNCATE (the apps cannot either), so nothing changes for them;
--    this closes the door for good, for existing tables and for tables created later.
-- 2. delete_my_account() was callable by anon (it only ever raised "Not authenticated").
-- Safe to re-run.
-- =============================================================================
revoke truncate on all tables in schema public from public, anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
revoke execute on function public.delete_my_account() from anon;

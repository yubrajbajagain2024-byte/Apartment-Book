-- =============================================================================
-- Rollback of 20261114000000_console_business.sql (migration 62: the staff console's Analytics and Business sections).
-- Run in one transaction, then: delete from public._migrations where name = '20261114000000_console_business.sql';
--
-- It refuses while the team's notes about businesses or the rate card hold anything: they are the UniBuzz team's own
-- records and exist nowhere else. Export them first (select * from public.business_admin_notes; select * from
-- public.ad_rates), then delete them on purpose and run this again. The history of active students
-- (platform_activity_daily, numbers only) is dropped with it. Nothing else changes: payments, ads and audit rows the
-- console wrote stay, as Business v2's own functions would have written them.
-- =============================================================================

do $$
begin
  if to_regclass('public.business_admin_notes') is not null and exists (select 1 from public.business_admin_notes) then
    raise exception 'business_admin_notes holds the team''s notes: export them, delete them on purpose, then roll back';
  end if;
  if to_regclass('public.ad_rates') is not null and exists (select 1 from public.ad_rates) then
    raise exception 'ad_rates holds the rate card: export it, delete it on purpose, then roll back';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'platform-activity';
  end if;
end $$;

drop function if exists public.console_add_business_note(uuid, text);
drop function if exists public.console_business(uuid);
drop function if exists public.console_businesses(text, text, integer, integer);
drop function if exists public.console_business_overview();
drop function if exists public.console_payments(integer, text, text, integer, integer);
drop function if exists public.console_void_ad_payment(uuid, text);
drop function if exists public.console_record_ad_payment(uuid, integer, text, text, text);
drop function if exists public.console_update_ad_terms(uuid, bigint, bigint, integer, text);
drop function if exists public.console_create_ad(uuid, jsonb);
drop function if exists public.console_ad(uuid);
drop function if exists public.console_ads(text, text, uuid, integer, integer);
drop function if exists public.console_ad_row_json(uuid);
drop function if exists public.console_payment_json(uuid);
drop function if exists public.console_set_ad_rate(text, integer, integer);
drop function if exists public.console_ad_rates();
drop function if exists public.console_ad_quote(uuid);
drop function if exists public.console_analytics_revenue(integer);
drop function if exists public.console_recognized_cents(timestamptz, timestamptz);
drop function if exists public.console_analytics_ads(integer, uuid);
drop function if exists public.console_analytics_overview(integer, uuid);
drop function if exists public.platform_activity_snapshot(timestamptz);
drop function if exists public.console_campus_json(uuid);
drop function if exists public.console_audit(text, text, text, text, jsonb);
drop function if exists public.console_like(text);
drop function if exists public.console_days(integer);
drop function if exists public.console_day_series(date, date);
drop function if exists public.console_day_start(date);
drop function if exists public.console_tz();
drop function if exists public.console_require_business_admin();

drop table if exists public.platform_activity_daily;
drop table if exists public.business_admin_notes;
drop table if exists public.ad_rates;

notify pgrst, 'reload schema';

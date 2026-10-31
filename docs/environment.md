# Environment variables

The names the code reads. Values live in `apps/web/.env.local`, Vercel, EAS secrets, Supabase Edge
Function secrets or Supabase Vault; which `.env` files may be committed is in the root CLAUDE.md
(Security).

| Where | Names |
| --- | --- |
| Website | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BUSINESS_SITE_URL`, `NEXT_PUBLIC_MAP_TILE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only; the feed sync needs it too), `CRON_SECRET` (Vercel Cron's bearer token for `/api/events/sync`; the route answers 401 without it), `MODERATION_AI_API_KEY`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET` |
| Mobile app | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SITE_URL`, `EXPO_PUBLIC_BUSINESS_SITE_URL`, `EXPO_PUBLIC_CALLS_ENABLED`, `EXPO_PUBLIC_BUZZ_FIXTURES` (development only); at build time `CAMPCONNECT_BUNDLE_ID`, `CAMPCONNECT_FREE_SIGNING` |
| Edge Function `livekit-token` | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| CampConnect Admin (`apps/admin`) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (the admin app's own address), `NEXT_PUBLIC_MAIN_SITE_URL` (the website, for "open on site" links), `NEXT_PUBLIC_GOOGLE_LOGIN`, `SUPABASE_SERVICE_ROLE_KEY` (server only: invitation emails; Production only on Vercel, never Preview), `MEDIA_WORKER_ENABLED` (the media worker runs only when it is exactly `true` and the service key is set), `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `CRON_SECRET` (the worker's retry sweep; the same name the website uses for its own cron) |
| Scripts and tests | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`, `STAGING_SUPABASE_REF` (also points the e2e seed, cleanup and `scripts/e2e-home-feed.mjs` at staging), `SITE_URL`, `BUSINESS_SITE_URL`, `ADMIN_URL`, `SKIP_SEED`, `SKIP_MIGRATION`, `SKIP_ENV`, `SKIP_AUTH`, `DRY_RUN`, `ALLOW_OUT_OF_ORDER`, `ADMIN_OWNER_EMAIL` (`scripts/supabase-setup.mjs`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER`, `INVITE_LINK_HOURS` (`scripts/configure-auth-email.mjs`), `BACKUP_DIR`, `KEEP_DAYS`, `RESTORE_INTO_PRODUCTION` (`scripts/backup.mjs`), `ADMIN_PROJECT`, `MAIN_SITE_URL`, `VERCEL_BYPASS` (`scripts/deploy-admin.mjs`), `BASE` and `PLAYWRIGHT_CHANNEL` (website e2e), `ADMIN_E2E_EMAIL`, `ADMIN_E2E_PASSWORD`, `ADMIN_E2E_TOTP_SECRET`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `VERCEL_BYPASS` (`apps/admin/e2e/admin.mjs`), `SLOW_MS` (`apps/web/e2e/business-performance.mjs`, the time a navigation is called slow at; 600). On a network where Node's IPv6-first DNS drops connections to Supabase (`fetch failed`), run the staging scripts with `NODE_OPTIONS=--dns-result-order=ipv4first` |

**Supabase Vault** holds the project URL and the service key, which `purge_snaps()` uses and
`npm run db:setup` in token mode keeps there, and the Expo push access token (`expo_push_token`)
for `send_push()`, which is added by hand (`20261029000000_push.sql`).

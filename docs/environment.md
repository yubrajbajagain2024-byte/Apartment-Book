# Environment variables

The names the code reads. Values live in `apps/web/.env.local`, Vercel, EAS secrets, Supabase Edge
Function secrets or Supabase Vault; which `.env` files may be committed is in the root CLAUDE.md
(Security).

| Where | Names |
| --- | --- |
| Website | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BUSINESS_SITE_URL`, `NEXT_PUBLIC_MAP_TILE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only; the feed sync needs it too), `CRON_SECRET` (Vercel Cron's bearer token for `/api/events/sync`; the route answers 401 without it), `MODERATION_AI_API_KEY`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET` |
| Mobile app | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SITE_URL`, `EXPO_PUBLIC_BUSINESS_SITE_URL`, `EXPO_PUBLIC_CALLS_ENABLED`, `EXPO_PUBLIC_BUZZ_FIXTURES` (development only); at build time `CAMPCONNECT_BUNDLE_ID`, `CAMPCONNECT_FREE_SIGNING` |
| Edge Function `livekit-token` | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Scripts and tests | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`, `STAGING_SUPABASE_REF` (also points the e2e seed, cleanup and `scripts/e2e-home-feed.mjs` at staging), `SITE_URL`, `BUSINESS_SITE_URL`, `SKIP_SEED`, `SKIP_MIGRATION`, `SKIP_ENV`, `BACKUP_DIR`, `KEEP_DAYS`, `RESTORE_INTO_PRODUCTION` (`scripts/backup.mjs`), `BASE` and `PLAYWRIGHT_CHANNEL` (website e2e), `SLOW_MS` (`apps/web/e2e/business-performance.mjs`, the time a navigation is called slow at; 600) |
| `step-admin` only | `MEDIA_WORKER_ENABLED` (its `CRON_SECRET` is the same name the website now uses) |

**Supabase Vault** holds the project URL and the service key, which `purge_snaps()` uses and
`npm run db:setup` in token mode keeps there, and the Expo push access token (`expo_push_token`)
for `send_push()`, which is added by hand (`20261029000000_push.sql`).

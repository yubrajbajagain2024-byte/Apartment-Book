# Testing

Every suite, what it needs, and its latest result. Update a result when you run the suite, in that
work's PR or a docs-only PR (root CLAUDE.md, documentation rule 2). How to
write a database suite: [supabase/CLAUDE.md](../supabase/CLAUDE.md); app checks:
[apps/mobile/CLAUDE.md](../apps/mobile/CLAUDE.md).

| Suite | Command | Needs | Last result |
| --- | --- | --- | --- |
| `packages/shared` units (19 files) | `npm run test:shared` | Node ≥ 22.18 | ✅ 184/184, 2026-10-28 on `business-v2` with `main` (PR #50) merged in; 181 on `ankur/dev` at `89737e4` |
| `packages/moderation` units (6 files) | `npm run test:moderation` | nothing | ✅ 429/429, 2026-10-28 on `business-v2` with `main` merged in, and on `ankur/dev` at `89737e4` |
| Database: migrations, RLS, functions (41 suites, including the production rollout rehearsal) | `npm run db:test` | nothing (PGlite, ~5 min) | ✅ 41 suites, 1514 checks, 0 failures, 2026-10-28 on `business-v2` (after the staging rehearsal's fixes); 38 suites, 1419 checks on `ankur/dev` at `89737e4` |
| Typecheck + lint + build | `npm run check` | nothing | ✅ 6/6 tasks, 2026-10-28 on `business-v2` (after the staging rehearsal's fixes), and on `ankur/dev` at `89737e4`; not recorded on `main` |
| Live end-to-end (writes temporary users and data, then deletes them) | `npm run db:check` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, the owner's approval | not run 2026-10-27 |
| Schema diff against production | `node supabase/applied-outside-repo/verify.mjs --live` | `SUPABASE_ACCESS_TOKEN` (`SUPABASE_PROJECT_REF` for another project) | production: not run 2026-10-28; staging: ✅ matches production's model, 2026-10-28, before and after the release rehearsal |
| Website, desktop + phone | seed `node apps/mobile/e2e/sim-seed.mjs` (`STAGING_SUPABASE_REF` for staging), `npm run dev -w web -- -p 3060` (with that project's URL and keys in the environment), `BASE=http://localhost:3060 node apps/web/e2e/home-feed.mjs` | token + Playwright (`PLAYWRIGHT_CHANNEL=chrome` without Playwright's Chromium) | ⚠️ 15/17 on staging, 2026-10-28, the same in production's state and after the Business v2 release: the two Posts-tab steps wait for a "Liked by" row the seed does not produce |
| App in the iOS Simulator | `cd apps/mobile && e2e/run.sh e2e/flows/00-signed-out.yaml` | Maestro, seeded data | not run 2026-10-27 |
| Snap / call lifecycle on the live project | `node apps/mobile/e2e/snap-lifecycle.mjs`, `…/call-lifecycle.mjs` | `SUPABASE_ACCESS_TOKEN` | not run 2026-10-27 |
| Business portal on a real project | `node supabase/tests/staging/business-portal.mjs` | a staging project | ✅ 58/58 on staging, 2026-10-28, in production's state and after the Business v2 release |
| Business v2 release rehearsal on a real project | `node supabase/tests/staging/release-rehearsal.mjs <step>` (baseline, seed, check, apply, rollback, restore, cleanup) | `SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_REF` | ✅ 2026-10-28 on staging: checks 10/10 before, 25/25 after, 10/10 after the release's rollback (Buzz unchanged); applied under traffic (480 requests, 1 refused: a staffer's reply as 49 committed); restored to production's state |
| Every page of each role, on whatever database the site points at | `BASE=http://localhost:3060 node apps/web/e2e/release-smoke.mjs` (after the rehearsal's `seed`) | Playwright, the rehearsal's accounts | ✅ 46/46 on staging after the release, 2026-10-28; 40/46 in production's state and after the release's rollback (the 6 need 49 and 50); never a request to production |
| Home-feed backend on a real project | `node scripts/e2e-home-feed.mjs` (`STAGING_SUPABASE_REF` for staging) | `SUPABASE_ACCESS_TOKEN` | ⚠️ 10/13 on staging, 2026-10-28, before and after the release: its three Buzz steps predate Buzz v2 (photo path, `buzz_v2_vote` signature) |

Read apps/mobile/CLAUDE.md ("End-to-end checks") before running the seed or lifecycle scripts.

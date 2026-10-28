# Testing

Every suite, what it needs, and its latest result. Update a result when you run the suite, in that
work's PR or a docs-only PR (root CLAUDE.md, documentation rule 2). How to
write a database suite: [supabase/CLAUDE.md](../supabase/CLAUDE.md); app checks:
[apps/mobile/CLAUDE.md](../apps/mobile/CLAUDE.md).

| Suite | Command | Needs | Last result |
| --- | --- | --- | --- |
| `packages/shared` units (18 files) | `npm run test:shared` | Node ≥ 22.18 | ✅ 181/181, 2026-10-28 on `ankur/dev` at `89737e4` (`main` merged in; 172 on `business-v2` at `bb36a24`, now on `main`) |
| `packages/moderation` units (6 files) | `npm run test:moderation` | nothing | ✅ 429/429, 2026-10-28 on `ankur/dev` at `89737e4`; 428/428 at `d9fb4b1` and on `business-v2` at `bb36a24` |
| Database: migrations, RLS, functions (39 suites) | `npm run db:test` | nothing (PGlite, ~5 min) | ✅ 39 suites, 1498 checks, 0 failures, 2026-10-28 on `auto-hide-reports` (`main` at `188c918` plus migration 55; its new suite `report-auto-hide` has 79 checks). 38 suites, 1419 checks on `ankur/dev` at `89737e4` |
| Typecheck + lint + build | `npm run check` | nothing | ✅ 6/6 tasks, 2026-10-28 on `auto-hide-reports` and on `ankur/dev` at `89737e4`; 6/6 on `business-v2` at `bb36a24`; not recorded on `main` |
| Live end-to-end (writes temporary users and data, then deletes them) | `npm run db:check` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, the owner's approval | not run 2026-10-27 |
| Schema diff against production | `node supabase/applied-outside-repo/verify.mjs --live` | `SUPABASE_ACCESS_TOKEN` | not run 2026-10-27 |
| Website, desktop + phone | seed `node apps/mobile/e2e/sim-seed.mjs`, `npm run dev -w web -- -p 3060`, `BASE=http://localhost:3060 node apps/web/e2e/home-feed.mjs` | token + Playwright | not run 2026-10-27 |
| App in the iOS Simulator | `cd apps/mobile && e2e/run.sh e2e/flows/00-signed-out.yaml` | Maestro, seeded data | not run 2026-10-27 |
| Snap / call lifecycle on the live project | `node apps/mobile/e2e/snap-lifecycle.mjs`, `…/call-lifecycle.mjs` | `SUPABASE_ACCESS_TOKEN` | not run 2026-10-27 |
| Business portal on a real project | `node supabase/tests/staging/business-portal.mjs` | a staging project | not run 2026-10-27 |

Read apps/mobile/CLAUDE.md ("End-to-end checks") before running the seed or lifecycle scripts.

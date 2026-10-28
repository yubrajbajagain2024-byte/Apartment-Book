# Merging `step-admin` into `main`: plan and open questions

For whoever merges this branch (Sunil and the project owner). Nothing here has been done to `main` or production; this branch is pushed as a backup and for review. **Do not merge before the questions at the end are answered.**

## Where things stand (2026-10-25)

- `step-admin` branches from `03faf37`, before PRs #29 to #33. It adds the separate admin app **CampConnect Admin** (`apps/admin`), the admin queries in `packages/shared`, migrations 14 to 17, their tests, and launch tooling. The student website gains no admin pages (the `/admin` section that once lived in `apps/web` on this branch was removed again).
- **Production already runs all four admin migrations.** 14 and 15 were applied 2026-10-25 15:11 UTC (main keeps copies in `supabase/applied-outside-repo/`). 16 and 17 were applied 22:31 UTC after a dry run, as `20261103100000_admin_dashboard.sql` and `20261103100100_hardening.sql` (renamed so their versions follow main's newest and collide with nothing). `public._migrations` on production: main's 40, then these four names.
- **The admin app is deployed on its own**: Vercel project `campconnect-admin` (Root Directory `apps/admin`, not connected to Git, so pushes and merges do not deploy it; `npm run deploy:admin` does). It needs no change to `apps/web` and no website redeploy.
- `apps/web/vercel.json` on this branch only turns off Vercel builds of the branch `step-admin` itself. It affects no other branch; delete it in the merge or keep it.

## Migration order: the one real decision

On production the admin migrations ran **after** main's `20261029000000_push.sql` and **before** `20261030000000_profile_privacy.sql`, but on this branch 14 and 15 are named `20261023000000_admin.sql` and `20261024000000_moderation_support.sql`, which share versions with main's `snap_close_deletes` and `message_replies` and would sort far earlier on a fresh database.

`npm run db:live-order` (this branch) rebuilds `origin/main` with the four admin migrations at their production positions and runs every suite of both branches: **all 29 pass** (main's 24 and the 5 admin suites).

Recommended (main's own proposal in `supabase/applied-outside-repo/README.md`):

1. In the merge, rename the files to `supabase/migrations/20261029100000_admin.sql` and `supabase/migrations/20261029100100_moderation_support.sql`, and delete `supabase/applied-outside-repo/20261023000000_admin.sql` and `…/20261024000000_moderation_support.sql` (or keep the folder as history and point `verify.mjs` at the new names).
2. At the moment the merged `main` lands, and before anyone runs `npm run db:setup` from it, rename the two tracking rows on production (project owner's approval needed; one transaction):

   ```sql
   begin;
   update public._migrations set name = '20261029100000_admin.sql' where name = '20261023000000_admin.sql';
   update public._migrations set name = '20261029100100_moderation_support.sql' where name = '20261024000000_moderation_support.sql';
   commit;
   ```

   If the rows are not renamed, this branch's setup script refuses to run (it will not apply a pending migration that is older than the newest applied one), so a half-done rename cannot re-run 14 and 15 over production.
3. A dry run of `npm run db:setup` (with `DRY_RUN=1`) must then list nothing.
4. Supabase CLI history is still empty on production; reconcile it only after this (main's step 5), never with a real `supabase db push`.

Migration 38's moderation branch keeps working either way (it checks for the moderation schema).

## Textual conflicts (from `git merge-tree`, 12 files)

| File | Size | Resolution |
| --- | --- | --- |
| `packages/shared/src/types/database.ts` | 21 hunks | Take the union, or better regenerate from production (it now has every table and function of both branches), then keep the hand-written comments |
| `packages/shared/src/schemas/index.ts`, `constants.ts`, `queries/index.ts`, `types/models.ts` | 1 hunk each | Both sides appended at the end: keep both blocks |
| `packages/shared/src/queries/moderation.ts` | 2 hunks | Keep main's changes and this branch's staff check in `deleteMyAccount()` (staff need aal2; the only owner is refused before uploads are removed) |
| `scripts/supabase-setup.mjs` | 3 hunks | Keep main's Vault step and this branch's `DRY_RUN`, out-of-order guard, one transaction per migration, `sslmode=disable` for the rehearsal, `ADMIN_URL` and the admin app's env file |
| `package.json` | 1 hunk | Keep main's scripts and add `dev:admin`, `start:admin`, `deploy:admin`, `db:rehearse`, `db:live-order`, and the admin suites in `db:test` |
| `apps/web/src/lib/utils.ts` | 1 hunk | Keep main's version plus the hardened `safeNextPath()` (backslash and URL-parse checks) |
| `apps/web/src/components/messages/chat-window.tsx`, `apps/mobile/src/app/messages/[id].tsx` | 1 hunk each | Keep main's optimistic message and add `hidden_at: null, hidden_reason: null` (the live `messages` table has them since migration 15) |
| `README.md` | 5 hunks | Keep main's text; add this branch's "Admin app (CampConnect Admin)" section and drop its outdated `/admin` wording |

Not conflicting but to check: `supabase/tests/harness.mjs` merges cleanly; main's suites that add their own auth stand-ins (`reels-feed-like-counts.test.mjs`, `applied-outside-repo/verify.mjs`) must make them idempotent (`create table if not exists auth.mfa_factors`, `create or replace function auth.jwt()`, a guarded `create role service_role`), exactly as `supabase/tests/live-order-check.mjs` does. Regenerate `package-lock.json` with `npm install`.

## Business portal admin checks

A follow-up is handled separately (details with the owner).

## After the merge, before deploying anything

```bash
npm install && npm run check          # typecheck, lint, build: web, admin, mobile, shared
npm run db:test                       # every suite of both branches (add main's to the script)
DRY_RUN=1 SKIP_ENV=1 SKIP_SEED=1 SKIP_AUTH=1 SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=dskbzoqreandwwpxiplh npm run db:setup   # must list nothing
```

Then deploy the website as usual. Redeploy the admin app only if `apps/admin` or `packages/shared` changed (`npm run deploy:admin -- --apply`).

## Questions for Sunil

1. Are you happy with the names `20261029100000_admin.sql` / `20261029100100_moderation_support.sql` for 14 and 15, and `20261103100000` / `20261103100100` for 16 and 17 (already in production under those names)? Is anything of yours planned for `20261103…`?
2. Who renames the two production tracking rows, and when (with the merge, or before)?
3. Should `supabase/applied-outside-repo/` stay as provenance or go?
4. Should the business review screens move into the admin app?
5. `ankur/dev` has `trust_safety` and `buzz_v2` migrations covering the same ground as 15; is that branch still alive?
6. Who resolves the merge: you on `main`'s side, or a merge of `main` into `step-admin` here first?

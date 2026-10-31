# admin-analytics-business

- **Owner:** Yubraj. **As of 2026-10-31:** branched from `main` at PR #59 (`a637de6`); `main` merged in up to PR #75
  (2026-10-31); pushed, draft PR #60, **not to be merged before the launch plan below is approved**. Written by AI
  sessions.
- **Purpose:** the owner's brief: two new sections in **CampConnect Admin** (`apps/admin`, the separate staff app), for
  the UniBuzz team to run the whole advertising operation without opening the database. The student website and the
  mobile app are unchanged by the sections; nothing here is on production.
  - **Analytics:** platform growth, active and engaged students, engagement, ad delivery (impressions, reach, clicks),
    the review queue and revenue, with interactive charts, live refresh and CSV exports.
  - **Business:** advertisers (review, verification, suspension, accounts, internal notes), campaigns (review with the
    payment, drafting for a business, scheduling, budgets, pausing, performance), payments (further payments, voiding,
    the ledger), pricing (a rate card) and students' reports, with the business audit log.
- **History:** first built in the website's `/admin` console (commit `63f0083`); the owner then decided (2026-10-30)
  that it belongs in CampConnect Admin, off the student website, so the second commit moves it there and returns
  `apps/web` to `main`'s state exactly. On 2026-10-31 the migration was renamed from `20261112000000` to
  `20261114000000_console_business.sql` (informally 62), because `main` had meanwhile applied 58 to 60 to production
  under later names and file order is authoritative; nothing in it changed.

## What it does

How it works, page by page and function by function: docs/technical-reference.md, "CampConnect Admin: Analytics and
Business". In short: two sections for owners and admins of the staff (Analytics, Business) behind the app's two-factor
gate; migration 62 adds the `console_*` functions, three closed tables and the `platform-activity` pg_cron job, and
changes no existing object; the Business section reuses Business v2's review functions; before 62 is applied both
sections say they need it.

## CampConnect Admin brought to `main` (from `step-admin`)

`apps/admin` existed only on `step-admin`, whose merge plan waits on questions for the owner (docs/branches/step-admin.md).
- **Brought on 2026-10-30:** `apps/admin` as on `step-admin` at `36a69c4`; `scripts/deploy-admin.mjs`; the root scripts
  `dev:admin`, `start:admin`, `deploy:admin`; the shared admin queries, constants, schemas and types. Next.js 16.4.3 and
  React 19.3.0 as the website; CampConnect Admin's role type is `AdminStaffRole`, its `assignableRoles` is
  `assignableStaffRoles`; the Analytics and Business entries show to owners and admins only.
- **Reconciled on 2026-10-31** (commit `f532cf8`, by a fresh session reviewing all 32 remaining files): the setup
  script's safeguards (`DRY_RUN=1`, one transaction per migration, the out-of-order guard with `ALLOW_OUT_OF_ORDER=1`,
  `ADMIN_URL`, `SKIP_AUTH`, `ADMIN_OWNER_EMAIL`, env files that keep their other lines); `scripts/configure-auth-email.mjs`
  (`npm run auth:email`; explicit project ref and admin URL, writes only with `--apply`, secrets never printed); five
  PGlite suites adapted to `boot({ live: true })` and Buzz v2 (`admin`, `admin-dashboard`, `moderation-support`,
  `permissions-audit`, `launch-checklist`, in `db:test`); the harness grants default privileges on sequences as
  Supabase does; the README's "Admin app (CampConnect Admin)" section; on the website a suspended account's sign-in
  message and the account-deletion refusal shown in the form.
- **Left on `step-admin`:** its migration files (14 to 17 are byte-for-byte or comment-only equal to
  `supabase/applied-outside-repo/`; 18 is on production and in no repo folder) and `staff-invite-email.test.mjs`; the
  `hidden_at`/`hidden_reason` message types with their website and app hunks (one later change together); `no-admin.mjs`
  and the navbar change (the website keeps its `/admin` console); `live-order-check.mjs` and `staging-rehearsal.mjs`
  (superseded); `apps/web/vercel.json`; `turbo.json`'s env names. The merge plan's questions 1 to 3 and 5 are untouched.
- **Found on the way, for the owner:** on Buzz v2 a reply hidden by CampConnect Admin still counts toward its thread's
  hot rank (Buzz's own removals go through `buzz_v2_set_status`); an author keeps reading their own removed thread or
  reply, others get a placeholder (v2's rule, not migration 15's "gone for everyone"); `deleteMyAccount` in
  `packages/shared` still lacks the staff pre-check, so a staff member deleting from the website loses their uploads
  before the database refuses.

## Tests

Every result is in docs/testing.md (the suites' one home). In short, on this tree: `npm run db:test`,
`npm run test:shared` and `npm run check` (see that table for the counts of 2026-10-31); `console-business.test.mjs`
(95 checks, 62 on this repo's schema and production's); the rollout rehearsal applies and rolls back 62 with the
release. On **staging, 2026-10-30 22:20 to 2026-10-31 02:30 UTC**, with the admin and a moderator on the staff with
authenticators and every session passing the second factor: the rehearsal 11/11 before, the release and 62 applied
under traffic with 0 failed requests, 30/30 after, probe 46/46; the business-portal test 58/58; the website's smoke
63/63 pages (the staff console and the portal's admin pages behind the second factor); CampConnect Admin's browser
check 9/9 as the admin (all eleven Analytics and Business views) and 8/8 as a moderator (neither section). Rolled
back and restored on a staging another session was using at the same time (details in docs/testing.md).

Fixed by those runs: the admin app's browser check waited on URLs that Next 16.4 no longer changes while the Security
page renders (it now waits for page content); the staging scripts now sign admins in with a second factor
(`supabase/tests/staging/mfa.mjs`); the rehearsal's `apply` takes a file list, its `check` covers 62, its `cleanup`
reports the release's own tables separately; the smoke test covers the website's console. Not a code defect: the
Security page renders under the address of the page asked for after sign-in (Next 16.4; `step-admin` ran 16.3.4).

## Independent review, 2026-10-30

A fresh reviewer read the migration and the server actions (code only) and reproduced four findings offline; all
eight are fixed, each with a check in `console-business.test.mjs` where PGlite can show it: Buzz counted by
`visible_at` only; a payment's note kept out of the business's audit log; recorded payments never rewritten; a void
locks the ad; no per-row function in the counts; the pure helpers revoked from the API; a further payment refused in
another currency or for a suspended business or an ad whose promoted item is gone; every action checks the caller
before reading its input. Found sound: access control on every function and action, the `app.ad_transition` uses,
what the business can read, day boundaries and previous-range windows, the cron schedule, re-running and the rollback.

## Launch plan (each production step needs the owner's explicit approval)

**Order of migrations on production.** 44, 46 and 49 to 57 are pending, as docs/status.md says; 61 (Events) goes
alone first, as 58 to 60 did; then one `db:setup` run applies 44, 46, 49 to 57 and 62 in file order. 62 needs 49, 50
and 56 and nothing newer; it is not needed by anything. An unpushed migration on the owner's Mac (`admin-check-1028`,
to be renamed so it sorts after 62) goes live alone, by hand, whenever the owner decides; the staging run above
rehearsed it first and alone, then the release.

1. **Backup that restores** (production read; the owner runs it): `node scripts/backup.mjs before-migration-62 --full`
   (`main`'s tool since PR #72; its restore, `scripts/restore.mjs`, was rehearsed on staging on 2026-10-30, 5/5). Keep
   the row counts it prints. Supabase's own backups need the Pro plan (production is on Free).
2. **Dry run:** `DRY_RUN=1 SUPABASE_DB_URL=… npm run db:setup` must list exactly 44, 46, 49 to 57 and 62 (61 once it
   is live is not listed) and warn that 44 and 46 are out of order.
3. **Apply:** `ALLOW_OUT_OF_ORDER=1 SUPABASE_DB_URL=… npm run db:setup`, then `verify.mjs --live` (the known 20
   differences of migration 18 aside) and `npm run db:check`'s read-only parts. Record 62 in docs/migrations.md.
4. **Roles:** `select public.grant_role('<user id>', 'admin')` for each staff owner or admin who runs businesses (the
   Business section needs the admin role on top of the staff role; Analytics does not).
5. **Merge PR #60.** Merging deploys the website: this branch changes two website messages (a suspended account's
   sign-in, the account-deletion refusal) and nothing a student sees otherwise; `apps/mobile` is untouched.
6. **Deploy the admin app:** `npm run deploy:admin` from the merged `main` (the project is not connected to Git), or,
   if the Vercel plan below is approved first, the merge deploys it.
7. **Smoke on production, read-only:** the admin app's signed-out gates (`BASE=https://campconnect-admin.vercel.app
   node apps/admin/e2e/admin.mjs` without accounts), then an owner signs in and opens Analytics and Business.
8. **Rollback, if needed:** 62 first (its rollback refuses while `business_admin_notes` has rows: export the notes,
   delete them on purpose, then run `rollbacks/20261114000000_console_business.down.sql` with its `_migrations`
   delete), then 57, 56, 55, 50, 49 as docs/status.md says. 62's rollback drops nothing of Business v2's.

**Vercel plan for `apps/admin` (nothing changed; read-only inspection of 2026-10-30).** Two projects in team `vyass`:
`apartment-book` (the website, root `apps/web`, connected to Git, every push to `main` deploys) and
`campconnect-admin` (root `apps/admin`, Next.js preset, Node 24, **not connected to Git**, deployed three times by hand
with `scripts/deploy-admin.mjs`, last on 2026-10-26). Its environment already separates the secret:
`SUPABASE_SERVICE_ROLE_KEY` is a Sensitive variable for **Production only**; `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_MAIN_SITE_URL` and `NEXT_PUBLIC_GOOGLE_LOGIN` are Production and
Preview; no Mux, worker or cron variable (the media worker stays off). The website's project is the same shape (its
service key and Mux secrets Production only; the anon key and URL also for Preview). Proposed, for the owner to apply
in the Vercel dashboard (none of it can be done from here without changing live settings):
1. Connect `campconnect-admin` to `yubrajbajagain2024-byte/UniBuzz` (Settings › Git), production branch `main`, root
   directory `apps/admin` (already set), so an approved merge deploys the admin app the way it deploys the website.
2. Ignored Build Step (Settings › Git): `git diff --quiet HEAD^ HEAD -- apps/admin packages/shared package.json
   package-lock.json`, so pushes that touch only the website or the app do not rebuild the admin app.
3. Previews: keep only the four public variables (the service key stays Production only, so a preview can never send
   invitation emails or run the worker); Deployment Protection "Vercel Authentication" on previews, so a preview of
   the staff app opens for team members only; production stays open (staff sign in themselves). Set a "Protection
   Bypass for Automation" secret and pass it as `VERCEL_BYPASS` to `apps/admin/e2e/admin.mjs` when checking a preview.
4. Keep `NEXT_PUBLIC_SITE_URL` unset on the project (`getSiteUrl()` uses `VERCEL_PROJECT_PRODUCTION_URL`) and add the
   production URL's `/auth/callback` and `/auth/confirm` to Supabase's redirect list if they are not there.
5. Once connected: the root CLAUDE.md's rule that merging deploys applies to the admin app too (62 must be live before
   the merge, as the website's rule already says), and `scripts/deploy-admin.mjs` becomes the manual fallback.
The website project and the mobile app are not touched by any of this.

## Launch checklist (what is ready, what remains, what needs approval)

| Item | State |
| --- | --- |
| Analytics and Business in CampConnect Admin, offline tests, independent review | ready |
| Staging: the release with 62 under traffic, its console through the API and in the admin app with two-factor sign-in, the website's pages and console, the portal test | ready (2026-10-30/31) |
| `step-admin` reconciled with `main` outside its migrations | ready (commit `f532cf8`); the owner's questions 1 to 3 and 5 remain |
| `main` merged in (PRs #61 to #75; the migration renamed to 62) | ready |
| Review of PR #60 by the owner (and Sunil for the shared package) | **needs the owner** |
| Production backup (`scripts/backup.mjs --full`), the dry run, the migrations, `grant_role`, the merge, the admin deploy | **each needs the owner's approval**; steps 1 to 8 above |
| The Vercel Git connection for `campconnect-admin` | **needs the owner** (plan above); until then `npm run deploy:admin` |
| The unpushed migration on the owner's Mac (`admin-check-1028`): rename so it sorts after 62, apply alone, then push | **needs the owner** |
| Events (61) alone first | Sunil's branch; on staging since 2026-10-31, not on production |

## Pending, in priority order

1. The owner's review of PR #60 and approval of the launch plan.
2. Staging again, once staging is free of the other session's run: the rehearsal's `rollback` after `cleanup` (its
   order; the console's guard), and row counts compared at the end (not possible on 2026-10-31).
3. By hand on staging in the admin app, the writes the browser check does not make: approve the rehearsal's ad with
   its payment, reschedule it, record and void a further payment, set a rate, add a note, draft a campaign for the
   business and submit it from the portal (the functions behind them are covered offline and the console reads through
   the API on staging).
4. Later, if wanted: retire the portal's `/business/admin` pages in favour of CampConnect Admin; Reels video measured
   at Mux before approval in the admin app (it needs a service key there); partial refunds; a payment provider.

## Risks

- **Active students are lower bounds:** only students who show their activity status leave a time to count; engaged
  students (from what they wrote) are the fuller measure. History of active students starts when 62 is applied.
- **Full scans:** the analytics count rows by `created_at` in tables without an index on it (messages, likes,
  comments). Fine at today's size and only on an admin's request; add indexes if the page grows slow.
- **A void restates earned revenue:** a voided payment earns nothing for any day (a void is a full refund; partial
  refunds do not exist yet).
- **Staging is shared:** another session's migrations and rows can appear during a rehearsal (they did on 2026-10-31);
  the scripts now say so, and a run must remove only its own rows.

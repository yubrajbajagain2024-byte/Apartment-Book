# admin-analytics-business

- **Owner:** Yubraj. **As of 2026-10-30:** branched from `main` at PR #59 (`a637de6`); pushed, draft PR #60, **not to be
  merged before the pending items below**. Written by an AI session.
- **Purpose:** the owner's brief: two new sections in **CampConnect Admin** (`apps/admin`, the separate staff app), for
  the UniBuzz team to run the whole advertising operation without opening the database. The student website and the
  mobile app are unchanged; nothing here is on production.
  - **Analytics:** platform growth, active and engaged students, engagement, ad delivery (impressions, reach, clicks),
    the review queue and revenue, with interactive charts, live refresh and CSV exports.
  - **Business:** advertisers (review, verification, suspension, accounts, internal notes), campaigns (review with the
    payment, drafting for a business, scheduling, budgets, pausing, performance), payments (further payments, voiding,
    the ledger), pricing (a rate card) and students' reports, with the business audit log.
- **History:** first built in the website's `/admin` console (commit `63f0083`); the owner then decided (2026-10-30)
  that it belongs in CampConnect Admin, off the student website, so the second commit moves it there and returns
  `apps/web` to `main`'s state exactly.

## What it does

How it works, page by page and function by function: docs/technical-reference.md, "CampConnect Admin: Analytics and
Business". In short: two sections for owners and admins of the staff (Analytics, Business) behind the app's two-factor
gate; migration 59 (`20261112000000_console_business.sql`) adds the `console_*` functions, three closed tables and the
`platform-activity` pg_cron job, and changes no existing object; the Business section reuses Business v2's review
functions; before 59 is applied both sections say they need it.

## CampConnect Admin brought to `main` (from `step-admin`, without its migrations)

`apps/admin` existed only on `step-admin` (16 commits ahead of where it branched, 146 behind `main`), whose merge plan
waits on questions for Sunil (docs/branches/step-admin.md). To put the two sections there without deciding those, this
branch brings over **the app and the shared code it needs, and nothing that touches the database's history**:
- **Brought:** `apps/admin` as on `step-admin` at `36a69c4`; `scripts/deploy-admin.mjs`; the root scripts `dev:admin`,
  `start:admin`, `deploy:admin`; the shared admin queries (`queries/admin.ts`, `admin-moderation.ts`,
  `admin-dashboard.ts`), constants, schemas and types, and the types of CampConnect Admin's tables and functions.
- **Changed on the way:** Next.js 16.4.3 and React 19.3.0, as the website; CampConnect Admin's role type is
  `AdminStaffRole` and its `assignableRoles` is `assignableStaffRoles` (`main` already exports a `StaffRole` and an
  `assignableRoles` with other meanings); the Analytics and Business entries in the navigation show to owners and
  admins only.
- **Left on `step-admin`, for its merge:** its migration files (production has 14 to 18; `main` keeps 14 to 17 in
  `supabase/applied-outside-repo/` as before, 18 is in neither); its PGlite suites; `supabase-setup.mjs`'s safeguards
  (`DRY_RUN`, the out-of-order guard, `ADMIN_URL`); its website changes (no admin links, the staff check before deleting
  an account, `safeNextPath`), and the `hidden_at`/`hidden_reason` column types that need a matching website change;
  `scripts/configure-auth-email.mjs`; the README's "Admin app" section (it says the website has no admin pages, which
  is not `main`'s state).
- **What the merge plan's questions become:** 4 (business screens in the admin app) is answered: yes. 1 to 3 and 5
  (migration names, the production `_migrations` rows, `applied-outside-repo/`, `ankur/dev`) are untouched: nothing
  here renames or moves a migration. 6 (who merges) is half done: the app is on `main`'s side; the rest still waits.
- **Not reconciled:** the website's own `/admin` Trust & Safety console (from PR #37) stays as it is; it and the admin
  app keep separate audit logs (`audit_log`, `staff_audit_log`).

## Tests run on this tree, 2026-10-30

| Suite | Result |
| --- | --- |
| `npm run db:test` | ✅ 43 suites, 1661 checks, 0 failures (new: `console-business.test.mjs`, 95 checks, on this repo's schema and production's; `production-rollout.test.mjs` applies and rolls back 59 with the release) |
| `npm run test:shared` | ✅ 219/219 (new: `ad-ops.test.mjs`) |
| `npm run check` | ✅ 9/9 tasks: typecheck, lint and build of the website, CampConnect Admin, the app and the shared package |
| The new components in a browser | sample data through the real components, desktop and phone, in Chrome (throwaway pages, not committed), in the website before the move and in the admin app after it: no browser errors; fixed a clipped chart label, a grid that could widen phone pages, and a screen-reader label that widened phone pages from inside a scrolling table |
| `apps/admin/e2e/admin.mjs` (extended: every view of both sections, shown to owners and admins only) | **not run**: it needs the admin app running against a project with a staff account and its authenticator key |
| Against staging, signed in as staff with a second factor | **not run**: no staging credentials on this machine |

## Independent review, 2026-10-30

A fresh reviewer read the migration and the server actions (code only) and reproduced four findings offline; all
eight are fixed, each with a check in `console-business.test.mjs` where PGlite can show it:
- Buzz was counted by its real write time, so a live count could date a buzz inside its publication delay: now by
  `visible_at`, only once visible and active.
- The note on a further payment reached the business through its audit log: now in the team's own audit log only.
- Rescheduling rewrote recorded payments' periods, changing revenue already reported: payments are never rewritten;
  a further payment covers the rest of the ad from the day it is recorded.
- Voiding did not lock the ad, so two voids (or a void and a payment) at once could miss each other: the ad is locked
  first, in the same order as further payments (not reproducible in PGlite, one connection).
- A per-row function made the counts slow: replaced by subqueries the planner joins (checked with `explain`).
- The pure helpers (`console_day_series` and four more) were callable signed out: revoked.
- A further payment could be in another currency, or for a suspended business or an ad whose promoted item is gone:
  refused.
- Some server actions read their input before checking the caller: every action checks first.

Found sound: access control on every function and action, the `app.ad_transition` uses, what the business can read,
day boundaries and the previous-range windows, the cron schedule, re-running and the rollback.

## Pending, in priority order

1. **Review of the `step-admin` port** by the owner and Sunil (it is the app half of `step-admin`'s merge), and the
   rest of that merge as its plan says (the items "Left on `step-admin`" above).
2. **Staging, as a staff owner or admin signed in with a second factor** (needs `SUPABASE_ACCESS_TOKEN` and
   `STAGING_SUPABASE_REF`; staging is not production):
   1. Bring staging to the release's state: `release-rehearsal.mjs` `baseline`, `seed`, `apply` (49 to 57 and 59), then
      the other pending migrations in the order the owner's release plan sets.
   2. On staging, a staff owner or admin with the admin role and an authenticator (set up at `/security` in the admin
      app pointed at staging; keep its base32 key for the script).
   3. `npm run dev:admin` with staging's URL and anon key, then
      `ADMIN_E2E_EMAIL=… ADMIN_E2E_PASSWORD=… ADMIN_E2E_TOTP_SECRET=… BASE=http://localhost:3001 node apps/admin/e2e/admin.mjs`.
   4. By hand on staging, the writes the script does not make: approve the rehearsal's ad with its payment (the rate
      card's price filled in), reschedule it, record and void a further payment, set a rate, add a note, draft a
      campaign for the business and submit it from the portal; then the release's rollback and restore.
3. **Production, each step with the owner's approval:** apply 59 with the Business v2 release (after 49 to 57, and the
   release's rollback undoes it first); `grant_role(<id>, 'admin')` for each staff admin who runs businesses; merge;
   then `npm run deploy:admin` (the admin app's own Vercel project; merging deploys only the website, which this branch
   leaves as `main` has it).
4. Later, if wanted: retire the portal's `/business/admin` pages in favour of CampConnect Admin; Reels video measured
   at Mux before approval in the admin app (it needs a service key there); partial refunds; a payment provider.

## Risks

- **Active students are lower bounds:** only students who show their activity status leave a time to count; engaged
  students (from what they wrote) are the fuller measure. History of active students starts when 59 is applied.
- **Full scans:** the analytics count rows by `created_at` in tables without an index on it (messages, likes,
  comments). Fine at today's size and only on an admin's request; add indexes if the page grows slow.
- **A void restates earned revenue:** a voided payment earns nothing for any day (a void is a full refund; partial
  refunds do not exist yet).

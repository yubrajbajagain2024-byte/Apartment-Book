# admin-analytics-business

- **Owner:** Yubraj. **As of 2026-10-30:** branched from `main` at PR #59 (`a637de6`); pushed with a draft PR, **not to
  be merged as it is**: the owner decided (2026-10-30) that before production the two tabs move into CampConnect Admin,
  the separate staff app (`apps/admin`, on `step-admin`), and off the student website. Written by an AI session.
- **Purpose:** the owner's brief: two new sections in the CampConnect Admin console (the website's `/admin`), for the
  UniBuzz team to run the whole advertising operation without opening the database.
  - **Analytics:** platform growth, active and engaged students, engagement, ad delivery (impressions, reach, clicks),
    the review queue and revenue, with interactive charts, live refresh and CSV exports.
  - **Business:** advertisers (review, verification, suspension, accounts, internal notes), campaigns (review with the
    payment, drafting for a business, scheduling, budgets, pausing, performance), payments (further payments, voiding,
    the ledger), pricing (a rate card) and students' reports, with the business audit log.
- The student website and the mobile app are unchanged; nothing here is on production.

## What it does

How it works, page by page and function by function: docs/technical-reference.md, "Staff console: Analytics and
Business". In short: two admin-only tabs of `/admin`; migration 59 (`20261112000000_console_business.sql`) adds the
`console_*` functions, three closed tables and the `platform-activity` pg_cron job, and changes no existing object; the
Business section reuses Business v2's review functions; before 59 is applied both sections say they need it.

## Tests run on this tree, 2026-10-30

| Suite | Result |
| --- | --- |
| `npm run db:test` | ✅ 43 suites, 1660 checks, 0 failures, after the independent review's fixes (new: `console-business.test.mjs`, 94 checks; `production-rollout.test.mjs` now applies and rolls back 59 with the release) |
| `npm run test:shared` | ✅ 219/219 (new: `ad-ops.test.mjs`) |
| `npm run check` | ✅ 6/6 |
| The new pages in a browser | sample data through the real components, desktop and phone, in Chrome (a throwaway page, not committed): no browser errors; fixed a clipped chart label and a grid that could widen phone pages |
| Against a real project (staging), signed in as staff | **not run**: no staging credentials on this machine, and no e2e script signs staff in with a second factor yet |

## Independent review, 2026-10-30

A fresh reviewer read the migration and the server actions (code only) and reproduced four findings offline; all
eight are fixed, each with a check in `console-business.test.mjs` where PGlite can show it:
- Buzz was counted by its real write time, so a live count could date a buzz inside its publication delay: now by
  `visible_at`, only once visible and active.
- The note on a further payment reached the business through its audit log: now in the staff console's log only.
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

1. **Move the two tabs into CampConnect Admin (`apps/admin`)** and take them off the website (owner's decision,
   2026-10-30). `apps/admin` exists only on `step-admin`, which is not merged (its merge plan's open questions,
   docs/branches/step-admin.md). The migration, the shared helpers and the tests here stay as they are; the pages, the
   components and the server actions move.
2. **Apply 59 with the Business v2 release**, after 49 to 57 and in step with the other pending admin migration
   (owner's approval; docs/status.md, "Order of release"). Then grant `grant_role(<id>, 'admin')` to each staff admin
   who runs businesses, if they do not have it.
3. **On staging, as a staff admin signed in with a second factor:** apply the release with 59 and click through every
   page. That needs a staff account with a TOTP factor in the rehearsal's seed and a smoke script that signs in with it
   (neither exists yet), and the staging credentials.
4. Later, if wanted: retire the portal's `/business/admin` pages in favour of the console; partial refunds (a payment
   is in force or voided, nothing in between); a payment provider.

## Risks

- **Active students are lower bounds:** only students who show their activity status leave a time to count; engaged
  students (from what they wrote) are the fuller measure. History of active students starts when 59 is applied.
- **Full scans:** the analytics count rows by `created_at` in tables without an index on it (messages, likes,
  comments). Fine at today's size and only on an admin's request; add indexes if the page grows slow.
- **A void restates earned revenue:** a voided payment earns nothing for any day (a void is a full refund; partial
  refunds do not exist yet).

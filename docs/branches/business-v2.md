# business-v2

- **Owner:** Sunil. **As of 2026-10-28:**
  - The first round (four commits of work plus docs, up to `575587a`) was **merged into `main` as
    PR #49 on 2026-10-28 at 04:07 UTC**, before migrations 49 and 50 reached production. See
    docs/status.md for what that means and the two ways out.
  - The second round is on this branch for a new PR: migrations 55 and 56, the video routes, and
    fixes from an independent review. `main` (PR #50, Buzz) is merged in. 55 and 56 were 51 and 52
    until 2026-10-28, and this branch's earlier commit messages still call them that
    (docs/migrations.md, "Numbering quirk").
  - Written by an AI session.
- **Purpose:** UniBuzz Business v2: upgrade the v1 portal (migration 39) to the business spec without
  rebuilding it.
  - Team roles.
  - Business posts.
  - An Ads Manager with admin review and recorded payment.
  - Sponsored ads in For You, Reels and Housing.
  - Public business profiles.
  - Analytics from real events.
  - Notifications, an audit log, rate limits and Fair Housing screening.
  - An Apple-style restyle of the portal with light and dark modes.

## Migrations (none is on production)

| # | File | What |
| --- | --- | --- |
| 49 | `20261107000000_business_teams.sql` (+ rollback) | Team roles, the business audit log, notifications of type `business`. Details below. |
| 50 | `20261107000100_business_ads.sql` (+ rollback) | Posts, ads, serving, events, Fair Housing, the v1 data migration. Details below. |
| 55 | `20261109000000_media_server_fields.sql` (+ rollback) | A video's processing details (status, the provider's ids, size, length, poster) are written by the server only; 30 new videos a day per person; a ready video is 10 minutes at most. |
| 56 | `20261109000100_business_hardening.sql` (+ rollback) | The independent review's fixes (above). |

**49, `business_teams`:**
- **Roles:** owner, admin, editor and analyst replace owner and staff; every staff member becomes an editor.
- **One permission check:** `business_can()` decides what each role may do, for every policy and function.
- **Inquiry chats:** analysts are kept out of them.
- **Audit log:** `business_audit_log`, append-only.
- **Notifications:** type `business`, for reviews and role changes.
- **Rate limit:** 30 invites a day.

**50, `business_ads`:**
- **Posts:**
  - `deals` now holds every post.
  - Kinds: update, product, service, deal, event, promotion.
  - Up to 10 photos or one video, a price and an event time.
- **Ads table:** `ads`, with its statuses: draft, pending review, scheduled, active, paused, completed, rejected.
- **Placement rules:** housing ads run in Housing only; Reels needs one vertical video.
- **Fair Housing:** `fair_housing_flags()`.
- **Review and payment:** admin review records the payment in `listing_promotions` (now the payment ledger, `ad_id`).
- **Start and stop on time:** `ads_sweep()`, scheduled with pg_cron every 5 minutes where it is installed.
- **Serving:** `ads_for_feed()` picks by campus only.
- **Students:** hide, save, report (`business_reports`) and block (`business_blocks`).
- **Events and analytics:** `business_events` and three functions that aggregate them.
- **Inquiries:** students can also message a business from its profile or an ad; 15 new business chats an hour.
- **Category:** `startup`.
- **Notifications:** type `ad`.
- **v1 data:** every v1 promotion becomes an ad, its payment linked.

**Release order:**
- The timestamps are later than every migration on `main` and on the other branches (55 and 56
  were renamed on 2026-10-28 to stay so, after PR #50's Buzz migrations 51 to 54).
- After the follow-up PR is merged, one `SUPABASE_DB_URL=… npm run db:setup` run from `main`, after
  a backup, applies 44, 46, 47 and 49 to 56 in file order (supabase/CLAUDE.md, docs/migrations.md).
- Then `notify pgrst, 'reload schema'` and `verify.mjs --live`.

**Compatibility with v1 clients:**
- **v1 portal calls still work:**
  - `business_invite_create(text)`;
  - `admin_record_promotion` and `admin_cancel_promotion`, now on top of ads;
  - `admin_list_promotions`.
- **Read by the app in testers' hands, unchanged:** `listing_sponsored` and `deal_sponsored`.

**Data:**
- A v1 promotion with no end date would wait in review, flagged with `needs_review_reason`.
- None can exist, because v1 required an end date.

## Done (all on this branch, uncommitted)

### Database
- The two migrations above, with rollbacks generated from verbatim copies of the replaced functions.
- `supabase/tests/business-teams.test.mjs` covers:
  - the role matrix;
  - invites and roles;
  - analysts kept out of chats;
  - the audit log;
  - the v1 staff-to-editor migration;
  - the rollbacks.
- `supabase/tests/business-ads.test.mjs` covers:
  - the v1 promotions migration;
  - posts, drafts and placements;
  - the Fair Housing screen;
  - submission and review;
  - the sweep and serving;
  - hide, report and block;
  - events and analytics;
  - rate limits;
  - the rollback's refusal.
- Both suites are registered in `db:test`.
- `business-portal.test.mjs` (v1) changed in two ways:
  - Its "re-runs cleanly" check now runs on a database booted up to migration 39. Re-running 39 over later
    migrations brought back the functions migration 49 replaces.
  - One assertion now expects an editor where it expected staff.
  - Every v1 rule still passes on the new schema.

### Shared package
- Types, schemas, constants and queries.
- Pure helpers in `business.ts`: role rules, ad status, placements, `interleaveAds` (one ad per `ADS_EVERY` = 9) and
  `adDestination`.
- Unit tests in `packages/shared/tests/business-ads.test.mjs`.

### Portal (`/business`)
- **Design system:** colour tokens scoped to `[data-surface="business"]`.
  - Light and dark, with a theme switch whose cookie is `biz-theme`.
  - SF Pro, with Inter as the fallback; one accent.
  - Frosted glass on the bars only; the shared components remapped in dark mode.
- **Restyled:** nav, dashboard, posts (v1 deals, still at `/deals`), team (roles), profile, inbox index and auth layout.
- **New pages:**
  - Ads Manager: list, editor with a live preview, the ad's page with its checklist and actions.
  - Analytics, with a chart and a table view.
  - Notifications.
  - Admin: an ads queue that records the payment and the Fair Housing check, students' reports, the audit log.
- **Loading, error and not-found** states for the whole portal.
- **Reels ad approval:** the server action asks Mux for the video's size before approving.

### Student website
- `/businesses/[id]`, the public profile.
- Sponsored cards in For You, Reels and Housing, with hide, report, block, save and "Why am I seeing this?".
- Impression, click, save, profile-visit and inquiry events.
- Business names link to their profile.
- Reels shows a business's tours under the business.
- The Deals page lists offers only.

### Mobile app
- `app/businesses/[id].tsx`, the public profile.
- Sponsored cards in For You and Housing, with impressions counted through the lists' viewability.
- Reels: a business's tours show the business, and Message opens the inquiry chat. Before, it tried a direct chat that
  the database refuses.
- The inquiry chat's info screen shows the business, and block and report act on the business, not one staff member.
- Housing cards and the listing page open the business's profile.

## Second round (2026-10-28, for a new PR)

- **Migration 55** and the website's video routes:
  - The upload route checks a declared size and writes Mux's upload id with the service role.
  - The status check writes with the service role and refuses videos over 10 minutes (deleting them
    at Mux).
  - The Mux webhook accepts only signatures made in the last 5 minutes, checks every signature in
    constant time, applies the same length limit, and reads an upload event's asset id from
    `asset_id`.
  - `lib/supabase/admin.ts` is the server-only service-role client.
- **App:** measures a video's size when the picker does not report it.
- **Release order for 55:** the code first, then the migration. With the old code, a session's
  writes of an upload's progress would be ignored and new uploads would stay "processing".
- **Display:** prices no longer show as "$0" on a database without migration 50.
- **Tests:**
  - `media-server-fields.test.mjs`.
  - `production-rollout.test.mjs`: on production's state it applies 44, 46, 47 and 49 to 56 in
    order (Buzz's 51 to 54 too, since `db:setup` applies them in the same run), rolls them back in
    reverse, and applies them again.
  - The harness's `boot({ skip })`.
  - `packages/shared/tests/video-security.test.mjs`.
  - `home-feed.test.mjs`'s fixture now has the server finish its test videos.
- **Independent review** of migrations 49 and 50 and the Business v2 code (database, website and
  app), 2026-10-28. Its findings are fixed in migration 56 (`20261109000100_business_hardening.sql`)
  and in the code.
  - An approved ad shows the reviewed copy of what it promotes. It pauses for the UniBuzz team when
    that changes, or when the business's category changes.
  - Every ad's words are screened for Fair Housing. Video ads are approved only with 55's guard in
    place.
  - Ad photos must be uploads to this project's storage. Both apps load business images only from
    there (the website through next/image).
  - A business sees a chat, and the student in it, once the student has written. Blocks stop chats
    both ways.
  - Dates come from the server. The foreign-key exception and the payment ledger hold, and events
    count once and only for the targeted campus.
  - Saved ads respect takedowns. The reviewer stays unnamed to the business, and the audit log folds
    repeated edits.
  - Links that are not http(s) are dropped, and the app opens only http(s).
  - The Reels video re-check reads the video with the service role. Unknown ad commands are refused,
    and `safeNextPath` refuses `//`.
  - Business profile links are copied rather than opened. Mute works in business chats on the app.
  - In the app's Reels, Message tries the inquiry first.
  - The rollbacks: 49's removes analysts instead of making them staff; 50's cancels payments of ads
    that were not running.
  - Accepted, low: the ads row still carries the reviewing admin's profile id (no name, and the
    profile is not readable by a business session). Impressions are reported by the student's
    client: at most one an hour per ad per student.
  - Tests:
    - `business-hardening.test.mjs`: one check per finding, plus 56's rollback.
    - The v1 suite expects an ad paused for review after its promoted listing was edited.
    - `business-ads.test.mjs` uses real storage uploads.

## Tests run on this tree, 2026-10-28 (second round, `main` with PR #50 merged in)

| Suite | Result |
| --- | --- |
| `npm run db:test` | ✅ 41 suites, 1514 checks, 0 failures after the staging rehearsal's fixes (1497 before; new: `media-server-fields`, `business-hardening`, `production-rollout`, which also rolls back the release alone and compares Buzz) |
| `npm run test:shared` | ✅ 184/184 |
| `npm run check` (typecheck, lint, build; 6 tasks) | ✅ 6/6 |
| `npm run test:moderation` | ✅ 429/429 |
| Staging (release rehearsal, every page of each role, website and API e2e, v1 portal script) | see "Staging rehearsal, 2026-10-28" below |
| App Maestro flows | not run (the app's flows stay a manual check before `eas update`, by the owner's choice) |

## Tests run on this tree, 2026-10-27 (first round)

| Suite | Result |
| --- | --- |
| `npm run db:test` | ✅ 34 suites (32 existing + 2 new), 1379 checks, 0 failures |
| `npm run test:shared` | ✅ 172/172 (15 new) |
| `npm run check` (typecheck, lint, build; 6 tasks) | ✅ 6/6, on the final tree |
| `npm run test:moderation` | ✅ 428/428 (untouched by this branch) |
| Website e2e, app Maestro flows, staging business script | not run (they need seeded data or a live project) |

## Staging rehearsal, 2026-10-28 (third round)

The release ran on `campconnect-staging` through the real stack (Auth sessions, the REST API, Storage, pg_cron), with
`supabase/tests/staging/release-rehearsal.mjs` (steps: baseline, seed, check, apply, rollback, restore, cleanup) and
the website pointed at staging (`apps/web/e2e/release-smoke.mjs`, every page of each role). Nothing ran on production.

- **Staging caught up to production's state first** (owner's approval, kept): 41, 42, 45 and the two admin migrations
  from `supabase/applied-outside-repo/`, in production's order. `verify.mjs --live` against staging then matched the
  offline model of production exactly (430 functions, 644 columns, 347 constraints, 120 triggers, 114 policies).
- **A bug the offline suites could not see, fixed:** the ad trigger read the "status change under way" setting as null
  on a connection that had never set it, which skipped the checks on what a business writes into an ad (status,
  review, photos, the daily limit). PGlite runs everything on one session, where migration 50's own data step had
  set it. Fixed in 50 and 56 (and in 56's rollback, which restores 50's version), with a regression check that runs on
  a new connection (`reopen()` in the harness). On staging, a business's "active" ad is now stored as an unreviewed
  draft and a linked photo is refused.
- **Results, in order:**

  | State | Student and business checks (API) | Website, 46 pages of 5 roles | v1 portal script | Other |
  | --- | --- | --- | --- | --- |
  | Production's state, this branch's website | 10/10 | 40/46: Ads, Analytics, the admin's Ads, Reports and Audit, and an event call on a business profile need 49 and 50 (as on production today) | 58/58 | API e2e 10/13, website e2e 15/17: see Risks |
  | During `apply` (what `db:setup` does), students and the staffer using the API | | | | 1st run: 11 migrations in 19 s, 300 requests, 0 failed (p95 182 ms, max 552 ms). 2nd run (49, 50, 55, 56 again): 180 requests, 1 failed: a staffer's reply refused once as 49 committed |
  | After the release | 25/25 (roles, posts, ads with real uploads, review and payment, serving, hide, events, saved ads, inquiries, blocks, video rows, audit, re-review, pg_cron, Buzz) | 46/46, no request to production | 58/58 | API e2e 10/13, website e2e 15/17 (the same as before) |
  | After the release's rollback (56, 55, 50, 49; Buzz kept) | 10/10; every Buzz object and row unchanged | 40/46, as before the release | | |
  | After the full restore (all 11 rolled back) | | | | schema = production's model again (`verify.mjs --live`), every table's row count = baseline's |

- **Found on the way:** rolling back 50 refuses while a payment for an ad that promoted no listing or post exists (by
  design: it would lose the record); 54's rollback keeps `buzz_posts.category` (by design, Ankur's); the existing e2e
  scripts leave chats, storage files and `media_jobs` rows behind on the project they run on (cleaned on staging).

## Production release plan (revised 2026-10-28)

Each production step needs the owner's explicit approval. Nothing is merged or applied before step 1.

**Before release day (no production change):**
- Review this branch's PR; do not merge it yet.
- In Vercel, check that `SUPABASE_SERVICE_ROLE_KEY` is set for Production (video uploads need it once this code is
  live) and note the current production deployment, to roll back to.
- Pick a quiet hour: business replies sent in the second migration 49 commits can fail once (a retry works).

**Release day, in this order:**
1. **Back up production, before any change** (read-only):
   `SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=<production ref> node scripts/backup.mjs before-business-v2`
   (→ `~/CampConnect-backups/<date>-before-business-v2/`; check `manifest.json`'s counts). Then confirm production is in
   the state rehearsed (read-only):
   `SUPABASE_ACCESS_TOKEN=… node supabase/applied-outside-repo/verify.mjs --live --except <the 11 files: 44, 46, 47, 49 to 56>`.
   If it does not match, stop: the plan was rehearsed on that state only.
2. **Merge the PR** (deploys the website). Until step 3 the site behaves as production does today (rehearsed: 40 of 46
   pages; the 6 others need 49 and 50).
3. **Apply the migrations**: `SUPABASE_DB_URL=… npm run db:setup` from an up-to-date `main` (database-URL mode only,
   never token mode or `supabase db push`). It applies 44, 46, 47, 49, 50, Buzz's 51 to 54, 55 and 56 in file order,
   each in its own transaction; it stops at the first failure, leaving the earlier ones applied. On staging, students'
   and the staffer's requests kept working while each one applied (above).
4. `notify pgrst, 'reload schema'`, then `verify.mjs --live` with no `--except`: it must match.
5. Look at the live site: a student's Home, Buzz, Messages, a business profile; the portal's Ads, Analytics and Inbox;
   the UniBuzz team's Business admin pages.
6. `eas update` from `apps/mobile` (app builds in students' hands keep working before it: the v1 portal script passes
   58/58 after the release).
7. A docs-only PR marks the rows in docs/migrations.md as applied.

**If something goes wrong (each also needs approval):**
- **The release's rollback leaves Buzz alone:** run only 56, 55, 50 and 49's rollbacks, in that order, each in one
  transaction together with `delete from public._migrations where name = '<file>.sql';` (the Supabase SQL editor
  runs a pasted script as one transaction, through the same API the staging rehearsal used: when 50's rollback
  refused there, its `_migrations` row stayed). Buzz's 51 to 54 stay; rehearsed offline and on staging, with every
  Buzz object and row compared.
- Before 50's rollback: export, then end or refund, any ad paid for that promoted no listing or post, and delete those
  payment rows; the rollback refuses otherwise. 49's rollback removes analysts from teams and makes editors and admins
  staff again.
- **Website only:** Vercel's instant rollback to the noted deployment. If 55 is applied, roll it back too (its
  rollback first): the older video routes cannot finish uploads with 55 in place.
- **Last resort:** the step-1 backup (JSON: schema, rows, accounts, file records). Restoring from it is manual.

## Decisions (also in docs/decisions.md)

| Decision | Why |
| --- | --- |
| v1 deals are business posts, and the table keeps the name `deals`. v1 paid promotions are ads, and `listing_promotions` is the payment ledger. | Keeps every v1 caller, label and stat working. Deals were never paid, so making them ads would break "Sponsored only when paid". |
| An admin approves an ad by recording its payment (amount and reference). | There is no payment provider yet, so "Sponsored" still always means a recorded payment. |
| Roles: owners and admins run the team, the profile and ad spend; editors post, draft ads and reply; analysts read numbers only and are never in inquiry chats. | Spend needs an owner or admin decision; least access to students' messages. |
| Housing ads: from a housing business, or promoting a listing. They run in Housing only, and every one needs an admin's Fair Housing check (a note when the screen flags words). | Spec and Fair Housing Act §3604(c); the screen flags, a person decides. |
| Ads go to signed-in students only, chosen by campus in a daily rotation that is the same for everyone on that campus. At most one ad per 9 organic rows. | "Campus only, never demographics or activity"; about one per 8–10 posts. |
| A business that leaves "approved" shows no ads; re-approved, its paid ads run again within their dates. | v1's promotions behaved that way, and the v1 suite checks it. |
| Students' reports about businesses go to the portal's admin, not the staff console's queue. | Business admins act on ads; the staff console's content adapters do not know ads. Merging the two is a later step. |

## Pending, in priority order

1. **Production runs #49's code without its migrations.** The owner chooses (production writes):
   - the production release plan below, now;
   - or revert #49 on `main` first.
2. **The production release plan below**, step by step, each production step with the owner's approval. Everything
   stays on `business-v2` until then.
3. When everything is live, update the rows in migrations.md, move a short summary of this file to
   docs/history.md, and delete the file.
4. **Mobile Reels ads.** The app's Reels pager has fixed-height pages and its own viewer, so it does not show ads yet.
   The website does.
5. **Saved ads on the Saved page.** `my_saved_ads()` and `listSavedAds()` exist; no screen lists them yet.
6. **Email and push for business notifications.** Today they appear in the portal only. Push reaches a business account
   only if it ever signed in on the app.
7. **e2e coverage:** Playwright for the portal and Sponsored cards, Maestro for the app.

## Risks

- **Ad videos:** for Reels, the database checks the video's size from its media record, the admin's approval asks Mux
  for it again, and the reviewer sees the video. The record's details come from the server once 55 is applied, and 56
  approves no video ad without 55.
- **Rehearsed on staging, not on production's data:** staging has a handful of accounts; production's row counts are
  larger, so its migrations may take longer than staging's 19 s (they lock the tables they change while they run).
- **e2e scripts that were already failing** (the same before and after the release on staging): the three Buzz steps of
  `scripts/e2e-home-feed.mjs` were written for the old Buzz (non-anonymous photo path, an old `buzz_v2_vote`
  signature); the website e2e's two Posts-tab steps wait for a "Liked by" row the seed does not produce. Not fixed here.
- **Event counts:**
  - Impressions are counted from the client (once per student per hour per ad).
  - A determined student could inflate their own impressions by at most one an hour per ad.
  - Reach counts distinct students.
- **Timing without pg_cron:** statuses lag until `ads_sweep()` runs. Students still never see an ad past its end date.

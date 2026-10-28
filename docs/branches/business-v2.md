# business-v2

- **Owner:** Sunil. **As of 2026-10-27:** branched from `main` at `14bb5c2`; four commits of work plus
  docs, pushed, PR open into `main`, **not merged**. Written by an AI session.
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

## Migrations (neither is on production)

| # | File | What |
| --- | --- | --- |
| 49 | `20261107000000_business_teams.sql` (+ rollback) | Team roles, the business audit log, notifications of type `business`. Details below. |
| 50 | `20261107000100_business_ads.sql` (+ rollback) | Posts, ads, serving, events, Fair Housing, the v1 data migration. Details below. |

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
- The timestamps are later than every migration on `main` and on the other branches.
- Apply 49 and 50 together, after every earlier migration, with `SUPABASE_DB_URL=… npm run db:setup` (supabase/CLAUDE.md).
- Then `notify pgrst, 'reload schema'`.
- The code on this branch needs both migrations. Do not merge before they are live.

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

## Tests run on this tree, 2026-10-27

| Suite | Result |
| --- | --- |
| `npm run db:test` | ✅ 34 suites (32 existing + 2 new), 1379 checks, 0 failures |
| `npm run test:shared` | ✅ 172/172 (15 new) |
| `npm run check` (typecheck, lint, build; 6 tasks) | ✅ 6/6, on the final tree |
| `npm run test:moderation` | ✅ 428/428 (untouched by this branch) |
| Website e2e, app Maestro flows, staging business script | not run (they need seeded data or a live project) |

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

1. **Review the PR.** The shared docs went in with it: the migrations.md rows, the testing.md
   results, the decisions, status.md, the README, and branches/README.md.
2. **Apply 49 and 50 to production, before merging.** Needs the owner and a credential.
   - Take a backup first.
   - Then `verify.mjs --live`.
   - Then update their rows in migrations.md.
3. **Merge**, then publish the app update (`eas update`, a production write).
   - When merged, move a short summary of this file to docs/history.md and delete the file.
4. **Mobile Reels ads.** The app's Reels pager has fixed-height pages and its own viewer, so it does not show ads yet.
   The website does.
5. **Saved ads on the Saved page.** `my_saved_ads()` and `listSavedAds()` exist; no screen lists them yet.
6. **Email and push for business notifications.** Today they appear in the portal only. Push reaches a business account
   only if it ever signed in on the app.
7. **e2e coverage:** Playwright for the portal and Sponsored cards, Maestro for the app.

## Risks

- **Ad videos:** for Reels, the database checks the video's size from its media record, the admin's approval asks Mux
  for it again, and the reviewer sees the video.
- **Event counts:**
  - Impressions are counted from the client (once per student per hour per ad).
  - A determined student could inflate their own impressions by at most one an hour per ad.
  - Reach counts distinct students.
- **Timing without pg_cron:** statuses lag until `ads_sweep()` runs. Students still never see an ad past its end date.

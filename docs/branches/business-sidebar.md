# business-sidebar

- **Owner:** Sunil. **As of 2026-10-28:** branched from `main` at PR #52 (`f77d796`); a PR open, not merged.
  Written by an AI session.
- **Purpose:** the business portal's navigation as a left sidebar, with every section a working page. The owner's
  brief named a reference image that did not reach the session; the sidebar follows the brief's written description.

## What it does

- **The sidebar** (`apps/web/src/components/business/portal-sidebar.tsx`, replacing `portal-nav.tsx`): graphite in both
  themes, outline icons, a thin accent mark and a raised background on the page you are on.
  - **Order:** Overview, Advertisements, Inbox, Products & Services, Analytics, Billing.
  - **Bottom:** Settings, set apart by a divider, above the account menu. The menu keeps what the old account menu
    had: the appearance switch and Log out.
  - **Header:** the notifications bell next to the business's name.
  - **Admins** of the UniBuzz team also get "Business review".
  - **Smaller screens:** on tablets and phones a slim top bar opens the same sidebar as a drawer. It closes on the next
    page, on Escape and on the scrim.
  - **Who sees what:** `portalSectionsFor()` in `packages/shared` decides it from the role and the business's standing,
    the same rules as before plus Billing's.
  - **Inbox:** the shared `MessagesShell` takes a `className` and `bottomBar`, so the portal's inbox sits beside the
    sidebar. The student site's Messages is unchanged.
- **Overview** (`/`): "At a glance" adds active ads (running, scheduled, in review), the month's spending (roles that
  see Billing) and the inquiries waiting for a reply, above the existing 30-day numbers, campaigns and inquiries.
- **Advertisements** (`/ads`), **Inbox**, **Analytics:** as before, renamed where the label changed.
- **Products & Services:**
  - `/deals`, the posts, with a type filter: products, services, special offers, events, updates.
  - `/listings`, the listings, restyled into the portal's look. Shown as a tab for housing businesses.
- **Billing** (new, `/billing` and `/billing/<id>`), for the owner, admins and analysts (`canSeeBilling`):
  - the payments the UniBuzz team recorded (`listBusinessPayments`, which falls back to v1's columns before
    migration 50);
  - totals for this month, the last 30 days and all time, and the running paid campaigns;
  - a status filter;
  - a CSV for the books (`paymentsCsv`, which writes cells a spreadsheet would run as formulas as text);
  - a printable receipt per payment (the sidebar stays off the printout).
  - Nothing is charged from the portal.
- **Settings** (new hub `/settings`), with tabs over:
  - the business profile (`/profile`) and the team (`/team`), at their old addresses;
  - verification (new, `/settings/verification`): the review and its note, Verified Partner, and a profile checklist
    (`businessProfileChecklist`);
  - the account (new, `/settings/account`): who is signed in, appearance, notifications, log out. It also serves the
    UniBuzz team without a business.

No migration, and nothing changes what the database allows.

## Tests, 2026-10-28

| Suite | Result |
| --- | --- |
| `npm run check` | ✅ 6/6 |
| `npm run test:shared` | ✅ 194/194 (new: `business-portal.test.mjs`, 10 tests: sections and order per role and standing, Billing's audience, payment standing, totals, CSV, subjects, the profile checklist) |
| `apps/web/e2e/business-sidebar.mjs` on staging with the release applied | ✅ 12/12: the order, Settings at the bottom, the active mark, each section working, the phone drawer, an editor without Billing |
| `apps/web/e2e/release-smoke.mjs` on staging with the release applied | ✅ 52/52 pages (the new ones included), no request to production |
| The sidebar's pages on staging in production's state (no 49 or 50) | ✅ every page loads; Billing shows v1's payments |
| App (Expo) | not touched |

Staging was rehearsed with the release and restored to production's state afterwards (owner's approval).

## Pending

1. Review and merge the PR. Merging deploys the website. It needs no migration: on today's production the sidebar's
   pages work as the rest of the portal does, and Ads and Analytics still need 49 and 50 (docs/migrations.md).
2. Once merged and deleted, a line in docs/history.md and this file removed.

# business-inbox-pending

- **Owner:** Sunil. **As of 2026-10-29:** branched from `main` at PR #57 (`e36a53b`); merged as PR #58 (06:14 UTC)
  and deployed (Vercel, 06:16 UTC). Written by an AI session.
- **Purpose:** the Inbox for a business awaiting the UniBuzz team's review. On production (2026-10-29) a pending
  business's sidebar had no Inbox at all: `portalSectionsFor()` showed it to approved businesses only, and the Inbox's
  route sent anyone else to Overview. The owner read that as the Inbox missing.

## What it does

- **Sidebar:** the Inbox sits below Overview for the owner, admins and editors whether the business is approved or
  pending (`portalSectionsFor()` in `packages/shared/src/business.ts`). Analysts still never get it; a rejected business
  keeps Overview and Settings; a suspended one nothing.
- **A pending business's Inbox** (`inbox/layout.tsx`, `components/business/inbox-pending.tsx`): "Your Inbox opens once
  you are approved", what happens then (students message from the profile, posts and listings; messages arrive live;
  anyone on the team who replies can answer; students always write first) and a link to Settings › Verification. No
  chat is read; a chat's own page still needs an approved business (`requireCapability("reply")`).
- **Unchanged, in the database** (migration 39 on production, 49 after the release): students can start an inquiry only
  with an approved business; a business's team writes only while approved, only in its own inquiries, and only after
  the student has written; a business cannot create a chat.
- Also carries `business-inbox`'s commit that came after PR #57: the browser test's not-found check and its results.

No migration, and nothing changes what the database allows.

## Tests, 2026-10-29

| Suite | Result |
| --- | --- |
| `npm run check` | ✅ 6/6 |
| `npm run test:shared` | ✅ 198/198 (a pending owner's and editor's sidebars have the Inbox second; an analyst's never) |
| The Inbox in production's state (no 49 to 56), a one-off script | ✅ 6/6, with a new business awaiting review: Inbox below Overview, the "opens once you are approved" page, no chat opens |
| `release-rehearsal.mjs check` | ✅ 10/10 before the release, 25/25 after |
| `apps/web/e2e/business-inbox.mjs` on staging with the release applied | ✅ 10/10 (new: a business awaiting review sees the Inbox, and a student cannot write to it), no request to production |
| `apps/web/e2e/business-sidebar.mjs`, `apps/web/e2e/release-smoke.mjs` | ✅ 12/12, 52/52 pages |

Staging got the release applied for these runs (owner's go-ahead) and is back in production's state: row counts as at
baseline, and `verify.mjs --live` finds the same schema as production.

## Pending

1. A business awaiting review receives inquiries only once the UniBuzz team approves it (`/business/admin`, Business
   review).
2. Delete the branch (the owner's call), then a line under "Retired branches" in docs/history.md and this file removed.

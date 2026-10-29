# business-inbox

- **Owner:** Sunil. **As of 2026-10-28:** branched from `main` at PR #56 (`20ec63b`); pushed, no PR yet.
  Written by an AI session.
- **Purpose:** a dedicated Inbox directly below Overview in UniBuzz Business: Instagram-style real-time messaging,
  unread badges, filters, notifications, inquiry context and instant replies from the team members who may reply,
  with businesses answering only after a student writes.

## What it does

- **Order:** Overview, **Inbox**, Advertisements, Products & Services, Analytics, Billing; Settings apart at the bottom
  (`PORTAL_SECTIONS` in `packages/shared/src/business.ts`). Who sees the Inbox is unchanged: the owner, admins and
  editors of an approved business (`requireCapability("reply")`); analysts and pending businesses do not.
- **The list** (`components/business/inquiry-list.tsx`, from `inbox/layout.tsx`):
  - rows: the student's photo and name, the newest message ("You:" or a teammate's first name when the team wrote it),
    what the chat is about with its icon, the time, an unread count or a dot when the student wrote last;
  - "N unread", "Mark all read", and a bell for desktop notifications;
  - a search over names, messages and what was asked about;
  - filters: All, Unread, Needs reply, and Listings, Posts, Ads, Profile when any exist (`INQUIRY_FILTERS`,
    `inquiryMatches`);
  - live: conversation, membership and message changes refresh it (debounced).
- **The chat** (`inbox/[conversationId]/page.tsx`): the shared chat window (real-time messages, receipts, the team's
  replies on the business's side) under a card with what the student asked about (`inquiry-context.tsx`: the
  listing, post or ad as it is now, its photo and price, linked to its page in the portal; or the profile).
- **Alerts** (`components/business/message-alerts.tsx`, mounted by the portal's layout for members who can reply):
  - on any portal page, a new message from a student shows a toast with Reply (8 s), unless that chat is open and
    the tab visible;
  - the Inbox's badge and the tab's title ("(3) …") follow the unread count, recounted on each page;
  - desktop notifications once turned on (Settings › Account, or the bell in the Inbox), per browser, after the
    browser's permission.
- **What each chat is about:** `getInquiryDetails()` in `packages/shared/src/queries/business.ts` reads every chat's
  target and newest sender in one query, then the listings, posts and ads in batches. If it fails the Inbox still
  works, without the context.
- **Reply-only, in depth:**
  - the database: a business cannot start a chat (`start_business_inquiry` and `get_or_create_direct_conversation`
    refuse business accounts; there is no insert policy), and `chat_write_problem()` refuses a business message
    before the student's first (migration 39); since 56 the business cannot even see that chat;
  - the website: the Inbox lists only chats with a message and returns 404 for any other, so production's state
    (without 56) shows the same.

No migration, and nothing changes what the database allows.

## Tests, 2026-10-28

| Suite | Result |
| --- | --- |
| `npm run check` | ✅ 6/6 |
| `npm run test:shared` | ✅ 198/198 (`business-portal.test.mjs`: the new order, and the inquiry kinds, labels, needs-reply, previews, filters and search) |
| `apps/web/e2e/business-inbox.mjs` | **not run**: needs staging with the release applied |
| `apps/web/e2e/business-sidebar.mjs` | updated for the new order; **not re-run** |
| `release-rehearsal.mjs check` | adds "the business cannot write first in an empty inquiry"; **not run** |
| App (Expo) | not touched: business accounts use the website |

## Pending

1. Run the browser test and the rehearsal's checks on staging (needs the owner's go-ahead: staging gets the release
   applied, then restored).
2. Open the PR, review and merge. Merging deploys the website; it needs no migration. On today's production (no 49
   to 56) the Inbox works for the inquiries that exist there, from listings and posts; inquiries from the profile and
   from ads need 50.
3. Once merged and deleted, a line in docs/history.md and this file removed.

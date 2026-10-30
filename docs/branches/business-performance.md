# business-performance

- **Owner:** Sunil. **As of 2026-10-30:** branched from `main` at PR #72 (`f2fd658`); not yet pushed or merged. Written
  by an AI session.
- **Purpose:** the owner's brief: make UniBuzz Business feel instant, smooth and premium end to end (every page, the
  Overview, the Inbox, the Ads Manager, Billing, the profile), with real performance work before visual tricks, no
  unnecessary loading screens, flicker or layout shift, every feature and security rule kept, and desktop and phone
  measured before it ships. No migration.

## What changed, and why it is faster

**The server, every portal page**

- **No Auth round trip per request.** The proxy (`apps/web/src/proxy.ts`) and the portal's session
  (`lib/business/portal.ts`, `getPortalUser`) read the access token's claims with `supabase.auth.getClaims()`, which
  verifies the signature against the project's public signing keys (production signs with ES256; the keys are fetched
  once and kept in memory for ten minutes by auth-js, across requests), instead of `getUser()`, which asked the Auth
  server on every request, twice per page (proxy and page). An expired token is refreshed exactly as before. The
  database trusts the same signature for every query it answers, so nothing is open on the page that is closed in the
  database. The student site's own pages still use `getUser()` through `lib/auth.ts`; only the proxy's check changed
  for them.
- **Profile and business read together.** `getPortalSession` reads the profile and `my_business()` in parallel
  (`my_business()` answers from the session alone); before, three reads ran one after another.
- **One read per request for what every part of a page asks for** (`lib/business/data.ts`: the team, the unread
  message count, the unread notification count, each under React `cache()`). The shell, the Overview, the Inbox's
  list and its open chat used to read the team separately in the same request.
- **The open chat reads everything at once** (`inbox/[conversationId]/page.tsx`): the conversation, the team, the
  messages and the inquiry's context in one round trip; the checks that decide what to show run after, on what the
  database already limited to this member.

**Navigation**

- **Prefetch on intent** (`components/business/portal-base.tsx`, `useIntentPrefetch` / `IntentLink`): the sidebar's
  sections, a section's tabs and the analytics periods prefetch their page in full, data included, the moment the
  pointer, keyboard focus or a finger reaches the link. Links merely in view keep Next's default for pages that read
  the database (the shell up to the loading state), so the server renders nothing for pages nobody opens. With the
  page already in the browser the click shows no loading state at all.
- **A one-minute cache for prefetched pages** (`next.config.ts`, `experimental.staleTimes.static: 60`, Next's default
  is five minutes): a page opened from the sidebar is never more than a minute behind the database, and any server
  action clears the cache at once. `dynamic` stays 0.
- **Loading states that wait** (`(portal)/loading.tsx`, `inbox/[conversationId]/loading.tsx`, `.biz-loading` in
  `globals.css`): a skeleton is invisible for its first 160 ms and then fades in; a page that is ready sooner (a
  prefetched or a warm one) never flashes a skeleton. The chat pane got a loading boundary of its own, so a chat's
  link is prefetched up to it and tapping a chat changes the pane at once.
- **One way for a page to arrive** (`(portal)/template.tsx`, `.biz-page-in`): a 200 ms fade in place, no movement, once
  per page; the sidebar outside it stays put. The Overview's header lost its own slide-in.
- **Filters without a request** (`components/business/filter-tabs.tsx`): the Ads Manager's status filter, Billing's
  standing filter and Products & Services' type filter pick from the rows already on the page, changing the address
  with `history.replaceState` (which Next's router follows into `useSearchParams`). Before, each filter tap was a
  server render behind a skeleton. The pills stay real links, so `?status=running` from Billing's tile, a new tab or a
  shared address still opens the same filter from the server.
- **Back to a tab after a minute away re-reads the page** (`components/business/refresh-on-return.tsx`), quietly, so
  the numbers are the database's without a reload.

**Live updates**

- **One realtime channel and one unread count for the shell** (`components/business/inbox-live.ts`,
  `message-alerts.tsx`): the alerts own the channel; the sidebar's badge (desktop and drawer) and the tab's title read
  the count from the shared store. Before, the badge and the alerts each held a channel on `messages`, the badge
  re-joined its channel on every navigation, and each navigation counted the unread messages three times (twice in
  the browser, once on the server). Now: one channel kept across pages, one count per page. "Delivered" for students
  (`markDeliveredAll`) is still sent when the portal opens and as messages arrive.
- **The Inbox's list updates itself** (`components/business/inquiry-list.tsx`; the pure parts in
  `packages/shared/src/business.ts`: `inboxAfterMessage`, `inboxAfterRead`, `inboxReflects`, with
  `packages/shared/tests/business-inbox.test.mjs`): a message moves its chat to the top with the new preview, count,
  "Needs reply" and "You:"/teammate name; a read receipt clears a count; "Mark all read" zeroes the list and the badge
  at once. Before, every message, read receipt and conversation change re-rendered the whole page tree on the server
  (the shell, the inbox layout and the open chat: about fifteen queries) through `router.refresh()`. The server is
  still asked for what the list cannot know: a chat it has not seen (a student's first message, which has a context
  to look up), memberships coming and going, and, once on mount, when a message arrived while another page was open
  (compared by the database's own timestamps, so clock differences between browser and server cannot loop it).

**Polish**

- The portal's own `theme-color` (`business/layout.tsx`, `generateViewport`): the browser's frame in the portal's
  canvas colour, light or dark, instead of the student site's blue.
- A dark portal paints the window's background and scrollbar dark too (`html:has(...)`/`body:has(...)` in
  `globals.css`): no light flash past the page's edge when it is pulled.
- The Inbox's time column is rendered on the server too (`suppressHydrationWarning`), so it no longer starts empty
  and fills in after hydration.
- List thumbnails in the Ads Manager and the posts grid load lazily (`loading="lazy" decoding="async"`, with sizes).

## What did not change

- Every read and write still goes through `packages/shared`, under row-level security; no migration, no new policy,
  no new environment variable. Nothing is cached on the server across requests or people: the per-request `cache()`
  dies with the request, and Next's prefetch cache lives in the one browser that fetched it.
- The pages' addresses, the filters' `?status=` / `?kind=` parameters and every `data-testid` the e2e scripts use.

## Tests, 2026-10-30

| Suite | Result |
| --- | --- |
| `npm run test:shared` | ✅ 223/223 (5 new in `business-inbox.test.mjs`) |
| `npx tsc --noEmit` in `apps/web` and `packages/shared`; `eslint` on the portal | ✅ |
| `npm run check` | see docs/testing.md |
| `apps/web/e2e/business-performance.mjs` (new: click-to-heading times cold and after intent, skeletons seen, requests per page, a filter that must cost no request, the chat opening, the dark window, the phone drawer) | **not run**: it needs a production build pointed at staging (`SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_REF`), which this session had no credential for; prefetching only runs in production builds, so `next dev` cannot measure it |
| `apps/web/e2e/business-sidebar.mjs`, `business-inbox.mjs`, `release-smoke.mjs` | **not run** since this branch, for the same reason; the filters they click keep their names, roles and `?kind=` addresses |

## Next steps

1. With staging: `npm run build -w web && npm run start -w web -- -p 3060` (staging's URL and keys in the environment),
   the rehearsal's `seed`, `apply` and `check`, then `BASE=http://localhost:3060 PLAYWRIGHT_CHANNEL=chrome node
   apps/web/e2e/business-performance.mjs shots`, and `business-sidebar.mjs`, `business-inbox.mjs` and
   `release-smoke.mjs` as before. Record the numbers in docs/testing.md.
2. If the warm pass still shows skeletons for a section, its page is slower than the prefetch window: look at that
   page's queries first (`getDailyStats`, `listConversations` are the heaviest).
3. Open the PR; merging deploys.

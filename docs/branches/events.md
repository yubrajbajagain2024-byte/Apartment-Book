# events

- **Owner:** Sunil. **As of 2026-10-31:** branched from `main` at PR #73 (`05ac276`); merged with PR #74 (https://github.com/yubrajbajagain2024-byte/UniBuzz/pull/74) on
  2026-10-31 at 03:43 UTC, which deployed the website; migration 61 is not on production. Written by an AI session with two forked sessions (one
  for the app, one for the website).
- **Purpose:** the owner's brief: the bottom bar becomes Home, Explore, Messages, Events, Profile (Discover's search
  moves to a magnifier beside the bell; Housing, Roommates and the Marketplace stay in Explore; Orbit, Buzz and Reels in
  Home); a dedicated Events section with a compact feed (small optional pictures, title, date, time, place, category),
  event pages, Save, Share and registration links; For you (a light recommendation: interests, upcoming dates, followed
  organizations, engagement) and All events (time order) with date and category pills, search and saved events;
  university events synced from ICS and RSS feeds without duplicates and with cancellations; verified clubs,
  organizations and departments publishing their own; a backend for many campuses with staff monitoring and
  moderation. Fast, minimal, in UniBuzz's existing design.
- **Migration:** 61, `20261113000000_events.sql` (rollback in `supabase/rollbacks/`). Not on production; applied on
  staging by `supabase/tests/staging/events.mjs` on 2026-10-31 (it stays, as 58 to 60 do). It needs only what production
  has (41, 39, 60), so it goes live on its own ahead of the Business v2 release, with the owner's approval, like 58 to 60
  ([../migrations.md](../migrations.md)).

## What is on the branch

See "Events" in [../../README.md](../../README.md#events) for how it works. In short:

- **Database:** `universities.timezone`; `organizations`, `organization_members`, `organization_follows`; `event_feeds`
  (closed to the API); `events` with `save_count`, `click_count`, a search column and a title key for the duplicate
  check; `event_saves`, `event_interests`, `event_engagement`; the write triggers that make a client's rows the server's
  (campus, author, source, status: `pending` until the organization is verified, `hidden` stays hidden); the counters;
  `record_event_click()`; the `events_console_*` functions (staff, two-factor, audited).
- **Shared (`packages/shared`):** `events.ts` (categories and the keyword guess, the date pills' ranges and the one-line
  "when" on the campus's clock, day groups, `rankEvents`), `events/ics.ts` and `events/rss.ts` (the parsers),
  `events/sync.ts` (the plan), `events/time.ts` (wall clocks in a zone without a date library), `queries/events.ts`
  (every read and write the apps make), `queries/event-sync.ts` (the sync's, with the service role), the zod schemas,
  the constants, the `Database` types, the upload kinds `events` and `organizations`.
- **App:** the tab bar and the search screen; the Events tab (For you | All events, search, pills); the event page;
  saved events; interests; publishing and editing events; organizations (page, create, edit, members).
- **Website:** the Events tab in the header and the phone bar; `/events`, `/events/[id]`, `/events/saved`,
  `/organizations/[id]`; `/admin/events` in the console; `/api/events/sync` with `vercel.json`'s daily cron and
  `lib/events-server/sync.ts`.

## Tests

- `supabase/tests/events.test.mjs` (50 checks) and `events-rollout.test.mjs` (61 alone on production's state, the
  release after it, its rollback): in `db:test`. The other rollout rehearsals skip 61 (`AHEAD`) so they still model
  production as it is.
- `packages/shared/tests/events.test.mjs` and `events-feeds.test.mjs`: the ranking, the date helpers, the parsers, the
  plan.
- `supabase/tests/staging/events.mjs`: 12/12 on staging on 2026-10-31 (Auth, the REST API, Storage, the sync's own code
  on an inline calendar, twice); every row it made deleted.

## Previews (2026-10-31)

- **Vercel's branch preview** (`apartment-book-git-events-vyass.vercel.app`, behind Vercel's login) reads production,
  where 61 is not applied: its Events pages are empty and the console's Events tab errors until 61 goes live.
- **A staging-backed preview** was run from the owner's Mac for review: a production build of the website on the local
  network (port 3060) and a second Expo server (port 8082, its own Metro cache), both given staging's address and keys
  per process, so no env file changed; their bundles were checked to name staging alone. Staging holds a demo student
  (`unibuzz-demo-events@txstate.edu`, admin staff there; the password was given to the owner, not written down), four
  demo organizations (Bobcat Robotics, Career Lab, Global Bobcats verified; Paw Film Society awaiting verification) with
  twelve events, and **Texas State's real public calendar** as a feed. Remove with
  `delete from public.event_feeds where url like '%trumba.com%'`, `delete from public.organizations where description like '%Demo organization%' or name = 'Paw Film Society'`
  and the demo account deleted in Auth.
- **Texas State's calendar** is Trumba's `calendar.1400280`: `https://www.trumba.com/calendars/calendar.1400280.ics`
  (200 events, 181 with a picture). Its RSS has no machine-readable start, so use the ICS. Synced with the branch's own
  code on staging: 200 inserted, none refused.
- The real feed found what the unit tests had not, all fixed and now under test: HTML entities in ICS text
  (`Texas A&amp;M`), HTML in descriptions, the calendar's "Event Type" custom field (97 of 200 events fell to Other
  without it, 18 with it), pictures in the standard `IMAGE` property (now kept, and loaded straight from the calendar's
  host on the website, since `next/image` resizes only our own Storage), a link without `https://` that the database
  refused and that failed its whole batch (links are normalised, and the sync now keeps every row the database accepts
  and reports the rest), and a daily exhibit repeated 75 times (For you shows a repeated event once).
- A browser check of the staging preview, signed in as the demo student on desktop and phone sizes (the page then
  crashed for every signed-in visitor: `/events` handed a function to a client component; fixed with
  `components/events/events-tabs.tsx`, as Home and Housing do): For you, All, Weekend, Tech, search, an event page,
  save and unsave, Saved, an organization page, the console's two-factor gate; 30 of 30 with no server error and no
  request to production.

## Pending, and next steps

1. The owner reviews PR #74; `npm run check` (6/6), `npm run test:shared` (238/238) and `npm run db:test` (48 suites,
   1721 checks) results are in [../testing.md](../testing.md).
2. Production, each with the owner's approval: a full backup, migration 61 alone (the procedure in
   `supabase/CLAUDE.md`), `CRON_SECRET` set in Vercel's Production environment, the merge (which deploys the website),
   the first feed added in `/admin/events` (Texas State's calendar, below), an EAS update so testers get the tab.
3. The Hobby plan allows one cron run a day; "Sync now" in the console covers the rest.
4. `apps/web/vercel.json` is in the right place: the Vercel project's Root Directory is `apps/web` (checked 2026-10-31).
5. Not done on this branch: notifications for a followed organization's new event; an "Add to calendar" button; event
   pictures deleted from Storage when a feed event goes (an organization's own are removed by the app when the uploader
   deletes the event); a per-campus choice of time zone in the console (a seed row for now).

# Project status

As of **2026-10-31**. Sources: the code, commit messages, and the owner's deploy notes (read-only
checks of production). Migration-by-migration status is in [migrations.md](migrations.md); branch
details in [branches/](branches/README.md). Refer to an item below by its title.

## Completed (on `main`)

- **Accounts:** university-email-only sign-up (form + trigger), confirmation email, optional
  Google sign-in, profiles (TikTok style), profile privacy controls, verified-student badge.
- **Social:** follows with private follower lists, threaded comments with likes, sharing to friends,
  blocking, notifications with mutes and mark-all-read, activity status, push (migration 36).
- **Home:** Orbit (posts + reels blend), Buzz tab, Reels viewer, floating "+" on Orbit, the menu
  under your photo; Posts kept as a tabless section.
- **Create flow (app):** camera first (BUZZ | POST | REEL | SNAP since 2026-10-30, front lens by default), gallery,
  editor, publish with title, link, audience (campus | global | friends | selected) and comments
  switch; roommate posts and Marketplace items made in the same flow, optionally anonymous.
- **Search** (the former Discover tab, a screen behind the magnifier beside the bell since the
  `events` branch): search plus popular posts, topics and accounts per campus (falls back until 44
  is live).
- **Buzz v2:** anonymous threads, moderation engine, staff console at `/admin` (41 + 42 live since
  2026-10-26). Since PR #41 (2026-10-27) an emoji no longer holds a Buzz for review. In the app,
  replies form a Reddit-style tree, feed cards show a top reply, and each day's prompt has one
  thread per feed; in the app and on the website a buzz may have a category. These need 51 to 54,
  not live as of 2026-10-28; until then both fall back (two levels, no top reply, prompt answers
  as their own buzz, no category kept).
- **Messages:** realtime chats, groups, semester course chats, voice messages, replies,
  attachments, requests, mute; **Snaps** (view-once); **Calls** (built, paused).
- **Explore:** apartments with PostGIS distance and maps, roommates, Marketplace (one video per
  item, no comments), anonymous listings with per-chat reveal (47, live since 2026-10-27).
- **Business portal** (`/business`): live with migration 39. Its left sidebar, Billing and Settings pages (PR #56,
  2026-10-29 03:34 UTC) and the Inbox below Overview with live alerts and inquiry context (PR #57, 04:06 UTC; for
  businesses awaiting review too since PR #58, 06:14 UTC) are on production too; Ads and Analytics still need 49 and 50.
  **Made instant on `business-performance`** (2026-10-30, pushed, PR to open): no Auth round trip per request
  (local token verification in the proxy and the portal), parallel and deduplicated reads, pages prefetched in full on
  intent, skeletons that wait 160 ms, filters that cost no request, one live channel and a self-updating Inbox list;
  `npm run check` and the unit tests pass, the browser timings (`apps/web/e2e/business-performance.mjs`) still need a
  staging run ([branches/business-performance.md](branches/business-performance.md)).
- **Staging** (`campconnect-staging`) has production's migrations since 2026-10-28 (it got 41, 42,
  45 and the two admin migrations then; `verify.mjs --live` against it matches production's model).
- **Video:** Mux uploads and tours. **Mobile:** Expo SDK 58 / RN 0.88; Android release build works
  (R8 rule for LiveKit).
- **AI documentation:** the root `CLAUDE.md` (PR #42), restructured on 2026-10-27 into one shared
  file plus these docs (PR #45).

## Open work, in priority order

- **Events** (PR #74, merged and deployed 2026-10-31 03:43 UTC; [branches/events.md](branches/events.md)): the bar is
  Home, Explore, Messages, Events, Profile; the Events tab (For you | All events, date and category pills, search,
  saved), event pages, organizations that students create and staff verify, the university's ICS and RSS feeds synced
  by the website, the console's Events section; migration 61, written, rehearsed offline and applied on staging, **not
  on production**: until it is, the website's Events pages show empty states and the console's Events tab shows an
  error (the apps are unchanged until an EAS update). Reviewed on 2026-10-31 through a staging-backed preview with Texas
  State's real calendar synced. Still to do, each with the owner's approval: a full backup and 61 alone (as 58 to 60
  went), `CRON_SECRET` in Vercel's Production environment, Texas State's calendar feed added in `/admin/events`, an EAS
  update.
- **Apply the pending migrations.** One run of `db:setup` from `main` in database-URL mode
  ([supabase/CLAUDE.md](../supabase/CLAUDE.md)), after a backup, applies them in file order: 44 and
  46 together, 49 and 50 (Business v2), 51 to 54 (Buzz), 55 and 56 (Business v2, PR #51), once
  `business-v2`'s ad trigger fix is merged (the order of release below). Confirm with `verify.mjs --live`, then
  publish the app update. Their code is already on `main`, which deploys production, so this is
  overdue. Needs the owner and a credential.
- **UniBuzz Business v2 is on `main` without its migrations.** PR #49 was merged on 2026-10-28 at
  04:07 UTC (and #51 at 07:06 UTC), so production's website runs Business v2 code while neither
  migration 49 nor 50 is applied (production's `_migrations`, read-only, 2026-10-28). Until they are, the code
  says these are broken on production:
  - creating and editing posts in the portal;
  - team invites;
  - the Ads screens;
  - "Message" on a business profile.

  On staging in production's state, this code shows an error screen on the portal's Ads and
  Analytics pages and the Business admin's Ads, Reports and Audit pages (2026-10-28). Student
  feeds carry on without ads. The owner chooses (both write to production):
  - the order of release below, now;
  - or revert PR #49 on `main` first, until the migrations can be applied.
- **UniBuzz Business v2** (merged in PR #49 on 2026-10-28 at 04:07 UTC). It upgrades the v1 portal to the business spec:
  - team roles;
  - business posts;
  - the Ads Manager with admin review and recorded payment;
  - Sponsored ads in For You, Reels and Housing;
  - public business profiles;
  - analytics from real events;
  - an Apple-style portal with light and dark modes.

  Order of release (the full list, rollbacks included, is "Production deployment checklist" in
  [branches/business-v2.md](branches/business-v2.md); rehearsed on staging on 2026-10-28). PR #51,
  the website part with 55 and 56, is live since 2026-10-28 07:06 UTC.
  1. Gates: `business-v2`'s fixes to 50, 55 and 56 merged (done: PR #52, 2026-10-28 19:03 UTC), and
     a restorable backup possible: production is on the Free plan, with no Supabase-managed backup
     (read-only check, 2026-10-28), so Pro's daily backups or a CLI dump.
  2. Release day: back up (a CLI dump, and `scripts/backup.mjs`), then check production is in the
     rehearsed state (`verify.mjs --live --except …`).
  3. Run `db:setup` once from `main`: 44, 46 and 49 to 57 (57 on `main` since PR #59; 47 and 58 to 60 are applied), and 62 once `admin-analytics-business` merges (61 goes alone first, as 58 to 60 did; `ALLOW_OUT_OF_ORDER=1`, since 44 and 46 are older than rows already applied). Then `verify.mjs --live`
     and the smoke test.
  4. Publish the app update.
  If it must be undone, the release's rollback is 62 (once merged; its functions read 50's tables, so it goes first), 57, 56, 55, 50 and 49 only: Buzz's 51 to 54 stay. Once an ad
  without a listing or deal has a recorded payment, 50's rollback first needs those payments refunded and deleted.
  **Reviewed and rehearsed again on 2026-10-30** (two staging cycles, all green); the Preview gate is closed (the
  service key left Vercel's Preview environment on 2026-10-30) and a restorable backup now exists: this repo's full
  backup and restore (`scripts/backup.mjs --full`, `scripts/restore.mjs`), rehearsed on staging on 2026-10-30; Supabase's
  own daily backups (Pro plan) remain the better path. See "Review of 2026-10-30" in
  [branches/business-v2.md](branches/business-v2.md).

  Follow-up work is listed in [branches/business-v2.md](branches/business-v2.md).
- **Business hours and the profile preview** (PR #59, merged and deployed 2026-10-29 07:19 UTC): the preview and the
  Website button are live on the website; the hours need **migration 57** on production (with the release above) and
  the app's part an EAS update, both the owner's approval. Until 57, the website shows and offers no hours. See
  [branches/business-hours.md](branches/business-hours.md).
- **The full-screen viewer in the app**: no "Add comment…" bar, the tab bar kept in view, the rail nearer the right
  edge (PR #61); closing from a later reel shrinks into the post it was opened from (PR #62); the zoom at Instagram's
  speed and no blur under the words (PR #63); Buzz's photos and video in the same viewer, anonymously (PR #64); swiping
  up and down through the Buzz list's buzzes with media (PR #65). All reach testers only with an EAS update (owner's
  approval); none has been timed on a device.
- **The Buzz thread, laid out like Reddit's** (PR #66): larger replies with their actions at the right, subtle thread
  lines that fold their branch when tapped, a band between conversations, a button to the next one. App only; reaches
  testers with an EAS update (owner's approval). Not seen on a device.
- **Snap previews in chats** (PR #67): a lighter frost and a slow drift while unopened, in the app and on the website.
  The preview itself is unchanged (32 pixels). Not seen on a device.
- **One camera for POST and REEL** (branch `camera-post-reel`, no PR yet): BUZZ | POST | REEL | SNAP; one TikTok row
  above the shutter for both (3m, 60s, 15s, Photo); on iOS the camera stays in video mode, so switching never reloads it
  (photos then come from the 1080p video session, 16:9 rather than 4:3, their exact size the phone's; the microphone
  indicator stays on while the camera is open). Merged as PR #68. Not tried on a device: photo size and back-camera
  flash in video mode need checking there.
- **Stories** (PR #69, merged 2026-10-30 17:26 UTC; **migration 58 live since 2026-10-30 19:30 UTC**, applied on its
  own ahead of the release above, so it leaves that release): a row of story rings under Home's tabs with "Your story",
  a full-screen viewer (tap, hold, swipe, pull down; your own views with who), "Your story" beside Post on the publish
  screen with the post's own audience choice; the database keeps the audience, the 24 hours and blocks. Shared from
  the owner's iPhone in Expo Go against production on 2026-10-30: a Texas State story, seen from a second account, and a
  Selected people story, both with exactly 24 hours (a read-only count of production; deleting one on the device and
  the 24-hour expiry not yet watched there). `stories-live` adds: the viewer's
  bar waits for the photo or video and stops while a video buffers, the next photo loads ahead, expired stories leave
  an open tray, and Home's pull to refresh reloads the tray. `stories-media` adds **migration 59** (live since 2026-10-30
  20:30 UTC, applied on its own after 58): a story's photo moves into `uploads/stories/<author>/`, which only its owner reads through the
  API; the database takes a photo from there only and a video only from the author's own uploads, and deletes the
  photo when the story goes (deleted, expired within ten minutes, or its account gone). Stories shared before 59 keep
  their photo where it was. **Migration 60** (branch `post-media-privacy`; live since 2026-10-30 21:46 UTC, applied on its own)
  closes the same gap for every other folder of the uploads bucket: through the API a person's files are listed by that person alone (a Friends-only or Selected
  people post's photos could be found by listing `posts/<their id>/`), a post takes only its author's own uploads, and
  a post's photos are deleted when the post goes. Testers' builds get Stories with an EAS update (owner's approval).
  App only (the website shows no stories yet).
- **Analytics and Business for the UniBuzz team** (branch `admin-analytics-business`, draft PR #60, as of 2026-10-30):
  two new sections of **CampConnect Admin** (`apps/admin`) for owners and admins of the staff in a two-factor session.
  Analytics: growth, active and engaged students, engagement, ad delivery, the review queue and revenue, live, with CSV
  exports. Business: advertisers, campaigns (review with the payment, drafting, schedule and budget, pause), payments,
  a rate card, students' reports and the business audit log. The branch also brings the admin app itself to `main`
  from `step-admin` (without its migrations); the student website and the app are unchanged. **Migration 59**, not
  applied anywhere: until it is, both sections say they need it. Offline tests and `npm run check` pass; not yet run on
  staging as staff with a second factor. See [branches/admin-analytics-business.md](branches/admin-analytics-business.md).
- **Buzz on the website.** The app has the threaded replies, top replies and prompt threads; the
  website still shows two levels of replies, no top reply, and prompt threads as ordinary buzzes
  (categories it has). See [branches/ankur/dev.md](branches/ankur/dev.md).
- **Security fix pending.** A security fix for a live part of the database is ready on a local,
  unpushed branch (2026-10-27) and is **not applied to production**. Its details stay out of this
  repository until production is patched, because the repository is public.
- **Decide and merge `step-admin`.** `admin-analytics-business` (draft PR #60) brings its app, scripts, suites,
  README section and website hunks to `main`'s tree (as of 2026-10-31); what still waits is its migration files'
  placement, production's `_migrations` rows, migration 18 and the `hidden_at` message types: the owner's questions
  1 to 3 and 5 of its merge plan. The website keeps its `/admin` console (decided). See
  [branches/step-admin.md](branches/step-admin.md).
- **Reconcile the Supabase CLI migration history** on production (applied-outside-repo README
  step 5), only after `step-admin` is merged, never with a real `db push`.
- **Fix the duplicate "migration 44" headers** ([migrations.md](migrations.md)).
- **Housekeeping**, when the owner says so: close PRs #43, #44, #46 and #47 without merging (they
  only carry old per-branch `CLAUDE.md` copies, #47 also the stray `app.json`, and conflict with
  `main`); delete the branches
  [branches/README.md](branches/README.md) lists as safe to delete; revert the stray `app.json` on
  `business-portal-prelaunch`; retire `step-1-brand-shell`; remove the leftover `claude/…`
  worktree branch.
- **Optional: hard-coded project refs.** The live project ref is written into the README,
  `docs/technical-reference.md`, `scripts/e2e-home-feed.mjs` and the scripts in
  `apps/mobile/e2e/`. Reading it from `SUPABASE_PROJECT_REF` instead would let them run against a
  staging project. Not a secret (it is part of the public URL), so not urgent.

## Blockers and known risks

| Item | Where it is written up |
| --- | --- |
| Two migrations not on production (44, 46), while `main`, which deploys production, already uses them (47 was applied on 2026-10-27) | [migrations.md](migrations.md) |
| Business v2's code is on `main` (PRs #49 and #51) while migrations 49 and 50 are not on production (read-only check, 2026-10-28): posts, invites and the Ads screens in the portal fail until they are applied | "UniBuzz Business v2 is on `main` without its migrations" above |
| `db:setup` token mode resets the production auth Site URL to localhost by default | [supabase/CLAUDE.md](../supabase/CLAUDE.md) |
| A security fix for a live part of the database is pending | "Security fix pending" above |
| Supabase CLI history empty on production; `supabase db push` would re-run everything | `supabase/applied-outside-repo/README.md` |
| Calls need an Apple Developer Program membership (USD 99/yr); native ring (CallKit/PushKit, Android full-screen intent) not built | README §"Calls" |
| `is_suspended(uuid)` callable while signed out (low severity) | applied-outside-repo README §"Security review" |
| Buzz's `admin.spam` rule pack flags ordinary phrases (staff can turn it off under Rules) | README §"Buzz (anonymous)" |
| A Buzz photo can be dated by Storage's `Last-Modified` despite the publication delay | same |
| Supabase CDN may serve a just-deleted Snap to the same viewer for ~1 minute | README §"Snaps" |
| Supabase free projects pause after a week idle (Pro, USD 25/mo, before real users); built-in auth email is rate-limited (custom SMTP needed) | README §"Production checklist" |
| Vercel Hobby optimizes 5,000 source images a month | README §"Photos" |
| The README still says the Vercel project is not connected to Git, and that 41 and 42 are not live; both are out of date | this file, [migrations.md](migrations.md) |

## Future plans

- **Core, next up:** clubs and organizations (pages to follow and join), campus events, campus
  news (none started); calls switched on (blocked, above); more campuses (a `universities` row
  with its `email_domain` and campus coordinates).
- **Buzz category sections:** buzzes can carry a category (54); how sections show them is not
  decided yet (filter chips on the feed, a page per category, following or muting categories).
- **Explore tools, later:** saved searches with alerts; seller ratings.
- **Long term:** the main digital community for university students worldwide (README
  §"Long-term vision").

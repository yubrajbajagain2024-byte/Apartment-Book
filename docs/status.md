# Project status

As of **2026-10-27**. Sources: the code, commit messages, and the owner's deploy notes (read-only
checks of production). Migration-by-migration status is in [migrations.md](migrations.md); branch
details in [branches/](branches/README.md). Refer to an item below by its title.

## Completed (on `main`)

- **Accounts:** university-email-only sign-up (form + trigger), confirmation email, optional
  Google sign-in, profiles (TikTok style), profile privacy controls, verified-student badge.
- **Social:** follows with private follower lists, threaded comments with likes, sharing to friends,
  blocking, notifications with mutes and mark-all-read, activity status, push (migration 36).
- **Home:** Orbit (posts + reels blend), Buzz tab, Reels viewer, floating "+" on Orbit, the menu
  under your photo; Posts kept as a tabless section.
- **Create flow (app):** camera first (SNAP | POST | REEL | BUZZ, front lens by default), gallery,
  editor, publish with title, link, audience (campus | global | friends | selected) and comments
  switch; roommate posts and Marketplace items made in the same flow, optionally anonymous.
- **Discover tab:** search plus popular posts, topics and accounts per campus (falls back until 44
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
  item, no comments), anonymous listings with per-chat reveal (needs 47).
- **Business portal** (`/business`): live with migration 39.
- **Video:** Mux uploads and tours. **Mobile:** Expo SDK 58 / RN 0.88; Android release build works
  (R8 rule for LiveKit).
- **AI documentation:** the root `CLAUDE.md` (PR #42), restructured on 2026-10-27 into one shared
  file plus these docs (PR #45).

## Open work, in priority order

- **Apply the pending migrations.** Apply 44 and 46 together, then 47, then 49 and 50, then 51 to 54
  (Buzz), to production in database-URL mode ([supabase/CLAUDE.md](../supabase/CLAUDE.md)), confirm with
  `verify.mjs --live`, then publish the app update. Their code is already on `main`, which deploys
  production, so this is overdue. Needs the owner and a credential.
- **UniBuzz Business v2** (merged in PR #49 on 2026-10-27). It upgrades the v1 portal to the business spec:
  - team roles;
  - business posts;
  - the Ads Manager with admin review and recorded payment;
  - Sponsored ads in For You, Reels and Housing;
  - public business profiles;
  - analytics from real events;
  - an Apple-style portal with light and dark modes.

  Order of release (step 2 happened first: PR #49 merged while its docs said 49 and 50 were not on
  production; not checked since):
  1. Apply migrations 49 and 50 to production, after the pending ones above
     ([migrations.md](migrations.md)).
  2. Merge.
  3. Publish the app update.

  Follow-up work is listed in [branches/business-v2.md](branches/business-v2.md).
- **Buzz on the website.** The app has the threaded replies, top replies and prompt threads; the
  website still shows two levels of replies, no top reply, and prompt threads as ordinary buzzes
  (categories it has). See [branches/ankur/dev.md](branches/ankur/dev.md).
- **Security fix pending.** A security fix for a live part of the database is ready on a local,
  unpushed branch (2026-10-27) and is **not applied to production**. Its details stay out of this
  repository until production is patched, because the repository is public.
- **Report auto-hide (migration 55, branch `auto-hide-reports`, 2026-10-28).** Content 10 different
  legitimate people report is hidden, flagged for review in CampConnect Admin, its owner told and the
  hide audited. Built and tested offline; not pushed and not on production. Its review screens go on `step-admin`.
  Release order, each step with the owner's approval:
  1. Apply 55 alone.
  2. Merge.
  3. Deploy the admin app.

  See [branches/auto-hide-reports.md](branches/auto-hide-reports.md).
- **Decide and merge `step-admin`.** Its merge plan lists six open questions for Sunil (migration
  names, who renames production's `_migrations` rows, the fate of `supabase/applied-outside-repo/`,
  a change to admin checks, branch ownership, who resolves the merge). Also reconcile `main`'s
  website `/admin` console with `step-admin`'s rule that the website carries no admin routes. See
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
| Three migrations not on production (44, 46, 47), while `main`, which deploys production, already uses them | [migrations.md](migrations.md) |
| Business v2's code needs migrations 49 and 50, and PR #49 merged it on 2026-10-27: if they are still not live, the portal and the business parts of the student site are broken on production (not checked) | [migrations.md](migrations.md), [branches/business-v2.md](branches/business-v2.md) |
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

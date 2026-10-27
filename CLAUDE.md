# CLAUDE.md — UniBuzz

**Read this first.** It is the hand-off note between AI sessions (and people): what the project
is, where things live, what is done, what is half-done, what is blocked, and what to do next. The
[README](README.md) and [docs/technical-reference.md](docs/technical-reference.md) are the deep
reference (every feature, every migration, setup from scratch); this file is the map and the
current state.

**Two kinds of content.** **§9 is about the branch this copy sits on**: its purpose, how its tree
differs from `main`, and what to do with it. **Every other section describes the whole project and
is identical on every branch**; it was last synced with `main` @ `9227e04` on **2026-10-27**. If
this branch is behind `main`, some files and migrations named outside §9 do not exist in this
tree, and §9 says so.

---

## 0. How to maintain this file

**Standing instruction from the project owner: keep this file current, automatically, after every
significant change.** Update it in the same commit as the work it describes, before you end your
turn. Do not wait to be asked.

**Significant means any of these:**

| Trigger | What to change |
| --- | --- |
| A feature, fix or refactor finished, or deliberately paused | §9 Completed / Current progress; §8 if it changes the project's state |
| Work left unfinished at the end of a session | §9 Current progress + Next steps: what was tried, where it stopped, what is uncommitted |
| A new migration in `supabase/migrations/` | §5 rollout table: number, file, what it adds, **whether it is on the live project** |
| A migration reaches (or fails to reach) production | §5 rollout table, §8 Blockers |
| A test suite added, or a suite now failing | §6, with the date and the result |
| An architectural or product decision | §4, with the reason, so nobody re-opens it |
| A branch created, merged, abandoned or deleted | §7, and §9 on that branch |
| A new blocker, risk, or anything that would surprise the next session | §8 Blockers (even a hunch, marked as one) |
| A new command, env var name, or tool the project depends on | §3 or §11 |

**Not significant:** typo and formatting fixes, read-only exploration, answering a question.

**Rules:**

1. **No credentials, ever.** No access tokens (`sbp_…`), service-role or anon keys, database URLs
   or passwords, LiveKit/Mux/moderation API secrets, Expo/EAS tokens, invite tokens, personal
   emails or phone numbers, and no Supabase project refs. Name the **environment variable** or the
   place that holds the value (`apps/web/.env.local`, Vercel, EAS secrets, Supabase Vault). And
   because the repository is public, no details of an unpatched security weakness. See §11.
2. **State, not prose.** Facts, paths, commit hashes, dates, status. Design narrative belongs in
   the README.
3. **Write what is true, including the ugly parts**: an unapplied migration, a regression, a test
   you could not run. A hidden blocker costs the next session a day.
4. **Date every claim that can go stale** ("applied 2026-10-27", "as of 2026-10-27"), and say where
   a claim comes from when you have not verified it yourself.
5. **Verify before you act on it.** If this file names a file, function, flag or status, check it
   still holds before relying on it.
6. **Keep §9 branch-specific and every other section identical across branches.** Change a shared
   section only for facts about the whole project, so merges conflict in as few lines as possible.
7. **No changelog here.** `git log -p -- CLAUDE.md` is the history; a table of edits would conflict
   on every merge.

**New branch:** it inherits this file. Rewrite §9 for the new branch's purpose and leave the rest.

**Merging:** a conflict in this file is expected, mostly inside §9. Keep the **target** branch's §9,
fold the source branch's finished items into its Completed list and carry over anything still
open; for shared sections keep the newer facts from either side. Each branch received this file in
its own commit on 2026-10-27, so the first merge between two branches after that shows an
*add/add* conflict on `CLAUDE.md`; resolve it the same way.

**Reminder hook (local, optional):** on the owner's machine an uncommitted Claude Code `Stop` hook
(`.claude/settings.local.json` → `.claude/hooks/claude-md-reminder.sh`) asks for an update when
files changed but this file did not. It only reminds you; deciding what is significant is still
your job.

> `apps/web/CLAUDE.md` is **not** project documentation. It is a one-line import of
> `apps/web/AGENTS.md`, a block that `next dev` writes and re-writes itself (Next.js 16 agent
> rules: read `node_modules/next/dist/docs/` before writing Next.js code). Leave both alone.

---

## 1. Project at a glance

**UniBuzz** is a private social network for verified university students. It launches at **Texas
State University**: sign-up is restricted to the email domains on the `universities` table
(`txstate.edu` today), enforced by the form and by a `before insert` trigger on `auth.users`.

**Social network first.** Lead with people, posts, Orbit, Buzz, Reels and messages. Housing,
roommates and the marketplace are *supporting tools* on the Explore tab. They must not set the
app's identity, navigation or wording outside Explore.

**Three surfaces, one Supabase project:**

1. **UniBuzz** (students): the Next.js website and the Expo app (iOS/Android).
2. **UniBuzz Business** at `/business` (its own host once `NEXT_PUBLIC_BUSINESS_SITE_URL` is set):
   listings, deals, inquiries, analytics, staff. Businesses never start conversations.
3. **CampConnect Admin** (staff): on `main`, a Buzz / Trust & Safety console at `/admin` on the
   website. A separate staff app (`apps/admin`) lives **only on the unmerged `step-admin` branch**
   and is deployed from there on its own (§7).

**Naming history: do not "fix" these.** The product was *CampConnect* until 2026-10-26 and is now
**UniBuzz**; the staff app keeps the name *CampConnect Admin*. The project began as *Apartment
Book*, which survives in identifiers only: package names (`@apartment-book/shared`,
`@apartment-book/moderation`), the root package `apartment-book`, the app slug / URL scheme /
bundle id (`apartmentbook`), the Vercel project, the old `origin` URL and old migration comments.
Renaming them breaks builds, deep links and the migration history.

**Stack:** Next.js 16.4 + React 19.3 + Tailwind 4 (web) · Expo SDK 58 / React Native 0.88 (mobile)
· Supabase (Postgres + PostGIS, auth, realtime, storage, Edge Functions) · LiveKit (calls) · Mux
(video) · npm workspaces + Turborepo · Node ≥ 22.18 (`.nvmrc`: 22).

**No custom server.** Security lives in the database as row-level security. The server-side secret
uses are the Buzz moderated write API (`apps/web/src/app/api/buzz`, service role) and Mux.

---

## 2. Repository map

```
apps/
  web/        Next.js website (App Router, src/)
    src/app/(app)/      /, apartments, roommates, marketplace, posts, reels, buzz, messages,
                        profile, notifications, saved, search, settings, deals, two-factor,
                        admin/ (staff console: queue, rules, users, appeals, audit, metrics)
    src/app/(auth)/     login, signup        src/app/auth/   auth callbacks
    src/app/business/   the business portal
    src/app/api/        buzz (moderated writes), video (Mux uploads + webhooks), geocode
    src/app/            also privacy, terms, guidelines, design, sitemap, robots, manifest
    src/components/     UI by area (home, feed, posts, buzz, messages, profile, housing,
                        apartments, roommates, marketplace, business, staff, deals, video, …)
    src/lib/            actions/ (server actions), supabase/ (browser + server clients),
                        buzz-server/ (server-only Buzz writes), staff/, business/, mux.ts, env.ts
    src/proxy.ts        auth guard; also serves the business portal at its own host
    e2e/home-feed.mjs   Playwright check, desktop + phone viewport
  mobile/     Expo app (expo-router)
    src/app/(tabs)/     index (Home), discover, messages, housing (Explore), profile
    src/app/compose/    the create flow: camera → edit → publish; listing, listing-form, listing-preview
    src/app/create/     per-kind entry points: post, reel, buzz, apartment, roommate, item
    src/app/…           buzz, messages, posts, reels, apartments, roommates, marketplace, profile,
                        follows, call, snap, topics, settings, notifications, saved, find-people
    src/lib/calls.ts    CALLS_PAUSED     src/lib/home-scope.ts   SCOPE_TOGGLE_SHOWN
    e2e/                Maestro flows/*.yaml + run.sh, sim-seed.mjs, snap-lifecycle.mjs,
                        call-lifecycle.mjs
packages/
  shared/     everything that is not a UI component: types/ (incl. database.ts), schemas/ (zod),
              queries/ (every read and write), buzz/, trust-safety/, constants.ts, for-you.ts,
              discover.ts, profile.ts, snaps.ts, calls.ts, share.ts, format.ts, …
  moderation/ server-only moderation engine for Buzz (rule packs, PII detector, policy).
              NEVER import it from the app or a client component.
supabase/
  migrations/           47 files, 20260906000000_init.sql first; file order is authoritative
  rollbacks/            *.down.sql for the newer migrations (8 files)
  applied-outside-repo/ 4 migrations production got from step-admin, plus verify.mjs.
                        READ ITS README BEFORE TOUCHING THE LIVE DATABASE
  tests/                32 PGlite suites (*.test.mjs) + harness.mjs; staging/ needs a real project
  functions/livekit-token/   Edge Function that mints LiveKit tokens
  seed.sql              universities with campus coordinates
scripts/      supabase-setup.mjs (db:setup), e2e-check.mjs (db:check), e2e-home-feed.mjs
docs/         technical-reference.md: the old README, every feature's design in full
```

**Hard rules for `packages/shared`:** no imports from `next/*`, `react-dom` or browser globals
(`window`, `document`, `localStorage`); every query takes the Supabase client as its first argument;
keep `src/types/database.ts` in step with the migrations by hand (or regenerate it, README
§"Regenerating database types").

---

## 3. Commands

```bash
npm install                 # once, from the repo root

npm run dev                 # every app (Turborepo)
npm run dev -w web          # the website alone (add -- -p 3060 for another port)
npm run check               # typecheck + lint + build: run before you call work done
npm run typecheck           # ) or one at a time
npm run lint                # )
npm run build               # )

npm run test:shared         # packages/shared unit tests, offline (node --test)
npm run test:moderation     # packages/moderation unit tests, offline
npm run db:test             # every supabase/tests/*.test.mjs in PGlite, offline, ~5 min

cd apps/mobile && npx expo start        # development build; add --go --tunnel for Expo Go
```

Commands that touch a **real Supabase project** need a credential passed on the command line for
that one command, never saved in a file (§11):

```bash
SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… npm run db:setup  # token mode: see §5 before using on production
SUPABASE_DB_URL=… npm run db:setup                               # database-URL mode: migrations + seed only
SUPABASE_ACCESS_TOKEN=… npm run db:check                         # live end-to-end check with throwaway users
SUPABASE_ACCESS_TOKEN=… node supabase/applied-outside-repo/verify.mjs --live   # read-only schema diff
```

**Every push to `main` deploys the website to production**: Vercel has been connected to Git since
2026-10-26, per the owner's deploy notes (the README still says otherwise). `vercel deploy --prod
--yes --archive=tgz` from the repo root deploys the local tree by hand. Publish mobile JS to
installed builds: `cd apps/mobile && npx eas-cli@latest update --channel preview --environment
preview`. **Apply a migration to production before merging code that uses it into `main`** (§5).

---

## 4. Decisions already made (do not re-open without a reason)

| Decision | Why |
| --- | --- |
| Social network first; Explore tools second | Product identity (README §"Product direction") |
| No custom backend; row-level security is the security model | One less thing to run and get wrong; every rule is testable offline in PGlite |
| All non-UI code in `packages/shared` | Web and mobile share everything except screens |
| npm workspaces + Turborepo, not pnpm | Nothing extra to install; Vercel and Expo support it as is |
| Hand-written `types/database.ts` | Kept deliberately in step with the migrations; regenerating is optional |
| Every new migration ships with a `supabase/rollbacks/*.down.sql` and a PGlite suite in `db:test` | Every change is reversible and tested offline, on the repo's and on production's schema order |
| Photos stored untouched; renditions at read time | Photos are the product: originals up to 25 MB, 12 per listing, Next.js images at quality 85–90 with blurred placeholders |
| No payments in the Marketplace | Meet on campus, like Facebook Marketplace |
| Buzz tables unreadable through the API | Only the `buzz_v2_*` functions decide what leaves the database, so a policy mistake cannot leak anonymity |
| Moderation engine is server-only | Its rules must never be bundled into the app |
| Businesses can never start a conversation | Students are never cold-messaged |
| "Sponsored" only for a recorded paid promotion; "Verified Partner" only with evidence | The database refuses either label otherwise |
| Anonymous listings keep no poster on the listing row | Identity lives in `anonymous_listing_owners`, readable by the poster alone; revealed per chat with `reveal_listing_identity()` |
| Calls built, then paused behind `CALLS_PAUSED` | No Apple Developer Program membership, so no iPhone build can carry them; `EXPO_PUBLIC_CALLS_ENABLED=1` turns them on |
| Campus/Global toggle hidden (`SCOPE_TOGGLE_SHOWN = false`) | Every feed stays on the reader's campus for now; the code is kept |
| Posts is a Home section with no tab (`HIDDEN_HOME_SECTIONS = ["posts"]`) | Orbit blends posts and reels; `/?tab=posts` still works |
| Keep legacy identifiers (`apartment-book`, `apartmentbook`) | Renaming breaks builds, deep links and migration history |

---

## 5. Migrations and production rollout

> **A migration must reach the live project *before* the code that uses it is deployed** (and
> merging into `main` deploys).

**Never run `supabase db push`.** The Supabase CLI's own migration history is **empty** on the live
project, so a push would re-run every migration over production. The repo's setup script tracks
what ran in `public._migrations` instead. See `supabase/applied-outside-repo/README.md`
§"Reconciling the migration history" (not done; needs the owner's approval).

**How to apply to production safely.** `npm run db:setup` has two modes:

- **Database-URL mode** (`SUPABASE_DB_URL=…`): runs pending migrations and the seed (an upsert),
  nothing else. **Use this for production.**
- **Token mode** (`SUPABASE_ACCESS_TOKEN=…`): also rewrites `apps/web/.env.local`, refreshes
  Vault, and **sets the auth Site URL to `SITE_URL`, which defaults to `http://localhost:3000`**.
  On production that breaks sign-in emails. Use it only for a fresh or local project, or pass the
  real `SITE_URL` (and `BUSINESS_SITE_URL`) and `SKIP_ENV=1`.

**Since migration 22**, `profiles` and `notifications` are granted to the API **column by column**.
A migration that adds a column to either **must** also
`grant select (that_column) on public.<table> to anon, authenticated`, or the API cannot read it
and `select *` on that table fails. Never grant SELECT on the whole table again.

### Rollout status (as of 2026-10-27)

Assembled from commit messages, `supabase/applied-outside-repo/README.md` and the owner's deploy
notes (read-only checks of production's `public._migrations`, latest 2026-10-27 00:32 UTC). **This
table was not read from the live catalog**; confirm with `verify.mjs --live` before acting on it. The
README's statement that 41 and 42 are not live is out of date.

| # | File | Live? |
| --- | --- | --- |
| 1–37 | `20260906000000_init.sql` … `20261030000000_profile_privacy.sql` | ✅ applied |
| — | 4 admin migrations from `step-admin`: copies in `supabase/applied-outside-repo/` (`…admin`, `…moderation_support`, `…admin_dashboard`, `…hardening`) | ✅ applied 2026-10-25, outside this folder |
| 38 | `20261031000000_reels_feed_like_counts.sql`: restores `post_like_count()` in `reels_feed()` | ✅ applied |
| 39 | `20261101000000_business_portal.sql`: roles, standings, listings, deals, inquiries, analytics, team | ✅ applied 2026-10-25 |
| 40 | `20261102000000_presence_channel_join.sql`: private-channel join check | ✅ applied |
| 41 | `20261103000000_trust_safety.sql`: reports, queue, sanctions, appeals, audit log | ✅ applied 2026-10-26 04:02 UTC (Ankur) |
| 42 | `20261103000100_buzz_v2.sql`: Buzz tables, aliases, serializer, reads and interactions | ✅ applied 2026-10-26 04:02 UTC (Ankur) |
| 43 | `20261103000200_marketplace_video.sql`: one video per Marketplace item | ✅ applied 2026-10-25 |
| 44 | `20261103000300_discover.sql`: Discover rankings (hot posts, trending topics, accounts) | ❌ **not applied** |
| 45 | `20261104000000_post_details.sql`: post title, link, audience, comments switch | ✅ applied 2026-10-27 00:32 UTC |
| 46 | `20261104000100_discover_audience.sql`: `discover_refresh()` ranks Global posts only | ❌ **not applied** |
| 47 | `20261105000000_anonymous_listings.sql`: anonymous roommate/marketplace posts, listing audiences, anonymous inquiry chats | ❌ **not applied** |
| (18) | `20261103100200_staff_invite_email.sql`: **file only on `step-admin`** (in neither `supabase/migrations/` nor `supabase/applied-outside-repo/` here) | ✅ applied |

**What the gaps cost today:** without 44, Discover falls back to newest posts and people; without
47, anonymous listings, listing audiences and anonymous inquiry chats do not work. `main` already
carries the code for 44, 46 and 47, so production's website most likely does too (it deploys from
`main`; not verified).

**Order constraints:** apply in file order. **46 must go live with or before 44**:
`discover_refresh()` runs with definer rights and fills world-readable ranking tables, so without
46 a friends-only or campus-only post's `#tag` would trend for everyone.

**Numbering quirk:** both `20261103000300_discover.sql` and `20261104000000_post_details.sql` call
themselves "migration 44" in their header comments. File order (timestamps) is authoritative;
this table numbers them 44 and 45. Fix the headers when either file is next touched.

---

## 6. Tests

| Suite | Command | Needs | Last result |
| --- | --- | --- | --- |
| `packages/shared` units (17 files) | `npm run test:shared` | Node ≥ 22.18 | ✅ 157/157, 2026-10-27 |
| `packages/moderation` units (6 files) | `npm run test:moderation` | nothing | ✅ 422/422, 2026-10-27 |
| Database: migrations, RLS, functions (32 suites) | `npm run db:test` | nothing (PGlite) | ✅ 1267 checks, 0 failures, 2026-10-27 |
| Typecheck + lint + build | `npm run check` | nothing | not recorded; run before finishing work |
| Live end-to-end | `npm run db:check` | `SUPABASE_ACCESS_TOKEN` | not run 2026-10-27 |
| Schema diff against production | `node supabase/applied-outside-repo/verify.mjs --live` | `SUPABASE_ACCESS_TOKEN` | not run 2026-10-27 |
| Website, desktop + phone | seed `node apps/mobile/e2e/sim-seed.mjs`, `npm run dev -w web -- -p 3060`, `BASE=http://localhost:3060 node apps/web/e2e/home-feed.mjs` | token + Playwright | not run 2026-10-27 |
| App in the iOS Simulator | `cd apps/mobile && e2e/run.sh e2e/flows/00-signed-out.yaml` | Maestro, seeded data | not run 2026-10-27 |
| Snap / call lifecycle on the live project | `node apps/mobile/e2e/snap-lifecycle.mjs`, `…/call-lifecycle.mjs` | `SUPABASE_ACCESS_TOKEN` | not run 2026-10-27 |
| Business portal on a real project | `node supabase/tests/staging/business-portal.mjs` | a staging project | not run 2026-10-27 |

The 2026-10-27 results are for the tree at `9227e04` (`main`, identical to `listing-flow-redesign`).

**Every new migration gets a PGlite suite** in `supabase/tests/` and an entry in the root
`package.json` `db:test` script. Suites that must match production's schema order boot with
`boot({ live: true })` (`supabase/tests/harness.mjs`), which also applies the out-of-repo admin
migrations where they really ran.

---

## 7. Branches

Remote `origin`: GitHub `yubrajbajagain2024-byte/UniBuzz`, **a public repository** (renamed from
`Apartment-Book`; the old URL that `origin` still uses redirects). Default branch: `main`. Work
lands through pull requests (#24 – #40 so far). Facts as of 2026-10-27.

| Branch | What it is | State against `main` |
| --- | --- | --- |
| `main` | integration branch; **every push deploys production** | tip `9227e04` (PR #40) |
| `listing-flow-redesign` | anonymous listings, new Roommate/Marketplace create flow | merged (PR #40); same tree as `main` |
| `create-flow-redesign` | TikTok-style create flow, post titles/links/audiences | merged via `listing-flow-redesign` |
| `ankur/dev` (remote) | Discover tab, Orbit "+", profile menu | merged (PR #38) |
| `ankur/owner-moderation` (remote) | Buzz v2 + Trust & Safety | merged (PR #37) |
| `step-home-feed` | home feed, messages, business portal groundwork | merged (PRs #24 – #33) |
| `business-portal-prelaunch` | business portal | merged; **1 local commit not on `main` or `origin`** (`b09910d`, an accidental stub `app.json`; see §9 there) |
| `step-1-brand-shell` | first brand-and-shell attempt (2026-09-07) | **1 commit never merged**, 178 behind; superseded |
| `step-admin` (remote) | **CampConnect Admin, the separate staff app** + migrations 14–18 | **not merged**: 10 ahead, 141 behind; merge plan in its `docs/step-admin-merge-plan.md` |
| `claude/claude-md-documentation-0b8750` | leftover worktree branch from a 2026-10-26 AI session that drafted this file | at `9227e04`, no commits of its own; safe to delete once this file is on `main` |

---

## 8. Project status (whole project)

### Completed (on `main`)

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
  2026-10-26).
- **Messages:** realtime chats, groups, semester course chats, voice messages, replies,
  attachments, requests, mute; **Snaps** (view-once); **Calls** (built, paused).
- **Explore:** apartments with PostGIS distance and maps, roommates, Marketplace (one video per
  item, no comments), anonymous listings with per-chat reveal (needs 47).
- **Business portal** (`/business`): live with migration 39.
- **Video:** Mux uploads and tours. **Mobile:** Expo SDK 58 / RN 0.88; Android release build works
  (R8 rule for LiveKit).

### Open work, in priority order

1. **Apply migrations 44, 46, 47 to production** in file order, with database-URL mode (§5).
   Their code is already on `main`, which deploys production, so this is overdue. Needs the owner
   and a credential.
2. **Security: tighten who counts as an admin for the business portal's staff actions**
   (`require_admin()` / `is_admin()`, migration 39, live). A fix is being prepared on its own
   branch (started 2026-10-27) and is **not applied to production**. Its details stay out of this
   file and out of PR text until production is patched, because the repository is public (§11).
3. **Decide and merge `step-admin`.** Its merge plan lists six open questions for Sunil (migration
   names, who renames production's `_migrations` rows, the fate of `supabase/applied-outside-repo/`,
   the `require_admin()` change, branch ownership, who resolves the merge). Also reconcile `main`'s
   website `/admin` console with `step-admin`'s rule that the website carries no admin routes.
4. **Reconcile the Supabase CLI migration history** on production (applied-outside-repo README
   step 5), only after item 3, never with a real `db push`.
5. Fix the duplicate "migration 44" header comments (§5).
6. Housekeeping, when the owner says so: drop `b09910d` on `business-portal-prelaunch` (explained
   in its §9), retire `step-1-brand-shell`, remove the leftover `claude/…` worktree branch (§7).

### Blockers and known risks

| Item | Where it is written up |
| --- | --- |
| Three migrations not on production (44, 46, 47), while `main`, which deploys production, already uses them | §5 |
| `db:setup` token mode resets the production auth Site URL to localhost by default | §5 |
| Admin authority for the business portal's staff actions needs tightening (security; live) | §8 item 2 |
| Supabase CLI history empty on production; `supabase db push` would re-run everything | `supabase/applied-outside-repo/README.md` |
| Calls need an Apple Developer Program membership (USD 99/yr); native ring (CallKit/PushKit, Android full-screen intent) not built | README §"Calls" |
| `is_suspended(uuid)` callable while signed out (low severity) | applied-outside-repo README §"Security review" |
| Buzz's `admin.spam` rule pack flags ordinary phrases (staff can turn it off under Rules) | README §"Buzz (anonymous)" |
| A Buzz photo can be dated by Storage's `Last-Modified` despite the publication delay | same |
| Supabase CDN may serve a just-deleted Snap to the same viewer for ~1 minute | README §"Snaps" |
| Supabase free projects pause after a week idle (Pro, USD 25/mo, before real users); built-in auth email is rate-limited (custom SMTP needed) | README §"Production checklist" |
| Vercel Hobby optimizes 5,000 source images a month | README §"Photos" |

---

<!-- BRANCH-STATE:BEGIN: rewrite this section for each branch; every other section is shared -->

## 9. This branch: `step-home-feed`

- **Last updated:** 2026-10-27
- **Tip before this file was added:** `ade98fd` (2026-10-25, "Business portal, paid-only Sponsored
  labels, presence join fix, Reels like counts")
- **Against `main` @ `9227e04`:** 0 ahead, 70 behind. **Fully merged** (PRs #24 – #33). This tree
  has 40 migrations.

**Purpose:** the long-running feature line from mid-October 2026: Home feed, profiles, comments,
sharing, messages, Snaps, calls, push, profile privacy, Expo SDK 58, then the business portal.

### Completed

- Everything on it is in `main`. Its last commit added the business portal (migration 39),
  paid-only "Sponsored" labels, the private-channel presence join fix (migration 40) and restored
  Reels like counts (migration 38); all three migrations are on production.

### Current progress

- Nothing in flight.

### Pending tasks

- None for this branch.

### Blockers

- None for this branch.

### Tests on this branch

- Not run on this tree on 2026-10-27.

### Next steps

1. Historical. Do not develop here; branch from `main`.
2. Safe to delete locally and on `origin` once the owner agrees.

<!-- BRANCH-STATE:END -->

---

## 10. Future plans

**Core, next up:** clubs and organizations (pages to follow and join), campus events, campus news
(none started); calls switched on (blocked, §8); more campuses (a `universities` row with its
`email_domain` and campus coordinates).

**Explore tools, later:** saved searches with alerts; seller ratings.

**Long term:** the main digital community for university students worldwide (README §"Long-term
vision").

---

## 11. Secrets and privacy

**Nothing secret belongs in this file, the README, a migration, a test or a commit message.**

- **The GitHub repository is public.** Every commit, branch and PR is world-readable. Until a
  security fix is live on production, keep how the weakness works and who can exploit it out of
  commits, PR text and this file; push the fix branch after the migration is applied, not before.

- `.gitignore` keeps `.env` and `.env.*` out, except `.env.example` files and `apps/mobile/.env`
  (only `EXPO_PUBLIC_*` values: the public anon key and site URL, safe because RLS does the
  protecting).
- **Never** put the service-role key in a `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` variable or anywhere a
  client can read it.
- Env vars the code reads (**names only**; values live in `apps/web/.env.local`, Vercel, EAS secrets,
  Supabase Edge Function secrets or Vault):
  - web: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`,
    `NEXT_PUBLIC_BUSINESS_SITE_URL`, `NEXT_PUBLIC_MAP_TILE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
    `MODERATION_AI_API_KEY`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`
  - mobile: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SITE_URL`,
    `EXPO_PUBLIC_BUSINESS_SITE_URL`, `EXPO_PUBLIC_CALLS_ENABLED`, `EXPO_PUBLIC_BUZZ_FIXTURES`,
    `CAMPCONNECT_BUNDLE_ID`, `CAMPCONNECT_FREE_SIGNING`
  - Edge Function `livekit-token`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
  - scripts and tests: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`,
    `STAGING_SUPABASE_REF`, `SITE_URL`, `BUSINESS_SITE_URL`, `SKIP_SEED`, `SKIP_MIGRATION`,
    `SKIP_ENV`
  - `step-admin` only: `CRON_SECRET`, `MEDIA_WORKER_ENABLED`
- Supabase Vault holds the project URL, the service key and the Expo push access token so
  `purge_snaps()` and `send_push()` work from inside the database.
- A personal access token (`sbp_…`) or a database URL is passed on the command line for one
  command only; delete the token from the Supabase dashboard afterwards.
- Student data is private by design: `user_activity`, the `buzz_*` tables, `snaps`, `staff*`,
  `account_restrictions` and `media_jobs` are closed to the API entirely (reads go through
  functions); `anonymous_listing_owners` is readable by the poster alone. Do not add a policy or
  grant that opens one of them without working through what it reveals.

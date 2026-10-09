# Apartment Book

A website and app for university students to **find apartments near campus**, **find roommates**, **buy and sell move-in essentials** (mattresses, desks, kitchen gear…), **message each other** in private or group chats, and **share posts, reels and anonymous Buzz threads** on Home. The layout follows the Facebook pattern: a top bar with four tabs (Home, Housing, Messages, Marketplace) plus the search box, a create menu and a profile menu; on phones the bar is Home, Housing, Messages, Marketplace, Profile at the bottom of the screen like the app, where Search is the magnifier in the top-right corner of every tab, TikTok style. Search finds people by name first (with a Follow button on every result), then apartments, roommates and items. Home itself has TikTok-style top tabs, see [Home feed](#home-feed); Housing holds Apartments and Roommates side by side, see [Housing](#housing).

Built with **Next.js 16 + TypeScript + Tailwind** on top of **Supabase** (Postgres, auth, realtime chat, image storage). The backend is a hosted service that iOS/Android apps can talk to directly, and all data-access code lives in a shared package, so the future mobile app reuses everything except the screens.

## Feature map

| Feature | How it is built |
| --- | --- |
| Housing (Apartments and Roommates) | One main tab, two slidable halves (see [Housing](#housing)). Postgres tables with PostGIS: campus and listing coordinates, `apartments_within(university, radius)` for "within 2 miles of campus", distance filled by a trigger. Map view and location picker use Leaflet + OpenStreetMap (free); address search uses Nominatim through `/api/geocode` |
| Marketplace | Same listing pattern with a `category` field. No payments |
| Messaging | Supabase Realtime over `conversations`, `conversation_members`, `messages`. Device push tokens stored in `device_push_tokens` for the future apps |
| Login | `@txstate.edu` only. The allowed domains live on the `universities` table (`email_domain`), the sign-up form validates against them, a `before insert` trigger on `auth.users` rejects everything else, and new users are attached to their university automatically |
| Home feed | Four swipeable tabs, For you first. Posts and reels are `feed_posts` rows with likes, comments and saves; Buzz threads live in `buzz_*` tables that the API cannot read directly, only the `buzz_*` database functions can. The For you blend is pure code in `packages/shared/src/for-you.ts`. See [Home feed](#home-feed) |
| Following | Follow people from their profile, like Instagram. Every profile shows follower / following counts that open the two lists, Home → Posts has a "Following" filter with only the posts of people you follow, and a notification tells you when someone starts following you; blocking someone ends the follow both ways. Migration 14 (`supabase/migrations/20260923000000_follows.sql`) adds the `follows` table and the `follow_stats` / `following_posts` functions |
| Comments | Under every post, reel and listing, Instagram style: threaded replies (answer a comment and it nests under it; the indent stops at three levels, `COMMENT_MAX_DEPTH`), thumbs up / down with a score, delete your own comment or any comment on your post (its replies go with it), and a notification for the author of the comment you answered ("… replied to your comment"; the post owner keeps the usual "commented on your post", one message when they are the same person). Migration 15 (`supabase/migrations/20260924000000_comment_threads.sql`) adds `post_comments.parent_id` and `score` (the sum of the votes, kept by trigger), the `post_comment_votes` table (readable like `post_likes`, written only through the `post_comment_vote()` function: 1 up, -1 down, 0 clears) and the reply notification; `threadComments` in `packages/shared` puts the flat rows in thread order for the website and the app alike |

## Photos: full quality, built to hook

Photos are the product, so the pipeline never degrades them:

- **Originals are stored untouched.** The browser uploads the exact file to Supabase Storage (JPG, PNG, WEBP, GIF or HEIC, up to 25 MB each, up to 12 per listing). Nothing is resized or re-encoded on upload.
- **Sharp on every screen.** Feeds and detail pages render through Next.js image optimization at quality 85 to 90 in AVIF/WebP with a size chosen for the viewer's screen (`images.qualities`, `deviceSizes` and `formats` in `apps/web/next.config.ts`). The full-screen viewer shows the original file itself, and its "Original" button opens it directly.
- **No blank boxes.** At upload time the browser reads each photo's dimensions and builds a tiny blurred preview (about 1 KB) that is saved as `image_meta` next to the listing. Feeds show the blur instantly and fade in the real photo, and layouts never jump.
- **Instagram-style feed.** Cards are photo-first with swipeable multi-photo carousels, a photo counter and dots, price overlaid on the photo, a bookmark button, and double-tap to save with a burst animation. Feeds load more as you scroll ("You're all caught up" at the end) and open with a stories-style strip: closest to campus on Home, fresh finds on Marketplace.
- **Detail pages.** Swipeable hero, thumbnail strip, and a full-screen viewer with swipe, arrow keys, double-tap zoom and the original download.
- **Uploader.** Drag and drop or pick files, instant previews while uploading, per-photo progress and errors, reorder, and "Make cover".

Vercel's Hobby plan optimizes up to 5,000 distinct source images per month. If the site outgrows that, upgrade the Vercel plan or move rendition generation to Supabase image transformations (Pro plan).

## Notifications

A `notifications` table that only its recipient can read, mark or delete; rows are created by database triggers so the mobile app gets them for free: a new message (repeated messages in one chat refresh a single unread entry), someone saved your listing, someone started following you (one entry per follower, however often they follow and unfollow), someone replied to your comment, and a new place pinned within 2 miles of your campus (opt-in per person in Settings). The top bar shows a bell with a live count and dropdown; `/notifications` lists everything. Push delivery can later use the same rows plus the stored device tokens.

## Home feed

Home has four tabs in TikTok's layout, left to right: **For you | Buzz | Posts | Reels**. They are swipeable: in the app the four pages sit side by side in a pager, and on the website a sideways touch swipe across the section body moves to the neighbouring tab (touch screens only; a multi-photo carousel keeps its own swipes). In the app the labels sit in a floating top bar over the feed, with the "+" (create) on its left and the Search magnifier on its right: the same icon every other tab shows in the top-right corner of its header, like TikTok, while the bottom bar reads Home, Housing, Messages, Marketplace, Profile. For you is the landing tab and keeps the clean `/` address, the others live at `/?tab=buzz`, `/?tab=posts` and `/?tab=reels`. The order and the addresses come from `HOME_SECTIONS` and `homeSectionHref` in `packages/shared/src/constants.ts`, so the website and the app always agree.

| Tab | What it shows |
| --- | --- |
| For you | Posts, reels and hot Buzz threads blended into one feed. `blendForYou` in `packages/shared/src/for-you.ts` spreads them in a fixed pattern (post, Buzz, post, reel, post, Buzz, post, post, reel, Buzz, post), each kind keeping its own order (posts and reels newest first, Buzz by Hot), so a page looks the same on every device and every reload. Each kind is paged on its own (`FOR_YOU_PAGE`: 6 posts, 3 threads and 2 reels per page), so page two never repeats page one; a kind that runs short is skipped and the others fill in. Works signed out |
| Buzz | Anonymous threads, Reddit style: topic, votes, nested replies, Hot / New / Top and search. Rows and threads show an alias ("Student 12345"), never a name, photo or user id. The `buzz_*` tables cannot be read through the API at all; threads are only reachable through the `buzz_*` database functions (`buzz_feed`, `buzz_get`, `buzz_create`, `buzz_reply`, `buzz_vote`, …), which decide what leaves the database |
| Posts | Instagram style: photo-first rows with swipeable carousels, heart / comment / share / bookmark (the heart pops when tapped and a double tap on the photo likes with a big heart burst; in the app the like also buzzes the phone through `expo-haptics`), "Liked by …", a caption with hashtags, the newest comment and, behind the comment icon, the thread itself: thumbs up / down with a score, replies nested under the comment they answer, delete |
| Reels | Vertical full-screen video (reels and apartment video tours), one at a time, autoplay with a shared sound button; the heart in the side rail and a double tap on the video like it with the same heart burst (and buzz in the app), the comment icon opens the same thread in a drawer |

Checks for the Home feed:

| Check | How |
| --- | --- |
| The For you blend, the Home and Housing tab order and addresses (unit tests, no network, Node 22.18+) | `npm run test:shared` |
| Migrations, row-level security, the `buzz_*` functions, following (`supabase/tests/follows.test.mjs`: the `follows` policies, `follow_stats`, `following_posts`, the follow notification, blocking, account deletion) and comment threads (`supabase/tests/comment-threads.test.mjs`: replies and their parent checks, `post_comment_vote()` and the score, the reply notification, deletion with its replies, blocking), offline in PGlite | `npm run db:test` |
| The website's Home and Housing on a desktop and a phone viewport, the top bar and the phone bottom bar, swipes, following (the Follow button on a profile, the follower list, Posts → Following) and the comment thread under a post (thumbs up and clear it, reply, delete) included (Playwright) | seed data with `SUPABASE_ACCESS_TOKEN=sbp_… node apps/mobile/e2e/sim-seed.mjs`, start the site (`npm run dev -w web -- -p 3060`), then `BASE=http://localhost:3060 node apps/web/e2e/home-feed.mjs` (add `PLAYWRIGHT_CHANNEL=chrome` to use the installed Chrome instead of downloading Playwright's browser) |
| The app in the iOS Simulator (Maestro) | the flows in `apps/mobile/e2e/flows/`: `e2e/run.sh e2e/flows/00-signed-out.yaml` from `apps/mobile`, with the same seeded data (see `apps/mobile/README.md`) |

## Housing

Housing is one main tab with two halves, left to right: **Apartments | Roommates**. Like the Home tabs they are slidable: in the app the two feeds sit side by side in a pager under the Housing header (tap a label or swipe), and on the website a sticky Apartments | Roommates bar sits under the navbar and a sideways touch swipe across the page moves to the other half (touch screens only; the photo rail, the map and a multi-photo carousel keep their own swipes). Apartments is the landing half. The website keeps the `/apartments` and `/roommates` addresses, so listing links, filters and the `?university=` query are unchanged; the Housing tab in the navbar links to `/apartments` and stays highlighted on both. In the app the floating "+" follows the visible half: "List an apartment" on Apartments, "Create roommate post" on Roommates. The order and the addresses come from `HOUSING_SECTIONS`, `DEFAULT_HOUSING_SECTION` and `housingSectionHref` in `packages/shared/src/constants.ts`, so the website and the app always agree.

## Video tours (Mux)

Video is the main attraction, so it gets a real pipeline:

- **Upload straight to the provider.** `POST /api/video/uploads` creates a direct-upload URL at Mux and a `media` row; the browser (or the app, with `Authorization: Bearer <token>`) sends the untouched file there in resumable chunks with progress, so a dropped connection resumes instead of restarting. Nothing passes through our server.
- **Processing.** Mux converts the original into adaptive streams (HLS, up to 4K with `video_quality: plus`) and a poster frame. `GET /api/video/{mediaId}` checks the provider and updates the row until it is `ready`; the uploader polls it. Optionally set `MUX_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` and point a Mux webhook at `/api/video/webhooks/mux` for push updates.
- **Listings** store a snapshot of ready videos in `videos` (jsonb); a trigger keeps `has_video` in sync. The feed query ranks `has_video` first, then newest, and the "Video tours only" filter uses the same column. Both rules live in the database, not in the web page.
- **Recording in the browser.** "Record a tour" opens the camera with a room-by-room checklist (front door, living room, kitchen, bedroom, bathroom, window view). Phones can also open the camera app directly. Any phone format is accepted, iPhone .mov included, up to 2 GB.
- **Playback.** Feed videos autoplay muted when in view, one at a time, with a shared mute button; detail pages show the video first in the gallery.

Environment: `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` (Mux → Settings → Access Tokens, Mux Video read + write) on the server only. The `.env.example` lists them. Mux bills per minute stored and delivered.

## Architecture checklist

| Decision | Status |
| --- | --- |
| Web: Next.js (React, TypeScript) | Done: `apps/web` |
| Mobile later: Expo (React Native) | Ready: the shared package was verified to type-check and bundle inside an Expo SDK 57 app (see [Moving to iOS and Android](#3-moving-to-ios-and-android-later)) |
| Backend: Supabase (Postgres, auth, realtime, storage) with no custom server | Done: `supabase/migrations`, security enforced with row-level security |
| Monorepo from day one with Turborepo | Done: npm workspaces + Turborepo (`turbo.json`): `apps/web`, `packages/shared`, `apps/mobile` later |
| Everything that is not a UI component lives in `packages/shared` | Done: types, zod validation, all Supabase queries, price/date formatting, constants. The web app only keeps Next.js-specific code (server actions, cookies, `cn()` for Tailwind) |

Why npm workspaces rather than pnpm: nothing to install for a new contributor, Vercel and Expo support it out of the box, and Turborepo provides the task pipeline and caching either way. Switching to pnpm later is a matter of adding `pnpm-workspace.yaml` and re-installing.

## What is included

| Area | Features |
| --- | --- |
| Accounts | Sign-up restricted to verified university emails (`@txstate.edu`), enforced in the form and by a database trigger; confirmation email; Google sign-in (optional, limited to the same domain); profile with photo, university (attached automatically from the email), program, bio; "Verified student" badge |
| Housing → Apartments | Listings with photos, rent, address, a map pin (address search or click-to-pin), distance to campus computed automatically with PostGIS, beds/baths, amenities, availability, lease length; list and map views; filters (university, "within 1/2/5/10 miles of campus", price, bedrooms, furnished, pets, sort); save; message the owner; mark as rented; edit/delete |
| Housing → Roommates | "I have a room" / "I need a room" posts with budget, move-in date, area (optionally pinned on the map with distance to campus), gender preference, sleep schedule, cleanliness, smoking/pets; filters incl. distance from campus; save; message |
| Marketplace | Items with photos, price (or free), category, condition, pickup location; filters; save; message the seller; mark as sold. No payments on purpose: meet on campus, like Facebook Marketplace |
| Messages | Conversations with participants (a group is simply a conversation with 3+ people): 1:1 chats, group chats (create, rename, add people, leave), Supabase Realtime delivery, unread badges, photo messages, "Message" buttons that pre-fill a first message about the listing. A `device_push_tokens` table is ready for the mobile apps |
| Social | Following, like Instagram: a Follow button on every other person's profile ("Following" once you follow, "Follow back" when they follow you), follower / following counts with the two lists behind them (public, like the profiles), a "Following" filter on Home → Posts, and a notification when someone follows you. Blocking someone removes the follow in both directions and stops new ones; row-level security only lets you add or remove your own follows |
| Comments | Under posts, reels and listings: threaded replies, thumbs up / down with a score, delete your own comment or any comment on your post; the author of a comment you answer gets a notification |
| Other | Global search across all three sections, saved listings page, public profile pages with a person's listings, "add your university", SEO metadata + sitemap, PWA manifest |

Security is enforced in the database with row-level security: users can only edit their own listings, only conversation members can read or send messages, and images can only be uploaded to a user's own folder.

## Project structure

```
apartment-book/
├─ apps/
│  ├─ web/                    # Next.js website (App Router, src/ layout)
│  │  ├─ src/app/             # routes: (app)/ has the main site, (auth)/ login + signup
│  │  ├─ src/components/      # UI: layout, home (For you, Buzz, Posts, Reels), housing (the Apartments | Roommates bar and swipe), apartments, roommates, marketplace, messages, profile
│  │  ├─ src/lib/actions/     # server actions (create/edit/delete, auth, chat)
│  │  ├─ src/lib/supabase/    # Supabase clients for browser and server
│  │  ├─ src/proxy.ts         # auth guard: refreshes sessions, protects private routes
│  │  └─ e2e/                 # home-feed.mjs: Playwright check of the navigation, Home and Housing on a desktop and a phone viewport
│  └─ mobile/                 # Expo app for iOS and Android (see apps/mobile/README.md)
│     ├─ src/app/(tabs)/      # bottom tabs: index.tsx (Home), housing.tsx (Apartments | Roommates), messages, marketplace, profile; Search opens from the top-right magnifier
│     ├─ src/components/      # UI: home (the Home pager), housing (the Housing pager), post cards, carousels, forms…
│     └─ e2e/                 # Maestro flows (flows/*.yaml), sim-seed.mjs test data, run.sh
├─ packages/
│  └─ shared/                 # platform-agnostic code reused by the website and the app
│     ├─ src/
│     │  ├─ types/            # Database types + models
│     │  ├─ schemas/          # zod validation for every form
│     │  ├─ queries/          # all reads/writes (apartments, items, roommates, messages, feed, follows, buzz, for-you, storage…)
│     │  ├─ for-you.ts        # blendForYou: the fixed pattern behind Home → For you
│     │  └─ constants.ts      # categories, amenities, currencies, HOME_SECTIONS, HOUSING_SECTIONS…
│     └─ tests/               # unit tests (npm run test:shared)
├─ supabase/
│  ├─ migrations/             # database schema, policies and functions, one file per change (first: 20260906000000_init.sql)
│  ├─ tests/                  # offline database tests in PGlite (npm run db:test)
│  └─ seed.sql                # starter list of universities
├─ scripts/                   # supabase-setup.mjs (one-shot setup), e2e-check.mjs and e2e-home-feed.mjs (live backend checks)
├─ turbo.json                 # Turborepo task pipeline (typecheck -> lint -> build, with caching)
└─ package.json               # npm workspaces root
```

Rules for `packages/shared`: no imports from `next/*`, `react-dom` or browser globals (`window`, `document`, `localStorage`); every query takes the Supabase client as its first argument; keep `types/database.ts` in sync with the migration. The web app's ESLint and type-check run through Turborepo (`npm run check`); the shared package's unit tests run with `npm run test:shared` (plain `node --test` on Node 22.18+, no network).

## 1. Run it locally

Requirements: Node.js 22.18 or newer (the shared unit tests load TypeScript files directly) and npm.

```bash
npm install
```

### Project status

The Supabase project for this app (`dskbzoqreandwwpxiplh`, region us-west-2) is already set up: the migrations and the universities (with campus coordinates and the `txstate.edu` domain) are loaded, `apps/web/.env.local` is written, and the auth URLs point at `http://localhost:3000`. Sign-ups therefore require a `@txstate.edu` address right now. The steps below are for reference, for a second environment, or if you start a fresh project.

Each new migration has to reach the live project before the code that uses it: migrations 14, `supabase/migrations/20260923000000_follows.sql` (the `follows` table, the `follow_stats` and `following_posts` functions and the follow notification), and 15, `supabase/migrations/20260924000000_comment_threads.sql` (`post_comments.parent_id` and `score`, the `post_comment_votes` table and the `post_comment_vote()` function), must be applied with `SUPABASE_ACCESS_TOKEN=sbp_xxx npm run db:setup` before this version of the website or the app is deployed, or every profile page, Home → Posts → Following and every comment thread will fail.

### Fastest path: the setup script

Create a personal access token at https://supabase.com/dashboard/account/tokens, then:

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx npm run db:setup      # migration + seed + .env.local + auth URLs
SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=<ref> npm run db:check   # live end-to-end check
```

`db:setup` applies any migration that has not been applied yet and re-runs the seed as an upsert, so it is safe to re-run (for example with `SITE_URL=https://yourdomain.com` after you go live). `db:check` creates two temporary users, exercises listings, chat (including realtime), and photo uploads, then deletes them. Delete the access token from the dashboard when you are done with it.

### Create the Supabase backend by hand (free)

1. Go to https://supabase.com, create an account and a new project. Pick a region close to your students. Save the database password somewhere safe.
2. In the dashboard open **SQL Editor → New query** and run each file in `supabase/migrations/` in order (`20260906000000_init.sql`, then `20260907000000_geo_push_domains.sql`). They create all tables, security policies, chat functions, PostGIS columns, the `uploads` image bucket, realtime for chat, push tokens and the university-email rule.
3. Run `supabase/seed.sql` the same way to load the universities with campus coordinates. Texas State University carries the `txstate.edu` email domain; to open the app to another university, set `email_domain` on its row (SQL: `update universities set email_domain = 'utexas.edu' where name = 'University of Texas at Austin'`).
4. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` for now (change to your domain later).
   - The migration enables the PostGIS extension automatically (it is available on every Supabase project).
   - Redirect URLs: add `http://localhost:3000/auth/callback` (and later `https://yourdomain.com/auth/callback`).
5. **Authentication → Providers → Email** is on by default. Keep "Confirm email" on for production. While developing you can turn it off so sign-ups log in immediately.
6. Optional, recommended: **Authentication → Emails → Templates → Confirm signup**: replace the link with
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=/settings/profile?welcome=1`
   so confirmation links work from any device or browser.
7. Optional: Google sign-in. In Google Cloud Console create OAuth credentials (Web application) with the redirect URI shown in **Supabase → Authentication → Providers → Google**, then paste the client ID and secret there and enable the provider.

### Configure the website

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in the values from **Supabase → Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   (the anon / publishable key, never the service_role key)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### Start

```bash
npm run dev
```

Open http://localhost:3000, create an account, set your university in Settings, and post a listing. Open a second browser (or a private window) with another account to try messaging: messages arrive instantly without refreshing.

Other scripts (all run through Turborepo): `npm run build`, `npm run lint`, `npm run typecheck`, and `npm run check` which runs all three with caching.

## 2. Put it online (hosting + domain)

The website is designed for **Vercel** (the company behind Next.js; free Hobby plan is enough to start) with Supabase as the backend.

### Current deployment

The site is live at **https://apartment-book-vyass.vercel.app** (Vercel project `apartment-book` in the `vyass` team of the `yubrajbajagain2024-2020` account, Root Directory `apps/web`, production environment variables set, Deployment Protection turned off so the public can reach it). Supabase's auth Site URL points at that address. To ship a new version from this machine:

```bash
git push                 # keeps GitHub in sync (yubrajbajagain2024-byte/Apartment-Book)
vercel deploy --prod --yes --archive=tgz   # from the repository root
```

To deploy automatically on every push instead, connect the GitHub repository in the Vercel dashboard (Project → Settings → Git). The `.vercelignore` file keeps build caches out of CLI uploads. Run each new file in `supabase/migrations/` on the live project (or `npm run db:setup`) before deploying code that depends on it.

### Deploy to Vercel (from scratch)

1. Put the project on GitHub:
   ```bash
   git init
   git add .
   git commit -m "Apartment Book"
   # create an empty repo on github.com, then:
   git remote add origin https://github.com/<you>/apartment-book.git
   git push -u origin main
   ```
2. Go to https://vercel.com, sign in with GitHub, click **Add New → Project** and import the repo.
3. In the import screen set **Root Directory** to `apps/web` (Vercel detects the npm workspace automatically).
4. Add the three environment variables from `.env.local`, but with `NEXT_PUBLIC_SITE_URL` set to your real address (for now the `https://<project>.vercel.app` URL Vercel gives you).
5. Click **Deploy**. Every push to `main` redeploys automatically.
6. Back in Supabase → Authentication → URL Configuration, set the Site URL to your Vercel URL and add `https://<project>.vercel.app/auth/callback` to Redirect URLs.

Alternative without GitHub: `npm i -g vercel`, then run `vercel` inside `apps/web` and follow the prompts.

### Connect your own domain

1. Buy a domain from any registrar (Namecheap, Cloudflare Registrar, Porkbun, GoDaddy, Google Domains alternatives). Something like `yourbrand.com` costs roughly USD 10–15 per year.
2. In Vercel open the project → **Settings → Domains** → add `yourbrand.com` and `www.yourbrand.com`.
3. Vercel shows the DNS records to create at your registrar (typically an `A` record pointing to Vercel's IP for the root domain and a `CNAME` for `www`). Add them in the registrar's DNS panel; the site is live on your domain once DNS propagates (minutes to a few hours). HTTPS certificates are automatic.
4. Update `NEXT_PUBLIC_SITE_URL` in Vercel to `https://yourbrand.com` and redeploy.
5. Update Supabase: Site URL `https://yourbrand.com`, add `https://yourbrand.com/auth/callback` to Redirect URLs.

### Production checklist

- Supabase free projects pause after a week of inactivity; upgrade to the Pro plan (USD 25/month) before real users arrive, which also adds daily backups.
- Supabase's built-in email sender is rate-limited (a few emails per hour). For real sign-ups configure **custom SMTP** (Resend, Postmark, Brevo, SendGrid all have free tiers) under Authentication → Emails → SMTP Settings.
- Keep "Confirm email" enabled so only real mailboxes can sign up. Sign-ups are already limited to the university domains stored on the `universities` table.
- Map tiles come from OpenStreetMap, which is fine for a student site. If traffic grows, set `NEXT_PUBLIC_MAP_TILE_URL` to a MapTiler or Stadia tile URL with your key (both have free tiers).
- Turn on **Vercel Analytics** (free) in the Vercel dashboard for traffic numbers.
- Never expose the `service_role` key in the app. The website only uses the anon key; row-level security does the rest.

## 3. Moving to iOS and Android later

Nothing in the backend has to change, and the shared package already works in React Native: it was verified by creating an Expo SDK 57 app inside a copy of this monorepo, importing `listApartments`, `apartmentSchema`, `formatPrice` and `timeAgo` from `@apartment-book/shared`, type-checking it, and producing a Metro/Hermes bundle. The steps:

1. Scaffold the app inside the monorepo:
   ```bash
   npx create-expo-app@latest apps/mobile --template blank-typescript --no-install
   ```
2. Add these to `apps/mobile/package.json` under `dependencies`, then run `npm install` from the repository root:
   ```json
   "@apartment-book/shared": "0.1.0",
   "@supabase/supabase-js": "^2.115.0"
   ```
   Expo configures Metro for monorepos automatically (SDK 52 and newer). Next.js and Expo both use React 19.2; if npm ever ends up with two React versions (symptom: "Invalid hook call"), pin the same `react` version in both apps.
3. Create the Supabase client the same way as `apps/web/src/lib/supabase/client.ts`, storing the session with `expo-secure-store` (see the Supabase Expo guide), and add the URL and anon key to `app.json` `extra` or an `.env` file.
4. Reuse the shared code in screens:
   ```tsx
   import { listApartments, formatPrice, type ApartmentWithOwner } from "@apartment-book/shared";
   const page = await listApartments(supabase, { universityId, sort: "newest" });
   ```
   Chat uses the same `supabase.channel(...).on("postgres_changes", …)` subscription as `apps/web/src/components/messages/chat-window.tsx`. Three rules learned the hard way, all encoded in `apps/web/src/lib/supabase/client.ts`: set the user's token on the realtime socket before a channel joins (a channel that joins before the session is loaded stays anonymous and row-level security hides every event), give every subscription a fresh channel name, and pass `postgres_changes_options: { wait: true }` so `SUBSCRIBED` means the server is actually streaming. Photo uploads call `uploadImage` with an `ArrayBuffer` read from the picked image (`await fetch(asset.uri).then((r) => r.arrayBuffer())`).
5. Add `"dev": "expo start"` and `"typecheck": "tsc --noEmit"` scripts so Turborepo picks the app up, then ship with **EAS Build**. You will need an Apple Developer account (USD 99/year) and a Google Play developer account (USD 25 once). Push notifications for new messages can be added with Expo Notifications plus a small Supabase Edge Function triggered on message insert.

Until then, the site already works as an installable web app: on a phone, "Add to Home Screen" gives it an icon and a full-screen experience.

## Regenerating database types

`packages/shared/src/types/database.ts` is written by hand to match the migration. If you change the schema, either edit it or generate it with the Supabase CLI:

```bash
npx supabase login
npx supabase gen types typescript --project-id <your-project-ref> > packages/shared/src/types/database.ts
```

## Ideas for later

Map view with pins (Google Maps or Mapbox), university email verification badges, reporting/blocking users, saved searches with email alerts, push notifications, ratings for sellers, and an admin dashboard for moderation.

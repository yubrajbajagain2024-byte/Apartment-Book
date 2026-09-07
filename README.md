# Apartment Book

A website for university students to **find apartments near campus**, **find roommates**, **buy and sell move-in essentials** (mattresses, desks, kitchen gear…) and **message each other** in private or group chats. The layout follows the Facebook pattern: a top bar with four tabs (Home = apartments, Roommates, Marketplace, Messages), a create menu and a profile menu; on phones the tabs move to a bottom bar.

Built with **Next.js 16 + TypeScript + Tailwind** on top of **Supabase** (Postgres, auth, realtime chat, image storage). The backend is a hosted service that iOS/Android apps can talk to directly, and all data-access code lives in a shared package, so the future mobile app reuses everything except the screens.

## Feature map

| Feature | How it is built |
| --- | --- |
| Apartments and roommates | Postgres tables with PostGIS: campus and listing coordinates, `apartments_within(university, radius)` for "within 2 miles of campus", distance filled by a trigger. Map view and location picker use Leaflet + OpenStreetMap (free); address search uses Nominatim through `/api/geocode` |
| Marketplace | Same listing pattern with a `category` field. No payments |
| Messaging | Supabase Realtime over `conversations`, `conversation_members`, `messages`. Device push tokens stored in `device_push_tokens` for the future apps |
| Login | `@txstate.edu` only. The allowed domains live on the `universities` table (`email_domain`), the sign-up form validates against them, a `before insert` trigger on `auth.users` rejects everything else, and new users are attached to their university automatically |

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
| Home / Apartments | Listings with photos, rent, address, a map pin (address search or click-to-pin), distance to campus computed automatically with PostGIS, beds/baths, amenities, availability, lease length; list and map views; filters (university, "within 1/2/5/10 miles of campus", price, bedrooms, furnished, pets, sort); save; message the owner; mark as rented; edit/delete |
| Roommates | "I have a room" / "I need a room" posts with budget, move-in date, area (optionally pinned on the map with distance to campus), gender preference, sleep schedule, cleanliness, smoking/pets; filters incl. distance from campus; save; message |
| Marketplace | Items with photos, price (or free), category, condition, pickup location; filters; save; message the seller; mark as sold. No payments on purpose: meet on campus, like Facebook Marketplace |
| Messages | Conversations with participants (a group is simply a conversation with 3+ people): 1:1 chats, group chats (create, rename, add people, leave), Supabase Realtime delivery, unread badges, photo messages, "Message" buttons that pre-fill a first message about the listing. A `device_push_tokens` table is ready for the mobile apps |
| Other | Global search across all three sections, saved listings page, public profile pages with a person's listings, "add your university", SEO metadata + sitemap, PWA manifest |

Security is enforced in the database with row-level security: users can only edit their own listings, only conversation members can read or send messages, and images can only be uploaded to a user's own folder.

## Project structure

```
apartment-book/
├─ apps/
│  └─ web/                    # Next.js website (App Router, src/ layout)
│     ├─ src/app/             # routes: (app)/ has the main site, (auth)/ login + signup
│     ├─ src/components/      # UI: layout, apartments, roommates, marketplace, messages, profile
│     ├─ src/lib/actions/     # server actions (create/edit/delete, auth, chat)
│     ├─ src/lib/supabase/    # Supabase clients for browser and server
│     └─ src/proxy.ts         # auth guard: refreshes sessions, protects private routes
├─ packages/
│  └─ shared/                 # platform-agnostic code reused by the future mobile app
│     └─ src/
│        ├─ types/            # Database types + models
│        ├─ schemas/          # zod validation for every form
│        ├─ queries/          # all reads/writes (apartments, items, roommates, messages, storage…)
│        └─ constants.ts      # categories, amenities, currencies…
├─ supabase/
│  ├─ migrations/20260906000000_init.sql   # full database schema, policies, chat functions
│  └─ seed.sql                             # starter list of universities
├─ scripts/                   # supabase-setup.mjs (one-shot setup), e2e-check.mjs (live backend check)
├─ turbo.json                 # Turborepo task pipeline (typecheck -> lint -> build, with caching)
└─ package.json               # npm workspaces root
```

Rules for `packages/shared`: no imports from `next/*`, `react-dom` or browser globals (`window`, `document`, `localStorage`); every query takes the Supabase client as its first argument; keep `types/database.ts` in sync with the migration. The web app's ESLint and type-check run through Turborepo (`npm run check`).

## 1. Run it locally

Requirements: Node.js 20 or newer (22 recommended) and npm.

```bash
npm install
```

### Project status

The Supabase project for this app (`dskbzoqreandwwpxiplh`, region us-west-2) is already set up: both migrations and the universities (with campus coordinates and the `txstate.edu` domain) are loaded, `apps/web/.env.local` is written, and the auth URLs point at `http://localhost:3000`. Sign-ups therefore require a `@txstate.edu` address right now. The steps below are for reference, for a second environment, or if you start a fresh project.

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

To deploy automatically on every push instead, connect the GitHub repository in the Vercel dashboard (Project → Settings → Git). The `.vercelignore` file keeps build caches out of CLI uploads.

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

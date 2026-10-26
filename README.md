# CampConnect

**A private social network for university life — connecting students, clubs, events, campus news, housing, and the student marketplace in one place.**

## What CampConnect is

CampConnect is a **social network for verified university students**. Students post photos, videos and reels, talk anonymously in Buzz, message each other and their classes, and follow the people around them. Each university is its own private community: students mainly see their own campus's people, clubs, events, discussions and news.

It launches first at **Texas State University (TXST)**, with plans to expand to campuses worldwide.

Facebook began as a network for college students and then became a network for everyone. CampConnect brings back that university-only feel. It isn't a general social network, and it isn't an apartment finder. It's the digital home of campus life.

## The core: the social network

This is the product. New work, navigation and wording should start here.

| Feature | What students get |
| --- | --- |
| **For You** | A personalized feed of photos, videos and posts from their campus. |
| **Buzz** | Anonymous campus discussions, questions and opinions, with upvotes and threaded replies. |
| **Reels** | TikTok-style short videos, full screen. |
| **Messages** | Private chats, group chats and automatic class group chats, with voice messages, replies and view-once Snaps. |
| **Profiles** | University-verified identities with major, graduation year, bio, followers and privacy controls. |
| **Search** | Find students to follow first, plus the housing, roommate and marketplace listings from Explore. |

**Coming next**, and part of the core:
- **Clubs and organizations:** pages to follow and join.
- **Events:** campus activities, club meetings, career fairs and hackathons.
- **Campus news:** university and student news.
- **Calls:** audio and video calls in any chat. They are built and paused behind a "Coming soon" label.

## Supporting features: tools for student life

These help students with everyday campus life and keep them in their community. They live together on the **Explore** tab.

| Tool | What it does |
| --- | --- |
| **Housing** | Apartments and subleases near campus, including listings from local apartment communities. |
| **Roommates** | Posts from students who have a room to share or are looking for one. |
| **Marketplace** | Buy, sell, trade or give away furniture, electronics, textbooks, bikes and more. |

## Product direction for developers and AI assistants

Read this before changing the product:

- **Social first.** CampConnect is a social network. Lead with people, posts, Buzz, Reels and messages. Housing, roommates and the marketplace are supporting tools, so don't let them set the app's identity, navigation or wording outside Explore.
- **Campus first.** Every feature belongs to a university community, and only verified students join, with a university email. Within a campus the university goes without saying: a feed doesn't need to repeat "Texas State University" under every name.
- **Businesses stay off the social side.** Local businesses reach students through the business portal. They can answer students who contact them but never start a conversation. "Sponsored" appears only on paid promotions, and "Verified Partner" only on businesses that have been checked.
- **Free for students.** Revenue comes from businesses: advertising, promoted posts, paid listings and partnerships.
- **Design.** Modern, minimal and Apple-inspired, combining the best of Instagram, TikTok, Reddit and Discord. It follows native iOS conventions and has a dark and a light theme, with the blue brand colour and the Aurora gradient used sparingly.
- **Legacy names.** The project began as an apartment finder called "Apartment Book". That name survives only in identifiers: the package names (`@apartment-book/shared`), the app's slug, URL scheme and bundle ID (`apartmentbook`), the Vercel project and old migration comments. They're history, not direction. Don't rename them, because that would break builds, deep links and the database history.

## How the app is organized

- **App tab bar:** Home, Explore, a "+" for creating, Messages, and Profile.
- **Home** has three sections: For you, Buzz and Reels. Search and notifications sit in Home's top bar.
- **"+"** creates a post, a reel, an anonymous Buzz post or a Snap.
- **Explore** holds the supporting tools: Housing, Roommate and Marketplace.
- **Website:** the same places across the top bar: Home, Explore, Messages and Profile.

## Where things live in the code

| Area | Mobile app (`apps/mobile/src`) | Website (`apps/web/src`) |
| --- | --- | --- |
| Home: For you, Buzz, Reels | `app/(tabs)/index.tsx`, `components/home/` | `app/(app)/page.tsx`, `components/home/` |
| Buzz threads | `app/buzz/[id].tsx` | `app/(app)/buzz/` |
| Full-screen reels and posts | `app/reels/[id].tsx` | `app/(app)/reels/` |
| Messages and Snaps | `app/(tabs)/messages.tsx`, `app/messages/`, `app/snap/` | `app/(app)/messages/` |
| Profiles and search | `app/(tabs)/profile.tsx`, `app/profile/[id].tsx`, `app/find-people.tsx` | `app/(app)/profile/`, `app/(app)/search/` |
| Explore: housing, roommates, marketplace | `app/(tabs)/housing.tsx`, `components/housing/` | `app/(app)/apartments/`, `roommates/`, `marketplace/` |
| Business portal | | `app/business/` |

All reading and writing of data, for both apps, is in `packages/shared/src/queries`. The database itself is defined in `supabase/migrations`.

## Three connected platforms

1. **CampConnect:** the social network for students, as an app for iOS and Android and a website.
2. **CampConnect Business:** a portal at `/business` for local businesses, from apartment communities to restaurants, shops and services. They post listings and deals targeted to campuses, promote them, answer student inquiries, see per-listing analytics and add staff.
3. **CampConnect Admin:** the dashboard for managing users, businesses, content and platform security. Business approvals and paid promotions live in the portal's admin area today.

## Technology

| Layer | Stack |
| --- | --- |
| Mobile | Expo (SDK 58), React Native, Expo Router, Reanimated, expo-video |
| Web | Next.js 16, TypeScript, Tailwind CSS |
| Backend | Supabase: Postgres with PostGIS, Auth, Realtime, Storage, row-level security |
| Media | Mux for video, Supabase Storage for photos |
| Hosting | Vercel for the website |
| Repository | npm workspaces and Turborepo |

The website and the app share all data access through `packages/shared`, so each platform only adds its own screens.

## Repository structure

```
apps/
  web/        Next.js website, including the business portal at /business
  mobile/     Expo app for iOS and Android (see apps/mobile/README.md)
packages/
  shared/     Types, validation, queries and helpers used by both apps
supabase/
  migrations/ Database schema, policies and functions, one file per change
  rollbacks/  Reverse scripts for recent migrations
  tests/      Offline database tests (PGlite)
scripts/      Database setup and live checks
docs/         Technical reference
```

## Getting started

Requirements: Node.js 22.18 or newer, and npm.

```bash
npm install

# Website: copy the example env file and add the Supabase URL and anon key
cp apps/web/.env.example apps/web/.env.local
npm run dev                         # http://localhost:3000

# Mobile app
cd apps/mobile
npx expo start --go --tunnel        # open with Expo Go on a phone
```

Signing up needs a university email address. Today that means `@txstate.edu`.

### Checks and tests

```bash
npm run check         # typecheck, lint and build, through Turborepo
npm run test:shared   # unit tests for packages/shared
npm run db:test       # database tests for every migration, offline in PGlite
```

### Database and deployment

- **Migrations:** every database change is a file in `supabase/migrations`. Apply new ones to the live project with `npm run db:setup` before shipping code that depends on them. Never run `supabase db push` here: the Supabase CLI's own history is empty, so it would run every migration again.
- **Website:** Vercel deploys from GitHub. A push to any branch builds a preview, and `main` is production.
- **Mobile:** the app runs in Expo Go during development. See `apps/mobile/README.md` for builds and updates.

## Documentation

- [Technical reference](docs/technical-reference.md): how each feature is built, the migrations and their rollout order, and setup from scratch.
- [Mobile app](apps/mobile/README.md): running, building and updating the app.
- [Migrations applied outside this repo](supabase/applied-outside-repo/README.md): where the admin and moderation database work came from and how it will be brought into `supabase/migrations`.

## Long-term vision

Become the main digital community for university students worldwide: one place to meet people, join clubs, find events and opportunities, follow campus news, and handle everyday student life, from housing to buying and selling. Instead of another general social network, CampConnect aims to be the digital home of university life.

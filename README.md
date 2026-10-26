# CampConnect

**A private social network for university life — connecting students, clubs, events, campus news, housing, and the student marketplace in one place.**

CampConnect is a social platform built exclusively for verified university students. It launches first at **Texas State University (TXST)**, with plans to expand to campuses worldwide.

Our mission is to connect students, clubs, organizations and campus communities in one place, so university life is more social, more connected and more convenient.

## Why CampConnect

Facebook began as a network for college students. As it grew into a general social network, it lost that university-only feel. CampConnect brings it back: a social network only for verified students and their campus communities.

Each university has its own community inside the platform. Students mainly see the people, clubs, organizations, events, discussions and news of their own university. That makes the experience more relevant, more trusted and more useful than mixing campus life with the whole internet.

Alongside the social side, CampConnect has tools for everyday student life. Students can find roommates, search for apartments and subleases near campus, and buy, sell, trade or give away furniture, electronics, textbooks, bikes and more.

**Our difference:** traditional social media is for everyone. CampConnect focuses only on university communities, verified student connections and real campus life.

## Features

| Feature | What students get |
| --- | --- |
| **For You** | A personalized feed of photos, videos and posts from their campus. |
| **Buzz** | Anonymous campus discussions, questions and opinions, with upvotes and threaded replies. |
| **Reels** | TikTok-style short videos, full screen. |
| **Explore** | Apartments near campus, roommate posts, and a student marketplace to buy and sell items. |
| **Messages** | Private chats, group chats and automatic class group chats, with voice messages, replies and view-once Snaps. |
| **Search** | Find students to follow, plus apartments, roommates and items for sale. |
| **Profiles** | University-verified identities with major, graduation year and bio, followers, and privacy controls. |

**Coming next:**
- **Events:** campus activities, club meetings, career fairs and hackathons.
- **Clubs and organizations:** pages to follow and join.
- **Campus news:** university and student news.
- **Calls:** audio and video calls in any chat. They are built and paused behind a "Coming soon" label.

## Three connected platforms

1. **CampConnect:** the social networking app (iOS and Android) and website for students.
2. **CampConnect Business:** a portal for apartments and local businesses at `/business`. They advertise, promote services, post apartment and deal listings targeted to campuses, answer student inquiries, see per-listing analytics and add staff. Listings carry a "Verified Partner" label once checked and "Sponsored" only when paid.
3. **CampConnect Admin:** the dashboard for managing users, businesses, content and platform security. Business approvals and paid promotions live in the portal's admin area today.

Businesses stay out of the student social side. They can reply to students who contact them, but never start a conversation.

## Business model

Revenue comes from business advertising, promoted posts, paid listings and partnerships. The student platform stays free.

## Design

A modern, minimal, Apple-inspired interface that combines the best of Instagram, TikTok, Reddit and Discord. It follows native iOS conventions, with a dark and a light theme and the Aurora gradient as a sparing signature.

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

Become the main digital community for university students worldwide: one place to discover people, events, opportunities, housing and everything happening around campus. Instead of another general social network, CampConnect aims to be the digital home of university life.

# CampConnect Admin

The staff-only control room for Apartment Book: a separate Next.js app that talks to the
same Supabase project as the website and the mobile app. Setup, roles, two-factor
authentication, moderation rules and deployment are documented in the root
[README.md](../../README.md#admin-app-campconnect-admin).

```bash
cp .env.example .env.local   # same Supabase URL + anon key as the website
npm run dev -w admin         # http://localhost:3001 (the website runs on :3000)
```

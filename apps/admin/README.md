# CampConnect Admin

The staff-only control room for UniBuzz: a separate Next.js app that talks to the same Supabase project as the
website and the mobile app.

```bash
cp .env.example .env.local   # same Supabase URL + anon key as the website
npm run dev:admin            # http://localhost:3001 (the website runs on :3000)
```

- **Analytics and Business** (for owners and admins of the staff): docs/technical-reference.md, "CampConnect Admin:
  Analytics and Business".
- **Roles, two-factor sign-in, invitations, moderation and the media worker:** the root README's section
  "Admin app (CampConnect Admin)".
- **Browser check:** `BASE=http://localhost:3001 node apps/admin/e2e/admin.mjs`, with a staff account and its
  authenticator key for the signed-in checks (see the script's header).
- **Deploying:** `npm run deploy:admin` (its own Vercel project, not connected to Git: merging deploys nothing here).
  It is a production deploy, so it needs the owner's approval.

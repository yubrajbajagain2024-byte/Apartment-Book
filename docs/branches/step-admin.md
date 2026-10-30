# step-admin

- **Owner:** Yubraj. **As of 2026-10-27:** **10 commits ahead, 146 behind, not merged**; tip
  `dffbf15` (2026-10-25). It branches from `03faf37`, before PRs #29 – #33. Its tree has 19
  migrations (main's early ones plus admin migrations 14–18) and `apps/admin`, which `main` lacks;
  the rest of the docs describe `main`, not this tree.
- **Purpose:** **CampConnect Admin**, a separate Next.js staff app (`apps/admin`, port 3001) on the
  same Supabase project, so the student website can carry no admin controls.

## Completed

- `c0661b1`: the admin app (overview, reports with review, content lookup and hiding, users with
  suspend/lift, media queue, staff, audit log, TOTP security); migrations 14–17 (staff roles,
  invitations, append-only audit log, aal2 gate on every admin function, suspensions, report
  review, media clean-up queue, dashboard queries, hardening); setup-script safeguards (`DRY_RUN`,
  refusal of out-of-order migrations, one transaction per migration); seven PGlite suites.
- Admin migrations 14–17 **applied to production 2026-10-25** (16 and 17 under the names
  `20261103100000_admin_dashboard.sql` and `20261103100100_hardening.sql`); `main` keeps copies in
  `supabase/applied-outside-repo/`.
- Deploy tooling: `npm run deploy:admin` (own Vercel project, root `apps/admin`, not connected to
  Git, public env only, worker off). `apps/web/vercel.json` here only turns off Vercel builds of
  this branch.
- `dffbf15`: staff invitations by email with expiring, account-bound links, password then
  mandatory MFA; migration 18 `20261103100200_staff_invite_email.sql` (on production, per the
  owner's deploy notes); the media worker runs only with `MEDIA_WORKER_ENABLED=true`.
- `df21452`: **`docs/step-admin-merge-plan.md`** (on this branch), the merge plan: migration order,
  12 conflicting files with resolutions, open questions.

## Current state

- **2026-10-30:** `admin-analytics-business` (draft PR #60) brings `apps/admin` and its shared code to `main`, without
  this branch's migrations, scripts other than `deploy-admin.mjs`, tests, website changes or README section, so that
  the new Analytics and Business sections live in the admin app (the owner's decision). That answers question 4 (yes)
  and leaves 1 to 3 and 5 as they were; what it brought and left is listed in
  [admin-analytics-business.md](admin-analytics-business.md).

- Pushed as a backup and for review. **The merge plan says: do not merge before its questions are
  answered.** No answers recorded as of 2026-10-27.

## Pending

- [ ] Owner answers the six questions in `docs/step-admin-merge-plan.md` (migration names, who
      renames production's two `public._migrations` rows and when, keep or drop
      `supabase/applied-outside-repo/`, a change to admin checks, whether `ankur/dev` is alive,
      who resolves the merge).
- [ ] Reconcile with `main`'s website `/admin` Buzz / Trust & Safety console (from PR #37), which
      contradicts this branch's "no admin on the website" rule.
- [ ] Merge, following the plan's conflict table, then `npm install && npm run check && npm run
      db:test`, and a `DRY_RUN=1` setup run that must list nothing. The production `_migrations`
      rename needs the owner's approval.
- [ ] Migration 18 is already on production under its file name: keep that name in the merge so
      its `public._migrations` row matches and it never runs again.

## Tests

- Not run on 2026-10-27. Per `dffbf15`: `npm run db:live-order` rebuilds `main` with the admin
  migrations in production's order and passes 30 suites, plus a 20-check staff-invite-email suite.

## Next steps

1. Read `docs/step-admin-merge-plan.md` in full before touching this branch or production.
2. Get the owner's answers and record them in that file and here.
3. In the merge PR, update the root CLAUDE.md map, supabase/CLAUDE.md, docs/migrations.md and
   docs/branches/README.md: the separate admin app becomes part of the shared map.

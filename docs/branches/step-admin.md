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
  this branch's migrations, so that the new Analytics and Business sections live in the admin app (the owner's
  decision). That answers question 4 (yes).
- **2026-10-31:** the same branch reconciles the rest of this branch with `main` (commit `f532cf8`): the setup script's
  safeguards (`DRY_RUN`, one transaction per migration, an out-of-order guard with `ALLOW_OUT_OF_ORDER=1`, `ADMIN_URL`,
  `SKIP_AUTH`, `ADMIN_OWNER_EMAIL`), `scripts/configure-auth-email.mjs`, five PGlite suites adapted to
  `boot({ live: true })` (admin, admin-dashboard, moderation-support, permissions-audit, launch-checklist), the README's
  "Admin app" section, the website's suspended-account message and the account-deletion refusal shown in the form.
  **Still only here:** migration 18 and its suite (`staff-invite-email`), the `hidden_at`/`hidden_reason` message types
  with their website and app hunks, `no-admin.mjs` and the "no admin on the website" rule (`main` keeps its `/admin`
  console), `live-order-check.mjs` and `staging-rehearsal.mjs` (superseded by `production-rollout.test.mjs` and
  `staging/release-rehearsal.mjs`), `apps/web/vercel.json`. Questions 1 to 3 (migration names, the `_migrations` rows,
  `applied-outside-repo/`) and 5 are still the owner's; nothing moved a migration file. Details:
  [admin-analytics-business.md](admin-analytics-business.md).
- Pushed as a backup and for review. **The merge plan says: do not merge before its questions are
  answered.** No answers recorded as of 2026-10-31.

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

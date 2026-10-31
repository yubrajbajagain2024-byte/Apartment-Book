# supabase/ — database instructions

How to change and ship the database. The root [CLAUDE.md](../CLAUDE.md) has the shared rules; each
migration's production status is in [docs/migrations.md](../docs/migrations.md).

## Access rules

- Closed to the API entirely, read only through `security definer` functions: `user_activity`, the
  `buzz_*` tables, `snaps`, `staff*`, `account_restrictions`, `media_jobs`, `event_feeds` (staff
  read and write them through `events_console_*`; the website's sync uses the service role).
  `event_engagement` is written by `record_event_click()` alone and read by its own student.
  `anonymous_listing_owners` is readable by the poster alone. In the `uploads` bucket (public: an
  address serves to anyone who has it), a file is read and listed through the API by its uploader
  only (migration 60); a post's and a story's photos must be their author's own uploads. Buzz anonymity depends on only the
  `buzz_v2_*` functions deciding what leaves the database.
- **Since migration 22, `profiles` and `notifications` are granted column by column.** A migration
  that adds a column to either must also
  `grant select (that_column) on public.<table> to anon, authenticated`, or the API cannot read it
  and `select *` on that table fails. Never grant SELECT on the whole table.
- Helpers the API must not call: `revoke all on function … from public, anon, authenticated`.
- SQL that must run with and without CampConnect Admin's schema (`public.staff`,
  `is_suspended()`): test for it with `to_regclass` / `to_regprocedure`, read optional tables with
  dynamic SQL, and nest the `IF` so plpgsql resolves an optional function only where it exists
  (migrations 39 and 41 do this).

## Writing a migration

- One file per change in `migrations/`, named `<UTC timestamp>_<name>.sql`, later than every name
  already used: in this folder, in `applied-outside-repo/`, on other branches, and in production's
  `public._migrations` (which also holds `20261103100000`–`20261103100200` from `step-admin`). The
  file order is authoritative; numbers in header comments are informal.
- Open with a header comment: what it adds and why, which migration it follows, where its rollback
  is. Make it safe to run more than once (`create or replace`, `if not exists`,
  `drop policy if exists` before `create policy`).
- Ship with it: `rollbacks/<same name>.down.sql`; a PGlite suite in `tests/` added to the root
  `package.json` `db:test` script; the hand-written types in `packages/shared/src/types/database.ts`
  (or regenerate them: README §"Regenerating database types"). Its "not applied" row in
  docs/migrations.md goes in with its PR (root CLAUDE.md, documentation rule 2).

## Testing (PGlite, offline)

`tests/harness.mjs` runs every migration and the seed in PGlite behind a small imitation of
Supabase's `auth` and `storage` schemas.

- `boot()`: this repo's schema. `boot({ live: true })`: production's order, with the
  `applied-outside-repo/` migrations where they really ran (no `step-admin` migration 18, which is
  not in this repo). `boot({ upTo })` stops after a migration.
- `mk(email, name)` makes a confirmed user; `as(uid, fn, { aal: "aal2" })` runs as a user after
  two-factor sign-in (it adds a verified factor); `asAnon`, `asService`; `expectOk`, `expectError`,
  `done`.
- `as()` sets the role on the one connection: never run two of them at once (`Promise.all`), or each
  sees the other's user. Loop instead.
- `reopen()`: the same database on a new connection. A custom setting (`app.…`) that a migration or
  a function set stays defined, as `''`, in the session that set it, but reads as null on the API's
  fresh connections: test code that depends on one there.
- `tests/staging/` needs a real Supabase project, the staging one (`STAGING_SUPABASE_REF`; the scripts
  refuse production): `business-portal.mjs`; `stories.mjs`, Stories through Auth, the REST API and
  Storage; `events.mjs`, Events through the same (it applies 61 on staging when missing); and
  `release-rehearsal.mjs`, which rehearses a release step by step (see its header) and expects every
  migration that went live ahead of the release (58 to 61) to be applied on staging first.
  Staging's `media_jobs` grows on its own: leave it out of row-count comparisons.

## Production

- **Never run `supabase db push`.** The Supabase CLI's own history is empty on production, so a
  push would re-run every migration. The setup script tracks what ran in `public._migrations`.
  Reconciling the CLI history is open work (`applied-outside-repo/README.md` step 5, needs the
  owner's approval).
- `npm run db:setup` applies **every** pending migration and the seed. It has two modes:
  - database-URL mode, `SUPABASE_DB_URL=… npm run db:setup`: migrations and seed only. **Use this
    for production.**
  - token mode, `SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… npm run db:setup`: also rewrites
    `apps/web/.env.local`, keeps the project URL and service key in Vault, and **sets the auth Site
    URL to `SITE_URL`, which defaults to `http://localhost:3000`**, breaking production's sign-in
    emails. Only for a fresh or local project, or with the real `SITE_URL` (and
    `BUSINESS_SITE_URL`) plus `SKIP_ENV=1`.
- A migration that needs only what production already has may go live ahead of a pending release,
  alone (58 to 60 did, 2026-10-30; 61 is written to): rehearse it offline on production's state
  (`boot({ live: true, skip })`, as `tests/stories-rollout.test.mjs` and `tests/events-rollout.test.mjs`
  do) and on staging, apply it as below, then take it out of the release lists (`PENDING` in
  `tests/production-rollout.test.mjs`, `RELEASE` in `tests/staging/release-rehearsal.mjs`) and out of
  the `AHEAD` skips in the rollout suites.
- To apply one migration alone, run the file in one transaction together with
  `insert into public._migrations (name) values ('<file name>')`, then
  `notify pgrst, 'reload schema'` when it adds functions. To roll one back, the same with its
  `rollbacks/` file and `delete from public._migrations where name = '<file name>'`, newest first
  (the SQL editor runs a pasted script as one transaction).
- Before a production migration, take a backup that restores:
  `SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/backup.mjs before-migration-<n> --full`
  (`~/CampConnect-backups/<date>-before-migration-<n>/` on the owner's Mac, 0600: rows, accounts with
  their password hashes, every file; never committed). It restores with
  `SUPABASE_PROJECT_REF=<ref> node scripts/restore.mjs <folder> --yes` into a project that has the
  same migrations (it refuses production unless `RESTORE_INTO_PRODUCTION=1`); the pair is rehearsed by
  `tests/staging/restore-rehearsal.mjs`. Without `--full` the folder is a row-count snapshot only. A
  daily full backup runs from the owner's Mac (`scripts/backup-daily.sh`, launchd). Supabase's own
  backups (Pro plan) are better when the plan allows; a CLI dump needs Docker, which the Mac lacks.
  After it, check the objects it created and record it in docs/migrations.md with a docs-only PR.
- `applied-outside-repo/` holds the four migrations production received from `step-admin` on
  2026-10-25. **Read its README before touching the live database.**
- Read-only: `SUPABASE_ACCESS_TOKEN=… node supabase/applied-outside-repo/verify.mjs --live`, a
  schema diff against production.
- **Not read-only:** `SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… npm run db:check` creates two
  temporary users, listings, chats and files on the live project and deletes them afterwards: a
  production write.

## Also here

- `functions/livekit-token/`: the Edge Function that mints LiveKit tokens for people the database
  has in a call.
- `seed.sql`: universities with campus coordinates and `email_domain`. A new campus is a row there.

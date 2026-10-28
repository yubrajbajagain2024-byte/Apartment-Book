# CLAUDE.md — UniBuzz

Shared instructions for every AI session (and person) working in this repository: what the project
is, how to work in it, and the rules that do not change week to week. **This file is the single
source of truth on `main`**: branches inherit it unchanged, and nothing branch-specific or
status-like belongs in it. Never add a per-branch copy or another instruction file on a branch;
change these files through a PR into `main`. Keep it under 200 lines. Status, history and branch
notes live in [docs/](docs/README.md).

More specific instructions load when you work in these folders:
[apps/mobile/CLAUDE.md](apps/mobile/CLAUDE.md), [supabase/CLAUDE.md](supabase/CLAUDE.md), and
`apps/web/CLAUDE.md`, an import of `apps/web/AGENTS.md`: the Next.js 16 rules that `next dev`
writes itself. Leave those two alone.

## The project

**UniBuzz** is a private social network for verified university students, launching at Texas
State University. Sign-up is limited to the email domains on the `universities` table
(`txstate.edu` today), checked by the form and by a `before insert` trigger on `auth.users`.

- **Social network first.** Lead with people, posts, Orbit, Buzz, Reels and messages. Housing,
  roommates and the Marketplace are supporting tools on the Explore tab; they must not set the
  app's identity, navigation or wording outside Explore.
- **Three surfaces, one Supabase project:** UniBuzz for students (Next.js website and Expo app);
  UniBuzz Business at `/business` (its own host once `NEXT_PUBLIC_BUSINESS_SITE_URL` is set), where
  businesses never start conversations; CampConnect Admin for staff (the website's `/admin`
  console, and a separate staff app whose state is in docs/branches/README.md).
- **Legacy names stay.** The product was *CampConnect* until 2026-10-26; the staff app keeps the
  name *CampConnect Admin*. *Apartment Book*, the first name, survives only in identifiers:
  `@apartment-book/shared`, `@apartment-book/moderation`, the root package `apartment-book`, the
  app slug / URL scheme / bundle id `apartmentbook`, the Vercel project, the old `origin` URL and
  old migration comments. Renaming them breaks builds, deep links and the migration history.
- **Stack:** Next.js 16.4, React 19.3, Tailwind 4 · Expo SDK 58, React Native 0.88 · Supabase
  (Postgres + PostGIS, auth, realtime, storage, Edge Functions) · LiveKit (calls) · Mux (video) ·
  npm workspaces + Turborepo · Node ≥ 22.18 (`.nvmrc`: 22).
- **No custom server.** Security is row-level security in the database. Server-side secrets are
  used only by the Buzz moderated write API (`apps/web/src/app/api/buzz`) and Mux.

## Where things are

```
apps/web/src/
  app/(app)/       the site: /, apartments, roommates, marketplace, posts, reels, buzz, messages,
                   profile, notifications, saved, search, settings, deals, two-factor, and admin/
                   (staff console: queue, rules, users, appeals, audit, metrics)
  app/(auth)/      login, signup     app/auth/  auth callbacks     app/business/  the portal
  app/api/         buzz (moderated writes), video (Mux uploads + webhooks), geocode
  app/             also privacy, terms, guidelines, design, sitemap, robots, manifest
  components/      UI by area (home, feed, posts, buzz, messages, profile, housing, business, staff, …)
  lib/             actions/ (server actions), supabase/ (clients), buzz-server/ (server-only),
                   staff/, business/, mux.ts, env.ts      proxy.ts: auth guard + the portal's host
apps/web/e2e/      home-feed.mjs (Playwright, desktop + phone)
apps/mobile/       Expo app (expo-router): apps/mobile/CLAUDE.md
packages/shared/   everything that is not UI: types/ (incl. database.ts), schemas/ (zod), queries/
                   (every read and write), buzz/, trust-safety/, constants.ts, for-you.ts, discover.ts,
                   profile.ts, snaps.ts, calls.ts, share.ts, format.ts, …
packages/moderation/  the Buzz moderation engine (rule packs, PII detector, policy); server-only
supabase/          migrations/, rollbacks/, tests/, applied-outside-repo/, functions/, seed.sql
scripts/           supabase-setup.mjs (db:setup), e2e-check.mjs (db:check), e2e-home-feed.mjs,
                   backup.mjs (read-only backup of a project), e2e-target.mjs (staging or production)
docs/              status, migrations, tests, decisions, history, environment, branches
```

How each feature works: [README.md](README.md) and [docs/technical-reference.md](docs/technical-reference.md).

## Commands

```bash
npm install                 # once, at the repo root
npm run dev                 # every app; npm run dev -w web for the website (-- -p 3060 for a port)
npm run check               # typecheck + lint + build: run before you call work done
npm run typecheck           # or lint, or build: the same steps one at a time
npm run test:shared         # packages/shared unit tests, offline
npm run test:moderation     # packages/moderation unit tests, offline
npm run db:test             # every supabase/tests suite in PGlite, offline, ~5 min
```

Commands against a real Supabase project, and their traps: [supabase/CLAUDE.md](supabase/CLAUDE.md).
App, device and EAS commands: [apps/mobile/CLAUDE.md](apps/mobile/CLAUDE.md).

## Coding standards

- Match the code around you: naming, comment density, idiom. TypeScript is `strict` everywhere.
- Comments say why, and which rule the code enforces, in full sentences, like the JSDoc on the
  queries in `packages/shared` and the header of every migration.
- `packages/shared` holds every read and write and all non-UI logic. No imports from `next/*`,
  `react-dom` or browser globals (`window`, `document`, `localStorage`); every query takes the
  Supabase client as its first argument. Screens on web and mobile stay thin.
- `packages/moderation` is server-only: never import it from the app or a client component.
- Website: server-only modules start with `import "server-only"`; writes go through server actions
  in `apps/web/src/lib/actions/`; call `redirect()` and `notFound()` outside `try` blocks; read
  `node_modules/next/dist/docs/` before using a Next.js API you have not checked.
- Paused features stay behind their flags instead of being deleted (apps/mobile/CLAUDE.md lists
  them).
- Database changes: follow [supabase/CLAUDE.md](supabase/CLAUDE.md).
- Settled product and technical choices, with their reasons, are in
  [docs/decisions.md](docs/decisions.md). Do not re-open one without a reason.

## Workflow

- Branch from `main` and land work through a **reviewed pull request**. Never push to `main`.
- **Every push to `main` deploys the website to production** (Vercel is connected to Git). Merging
  is deploying, so a migration the code needs must already be live.
- Before opening a PR, check what it would bring (`git log origin/main..<branch>`); a branch that
  is already merged needs none, whatever GitHub's "Compare & pull request" banner suggests. Then
  run `npm run check`, the tests your change touches (`npm run db:test` for any SQL), and the
  documentation updates below.
- Commit messages: a plain-English subject saying what changed; a body with why, the migrations
  (and whether they are on production) and the tests run. AI-written commits end with a
  `Co-Authored-By:` trailer.
- **Push only your own branches.** Do not push, rewrite or commit on someone else's branch without
  their approval (owners: [docs/branches/README.md](docs/branches/README.md)). Never rewrite
  commits that are already pushed.
- **Every production write needs the owner's explicit approval**: a migration, a role grant, an EAS
  publish, a script that writes to the live project, and a manual deploy
  (`vercel deploy --prod --yes --archive=tgz` from the repo root ships the local tree).
- Never chain `cd` with `;` in front of a command that writes files; use `&&` or absolute paths
  (a failed `cd` once let EAS write a stray `app.json` at the repo root).

## Security and privacy

- **The GitHub repository (`yubrajbajagain2024-byte/UniBuzz`) is public.** Every commit, branch and
  PR is world-readable. Until a security fix is live on production, keep how the weakness works and
  who can exploit it out of commits, branch names, PR text and docs; push the fix branch only after
  its migration is applied, unless the owner decides otherwise.
- **Add no credentials or private data to the repository**: code, docs, migrations, tests and
  commit messages included. No access tokens (`sbp_…`), service-role keys, database URLs or
  passwords, LiveKit/Mux/moderation secrets, Expo/EAS tokens, invite tokens, personal emails or
  phone numbers, and no new Supabase project refs (the live ref already sits in the public URL in
  `apps/mobile/.env`, the README and scripts that depend on it; leave those). Name the environment
  variable instead ([docs/environment.md](docs/environment.md) lists them).
- `.env` and `.env.*` are git-ignored, except `.env.example` files and `apps/mobile/.env`, which
  holds only public `EXPO_PUBLIC_*` values (the anon key and site URLs, safe because row-level
  security does the protecting).
- **Never** put the service-role key in a `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` variable, or anywhere
  a client can read it.
- A personal access token or database URL goes on the command line for one command only; delete
  the token from the Supabase dashboard afterwards.
- Student data is private by design. Tables closed to the API stay closed (supabase/CLAUDE.md
  lists them); never add a policy or grant that opens one without working out what it reveals.

## Documentation: keep it current

**Update the documentation as part of every significant change, before you end your turn and
without being asked**, so it lands in the same PR as the work. Significant: a feature or fix
finished or paused, work left unfinished, a migration added or applied, a test suite added, run or
failing, a decision, a branch created or merged, a new blocker or risk, a new command, tool or
environment variable. Typos, formatting and read-only exploration are not.

| What | Its one home |
| --- | --- |
| Lasting instructions: how to work, standards, rules | this file; folder rules in `apps/mobile/` and `supabase/` CLAUDE.md |
| Done, open work in priority order, blockers and risks, plans | [docs/status.md](docs/status.md) |
| Each migration's production rollout | [docs/migrations.md](docs/migrations.md) |
| Test suites and their latest results | [docs/testing.md](docs/testing.md) |
| Settled decisions and why | [docs/decisions.md](docs/decisions.md) |
| Dated history: names, merges, production events, retired branches | [docs/history.md](docs/history.md) |
| Environment variable names | [docs/environment.md](docs/environment.md) |
| Every branch at a glance, with its owner | [docs/branches/README.md](docs/branches/README.md) |
| One branch: purpose, progress, pending work, next steps | `docs/branches/<branch name>.md` |
| How each feature works | README.md, docs/technical-reference.md |

1. **One home per fact.** Link to it instead of repeating it. CLAUDE.md files hold instructions,
   never status. Refer to other entries by title, not by number.
2. **Avoid merge conflicts by design.** While a branch is in progress, record its progress only in
   its own `docs/branches/<branch name>.md` (a slash in the name is a folder:
   `docs/branches/ankur/dev.md`). Its changes to shared files (status, migrations, testing,
   history, branches/README) go in late, in its PR, after merging `main` into it. Something that
   happens on no branch (a migration applied to production, a test run on `main`) gets a short
   docs-only PR.
3. A branch that outlives one session or PR gets its own file; once the branch is merged and
   deleted, move a short summary to docs/history.md and delete the file.
4. **State, not prose: write what is true, the ugly parts included**, and date what can go stale
   ("as of 2026-10-27"). Say where a claim comes from when you have not checked it yourself.
5. **Verify before you rely on it.** Check that a named file, function, flag or status still holds.
6. No changelog sections: git history is the record. The old per-branch `CLAUDE.md` copies of
   2026-10-27 lose to `main`'s in a merge (docs/branches/README.md); resolve any other conflict on
   its merits.

On the owner's Mac a local Claude Code `Stop` hook, not in git (`.claude/settings.local.json` →
`.claude/hooks/claude-md-reminder.sh`), reminds a session when files changed but no documentation
did. It only reminds; deciding what is significant is still your job.

# History

How UniBuzz got here, dated. Sources: git history and commit messages; production events also from
the owner's deploy notes. Each migration's production date is in [migrations.md](migrations.md);
open work is in [status.md](status.md).

## Names

- **Apartment Book** (2026-09): an apartments, roommates, marketplace and chat site for Texas State
  students. The name survives in identifiers (root CLAUDE.md, "Legacy names stay").
- **CampConnect**: the product's name in its docs and website until 2026-10-26. The separate staff
  app keeps the name **CampConnect Admin**.
- 2026-10-20: the app was renamed **UniBuzz** and its For you tab **Orbit** (`cbaad1a`).
- 2026-10-26: **UniBuzz** everywhere (`5bf3035`, merged into `main` in `fee2e8f`).
- The GitHub repository was renamed from `Apartment-Book` to `UniBuzz` (noticed 2026-10-27; the old
  URL redirects).

## Timeline

- **2026-09-07:** first commits (Yubraj): "Apartment Book: apartments, roommates, marketplace and
  chat for Texas State students". `step-1-brand-shell`, a first brand-and-shell pass, is never
  merged ([branches/step-1-brand-shell.md](branches/step-1-brand-shell.md)).
- **2026-10-09 – 10-25:** `step-home-feed`, the main feature line, merges as PRs #1 – #32: home
  feed, profiles, comments, sharing, messages, course chats, Snaps, calls, push, profile privacy,
  Expo SDK 58.
- **2026-10-18:** a full redesign is tried and undone the same day (`a817832`, `4e9502f`); what
  stays is one sheet and button family, Apple's type scale and the Aurora palette (`a60f8d6`,
  `a1cedf4`).
- **2026-10-20:** Buzz v2 ported from UniVerse, with the moderation engine and a staff console
  (`03842fd`).
- **2026-10-25:** calls paused behind a flag (`e39fd3e`); the business portal and migrations 38–40
  reach production; CampConnect Admin's four admin migrations reach production from `step-admin`;
  PR #33 (`business-portal-prelaunch`), PR #35 (`ankur/dev`), PR #37 (`ankur/owner-moderation`:
  Buzz v2 and Trust & Safety).
- **2026-10-26:** migrations 41, 42 (Ankur) and 43 reach production; from then on every push to
  `main` deploys production; `business-portal-prelaunch` merged again
  (`fee2e8f`); Android release build fixed (`2e0e445`); a stray root `app.json` committed by
  accident (`b09910d`, [branches/business-portal-prelaunch.md](branches/business-portal-prelaunch.md));
  PR #38 (`ankur/dev`: Discover, Orbit "+", profile menu); PR #40 (`listing-flow-redesign`, with
  `create-flow-redesign`: the camera-first create flow, post details, anonymous listings).
- **2026-10-27:** migration 45 reaches production; PR #41 (`ankur/dev`: an emoji no
  longer holds a Buzz for review); PR #42 adds the root `CLAUDE.md`; PRs #43 and #44 are opened
  from two merged branches and conflict with `main`; PR #45 restructures the AI documentation into
  one shared `CLAUDE.md` plus `docs/`; PRs #46 and #47 are opened from two more merged branches.

## The AI documentation

- 2026-10-26: an AI session drafts a `CLAUDE.md` in the worktree branch
  `claude/claude-md-documentation-0b8750` (never committed).
- 2026-10-27: every branch gets a `CLAUDE.md` with shared sections and a branch-specific §9; `main`'s
  arrives in PR #42. Each branch's copy differs, so merges conflict (PRs #43 and #44). The same day
  it is replaced by one shared root `CLAUDE.md` on `main`, folder files in `apps/mobile/` and
  `supabase/`, and these docs ([decisions.md](decisions.md), last row): PR #45, merged without a
  formal GitHub review (an independent AI review ran before it was pushed, and its findings were
  fixed). PRs #46 and #47 are then opened from two more merged branches; like #43 and #44 they carry
  only old copies (and, in #47, the stray `app.json`).

- 2026-10-28 04:07 UTC: PR #49 (UniBuzz Business v2) merged into `main`, 16 seconds after it was
  opened. Its description and this repository's docs said to apply migrations 49 and 50 first.
  Production's website therefore runs Business v2 code against a database without them (see
  status.md). The follow-up work (migration 51, now 55; video routes; review fixes) stays on
  `business-v2` for a new PR.

- 2026-10-28 06:18 UTC: PR #50 (`ankur/dev`: Buzz threaded replies, top reply, prompt threads,
  categories) merged into `main` with migrations numbered 51 to 54. The two unmerged migrations on
  `business-v2`, 51 and 52 in its commit messages, were renamed to sort after them
  (`20261109000000_media_server_fields.sql`, `20261109000100_business_hardening.sql`): now 55 and
  56.

## Retired branches

None deleted yet. When a branch is merged and deleted, add a line here (name, what it delivered,
its PRs) and delete its file in `branches/`.

# business-portal-prelaunch

- **Owner:** Sunil. **As of 2026-10-27:** its business-portal work is merged (PR #33, then
  `fee2e8f` on 2026-10-26). Since then it carries two commits `main` does not have, both pushed to
  GitHub from the owner's Mac on 2026-10-27 01:31 (UTC−5): `b09910d`, a stray root `app.json`
  (below), and `a1c3001`, an old `CLAUDE.md` copy. Its tree has 43 migrations.
- **Purpose:** UniBuzz Business, the business portal at `/business` (migration 39), finished before
  launch.

## Completed

- The business portal: roles, standings, listings, deals, inquiries, analytics, team (migration 39,
  live on production since 2026-10-25), and "Sponsored" only on recorded paid promotions.
- `602a3c6`: gave the Marketplace video migration a unique timestamp, `20261103000200`.
- `5bf3035`: docs say the product is UniBuzz.

## The stray `app.json` (`b09910d`)

`b09910d`, "Update UniBuzz", adds a root `app.json` containing `{"expo": {}}`. Nothing needs it.
Investigated 2026-10-27 from the local Claude Code session logs:

- 2026-10-26 03:03 (UTC−5), an AI session building the iOS app ran
  `git worktree add … && cd <worktree> && … ; npx eas-cli device:list` from this checkout's root.
  The worktree already existed, so the `cd` never ran, and the `;` started EAS CLI at the **repo
  root**. It found no project there, failed, and left a stub `app.json` (Claude Code's file-change
  record shows the file created by that command).
- 03:18: a manual commit, "Update UniBuzz", picked the untracked stub up on this branch. No AI
  session ran that commit. At 03:22 the checkout moved to `main`.
- The real app config is `apps/mobile/app.json` + `app.config.js`. A root `app.json` could make
  Expo or EAS tooling run from the root treat the root as the app.
- The lesson is now a rule in the root CLAUDE.md (Workflow) and apps/mobile/CLAUDE.md.

## Pending

- [ ] Close PR #47 without merging: it would add only the old `CLAUDE.md` copy and the stub
      (checked 2026-10-27; every note in the copy is in these docs).
- [ ] Owner to choose: delete the branch (it holds nothing else `main` lacks), or `git revert
      b09910d` on it. Since the commit is pushed, do not rewrite it.

## Tests

- Not run on this tree on 2026-10-27.

## Next steps

1. No new work here; branch from `main`.

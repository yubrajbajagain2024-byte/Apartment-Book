# ankur/dev

- **Owner:** Ankur. **As of 2026-10-27:** fully merged (PRs #35, #38 as `070c8f4`, and #41); tip
  `b083fec`, the merge of PR #41. Ankur's active feature line.
- **Purpose:** Ankur's day-to-day feature work, merged into `main` through PRs.

## Completed

- `5ec8dcb`: the Discover tab, with search and what is popular on every campus (migration 44,
  `20261103000300_discover.sql`, **not on production**).
- `cd742f6`: a floating "+" on Orbit and a menu under your photo.
- `e3b71c9`: the Buzz toast shows the message, not only the icon.
- `a56005e` (PR #41, 2026-10-27): an emoji no longer holds a Buzz for review
  (`packages/moderation/src/normalize.ts`, with tests).

## Pending

- [ ] Migration 44 is not on production yet; [../../migrations.md](../../migrations.md) has its
      order rule.

## Tests

- Not run on this branch on 2026-10-27; `test:moderation` passes 428/428 on `main` after PR #41.

## Next steps

1. Merge `main` in before more work here (it brings the shared `CLAUDE.md` and `docs/`).

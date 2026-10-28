# ankur/dev

- **Owner:** Ankur. **As of 2026-10-28:** a PR into `main` is open with the Buzz work below
  (`e8049cf`), `main` merged in (`89737e4`, up to PR #49) and these docs. Before it: fully merged
  (PRs #35, #38 as `070c8f4`, and #41). Ankur's active feature line.
- **Purpose:** Ankur's day-to-day feature work, merged into `main` through PRs.

## Completed

- `5ec8dcb`: the Discover tab, with search and what is popular on every campus (migration 44,
  `20261103000300_discover.sql`, **not on production**).
- `cd742f6`: a floating "+" on Orbit and a menu under your photo.
- `e3b71c9`: the Buzz toast shows the message, not only the icon.
- `a56005e` (PR #41, 2026-10-27): an emoji no longer holds a Buzz for review
  (`packages/moderation/src/normalize.ts`, with tests).
- `e8049cf` (the open PR): Buzz. In the app: replies as a Reddit-style tree (migration 51), "Top
  reply" on feed cards (52), one thread per day's prompt (53). In the app and on the website: an
  optional category on a buzz (54). README §"Buzz (anonymous)" and apps/mobile/README.md describe
  them. The four migrations were first numbered `20261106000000` to `20261109000000`; they were
  renumbered before the first push because `20261107000000` was taken by Business v2.

## Pending

- [ ] Migrations 51 to 54 are not on production; the code works without them, so the PR can merge
      first ([../../migrations.md](../../migrations.md) has the order). 44 is not on production
      either.
- [ ] The website's Buzz: the reply tree, top reply and prompt threads are in the app only.
- [ ] Buzz category sections: categories are stored and shown; nothing filters by them yet.
- [ ] Checked offline only (tests, sample data, the website in a headless browser, the iOS bundle
      export); not seen on a device by this session as of 2026-10-28.

## Tests

- 2026-10-28 at `89737e4` (`main` merged in): see [../../testing.md](../../testing.md) for the
  results.

## Next steps

1. Review and merge the PR. Merging deploys the website; it needs none of 51 to 54.
2. With the owner's approval and after a backup, apply 51 to 54 in file order.
3. Bring the website's Buzz up to the app: the reply tree, top reply and prompt threads.
4. Decide how category sections work (ideas: filter chips on the feed, a page per category,
   following or muting categories).

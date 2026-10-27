# create-flow-redesign

- **Owner:** Sunil. **As of 2026-10-27:** merged into `main` through `listing-flow-redesign`
  (PR #40). Since then it carries only two old `CLAUDE.md` commits (`aa6bf02`, `043f0a9`); PR #44,
  opened from it on 2026-10-27, conflicts with `main` and would add nothing but that copy. Its tree
  has 46 migrations (no `20261105000000_anonymous_listings.sql`).
- **Purpose:** the TikTok-style create flow behind every "+" in the app, and richer posts.

## Completed

- `2749b83`: live camera first (POST | REEL | SNAP | BUZZ), in-app gallery, editor, publish screen
  with title, caption with #/@ suggestions, link, audience, drafts. Migration 45,
  `20261104000000_post_details.sql` (title, link, audience campus | global | friends | selected,
  comments switch), applied to production 2026-10-27 00:32 UTC, with rollback and PGlite suite.
- `61a6395`: front lens by default; SNAP | POST | REEL | BUZZ.
- `7bcc6b4`: merged `main`.

The work continued on `listing-flow-redesign`, which is merged.

## Pending

- [ ] Close PR #44; then delete the branch once the owner agrees.

## Tests

- Not run on this tree. The same commits plus `985d348` passed every offline suite on 2026-10-27
  ([listing-flow-redesign.md](listing-flow-redesign.md)).

## Next steps

1. No new work here; branch from `main`.

# listing-flow-redesign

- **Owner:** Sunil. **As of 2026-10-27:** merged into `main` as PR #40 (2026-10-26). Since then it
  carries only two old `CLAUDE.md` commits (`4622f57`, `ccadf10`); PR #43, opened from it on
  2026-10-27, conflicts with `main` and would add nothing but that copy.
- **Purpose:** move Roommate posts and Marketplace items into the app's create flow and let them be
  posted anonymously. Built on top of `create-flow-redesign`.

## Completed

- `2749b83`: TikTok-style create flow (camera, gallery, editor, publish) and post titles, links,
  audiences and the comments switch: migration 45, `20261104000000_post_details.sql`, applied to
  production 2026-10-27 00:32 UTC.
- `61a6395`: the camera opens on the front lens; mode order SNAP | POST | REEL | BUZZ.
- `7bcc6b4`: merged `main` (Discover, Orbit "+", profile menu).
- `985d348`: roommate posts and Marketplace items in the create flow (Details → form → preview),
  post as your name or Anonymous, listing audiences (campus | global | friends), anonymous inquiry
  chats with `start_listing_inquiry()` and per-chat `reveal_listing_identity()`. Migration 47,
  `20261105000000_anonymous_listings.sql`, with rollback and 151 PGlite checks. The website shows
  anonymous listings and chats without naming anyone.

## Pending

- [ ] Migration 47 is **not on production**, although this code is on `main`;
      [../migrations.md](../migrations.md) says what that costs and in which order it goes out.
- [ ] Close PR #43; then delete the branch once the owner agrees.

## Tests

- 2026-10-27 at `985d348` (the same tree as `main` then): `test:shared` 157/157,
  `test:moderation` 422/422, `db:test` 1267 checks with 0 failures. Not run: `npm run check`, the
  iOS Simulator flows, the live suites.

## Next steps

1. No new work here; branch from `main`.

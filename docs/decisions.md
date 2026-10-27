# Decisions

Settled choices and why they were made. Do not re-open one without a reason; when one changes, edit
its row and say why and when.

| Decision | Why |
| --- | --- |
| Social network first; Explore tools second | Product identity (README §"Product direction") |
| No custom backend; row-level security is the security model | One less thing to run and get wrong; every rule is testable offline in PGlite |
| All non-UI code in `packages/shared` | Web and mobile share everything except screens |
| npm workspaces + Turborepo, not pnpm | Nothing extra to install; Vercel and Expo support it as is |
| Hand-written `types/database.ts` | Kept deliberately in step with the migrations; regenerating is optional |
| Every new migration ships with a `supabase/rollbacks/*.down.sql` and a PGlite suite in `db:test` | Every change is reversible and tested offline, on the repo's and on production's schema order |
| Photos stored untouched; renditions at read time | Photos are the product: originals up to 25 MB, 12 per listing, Next.js images at quality 85–90 with blurred placeholders |
| No payments in the Marketplace | Meet on campus, like Facebook Marketplace |
| Buzz tables unreadable through the API | Only the `buzz_v2_*` functions decide what leaves the database, so a policy mistake cannot leak anonymity |
| Moderation engine is server-only | Its rules must never be bundled into the app |
| Businesses can never start a conversation | Students are never cold-messaged |
| "Sponsored" only for a recorded paid promotion; "Verified Partner" only with evidence | The database refuses either label otherwise |
| Anonymous listings keep no poster on the listing row | Identity lives in `anonymous_listing_owners`, readable by the poster alone; revealed per chat with `reveal_listing_identity()` |
| Calls built, then paused behind `CALLS_PAUSED` | No Apple Developer Program membership, so no iPhone build can carry them; `EXPO_PUBLIC_CALLS_ENABLED=1` turns them on |
| Campus/Global toggle hidden (`SCOPE_TOGGLE_SHOWN = false`) | Every feed stays on the reader's campus for now; the code is kept |
| Posts is a Home section with no tab (`HIDDEN_HOME_SECTIONS = ["posts"]`) | Orbit blends posts and reels; `/?tab=posts` still works |
| Keep legacy identifiers (`apartment-book`, `apartmentbook`) | Renaming breaks builds, deep links and migration history |
| One shared root `CLAUDE.md` on `main`; status in `docs/`, branch notes in `docs/branches/` (2026-10-27) | A per-branch `CLAUDE.md` conflicted on every merge (PRs #43 and #44); instructions and status now each have one home |

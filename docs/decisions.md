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
| UniBuzz Business v2 builds on v1 (migrations 49 and 50, 2026-10-27): v1 deals are business posts (the table stays `deals`); v1 paid promotions are ads, and `listing_promotions` is the ledger of ad payments | Every v1 caller, label and stat keeps working; deals were never paid, so making them ads would break "Sponsored only when paid" |
| An admin approves an ad by recording its payment (amount and reference); no payment provider yet | "Sponsored" still always means a recorded payment |
| Business team roles: owners and admins run the team, the profile and ad spend; editors post, draft ads and reply; analysts read the numbers only and are never in inquiry chats | Spending is an owner's or admin's call; the fewest people read students' messages |
| Housing ads (a housing business's, or one promoting a listing) run in Housing only; every one needs an admin's Fair Housing check, with a note when the screen flags its words | The Fair Housing Act (42 U.S.C. 3604(c)); the screen flags, a person decides |
| Ads go to signed-in students only, chosen by campus in a daily rotation that is the same for everyone on that campus, at most one per 9 organic rows | Campus is the only targeting: never demographics or activity; "about one per 8 to 10 posts" |
| Students' reports about businesses and ads go to the business portal's admin queue, not the staff console's | Business admins act on ads; joining the two queues is later work |

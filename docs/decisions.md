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
| Each day's Buzz prompt has one thread per campus and one on Global, owned by no one; answers are its replies by default, or a buzz of their own titled with the prompt (2026-10-28) | Answers read together under the prompt instead of as stray untitled buzzes; no anon owns the prompt; the first answer makes the thread, so a day nobody answers leaves nothing |
| A buzz's category is optional, one per buzz, from a fixed list (`BUZZ_CATEGORIES`) that the database also enforces (2026-10-28) | Stored now so category sections can come later; a fixed list keeps sections meaningful; optional keeps posting quick |
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
| An approved ad shows the copy of its post or listing taken at approval; a change to that post or listing, or to the business's category, pauses the ad until the UniBuzz team looks again (migration 56) | Students see what was reviewed, and nothing reaches them that the UniBuzz team did not see |
| Every ad's words are screened for Fair Housing, not only housing ads' (migration 56) | A business's category is its own to change, so it cannot decide whether its words are checked |
| A business sees an inquiry chat, and the student in it, only once the student has written (migration 56) | Tapping "Message" is not consent to be known to the business |
| A video's processing details are written by the website's server with the service role, never by a signed-in session (migration 55) | Ads and Reels rely on a video's size and length; only the provider knows them |
| The business portal's sections, in this order: Overview, Inbox, Advertisements, Products & Services, Analytics, Billing; Settings apart at the bottom (2026-10-28; Inbox moved up from third the same day) | The owner's briefs: the sidebar first, then "a dedicated Inbox directly below Overview"; one order everywhere (sidebar and drawer) so people find things by place |
| The app's full-screen pages put gradient shades under the words, never a blur (2026-10-30) | Instagram draws shades; a blur under a playing video is sampled again every frame, and re-drawn through every frame of the zoom and the swipe back, where frames were dropped |
| The viewer's zoom opens in about a fifth of a second and closes in 0.24 s (2026-10-30) | Measured frame by frame in the owner's recording of Instagram (0.15 to 0.2 s each way); UniBuzz's took 0.3 to 0.4 s |
| Closing the app's full-screen viewer from any page shrinks it into the post it was opened from; from a later reel it fades into that post on the way (2026-10-30) | Instagram's way back, from the owner's screen recording; the feed is still there underneath, so going back always lands where you left it |
| The app's full-screen viewer has no comment bar, keeps the app's tab bar in view when opened over the tabs, and sets its rail 2pt from the right edge at the height it had (2026-10-25, restored 2026-10-30) | The owner's brief; the rail's Comments already opens the comments, and the tab bar keeps the viewer part of the app, as on Instagram |
| A business's hours are one `jsonb` column on `businesses` (time zone, weekly ranges, special dates), checked by the database, public with the profile (migration 57, 2026-10-29) | They are read and written whole with the profile; one value keeps the form, the check and both apps' display in step, and needs no new table, policy or function for students |
| Business hours use one of the seven United States time zones, Central by default, and "open now" is worked out in that zone whatever the viewer's (2026-10-29) | UniBuzz's campuses are in the United States; a business's hours are local to it, and a student travelling must still read them right |
| Special hours replace a date's usual hours whole, closed or with their own ranges; dates before yesterday drop off when the profile is saved (2026-10-29) | Holidays are whole-day exceptions; yesterday stays because a late night can run into today |
| The business's name and photo at the top of the portal's sidebar open a preview of its public profile; the preview is the student page's own component (2026-10-29) | The owner's brief; one component means the preview cannot drift from what students see |
| A business awaiting review sees the Inbox below Overview, saying it opens on approval, with no chats (2026-10-29) | Hiding it left owners unsure the Inbox existed; students write only to an approved business, so there is nothing to show before |
| The business Inbox lists only chats a student has written in, and opens no other, even on a database without migration 56 (2026-10-28) | Businesses only ever answer; a student who tapped "Message" and wrote nothing has not contacted the business |
| The business Inbox's alerts: a toast, the Inbox's badge and the tab's title always; desktop notifications only once a person turns them on, per browser (2026-10-28) | The browser asks for permission only after a click, and each teammate decides for their own devices; nothing is stored in the database |
| No typing indicator in the business Inbox (2026-10-28) | It needs a realtime channel that business accounts may join, a database change for a small gain; read receipts already show when a reply was seen |
| Billing is for the owner, admins and analysts, not editors (2026-10-28) | Spending is the owner's and admins' decision and analysts read the numbers; editors draft ads but never pay (the database lets every member read payments; the portal stays lean) |
| Products & Services holds the posts and the listings; Settings holds the profile, the team, verification and the account; their old addresses stay (2026-10-28) | Nothing a business bookmarked breaks; each section is a set of tabs over pages that already worked |
| A resume by the UniBuzz team is not an approval: an ad runs again only as the kind of ad, and with the Fair Housing flags, the team approved; any change to what it shows, while it waits, runs or is paused (by the business too), goes back to the team (migration 56, 2026-10-28) | Otherwise pausing, editing and resuming would put unreviewed content, or a housing ad without the Fair Housing check, in front of students |
| While an ad is live, the files it shows are locked for their uploader, and its videos are not re-read (migrations 55 and 56, 2026-10-28) | An ad points at files by address; replacing the file behind the address would change what students see without a review |
| Payments stay on record, without the business, when a business or its owner's account is deleted (migration 56, 2026-10-28) | A payment is the UniBuzz team's record of money received; deleting an account must not erase it |
| The Business v2 release's own rollback is 56, 55, 50 and 49 only; Buzz's 51 to 54, applied in the same run, stay (2026-10-28) | The two share no object (the rehearsals compare every Buzz object and row before and after), and undoing someone else's feature is their call |
| Production is backed up before the release's first change, the merge included (2026-10-28) | Merging deploys: the backup has to show production as it was before any part of the release reached it |

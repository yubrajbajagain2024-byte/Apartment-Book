# profile-stories-nav

- **Owner:** Sunil. **As of 2026-10-31:** branched from `events` at `d631d96`, because the Events filter needs the Events
  tab; the work is one commit, `6180de8`; `main` merged in after PR #74 (Events) landed; pushed, no PR yet. Written by an
  AI session with one forked session (Stories).
- **Purpose:** the owner's brief: the app's Profile laid out like Instagram's with a rectangular post grid; Like,
  Message, Share Story, Report, Block and Mute in Stories; the create button at the bottom like X's; the bottom bar
  collapsing like Reddit's (only the Home icon left while a feed scrolls on, the whole bar back as it scrolls back) on
  For you and on Buzz, then (the owner's follow-ups) on Explore and Events with their own icons, and swipes past a
  carousel's ends moving to the next section; Events' search with the Marketplace's filter button beside it and a sheet
  of event types
  (Academic, Career, Sports, Social, Arts and the rest).
- **Surface:** the app, except where a story card reaches the website: a chat shows it ("View story in the app"), and the
  staff console lists story reports. The website has no Stories viewer and no collapsing bar; its Events page keeps its
  pills.
- **Migration:** 62, `20261114000000_story_actions.sql` (rollback in `supabase/rollbacks/`). Not applied anywhere, staging
  included. It needs only what production has (41, 42, 58, 59, migration 17's cards, 30's preview, 31's reply quotes),
  and nothing pending (44, 46, 49 to 57, 61) redefines what it replaces, so it can go live alone, ahead of 61 and the
  release, with the owner's approval (`story-actions-rollout.test.mjs` rehearses exactly that).

## What is on the branch

- **Collapsing bottom bar** (`apps/mobile/src/lib/tab-bar-collapse.ts`, `components/floating-tab-bar.tsx`): on Home
  (For you, Buzz), Explore (its three pages) and Events (its two). Direction decides (28pt on collapses, 14pt back or the
  top of the feed restores); the bar narrows to a circle as tall as itself, scaled to 0.82 from its bottom left corner,
  the row sliding so the tab on screen (Home, Explore or Events) stays centred while the labels, the capsule and the
  other tabs fade. The row keeps its measured width throughout, so no tab is laid out again mid-animation. Fed through
  `useCollapsingHeader`'s new `onFollowedScroll` (For you, Explore, Events) and by Buzz's own list. A tap on the circle,
  another page of the tab, another tab, a pushed screen or a screen reader brings the whole bar back. Messages and
  Profile keep the whole bar; the viewer's copy of the bar never collapses.
- **Create at the bottom, X's way:** Orbit's "+" (`components/feed-header.tsx` `Fab`, also Events') and Buzz's pen
  (`components/buzz/fab.tsx`) stay at the bottom right; as the bar collapses each becomes the collapsed Home button's
  twin (`collapsedRide` in `lib/tab-bar.ts`): scaled to the same 54pt circle, centred at the same height, as far in from
  the right edge as Home is from the left (14pt). Buzz's pen no longer slides off screen while the feed scrolls. The "+"
  in Home's top bar over Reels is gone (your photo and its menu, with Upload, take the slot); Reels has no floating "+",
  since its rail fills the bottom right.
- **Profile:** the top is kept as the owner chose it on 2026-10-31 (screenshot): the cover with Find friends and the
  menu as round buttons, the photo with Share profile and Edit profile beside it, the name (account sheet), @username
  with QR, the university pill with "Computer Science · '28" beside it (the pre-2026-10-25 arrangement, which the base
  branch had changed to one line), the bio, and Posts | Followers | Following | Likes. A first Instagram-style header
  on this branch was dropped at the owner's request. Below it: Instagram's grid, edge to edge, 3:4 tiles (9:16 on Reels)
  with 2pt gaps and square corners, a play count on videos only, tabs with a full-width underline
  (`profile-tile.tsx`, `profile-tabs.tsx`); Search's grid keeps its rounded tiles (a `radius` prop). More on someone
  else's profile offers Mute stories / Unmute stories.
- **Events filter** (`components/events/event-filter-sheet.tsx`, `app/(tabs)/events.tsx`): the Marketplace's round filter
  button with a count beside the search box; the sheet has When and Event type (any number of `EVENT_CATEGORIES`), Reset
  and Show results; the pills row keeps the date pills and lists the types in force, each tap-to-drop.
  `listEvents` takes `categories` (any of them) beside `category` (`packages/shared/src/queries/events.ts`).
- **Swipes past a carousel go to the next section** (the owner's follow-ups, TikTok's way; `apps/mobile/src/lib/section-pager.ts`,
  `components/photo-carousel.tsx`): on Home (Orbit | Buzz | Reels) and Explore (Housing | Roommate | Marketplace) a
  post's or listing's photos take the swipes first; from the last photo the next swipe on goes to the next section, from
  the first the next swipe back to the previous one, never past the ends, so never to another bottom tab. Two earlier
  versions failed on the owner's phone, and the cause was then measured on the iOS Simulator (2026-10-31): the paging
  FlatList's own scroll gesture takes a swipe that starts at its end even with nothing to scroll and no bounce, so the
  pager never gets it (first version) and a gesture-handler pan is cancelled by it (second version), and the touch ends
  as a tap that opens the post. React Native's touches keep arriving all the while, so the carousel reads the finger
  from them (`onTouchStart/Move/End` on its wrapper): past 10pt, a swipe starting on the last photo going on (or the
  first going back) is the pager's; the pager follows the finger through `SectionPager.follow` (`followOffset`, never
  past the page beside) and, let go, glides on through `release` (a quarter of the way or a 500pt/s flick,
  `handOverTarget`) or back, by its label-tap path; the tap that touch ends with is dropped. The carousel's ends no
  longer rubber-band on those pagers. Reels' page has no carousel (every reel there is one video), and Buzz's cards
  none, so their sideways swipes are the pager's own native drag. The full-screen viewer and a listing's own screen keep
  their swipes as before (`lib/viewer-swipe.ts` is unchanged from the base).
- **Likes felt at once** (the owner's follow-up): `useLike` (`components/engagement.tsx`: posts, listings) and the reel's
  heart (`components/home/reel-item.tsx`) no longer ignore taps while a like is being saved (each save waited for two
  round trips): the haptic is the first thing a tap does (a firm tick to like, a light one to unlike, which had none),
  then the heart and the count change, and the taps go to the server one at a time, the newest wish next, Buzz votes'
  way. A double tap always ticks, liked already or not (`likeNow`), before the big heart. A story's heart ticks before
  its state changes. Buzz votes already ticked first.
- **Stories actions** (`apps/mobile/src/app/stories/[id].tsx`, `lib/stories-store.ts`, migration 62):
  - Someone else's story, Instagram's layout: a "Send message" box, a heart and a paper plane along the bottom (the row
    rides the keyboard; the story pauses while you type, share or read a menu); "⋯" at the top: Report… (`'story'` is a
    report type now), Mute / Unmute <first name>'s stories, Block <name> (muting or blocking moves on to the next person).
  - **Like:** `story_likes`, only on a story the person may see right now, never their own; read by the liker and the
    author. Your own story shows a like count beside the views and a heart beside each viewer who liked it. No
    notification for a like (yet).
  - **Message:** a reply goes to the author's DM as a `story_reply` card with the words; **Share Story:** the share
    sheet's friends get a `story` card. `guard_message_story_card()` refuses a card for a story that is gone, expired or
    hidden from the sender, a share into a chat where anyone may not see the story, a reply into a chat without the
    author, and blocks either way; it rewrites the card from the story row, so a card cannot be forged. Chats show the
    card at reel height and open the story (website: "View story in the app"); it reads "Story no longer available"
    once the story has gone. Inbox lines: "Sent a story", "Replied to a story".
  - **Mute:** `story_mutes`, read only by the person who muted; muted people leave the tray (Instagram moves them to its
    end instead). Also from a person's profile: More → Mute stories / Unmute stories.
  - **Report:** staff read a story through `ts_story_snapshot()` (its photo or video, its audience, the author's profile
    as the link); Remove deletes the story (migration 59 deletes its photo with it). A story reported after it expires
    leaves the queue once the sweep deletes its row (within about ten minutes).
  - **Block:** the existing `blockUser`; the tray drops the person at once.

## Tests

- **On the iOS Simulator** (2026-10-31; iPhone 16e, iOS 26.3, Expo Go 58.0.7 against the branch's Metro, signed out, so
  reading production): real touches posted by a scratch Swift script, checked with `simctl` screenshots and temporary
  `[swipe-debug]` logs (removed). Orbit (a temporary fixture gave a post three photos, since signed-out Orbit had none):
  photos 1→2→3, the next swipe followed the finger into Buzz and opened nothing; back through 3→2→1, then a swipe right
  from the first photo stayed on Orbit (no section before it); a short slow drag past the end sprang back; a vertical
  scroll starting on the photo scrolled the feed; a plain tap still opened the viewer. Explore (a fixture listing on
  Housing, then the clean code with a real three-photo roommate post): Housing→Roommate from the last photo,
  Roommate→Housing from the first, Roommate→Marketplace from the last; nothing opened, Explore stayed the tab. Reels→Buzz
  and Buzz→Orbit by the pager's own drag. The bottom bar's collapse and the "+" beside it were seen working too. Not
  tried: a real iPhone, Android, haptics (the simulator has none), signed-in feeds.

- New PGlite suites in `db:test`: `supabase/tests/story-actions.test.mjs` (likes, mutes, cards, blocks, reports, the API
  grants, the rollback against the schema without 62) and `story-actions-rollout.test.mjs` (62 alone on production's
  state, then 61 and the release, then the rollback and a re-apply). 62 joins the `AHEAD` skips in
  `production-rollout`, `stories-rollout` and `events-rollout`.
- `packages/shared/tests/share.test.mjs` and `message-replies.test.mjs` gained story cases.
- Results on 2026-10-31: `npm run check` 6/6, `npm run test:shared` 243/243, `npm run db:test` 50 suites, 1765 checks, all passed (exit 0).
- Not run on a device or simulator; no `tests/staging/` script for 62 yet, and it is not in `release-rehearsal.mjs`.

## Pending, and next steps

1. A staging probe for 62 (like `tests/staging/stories.mjs`), and 62 on staging before it goes ahead of the release.
2. Try it on a device: the collapse's feel (thresholds, the 0.82 scale), the buttons landing as the circle's twin, the
   grid on a small phone, the carousel hand-off on a real iPhone (verified on the simulator only), the likes' haptics;
   Android has not been tried at all.
3. The owner decides whether the website follows (its phone bar, its Profile grid, its Events filter).
4. Merge `events` first (PR #74); then this branch's PR goes to `main`, with the shared docs (status, branches, testing,
   migrations: 62's "not applied" row) updated in it.
5. Production, each with the owner's approval: a full backup, then 62 alone (the procedure in `supabase/CLAUDE.md`), then
   an EAS update so testers get the app's changes.

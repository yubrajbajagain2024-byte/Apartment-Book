# Apartment Book

A website and app for university students to **find apartments near campus**, **find roommates**, **buy and sell move-in essentials** (mattresses, desks, kitchen gear…), **message each other** in private or group chats, and **share posts, reels and anonymous Buzz threads** on Home. The layout follows the Facebook pattern: a top bar with three tabs (Home, Explore, Messages) plus the search box, a create menu and a profile menu; on phones the bar is Home, Explore, Messages, Profile at the bottom of the screen (the app's bar is Home, Search, Explore, Messages, Profile, with a Notifications bell in Home's top-right corner that opens every notification). Search finds people by name first (with a Follow button on every result), then apartments, roommates and items. Home itself has three top tabs, For you | Buzz | Reels (in the app under a CampConnect wordmark with a feed dropdown, Instagram style; Posts is a fourth section that keeps its feed and its `/?tab=posts` address on the website but has no tab), see [Home feed](#home-feed); the Explore tab holds Room (apartments), Roommate and the Marketplace side by side, see [Housing](#housing).

Built with **Next.js 16 + TypeScript + Tailwind** on top of **Supabase** (Postgres, auth, realtime chat, image storage). The backend is a hosted service that iOS/Android apps can talk to directly, and all data-access code lives in a shared package, so the future mobile app reuses everything except the screens.

## Feature map

| Feature | How it is built |
| --- | --- |
| Housing (Apartments and Roommates) | One main tab, labelled Explore in the bar, two slidable halves with the Marketplace as a third page after them (see [Housing](#housing)). Postgres tables with PostGIS: campus and listing coordinates, `apartments_within(university, radius)` for "within 2 miles of campus", distance filled by a trigger. Map view and location picker use Leaflet + OpenStreetMap (free); address search uses Nominatim through `/api/geocode` |
| Marketplace | Same listing pattern with a `category` field; the third page of the Explore tab. No payments |
| Messaging | Supabase Realtime over `conversations`, `conversation_members`, `messages`. Device push tokens stored in `device_push_tokens` for the future apps. The app's inbox has two pages, Chats and Groups, side by side like Home's (a swipe or a tap on a label, with the same knock), and All | Unread | Requests pills: a direct chat that someone you don't follow started with you sits under Requests until you reply (or follow them). No table holds this: it is read off the chats, `follow_stats` and whether you have written in each (`conversationsWrittenIn` in `packages/shared/src/queries/messages.ts`), so it is the same on every device |
| Activity status | Instagram style, the same in the app and on the website: under the other person's name at the top of a direct chat (the Messages page and the desktop chat dock on the website), a small green dot and "Active now" while they are online, otherwise when they were last active ("Active 1 min ago", "Active 3 hours ago", "Active yesterday" for the day before today, "Active 2 days ago", redrawn every 30 seconds and asked again every minute while the chat is open, and whenever they send a message), or no status at all when there is nothing to show (the website's chat header then says "Direct message", as before). Group chats keep "N members". Who is online comes from Supabase Realtime Presence on a private channel, `presence:active` (`PRESENCE_TOPIC`), that only signed-in people who show their activity status may join (the green dots on avatars, the app's online friends row and Roommates' Online now come from it too, leaving out people blocked either way, from `blocked_either_way_ids()`). The app going to the background stamps the time and stops appearing there at once (no timer runs in the background on a phone, so a grace would last until the server dropped the silent connection); a hidden browser tab does the same 15 seconds later on a computer (a quick look at another tab changes nothing for anyone), and at once on a phone or tablet or when the browser freezes the page. Back in front, they stamp first and appear once that stamp confirms the status is still shown; after a dropped connection that outlasted the last stamp they stamp again before appearing; in front, the time is stamped and the block list read again every minute. Logging out leaves the channel at once. Exact last-active times live in `user_activity`, a table the API can neither read nor write: `activity_status()` answers only while you show your own status (hide yours and you see nobody's), they show theirs and neither of you has blocked the other: for anyone you share a chat with, whether they are recent (so "Active now" can show, as their green dot does anyway), and their time, cut to the minute, only once they have written to you in a chat you are both in, since you joined it (an empty chat, a group someone made with everyone, or what a group said before you joined is not enough). "Active now" needs presence and a recent stamp both, since anyone on the channel could claim presence for someone else. Settings → "Show your activity status" turns it off: it deletes your time, and your devices stop marking messages "Delivered" (people see "Seen" once you read something new). Only that switch turns it back on (`set_show_active_status()`), so a stale Settings save from an installed old build cannot undo a hide. Migration 22 (`supabase/migrations/20261011000000_activity_status.sql`) adds the table, the `touch_activity()`, `activity_status()`, `blocked_either_way_ids()` and `set_show_active_status()` functions and the Realtime Authorization policies of the channel, retires the public `profiles.last_seen_at` (emptied and never written again; old builds still read it), makes `mark_delivered_all()` do nothing while you hide your status and `mark_conversation_read()` change nothing when there is nothing new to read (opening a chat no longer tells its members when you had the app open), dates every message no later than when it is sent (one dated ahead used to stay "new" and keep "Seen" and "Delivered" moving), lets chat members change only their own receipts and a group's name (no moving a membership into another chat, no turning a direct chat into a group), lets a notification be changed (`read_at` only) or deleted only once it shows, and grants `profiles` and `notifications` to the API column by column so their system columns (`xmin`, `xmax`, which traced who wrote or locked a row and when, down to anonymous Buzz replies and when they were made) are unreadable. The labels live in `packages/shared/src/activity.ts`, the presence store and the queries in `packages/shared/src/queries/presence.ts` |
| Login | `@txstate.edu` only. The allowed domains live on the `universities` table (`email_domain`), the sign-up form validates against them, a `before insert` trigger on `auth.users` rejects everything else, and new users are attached to their university automatically |
| Home feed | Four swipeable tabs, For you first. Posts and reels are `feed_posts` rows with likes, comments and saves; Buzz threads live in `buzz_*` tables that the API cannot read directly, only the `buzz_*` database functions can. The For you blend (posts and reels; Buzz stays on its own tab) is pure code in `packages/shared/src/for-you.ts`. See [Home feed](#home-feed) |
| Following | Follow people from their profile, like Instagram. Every profile shows follower / following counts to everyone, but who follows whom is private: on your own profile the counts open your Followers and Following lists, on anyone else's both open one list, Mutual friends (the people who are friends with both of you, by name), with a note that their followers and following are private; signed out, you are asked to log in instead. Home → Posts has a "Following" filter with only the posts of people you follow (in the app, a row of the feed dropdown in the Home top bar), and a notification tells you when someone starts following you; blocking someone ends the follow both ways. Migration 14 (`supabase/migrations/20260923000000_follows.sql`) adds the `follows` table and the `follow_stats` / `following_posts` functions; migration 21 (`supabase/migrations/20261010000000_private_follow_lists.sql`) lets only the two people in a follow read it (the counts come from `follow_stats`: the same totals for every viewer, whoever they have blocked, so a block cannot be used to find out whom someone follows) and adds the `mutual_friends()` function. The view each person gets and its wording live in `packages/shared/src/profile.ts` (`followListView`), the query in `listMutualFriends` |
| Comments | Under every post, reel and listing, TikTok style: a "N comments" header with a Top / Newest sort (`COMMENT_SORTS` and `threadComments(…, { sort })` in `packages/shared`: Top puts the most-hearted first, replies always stay oldest first), each comment as avatar, name (the post owner's carry an "Author" tag), text, time and Reply, with a heart and its count and a thumbs-down on the right (hearts are counted; a dislike stays private and only moves the score); threaded replies (answer a comment and it nests under it, folded behind "View N replies"; the indent stops at three levels, `COMMENT_MAX_DEPTH`); hold a comment for Reply, Report, Block or Delete (your own comment or any comment on your post; its replies go with it); and a notification for the author of the comment you answered ("… replied to your comment"; the post owner keeps the usual "commented on your post", one message when they are the same person). Migration 15 (`supabase/migrations/20260924000000_comment_threads.sql`) adds `post_comments.parent_id` and `score` (the sum of the votes, kept by trigger), the `post_comment_votes` table (readable like `post_likes`, written only through the `post_comment_vote()` function: 1 up, -1 down, 0 clears) and the reply notification; migration 16 (`supabase/migrations/20260925000000_comment_likes.sql`) adds `post_comments.likes` (how many people hearted it, kept by trigger) and has `post_comment_vote()` return the score, the likes and your vote |
| Sharing | In the app, the Share button on posts and reels and the Share item in every listing's ••• menu (apartments, roommates, marketplace) open a sheet of your friends; on the website, the Share button on posts and reels (video tours of apartments and roommates included) and on apartment cards that carry a video does, while the ••• "Share post" item still copies the link or opens the system share. The sheet is Instagram style: the people you follow who follow you back (blocked people never show), with a search box. Pick one or more, add an optional note and Send: each friend gets a direct message carrying the post as a card (its picture, author, caption or title, and "View post" / "View reel" / "View listing") that opens it, with the note as a normal bubble under it. The sheet also offers "Copy link" on the website, plus "Share to…" (the system share sheet) in the app and in phone browsers that support it. The card's link is always rebuilt from the shared thing's type and id, and the database refuses any other link, so a hand-made message cannot turn a card into an outside link. Migration 17 (`supabase/migrations/20260926000000_shared_posts.sql`) adds `messages.shared_post` (a snapshot of what was shared), lets a message carrying a share have no words (the inbox and the notification then read "Sent a post", "Sent a reel" or "Sent a listing") and adds the `list_friends()` function; the snapshots are built in `packages/shared/src/share.ts` |
| Profile | TikTok style, the same on the website (`/profile/[id]`, `/profile/me`) and in the app (the Profile tab and `/profile/[id]`): the photo (yours with a "+" to change it), the name, an @username with a QR button, Following · Followers · Likes (every like on their posts, reels and listings), Edit profile / Share profile / Find friends on your own profile and Follow / Message / ••• (block, report) on someone else's, the bio and campus, then the tabs Posts, Classes, Reels, Saved, Liked and Listings over a three-column grid with view counts (in the app the tabs are icons with a sliding underline, and the open one carries a mark of who can see that section: a lock, two people or a globe). Listings holds their apartments, roommate posts and items for sale, each square with its kind and title (on the website the owner also sees the rented, sold or found ones, marked so). Every profile gets an @username made from the name, changed in Settings (unique; 3 to 30 letters, numbers, dots and underscores); people search matches it too. Classes are listed per semester (this one first, up to 12 each) with a section, the days and times it meets and the room; your own are added from two boxes, the subject and the course number ("CS" and "3358", kept as the one code "CS 3358" the database checks: `joinClassCode` and its checks in `packages/shared/src/profile.ts`), and the form closes once the class is in, a line by "Add class" saying so until the button brings the form back; in the app a hold on a class card offers Edit (the same form, filled in; `updateProfileClass`) and Delete, which asks first, while the website keeps its remove cross; listing a section puts you in its course chat, a group chat shared by everyone at your university taking that section that semester (the first classmate's listing creates it, removing the class leaves it, and a notification tells you about both). Who can see Classes, Saved and Liked is each person's choice of Everyone, Friends (people you follow who follow you back) or Only me, set from the line at the top of the tab or in Settings → Privacy; the defaults are Friends for Classes, Only me for Saved and Everyone for Liked, and a visitor without access (or anyone blocked either way) sees a lock ("Only Sunil can see their saved posts"). Pin up to three of your posts or reels to the top of the grid from their ••• menu (in the app also by holding the square). Share profile, or the QR button, opens a sheet with the QR code of the profile's web address, Share and, on the website, Copy link. Migration 18 (`supabase/migrations/20260927000000_profile_page.sql`) adds `profiles.username` and the three visibility columns, the `profile_classes` table, `feed_posts.pinned_at` (three pins at most, checked by trigger) and the `profile_stats`, `post_view_counts`, `profile_section_access`, `profile_saved_items` and `profile_liked_items` functions; likes stop being readable row by row, so counts come from `post_like_count()` and the "Liked by" faces from `post_likers_many()`, which honours each liker's Liked setting. The wording and helpers live in `packages/shared/src/profile.ts`, the queries in `packages/shared/src/queries/profile-page.ts` |

## Photos: full quality, built to hook

Photos are the product, so the pipeline never degrades them:

- **Originals are stored untouched.** The browser uploads the exact file to Supabase Storage (JPG, PNG, WEBP, GIF or HEIC, up to 25 MB each, up to 12 per listing). Nothing is resized or re-encoded on upload.
- **Sharp on every screen.** Feeds and detail pages render through Next.js image optimization at quality 85 to 90 in AVIF/WebP with a size chosen for the viewer's screen (`images.qualities`, `deviceSizes` and `formats` in `apps/web/next.config.ts`). The full-screen viewer shows the original file itself, and its "Original" button opens it directly.
- **No blank boxes.** At upload time the browser reads each photo's dimensions and builds a tiny blurred preview (about 1 KB) that is saved as `image_meta` next to the listing. Feeds show the blur instantly and fade in the real photo, and layouts never jump.
- **Instagram-style feed.** Cards are photo-first with swipeable multi-photo carousels, a photo counter and dots, price overlaid on the photo, a bookmark button, and double-tap to save with a burst animation. Feeds load more as you scroll ("You're all caught up" at the end) and open with a stories-style strip: closest to campus on Home, fresh finds on Marketplace.
- **Detail pages.** Swipeable hero, thumbnail strip, and a full-screen viewer with swipe, arrow keys, double-tap zoom and the original download.
- **Uploader.** Drag and drop or pick files, instant previews while uploading, per-photo progress and errors, reorder, and "Make cover".

Vercel's Hobby plan optimizes up to 5,000 distinct source images per month. If the site outgrows that, upgrade the Vercel plan or move rendition generation to Supabase image transformations (Pro plan).

## Notifications

A `notifications` table that only its recipient can read, mark or delete; rows are created by database triggers so the mobile app gets them for free: a new message (repeated messages in one chat refresh a single unread entry), someone saved your listing, someone started following you (one entry per follower, however often they follow and unfollow), someone replied to your comment, and a new place pinned within 2 miles of your campus (opt-in per person in Settings). The top bar shows a bell with a live count and dropdown; `/notifications` lists everything. Push delivery can later use the same rows plus the stored device tokens.

## Home feed

Home has three tabs in TikTok's layout, left to right: **For you | Buzz | Reels**; Posts is a section without a tab (`HIDDEN_HOME_SECTIONS`): its feed, its `/?tab=posts` address and every post feature stay, and For you keeps blending posts in. They are swipeable: in the app the three pages sit side by side in a pager, and on the website a sideways touch swipe across the section body moves to the neighbouring tab (touch screens only; a multi-photo carousel keeps its own swipes). In the app the floating top bar over the feed has two rows, like X's: your photo in a teal-to-violet ring on the left, which opens your profile, the CampConnect wordmark (`HOME_BRAND`) in the middle (it reads "Following" while that feed shows), and the Notifications bell on the right (it opens the notifications screen; its badge counts the unread); then the three labels spread across the second row, highlighted like X: the active one bold with a rounded violet underline as wide as the label, sliding with the finger over a hairline across the whole bar, and a soft haptic each time the section changes, by tap or swipe. Under the labels sits a Campus | Global toggle, a small segmented pill whose thumb slides to the choice: Campus is your own university, Global every university (Following joins it only while Posts has a tab: it keeps Posts to the people you follow and moves to Posts); the row is not drawn for someone without a university. The bottom bar reads Home, Search, Explore, Messages, Profile: Search is the people search as a tab of its own. Creating (a post, a reel or a Buzz thread) is the small "+" badge on your photo's corner (over Reels the bar's left slot holds a white "+" instead). The bar scrolls like Instagram's: it slides up out of the way as the page on screen scrolls down and back the moment the page scrolls up, however far down it is (a swipe or a tap between pages brings it back too; Reels never moves it). Explore's Room | Roommate | Marketplace row and the pills under it (the Marketplace's categories among them) do the same under its fixed top bar; the bottom bar never moves: it floats over the content as a rounded glass pill (real liquid glass on iOS 26, a translucent fill elsewhere), and every tab keeps room clear under it. The campus and the Following choice live only in that menu (`apps/mobile/src/lib/home-scope.ts`, shared by For you, Buzz, Posts and Reels): the pages have no filter chips of their own. For you is the landing tab and keeps the clean `/` address, the others live at `/?tab=buzz`, `/?tab=posts` and `/?tab=reels`. The order and the addresses come from `HOME_SECTIONS` and `homeSectionHref` in `packages/shared/src/constants.ts`, so the website and the app always agree.

| Tab | What it shows |
| --- | --- |
| For you | Posts and reels blended into one feed; anonymous Buzz threads are never part of it, they live only on the Buzz tab. `blendForYou` in `packages/shared/src/for-you.ts` spreads the reels between the posts in a fixed pattern (post, post, reel, post, post, post, reel, post), each kind keeping its own order (newest first), so a page looks the same on every device and every reload. Each kind is paged on its own (`FOR_YOU_PAGE`: 6 posts and 2 reels per page), so page two never repeats page one; a kind that runs short is skipped and the other fills in. Works signed out |
| Buzz | Anonymous threads, Reddit style: topic, votes, nested replies, Hot / New / Top and search. Rows and threads show an alias ("Student 12345"), never a name, photo or user id. The `buzz_*` tables cannot be read through the API at all; threads are only reachable through the `buzz_*` database functions (`buzz_feed`, `buzz_get`, `buzz_create`, `buzz_reply`, `buzz_vote`, …), which decide what leaves the database |
| Posts | Photo-first rows (in the app every post, roommate post and apartment shares one layout: avatar, name and "<campus> · Oct 2" up top, the words next, folded to three lines with "more…" / "less" (a roommate post's description stays hidden whole behind "more…"), then the photo in a rounded frame inset from the screen edges, no card box) with swipeable carousels (the slide dots on their own row under the photo), heart / comment / share / bookmark (the heart pops when tapped and a double tap on the photo likes with a big heart burst; in the app the like also buzzes the phone through `expo-haptics`), "Liked by …", a caption with hashtags, the newest comment and, behind the comment icon, the thread itself, TikTok style: "N comments" with a Top / Newest sort, a heart with its count on every comment (a dislike stays private), Reply, replies folded behind "View N replies", and a hold on a comment for Reply / Report / Block / Delete |
| Reels | Vertical full-screen video (reels and apartment video tours), one at a time, autoplay with a shared sound button; the heart in the side rail and a double tap on the video like it with the same heart burst (and buzz in the app), the comment icon opens the same thread in a drawer |

Checks for the Home feed:

| Check | How |
| --- | --- |
| The For you blend, the Home and Housing tab order and addresses, the snapshot a shared post carries into a chat (`packages/shared/tests/share.test.mjs`) and the profile helpers (`packages/shared/tests/profile.test.mjs`: semesters and classes grouped by term, class codes and usernames checked like the database checks them, the who-can-see wording, which follower list a viewer gets and its wording, grid squares) and activity status (`packages/shared/tests/activity.test.mjs`: "Active 1 min ago" to "Active 2 days ago", "yesterday" by the calendar (also the nights the clocks change), never "0 min", a few minutes of clock skew, nothing before presence is known or without anything to show, "Active now" only with a recent stamp (and with no time for someone who has not written to you); the presence store on its private channel, with its readiness, appearing only while a fresh stamp is in, the grace before a tab stops appearing and leaving at once on a phone, coming back (no re-appearing after a hide made elsewhere), Realtime's presence-call limit, the minute heartbeat and block list, a status hidden on another device, a refused join, a session that ended and one only being renewed, rejoining after a close, a dropped connection short or long, people blocked either way; `activity_status` asked in batches of 100) (unit tests, no network, Node 22.18+) | `npm run test:shared` |
| Migrations, row-level security, the `buzz_*` functions, following (`supabase/tests/follows.test.mjs`: the `follows` policies, `follow_stats`, `following_posts`, the follow notification, blocking, account deletion) and comment threads (`supabase/tests/comment-threads.test.mjs`: replies and their parent checks, `post_comment_vote()` and the score, the reply notification, deletion with its replies, blocking) and comment likes (`supabase/tests/comment-likes.test.mjs`: the hearts count only the likes, a dislike stays private, the counts belong to the server) and shared posts (`supabase/tests/shared-posts.test.mjs`: friends are mutual follows minus blocks, a share without words, the "Sent a post" / "Sent a reel" previews and notifications, plain messages unchanged) and the profile page (`supabase/tests/profile-page.test.mjs`: usernames, the who-can-see settings and their defaults, classes per semester, the Saved and Liked lists behind those settings with like counts unchanged, blocking, profile numbers, view counts, at most three pins) and private follower lists (`supabase/tests/private-follow-lists.test.mjs`: a follow readable only by the two people in it, the owner reading all of theirs, `follow_stats` giving every viewer the same totals whoever they have blocked (zeros only across a block with that profile), mutual friends (exactly the friends both have, by name; nothing signed out, on your own profile or across a block), `are_friends()` closed to the API while friends-only sections still open, and `list_friends`, `following_posts`, following, its notification and blocking unchanged) and activity status (`supabase/tests/activity-status.test.mjs`: `user_activity` closed to the API signed in and out, heartbeats that stamp only people who show their status (`touch_presence` from old builds too) and leave no trace on `profiles`, not even a lock, `profiles`' and `notifications`' system columns closed to the API (an anonymous Buzz reply can no longer be matched to its author or dated), the grant following whatever columns each table has, hiding deleting the time and stopping "Delivered", showing it again only through `set_show_active_status()` (a stale save cannot), `mark_conversation_read()` moving only for something new (a message sent dated ahead is dated when it was sent, so it cannot keep "Seen" or "Delivered" moving), chat members changing only their receipts and a group's name (even with no filter), a scheduled notification out of reach of filterless updates and deletes, `activity_status()` rule by rule (hide yours and you see nobody's, someone hiding theirs, blocked either way, no shared chat, an empty chat or a group nobody wrote in giving "recent" with no time, what a group said before you joined, leaving a group, cut to the minute, recent, 100 ids at most, refused signed out), `blocked_either_way_ids()`, `profiles.last_seen_at` emptied for good, and the presence policies against a stand-in realtime schema), offline in PGlite | `npm run db:test` |
| The website's Home and Housing on a desktop and a phone viewport, the top bar and the phone bottom bar, swipes, following (the Follow button on a profile, Maya's Followers and Following numbers opening your mutual friends instead of her lists, a log-in prompt there signed out, your own Followers and Following lists, Posts → Following) and the comment thread under a post (heart a comment and clear it, reply, the "N comments" header and its sort menu, delete the reply from its options menu) and sharing a post with a friend (the Share dialog offers Leo, whom the seed makes a friend, and not Maya; pick him, add a note, Send, then the card and the note in your chat with him) included, plus the carousel dots sitting above the heart / comment / share row, and the profile page (signed out: Maya's Following · Followers · Likes, @username, tabs, grid, no classes card above the tabs, CS 3358 on her Classes tab, her apartment on her Listings tab and her locked Saved tab; signed in: your own profile, and its Saved setting set to Everyone, seen from a signed-out visitor, and back to Only me) (Playwright) | seed data with `SUPABASE_ACCESS_TOKEN=sbp_… node apps/mobile/e2e/sim-seed.mjs`, start the site (`npm run dev -w web -- -p 3060`), then `BASE=http://localhost:3060 node apps/web/e2e/home-feed.mjs` (add `PLAYWRIGHT_CHANNEL=chrome` to use the installed Chrome instead of downloading Playwright's browser) |
| The app in the iOS Simulator (Maestro; `01-signed-in.yaml` also tours your own profile: Leo among your Followers, adds and removes a class, the Saved line, and on Maya's profile the empty Mutual friends list behind her Followers number and her Classes and Listings tabs) | the flows in `apps/mobile/e2e/flows/`: `e2e/run.sh e2e/flows/00-signed-out.yaml` from `apps/mobile`, with the same seeded data (see `apps/mobile/README.md`) |

## Housing

Housing is one main tab, labelled **Explore** in the bar with a compass icon, with two halves, left to right: **Room | Roommate** (apartments and roommates), and the **Marketplace** as a third page right after them (its grid, hearts, category pills, search and "Sell an item" moved in unchanged). Like the Home tabs they are slidable: in the app the three feeds sit side by side in a pager under the tab's own bar, laid out like the inbox's ("Find", the labels with the sliding underline, the inbox's search box searching the page on screen with a round filter button beside it (a sheet of the page's own filters: sort, bedrooms, rent, distance from campus, furnished, pets and video tours for rooms; budget, who the post is open to, distance and video for roommate posts; sort, condition and price for items), then the pills: All, All | Has a room | Looking for a room, or All and the item categories) (tap a label or swipe, with one clear haptic each time the page changes, like Home's), and on the website a sticky Room | Roommate | Marketplace bar sits under the navbar and a sideways touch swipe across the page moves to the neighbouring section (touch screens only; the photo rail, the map and a multi-photo carousel keep their own swipes). Room is the landing half. The website keeps the `/apartments`, `/roommates` and `/marketplace` addresses, so listing links, filters and the `?university=` query are unchanged; the Explore tab in the navbar links to `/apartments` and stays highlighted on both. In the app the floating "+" follows the visible half: "List an apartment" on Apartments, "Create roommate post" on Roommates, "Sell an item" on Marketplace. The order and the addresses come from `HOUSING_SECTIONS`, `DEFAULT_HOUSING_SECTION` and `housingSectionHref` in `packages/shared/src/constants.ts`, so the website and the app always agree.

## Video tours (Mux)

Video is the main attraction, so it gets a real pipeline:

- **Upload straight to the provider.** `POST /api/video/uploads` creates a direct-upload URL at Mux and a `media` row; the browser (or the app, with `Authorization: Bearer <token>`) sends the untouched file there in resumable chunks with progress, so a dropped connection resumes instead of restarting. Nothing passes through our server.
- **Processing.** Mux converts the original into adaptive streams (HLS, up to 4K with `video_quality: plus`) and a poster frame. `GET /api/video/{mediaId}` checks the provider and updates the row until it is `ready`; the uploader polls it. Optionally set `MUX_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` and point a Mux webhook at `/api/video/webhooks/mux` for push updates.
- **Listings** store a snapshot of ready videos in `videos` (jsonb); a trigger keeps `has_video` in sync. The feed query ranks `has_video` first, then newest, and the "Video tours only" filter uses the same column. Both rules live in the database, not in the web page.
- **Recording in the browser.** "Record a tour" opens the camera with a room-by-room checklist (front door, living room, kitchen, bedroom, bathroom, window view). Phones can also open the camera app directly. Any phone format is accepted, iPhone .mov included, up to 2 GB.
- **Playback.** Feed videos autoplay muted when in view, one at a time, with a shared mute button; detail pages show the video first in the gallery.

Environment: `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` (Mux → Settings → Access Tokens, Mux Video read + write) on the server only. The `.env.example` lists them. Mux bills per minute stored and delivered.

## Architecture checklist

| Decision | Status |
| --- | --- |
| Web: Next.js (React, TypeScript) | Done: `apps/web` |
| Mobile later: Expo (React Native) | Ready: the shared package was verified to type-check and bundle inside an Expo SDK 57 app (see [Moving to iOS and Android](#3-moving-to-ios-and-android-later)) |
| Backend: Supabase (Postgres, auth, realtime, storage) with no custom server | Done: `supabase/migrations`, security enforced with row-level security |
| Monorepo from day one with Turborepo | Done: npm workspaces + Turborepo (`turbo.json`): `apps/web`, `packages/shared`, `apps/mobile` later |
| Everything that is not a UI component lives in `packages/shared` | Done: types, zod validation, all Supabase queries, price/date formatting, constants. The web app only keeps Next.js-specific code (server actions, cookies, `cn()` for Tailwind) |

Why npm workspaces rather than pnpm: nothing to install for a new contributor, Vercel and Expo support it out of the box, and Turborepo provides the task pipeline and caching either way. Switching to pnpm later is a matter of adding `pnpm-workspace.yaml` and re-installing.

## What is included

| Area | Features |
| --- | --- |
| Accounts | Sign-up restricted to verified university emails (`@txstate.edu`), enforced in the form and by a database trigger; confirmation email; Google sign-in (optional, limited to the same domain); profile with photo, university (attached automatically from the email), program, bio; "Verified student" badge |
| Housing → Apartments | Listings with photos, rent, address, a map pin (address search or click-to-pin), distance to campus computed automatically with PostGIS, beds/baths, amenities, availability, lease length; list and map views; filters (university, "within 1/2/5/10 miles of campus", price, bedrooms, furnished, pets, sort); save; message the owner; mark as rented; edit/delete |
| Housing → Roommates | "I have a room" / "I need a room" posts with budget, move-in date, area (optionally pinned on the map with distance to campus), gender preference, sleep schedule, cleanliness, smoking/pets; filters incl. distance from campus; save; message |
| Marketplace (the third page of Explore) | Items with photos, price (or free), category, condition, pickup location; filters; save; message the seller; mark as sold. No payments on purpose: meet on campus, like Facebook Marketplace |
| Messages | Conversations with participants (a group is simply a conversation with 3+ people): 1:1 chats, group chats (create, rename, add people, leave), course chats (one per section of a class each semester, see Profile above: they fill themselves from the class lists, cannot be renamed or hand-filled, and are deleted when the semester ends after a week's notice), Supabase Realtime delivery, unread badges, "Mark all as read" (a pill above the app's inbox while Unread is chosen, a button in the website's chat list: one call, `mark_conversations_read()` in migration 27, marks every unread chat on screen read, the counts and the badge clearing at once; a chat with nothing new is left alone, as when it is opened), muting (a person's messages everywhere, one group, or every group chat, for 1, 8 or 24 hours or until unmuted: the message and the unread count still arrive, the notice does not; migration 26), rows that show full names only, photo messages, posts, reels and listings shared from their Share button (as cards that open them), "Message" buttons that pre-fill a first message about the listing, and "Active now" or "Active 5 min ago" under the other person's name in a direct chat (anyone can hide theirs in Settings, see Activity status in the [feature map](#feature-map)). A `device_push_tokens` table is ready for the mobile apps |
| Social | Following, like Instagram: a Follow button on every other person's profile ("Following" once you follow, "Follow back" when they follow you), follower / following counts (public, like the profiles) with your own two lists behind them and, on anyone else's profile, the mutual friends you share with them (row-level security keeps every follow readable only by the two people in it), a "Following" filter on Home → Posts (in the app, a row of the feed dropdown in the top bar), and a notification when someone follows you. Blocking someone removes the follow in both directions and stops new ones; row-level security only lets you add or remove your own follows |
| Comments | Under posts, reels and listings, TikTok style: threaded replies folded behind "View N replies", a heart with its count on every comment (a dislike stays private), Top / Newest sort, hold a comment for Reply / Report / Block / Delete (your own comment or any comment on your post); the author of a comment you answer gets a notification |
| Profiles | TikTok style (see Profile in the [feature map](#feature-map)): @username, Following · Followers · Likes, Edit profile / Share profile with a QR code, classes per semester, the person's listings, and Posts, Classes, Reels, Saved and Liked tabs; each person chooses who can see their Classes (Friends by default), Saved (Only me) and Liked (Everyone); up to three pinned posts |
| Other | Global search across all three sections, saved listings page, public profile pages, "add your university", SEO metadata + sitemap, PWA manifest |

Security is enforced in the database with row-level security: users can only edit their own listings, only conversation members can read or send messages, and images can only be uploaded to a user's own folder.

## Project structure

```
apartment-book/
├─ apps/
│  ├─ web/                    # Next.js website (App Router, src/ layout)
│  │  ├─ src/app/             # routes: (app)/ has the main site, (auth)/ login + signup
│  │  ├─ src/components/      # UI: layout, home (For you, Buzz, Posts, Reels), housing (the Room | Roommate | Marketplace bar and swipe), apartments, roommates, marketplace, messages, profile
│  │  ├─ src/lib/actions/     # server actions (create/edit/delete, auth, chat)
│  │  ├─ src/lib/supabase/    # Supabase clients for browser and server
│  │  ├─ src/proxy.ts         # auth guard: refreshes sessions, protects private routes
│  │  └─ e2e/                 # home-feed.mjs: Playwright check of the navigation, Home, Housing and the profile page on a desktop and a phone viewport
│  └─ mobile/                 # Expo app for iOS and Android (see apps/mobile/README.md)
│     ├─ src/app/(tabs)/      # bottom tabs: index.tsx (Home), search.tsx (Search: people), housing.tsx (the Explore tab: Room | Roommate | Marketplace), messages, profile; the bell in Home's top-right corner opens notifications.tsx
│     ├─ src/components/      # UI: home (the Home pager), housing (the Housing pager), profile (the TikTok-style profile), post cards, carousels, forms…
│     └─ e2e/                 # Maestro flows (flows/*.yaml), sim-seed.mjs test data, run.sh
├─ packages/
│  └─ shared/                 # platform-agnostic code reused by the website and the app
│     ├─ src/
│     │  ├─ types/            # Database types + models
│     │  ├─ schemas/          # zod validation for every form
│     │  ├─ queries/          # all reads/writes (apartments, items, roommates, messages, feed, follows, buzz, for-you, storage…)
│     │  ├─ for-you.ts        # blendForYou: the fixed pattern behind Home → For you
│     │  └─ constants.ts      # categories, amenities, currencies, HOME_SECTIONS, HOUSING_SECTIONS…
│     └─ tests/               # unit tests (npm run test:shared)
├─ supabase/
│  ├─ migrations/             # database schema, policies and functions, one file per change (first: 20260906000000_init.sql)
│  ├─ tests/                  # offline database tests in PGlite (npm run db:test)
│  └─ seed.sql                # starter list of universities
├─ scripts/                   # supabase-setup.mjs (one-shot setup), e2e-check.mjs and e2e-home-feed.mjs (live backend checks)
├─ turbo.json                 # Turborepo task pipeline (typecheck -> lint -> build, with caching)
└─ package.json               # npm workspaces root
```

Rules for `packages/shared`: no imports from `next/*`, `react-dom` or browser globals (`window`, `document`, `localStorage`); every query takes the Supabase client as its first argument; keep `types/database.ts` in sync with the migration. The web app's ESLint and type-check run through Turborepo (`npm run check`); the shared package's unit tests run with `npm run test:shared` (plain `node --test` on Node 22.18+, no network).

## 1. Run it locally

Requirements: Node.js 22.18 or newer (the shared unit tests load TypeScript files directly) and npm.

```bash
npm install
```

### Project status

The Supabase project for this app (`dskbzoqreandwwpxiplh`, region us-west-2) is already set up: the migrations and the universities (with campus coordinates and the `txstate.edu` domain) are loaded, `apps/web/.env.local` is written, and the auth URLs point at `http://localhost:3000`. Sign-ups therefore require a `@txstate.edu` address right now. The steps below are for reference, for a second environment, or if you start a fresh project.

Each new migration has to reach the live project before the code that uses it: migrations 14, `supabase/migrations/20260923000000_follows.sql` (the `follows` table, the `follow_stats` and `following_posts` functions and the follow notification), 15, `supabase/migrations/20260924000000_comment_threads.sql` (`post_comments.parent_id` and `score`, the `post_comment_votes` table and the `post_comment_vote()` function), 16, `supabase/migrations/20260925000000_comment_likes.sql` (`post_comments.likes` and the `post_comment_vote()` function returning the score, the likes and your vote), 17, `supabase/migrations/20260926000000_shared_posts.sql` (`messages.shared_post` and the `list_friends()` function), 18, `supabase/migrations/20260927000000_profile_page.sql` (usernames, the who-can-see settings, the `profile_classes` table, likes readable only through functions, the `profile_stats` and `post_view_counts` functions and `feed_posts.pinned_at`), 21, `supabase/migrations/20261010000000_private_follow_lists.sql` (follows readable only by the two people in them, `follow_stats` giving everyone the same totals, the `mutual_friends()` function and `are_friends()` closed to the API), and 22, `supabase/migrations/20261011000000_activity_status.sql` (the private `user_activity` table, the `touch_activity()`, `activity_status()`, `blocked_either_way_ids()` and `set_show_active_status()` functions, the Realtime Authorization policies of the private `presence:active` channel, `profiles.last_seen_at` emptied and no longer written, `mark_delivered_all()` doing nothing while you hide your status, `mark_conversation_read()` doing nothing when there is nothing new, messages dated no later than when they are sent, chat members limited to their receipts and a group's name, notifications changed only once shown, and `profiles` and `notifications` granted to the API column by column), must be applied with `SUPABASE_ACCESS_TOKEN=sbp_xxx npm run db:setup` before this version of the website or the app is deployed, or every profile page, Home → Posts → Following, every comment thread, the share sheet and sending a share will fail (only messages that carry a share write `shared_post`, so plain chat keeps working). Without migration 18 a profile still shows its header, with zeros, and each tab says what it could not load, but searching people by name fails (the search also matches @usernames) and posts lose their "Liked by" line and newest comment. Without migration 21 other people's follower lists cannot load (on someone else's profile the counts open your mutual friends, which come from a function only migration 21 adds), and anyone with the public API key can still read who follows whom. Ship this version right after applying it, though: app builds and website versions from before it read other people's lists straight from the `follows` table, so once migration 21 is live they show empty lists (or only you) under the real counts until they get this code. Without migration 22 the private presence channel refuses every join and `touch_activity()` and `activity_status()` do not exist, so no green dots show anywhere (avatars, the app's online friends row, Roommates' Online now) and chat headers show no activity status (the website's says "Direct message", as before); nothing wrong is shown and messaging keeps working. From migration 22 on, `profiles` and `notifications` are granted to the API column by column (so their system columns stay closed): a migration that adds a column to either must also `grant select (that_column) on public.<table> to anon, authenticated`, or the API cannot read it (and `select *` on that table fails until it does), and must never grant SELECT on the whole table again. Once it is live, older builds and website versions keep working but meet on the old public `online` channel, so they and this version no longer see each other online, and they lose last-seen times ("Active 5m ago" read `profiles.last_seen_at`, now always empty); this version still shows their last-active times to the people they have written to, because their heartbeat (`touch_presence()`) now stamps the private table. Their Settings can still hide the activity status but no longer turn it back on (only `set_show_active_status()`, which this version calls, can); the rest of such a save is kept. Right after `npm run db:setup`, redeploy the website and publish the app's JavaScript to installed builds with `cd apps/mobile && npx eas-cli@latest update --channel preview` (a build downloads it on its next launch and runs it from the launch after). Migration 24, `supabase/migrations/20261017000000_course_groups.sql`, adds the section, the meeting times and the room on classes, the `course_groups` table and triggers behind the course chats, and the daily `course_groups_rollover()` that warns members a week before a semester ends and deletes its course chats the day after; it schedules itself with pg_cron where that extension is enabled (Supabase dashboard: Database → Extensions), otherwise run `select public.course_groups_rollover()` once a day another way. Migration 25, `supabase/migrations/20261018000000_course_groups_rollover_params.sql`, lets that function take the day it runs for and one term (`course_groups_rollover('2099-12-26', 'Fall 2099')`), which is how `supabase/tests/course-groups.test.mjs` exercises both the week-before notice and the deletion in PGlite, and moves the leave-the-chat step to an AFTER trigger so a changed section or a deleted chat never collides with the class row it is updating. When a semester ends, the class rows stay on the profile as that semester's history with no chat attached, and the new semester's list starts empty.

### Fastest path: the setup script

Create a personal access token at https://supabase.com/dashboard/account/tokens, then:

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx npm run db:setup      # migration + seed + .env.local + auth URLs
SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=<ref> npm run db:check   # live end-to-end check
```

`db:setup` applies any migration that has not been applied yet and re-runs the seed as an upsert, so it is safe to re-run (for example with `SITE_URL=https://yourdomain.com` after you go live). `db:check` creates two temporary users, exercises listings, chat (including realtime), and photo uploads, then deletes them. Delete the access token from the dashboard when you are done with it.

### Create the Supabase backend by hand (free)

1. Go to https://supabase.com, create an account and a new project. Pick a region close to your students. Save the database password somewhere safe.
2. In the dashboard open **SQL Editor → New query** and run each file in `supabase/migrations/` in order (`20260906000000_init.sql`, then `20260907000000_geo_push_domains.sql`). They create all tables, security policies, chat functions, PostGIS columns, the `uploads` image bucket, realtime for chat, push tokens and the university-email rule.
3. Run `supabase/seed.sql` the same way to load the universities with campus coordinates. Texas State University carries the `txstate.edu` email domain; to open the app to another university, set `email_domain` on its row (SQL: `update universities set email_domain = 'utexas.edu' where name = 'University of Texas at Austin'`).
4. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` for now (change to your domain later).
   - The migration enables the PostGIS extension automatically (it is available on every Supabase project).
   - Redirect URLs: add `http://localhost:3000/auth/callback` (and later `https://yourdomain.com/auth/callback`).
5. **Authentication → Providers → Email** is on by default. Keep "Confirm email" on for production. While developing you can turn it off so sign-ups log in immediately.
6. Optional, recommended: **Authentication → Emails → Templates → Confirm signup**: replace the link with
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=/settings/profile?welcome=1`
   so confirmation links work from any device or browser.
7. Optional: Google sign-in. In Google Cloud Console create OAuth credentials (Web application) with the redirect URI shown in **Supabase → Authentication → Providers → Google**, then paste the client ID and secret there and enable the provider.

### Configure the website

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in the values from **Supabase → Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   (the anon / publishable key, never the service_role key)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### Start

```bash
npm run dev
```

Open http://localhost:3000, create an account, set your university in Settings, and post a listing. Open a second browser (or a private window) with another account to try messaging: messages arrive instantly without refreshing.

Other scripts (all run through Turborepo): `npm run build`, `npm run lint`, `npm run typecheck`, and `npm run check` which runs all three with caching.

## 2. Put it online (hosting + domain)

The website is designed for **Vercel** (the company behind Next.js; free Hobby plan is enough to start) with Supabase as the backend.

### Current deployment

The site is live at **https://apartment-book-vyass.vercel.app** (Vercel project `apartment-book` in the `vyass` team of the `yubrajbajagain2024-2020` account, Root Directory `apps/web`, production environment variables set, Deployment Protection turned off so the public can reach it). Supabase's auth Site URL points at that address. To ship a new version from this machine:

```bash
git push                 # keeps GitHub in sync (yubrajbajagain2024-byte/Apartment-Book)
vercel deploy --prod --yes --archive=tgz   # from the repository root
```

To deploy automatically on every push instead, connect the GitHub repository in the Vercel dashboard (Project → Settings → Git). The `.vercelignore` file keeps build caches out of CLI uploads. Run each new file in `supabase/migrations/` on the live project (or `npm run db:setup`) before deploying code that depends on it.

### Deploy to Vercel (from scratch)

1. Put the project on GitHub:
   ```bash
   git init
   git add .
   git commit -m "Apartment Book"
   # create an empty repo on github.com, then:
   git remote add origin https://github.com/<you>/apartment-book.git
   git push -u origin main
   ```
2. Go to https://vercel.com, sign in with GitHub, click **Add New → Project** and import the repo.
3. In the import screen set **Root Directory** to `apps/web` (Vercel detects the npm workspace automatically).
4. Add the three environment variables from `.env.local`, but with `NEXT_PUBLIC_SITE_URL` set to your real address (for now the `https://<project>.vercel.app` URL Vercel gives you).
5. Click **Deploy**. Every push to `main` redeploys automatically.
6. Back in Supabase → Authentication → URL Configuration, set the Site URL to your Vercel URL and add `https://<project>.vercel.app/auth/callback` to Redirect URLs.

Alternative without GitHub: `npm i -g vercel`, then run `vercel` inside `apps/web` and follow the prompts.

### Connect your own domain

1. Buy a domain from any registrar (Namecheap, Cloudflare Registrar, Porkbun, GoDaddy, Google Domains alternatives). Something like `yourbrand.com` costs roughly USD 10–15 per year.
2. In Vercel open the project → **Settings → Domains** → add `yourbrand.com` and `www.yourbrand.com`.
3. Vercel shows the DNS records to create at your registrar (typically an `A` record pointing to Vercel's IP for the root domain and a `CNAME` for `www`). Add them in the registrar's DNS panel; the site is live on your domain once DNS propagates (minutes to a few hours). HTTPS certificates are automatic.
4. Update `NEXT_PUBLIC_SITE_URL` in Vercel to `https://yourbrand.com` and redeploy.
5. Update Supabase: Site URL `https://yourbrand.com`, add `https://yourbrand.com/auth/callback` to Redirect URLs.

### Production checklist

- Supabase free projects pause after a week of inactivity; upgrade to the Pro plan (USD 25/month) before real users arrive, which also adds daily backups.
- Supabase's built-in email sender is rate-limited (a few emails per hour). For real sign-ups configure **custom SMTP** (Resend, Postmark, Brevo, SendGrid all have free tiers) under Authentication → Emails → SMTP Settings.
- Keep "Confirm email" enabled so only real mailboxes can sign up. Sign-ups are already limited to the university domains stored on the `universities` table.
- Map tiles come from OpenStreetMap, which is fine for a student site. If traffic grows, set `NEXT_PUBLIC_MAP_TILE_URL` to a MapTiler or Stadia tile URL with your key (both have free tiers).
- Turn on **Vercel Analytics** (free) in the Vercel dashboard for traffic numbers.
- Never expose the `service_role` key in the app. The website only uses the anon key; row-level security does the rest.

## 3. Moving to iOS and Android later

Nothing in the backend has to change, and the shared package already works in React Native: it was verified by creating an Expo SDK 57 app inside a copy of this monorepo, importing `listApartments`, `apartmentSchema`, `formatPrice` and `timeAgo` from `@apartment-book/shared`, type-checking it, and producing a Metro/Hermes bundle. The steps:

1. Scaffold the app inside the monorepo:
   ```bash
   npx create-expo-app@latest apps/mobile --template blank-typescript --no-install
   ```
2. Add these to `apps/mobile/package.json` under `dependencies`, then run `npm install` from the repository root:
   ```json
   "@apartment-book/shared": "0.1.0",
   "@supabase/supabase-js": "^2.115.0"
   ```
   Expo configures Metro for monorepos automatically (SDK 52 and newer). Next.js and Expo both use React 19.2; if npm ever ends up with two React versions (symptom: "Invalid hook call"), pin the same `react` version in both apps.
3. Create the Supabase client the same way as `apps/web/src/lib/supabase/client.ts`, storing the session with `expo-secure-store` (see the Supabase Expo guide), and add the URL and anon key to `app.json` `extra` or an `.env` file.
4. Reuse the shared code in screens:
   ```tsx
   import { listApartments, formatPrice, type ApartmentWithOwner } from "@apartment-book/shared";
   const page = await listApartments(supabase, { universityId, sort: "newest" });
   ```
   Chat uses the same `supabase.channel(...).on("postgres_changes", …)` subscription as `apps/web/src/components/messages/chat-window.tsx`. Three rules learned the hard way, all encoded in `apps/web/src/lib/supabase/client.ts`: set the user's token on the realtime socket before a channel joins (a channel that joins before the session is loaded stays anonymous and row-level security hides every event), give every subscription a fresh channel name, and pass `postgres_changes_options: { wait: true }` so `SUBSCRIBED` means the server is actually streaming. Photo uploads call `uploadImage` with an `ArrayBuffer` read from the picked image (`await fetch(asset.uri).then((r) => r.arrayBuffer())`).
5. Add `"dev": "expo start"` and `"typecheck": "tsc --noEmit"` scripts so Turborepo picks the app up, then ship with **EAS Build**. You will need an Apple Developer account (USD 99/year) and a Google Play developer account (USD 25 once). Push notifications for new messages can be added with Expo Notifications plus a small Supabase Edge Function triggered on message insert.

Until then, the site already works as an installable web app: on a phone, "Add to Home Screen" gives it an icon and a full-screen experience.

## Regenerating database types

`packages/shared/src/types/database.ts` is written by hand to match the migration. If you change the schema, either edit it or generate it with the Supabase CLI:

```bash
npx supabase login
npx supabase gen types typescript --project-id <your-project-ref> > packages/shared/src/types/database.ts
```

## Ideas for later

Map view with pins (Google Maps or Mapbox), university email verification badges, reporting/blocking users, saved searches with email alerts, push notifications, ratings for sellers, and an admin dashboard for moderation.

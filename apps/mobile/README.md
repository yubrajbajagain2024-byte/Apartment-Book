# Apartment Book – mobile app (Expo)

React Native app for iOS and Android. All data access lives in `packages/shared`
(the same code the website uses); this app only adds screens.

## Run it

```bash
# from the repo root, once
npm install

cd apps/mobile
npx expo start          # press i for the iOS Simulator (needs Xcode), a for Android
npx expo start --tunnel # phone anywhere with Expo Go: scan the QR code
```

`.env` holds only public keys (Supabase URL + anon key, website URL). Row-level
security protects the data, so they are safe to ship.

## Design system

The app's look is quiet luxury, and it lives in three files. `src/lib/theme.ts` holds what is the same in both themes:
the corner radii (modest: 6, 10, 14, 20pt; capsules only are pills), the 4pt spacing rhythm, the type scale (Playfair
Display, bundled in `assets/fonts` and loaded with `useFonts` in `app/_layout.tsx`, for `display`, `title`, `headline`
and the italic `aside`: the wordmark, screen titles, big numbers and headlines; the system face for everything read and
tapped, with `eyebrow`, a tracked small-caps label, for section and stat labels), the three shadows (`card`, `float`,
`sheet`, faint) and the motion (one soft spring, a 0.97 press sink). `src/lib/palette.ts` holds the two palettes, every
colour on screen: warm ivory surfaces and near-black ink by day, near-black surfaces and warm white ink at night; `brand`
is that ink (buttons, links, selected states), `accent` the one violet (Home's underline, slide dots, hashtags), `verified`
a bronze, `border` the hairlines that separate instead of boxes, `borderStrong` the outline of a control you tap (chips,
outline buttons, tags, toggles), `input` the soft field fill, and the media tokens stay light over photos and video in
both (`mediaControl` is the dark glass of a control drawn on video, such as the Campus | Global toggle over Reels).
Readability is a rule, not a taste: every text colour clears WCAG contrast on every surface it sits on, in both themes
(`text` above 15:1, `muted` at least 6.5:1, `faint`, the placeholders and times, at least 4.6:1), secondary text is never
set below 12pt, the floating bottom bar is an opaque pill under its liquid glass, and reels carry a soft gradient at the
top and bottom so white words and icons hold on the brightest frame. `src/components/ui.tsx` holds the pieces: `Button` (ink, outline, ghost, danger; it
sinks under the finger), `Field` (eyebrow label, soft fill, an ink hairline on focus), `Chip`, `Badge`, `Card`, `Eyebrow`,
`SectionTitle`, `Skeleton` with `FeedSkeleton` and `RowSkeleton` (lists breathe their own shape while loading), `EmptyState`
(a serif headline) and `ErrorBanner`; `post-bits.tsx` the pieces every post is built from. Screens never pick a hex code
or a font name: they take tokens through `useColors()` / `makeStyles()` and the `type` scale, so Light, Dark and System
Default all hold. The mark is a serif "C" on ink (`assets/images`, drawn from the Playfair outline).

On iOS the app speaks the platform's own language, after Apple's Human Interface Guidelines and Liquid Glass. Every icon
is an SF Symbol (`src/components/icon.tsx` maps each Ionicons name used in the app to its symbol, each one checked
against the SF Symbols catalogue, and falls back to the Ionicon on Android, the web and older iOS): the tab bar uses the
system's own glyphs, filled when selected, verified students carry Apple's seal, and a heart, a bookmark or a tab
answers with the system's bounce when it turns on. Liquid Glass belongs to the navigation layer only
(`src/components/glass.tsx`): the floating tab bar (interactive glass over a 92% fill, so its labels keep at least 6:1
over any content), the floating "+" (glass tinted with the ink), the round buttons over a profile's cover, the "Mark
all as read" pill, and over photos and video the Back and sound buttons and the Campus | Global toggle (clear glass on
a dark dimming layer). Content stays opaque. Rounded rectangles use iOS's continuous corners, bottom sheets float inset
from the screen's edges with corners concentric with the phone's and a system grabber, and the segmented control
springs its thumb like UIKit's. Haptics follow Apple's vocabulary (`src/lib/haptics.ts`): a selection tick for tabs,
chips, segments and switches, the softest impact when a primary button commits or a list is pulled to refresh, success
when something is published, a warning as a destructive choice is asked for, an error when something fails, and a light
tap as a held row's menu rises. Tapping the tab you are on scrolls its list back to the top (`src/lib/tab-reselect.ts`),
rows fade in once as they first arrive, and Reduce Motion and Reduce Transparency are honoured throughout
(`src/lib/accessibility.ts`): animations become still and glass gives way to solid fills.

## Home and the tabs

The bottom bar has five tabs: Home, Search, Explore, Messages, Profile (your own photo in a circle, ringed while
the tab is on screen; the person icon signed out). It floats over the content as a rounded
glass pill (`src/app/(tabs)/_layout.tsx`, its size in `src/lib/tab-bar.ts`): on iOS 26 real liquid glass, with what scrolls
under it blurred through, elsewhere a translucent fill; the tab on screen sits in a lighter capsule with its icon filled, and the capsule slides to
the tab you tap on a soft spring while the tabs make room for it, GroupMe style, with no haptic
(`src/components/floating-tab-bar.tsx`, on Reanimated); every tab's list and floating button keeps `tabBarInset` clear
under it. Search (find accounts by name and follow them) is the second tab, under its own "Search" title
(`src/app/(tabs)/search.tsx`; the share sheet's Find people and a profile's Find friends push the same screen with the box
focused, `src/app/find-people.tsx`). The Notifications bell in the top-right corner of Home's floating top bar opens every
notification the database keeps for you (`src/app/notifications.tsx`: new messages, likes, comments and replies, follows,
saves of your listings, places near campus, newest first, the unread ones tinted); tapping one marks it read and opens what
it is about, "Mark all read" sits in the header, and the bell's badge counts the unread live. Home opens on **For you**, a blend of posts and reels (anonymous Buzz threads stay on
the Buzz page; the fixed pattern lives in `packages/shared/src/for-you.ts` and is shared with the website). Its
three pages, For you | Buzz | Reels, sit side by side in a pager (Posts is a section without a tab: `HIDDEN_HOME_SECTIONS` in the shared constants keeps it out of the row and the pager while its feed, the post features and the data stay; its Following filter is reachable on the website's `/?tab=posts`; reels also run through For you): swipe left or right to move
between them, or tap a label in the floating top bar. That bar has two rows, like X's (`src/components/home/home-top-tabs.tsx`): your photo in a teal-to-violet
ring on the left, which opens your profile, with Instagram's small "+" badge on its corner that opens the create sheet
(Post / Reel / Buzz; over Reels the bar's left slot holds a white "+" instead), the CampConnect wordmark in the middle (it
reads "Following" while that feed shows) and Search on the right; then the three labels spread across the row
(`src/components/sliding-tabs.tsx`): the active one bold with a rounded violet underline as wide as the label, sliding
with the finger over a hairline, and a soft haptic each time the section changes, by tap or swipe. Under the labels sits the Campus | Global
toggle, a small segmented pill whose thumb slides to the choice: Campus is your own university, Global every university (and,
only while Posts has a tab, Following: the posts of people you follow, which switches to Posts); the choice scopes For you,
Buzz, Posts and Reels alike (`src/lib/home-scope.ts`). Someone without a university has nothing to choose, so the row is not drawn.
Tapping a reel in For you opens it full screen in the Reels viewer (`src/app/reels/[id].tsx`), like Instagram: the reel
plays edge to edge under one top row with Back at the left, the same Campus | Global toggle in the middle and its sound
button at the right; the creator's name, the caption and the heart, comments, share, save and "…" rail sit at the bottom
(`src/components/home/reel-item.tsx`, as on the Reels page), and under them an "Add comment…" bar on every reel opens the
comments sheet straight into typing. A swipe up moves on to the next reel: the Reels feed runs on
behind the one that was opened, page by page, and the other campus choice keeps the reel on screen while the reels after
it come from the new choice. The row hands its reel over (`src/lib/reel-viewer.ts`), so the viewer opens at once with the
row's counts, and what you like, save or comment there shows on the row when you come back (`emitPostEngagement` in
`src/lib/posts-events.ts`); a reel deleted there leaves the feeds too.
The bar scrolls like Instagram's (`src/lib/collapsing-header.ts`): it slides up out of the way as the page on screen
scrolls down, by as much as the page moved, and slides back the moment the page scrolls up, however far down it is; a
swipe or a tap between pages brings it back too, and Reels never moves it. The same goes for the Room | Roommate | Marketplace
row on Explore and the pills under it (the bar with its title and Search stays put): they slide up under the fixed bar
as the list under them scrolls down, and back as soon as it
scrolls up. The bottom bar never moves. The choice lives in
`src/lib/home-scope.ts` and drives For you, Buzz and Posts alike: the pages have no filter chips of their own.
Housing (the Explore tab, with a compass icon) works the same way with three pages,
**Room | Roommate | Marketplace** (apartments, roommates, items), under its own top bar laid out like the inbox's (`src/app/(tabs)/housing.tsx`): the big
"Find" title, the three labels with the sliding violet underline, the inbox's search box (searching the page on screen) with a
round filter button beside it (`src/components/housing/filter-sheet.tsx`: a sheet of the page's own filters, applied on "Show
results", counted on the button; rooms sort, bedrooms, rent, distance from campus, furnished, pets and video tours; roommate
posts a budget cap, who the post is open to, distance and video; items sort, condition and price), and the
pills that narrow the page (All on Room, All | Has a room | Looking for a room on Roommate, All and the item
categories on Marketplace); the labels and the pills slide up under the title as the page scrolls. It opens on Room, a swipe or a tap on the label above the
pager moves to Roommate or the Marketplace and back (one clear haptic each time the page changes, by tap or swipe, like
Home's), and the floating "+" follows the visible page ("List an apartment",
"Create roommate post" or "Sell an item"). The order comes from `HOUSING_SECTIONS` in `packages/shared/src/constants.ts`.
The Marketplace page is the old Marketplace tab's grid, moved in whole (`src/components/housing/marketplace-section.tsx`):
the same cards and hearts, its categories in the pills row, its search (applied
once typing pauses, a spinner in the box meanwhile) and "Sell an item", a page at a time as it scrolls; the old
`/marketplace` address redirects to it.
Profiles work like Instagram too: a Follow button (it reads "Following" once you follow), follower / following
counts that open your own two lists (on anyone else's profile, the friends you have in common, since who follows whom
is private; signed out, a log-in prompt), and, signed in, the Following segment of the Home toggle (while Posts has a tab), which keeps only the
posts of people you follow on Posts. Builds from before private follower lists show empty lists on other people's
profiles once migration 21 is live, so publish this code (`npx eas-cli@latest update --channel preview`) right after
applying it. Comments open in a TikTok-style sheet: "N comments" up top with a Top / Newest sort, each comment with
a heart and its count (a dislike stays private), Reply, replies folded behind "View N replies", the composer pinned at the
bottom, and a hold on a comment for Reply / Report / Block / Delete (your own comment, or any comment on your post); a like on a
post, a reel or a comment buzzes the phone through `expo-haptics` (`src/lib/haptics.ts`, with the selection tick of the Home labels too).
The Share button on posts, reels and listings opens a sheet of your friends, the people you follow who follow you back
(`src/components/share-sheet.tsx`, mounted once in `src/app/_layout.tsx`): search, tap one or more faces, add an optional
note and Send, and each friend gets a chat message with the post as a card that opens it, the note under it; "Share to…"
at the bottom is the system share sheet. It needs migration 17 (`supabase/migrations/20260926000000_shared_posts.sql`).

The Profile tab is your profile, TikTok style (`src/components/profile/`, one `ProfileView` for the tab and for
`/profile/[id]`): a top bar with Find friends, your name (the account sheet, Log out) and the menu (Settings and privacy,
Saved, the legal pages, Log out); your photo with a "+" to change it, @username (made from your name at sign-up, changed
in Settings) with a QR icon, Following | Followers | Likes (every like on your posts, reels and listings), Edit profile /
Share profile (a sheet with the profile's QR code and Share) / Find friends, the bio and university, then the tabs
Posts | Classes | Reels | Saved | Liked | Listings as icons, TikTok style (the open one filled, with the sliding
underline and a small mark of who can see that section: a lock for Only me, two people for Friends, a globe for
Everyone; the filled icon and the mark crossfade with the swipe on the native side, like the underline, so they never
wait for the pager to settle), over a three-column grid with view counts (Listings: your live
apartments, roommate posts and items for sale, each square with its kind and title). The Classes tab lists classes by semester, this one first (up to 12 each; add your own there with the subject and course number as two boxes, "CS" and "3358", kept as the one code "CS 3358" the database checks, the section, the days and times it meets and the room; a hold on a class card offers Edit (the same form, filled in; Save moves you between course chats when the section changes) and Delete, which asks first, and there is no other way to change or remove one; once a class is in or changed, the form closes and a line under "Add class" says so, the button bringing it back). Listing a section puts you in that section's course chat, a group in Messages shared by everyone at your campus taking it this semester: the first classmate's listing creates it, removing the class leaves it, a notification tells you about both, it cannot be renamed or hand-filled, and it goes with the semester after a week's notice (migration 24).
Classes, Saved and Liked each have a setting (Everyone, Friends, Only me; friends are people you follow who follow you
back), changed from the line at the top of the tab or in Settings → Privacy; by default Classes is Friends, Saved is Only
me and Liked is Everyone, and visitors without access see a lock. Hold one of your own posts or reels in the grid (or use
its ••• menu) to pin it to the top of your profile, three at most. Someone else's profile has Follow, Message and More
(block, report) instead. It needs migration 18 (`supabase/migrations/20260927000000_profile_page.sql`: usernames, the
who-can-see settings, `profile_classes`, likes readable only through functions, `profile_stats`, `post_view_counts` and
`feed_posts.pinned_at`); without it the header still shows, with zeros, and each tab says what it could not load.

The Messages tab is the inbox (`src/app/(tabs)/messages.tsx`): the new-message pencil in the top-right corner, the big
"Messages" title, Chats | Groups with Home's sliding violet underline, a rounded search box and the All | Unread |
Requests pills (each with its count; Requests on Chats only), then the two pages side by side in a pager like Home's: a
swipe or a tap on a label moves between your direct chats and your group chats, with the same knock. On Chats the row of
friends online now sits above the chats (photo, name, the time at the right, the last message under it, a hairline between
rows; no @usernames anywhere in Messages, names only, though typing a handle still finds the chat). A long press on a row (or Chat
info) mutes that person's messages everywhere or that group, and a group also offers every group chat at once, each for 1, 8 or
24 hours or until unmuted (`src/lib/use-mutes.ts`, migration 26: the message and the unread count still arrive, only the notice is
withheld); a muted chat shows a small bell-slash after its name. While Unread is chosen and lists something, a "Mark all as
read" pill floats above the bottom bar, as in GroupMe: one tap marks every chat it lists read in one call
(`mark_conversations_read`, migration 27), the rows and the Messages badge clearing at once (`reportMessagesRead` in
`src/lib/use-unread.ts`) and the server catching up behind. Requests holds the direct chats that people you do not follow started with you, until you reply or follow them
(`src/lib/use-message-requests.ts`: nothing is stored for it, it is read off the chats, the follow stats and whether you
have written in each, so every device agrees). Searching looks only in the page on screen.

A direct chat shows the other person's activity status under their name, like Instagram (`src/lib/use-activity-status.ts`,
the wording in `packages/shared/src/activity.ts`): a small green dot and "Active now" while they are online, otherwise
when they were last active ("Active 5 min ago", "Active 3 hours ago", "Active yesterday", "Active 2 days ago", redrawn every
30 seconds, asked again every minute in view and whenever they send a message), or nothing when there is nothing to show
(they hide theirs, or a block; someone who has never written to you shows "Active now" while online, never a time); group
chats keep "N members". Presence (`src/lib/presence.tsx`) runs only while you show your own status: when the app goes to
the background it stamps your last-active time and stops showing you online at once, while it still can (a phone runs no
timer in the background; a glance at Notification Center is not leaving); back in front it stamps first and shows you
again once that stamp confirms your status is still shown; it stamps the time and reads the block list every minute in
front, leaves out people blocked either way, and stops at once when you log out. Settings → "Show your activity status"
turns it off, and then you see nobody's either and your app stops marking messages "Delivered" (people see "Seen" once you
read something new); Settings reads your profile again whenever it opens, and sends that switch
(`set_show_active_status()`, the only way to turn it back on) only when you change it. It needs migration 22
(`supabase/migrations/20261011000000_activity_status.sql`); without it no green dots show and chat headers have no
activity line. Builds from before it meet on the old public presence channel, so once it is live they and this version no
longer see each other online and they show no last-seen times, and their Settings can no longer turn activity status back
on: publish this code (`npx eas-cli@latest update --channel preview`) right after applying it.

The Maestro flows in `e2e/flows/` check this in Expo Go on the booted iOS Simulator and save
screenshots to `e2e/screenshots/`. They need [Maestro](https://maestro.mobile.dev) installed in
`~/.maestro`, `npx expo start` running, and seeded test data:

```bash
cd apps/mobile
SUPABASE_ACCESS_TOKEN=sbp_... node e2e/sim-seed.mjs      # test users and sample posts (the test account and Leo follow each other, so Leo is a friend to share with; Maya lists CS 3358 and MATH 3398 for this semester, visible to everyone); prints the login, writes e2e/.sim-state.json
e2e/run.sh e2e/flows/00-signed-out.yaml                 # lands on For you (no Campus | Global toggle signed out), swipes to Buzz, opens Notifications from the bell in Home's top-right corner (signed out: the log-in prompt), Search (bottom tab: the people list), Messages (bottom tab), Explore (Room, Roommate, swipe back, Marketplace), Profile (several flows at once is fine)
EMAIL=... PASSWORD=... e2e/run.sh e2e/flows/01-signed-in.yaml   # your own profile (adds CS 1428 under Classes and removes it, Saved says only you can see it), then likes, comments (write, heart, reply, delete from the hold menu), shares the top post with Leo and finds the card in your chat with him (Messages), votes, replies, the Campus | Global toggle under the labels, follows and unfollows Maya (her Classes tab shows CS 3358, her Listings tab her apartment), opens your own Followers (Leo) and Maya's Mutual friends (none: Leo follows her one way), as the seeded account
node e2e/sim-seed-thread.mjs                            # nested replies and votes for 03-buzz-thread.yaml
SUPABASE_ACCESS_TOKEN=sbp_... node e2e/sim-cleanup.mjs  # removes the test data afterwards
```

The flows that like, vote or post (01 to 03) only ever act as a seeded `ui-sim-…` account and
stop if someone else is signed in on the simulator (they read the email on the account sheet behind your name on the
Profile tab, which shows "Edit profile" when you are signed in); 00 and 04 only look.

## Project state

- EAS project: `@apartmentbooks-team/apartment-book` (id in `app.json` → `extra.eas.projectId`)
- Bundle id / package: `com.apartmentbook.app`
- Build profiles: `eas.json` (`production` auto-increments build numbers on EAS)
- Workflow: `.eas/workflows/create-production-builds.yml` builds both platforms on push to `main`
  once the GitHub repo is linked on expo.dev (set base directory to `apps/mobile`).
- Backend features the stores require are live: account deletion (Settings), report and
  block (••• menu on posts, More on profiles), privacy policy and terms (website `/privacy`, `/terms`).

## Ship to the App Store (first time, needs Xcode + Apple Developer account)

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest build --profile production --platform ios   # sign in with your Apple ID when asked
npx eas-cli@latest submit --platform ios --latest              # uploads to TestFlight / App Store Connect
```

Before submitting, in App Store Connect create the app (name "Apartment Book",
bundle id `com.apartmentbook.app`) and fill the listing: screenshots, description,
privacy policy URL `https://apartment-book-vyass.vercel.app/privacy`, support URL,
age rating, and the App Privacy questionnaire (email, name, photos, messages,
user content; not used for tracking).

## Ship to Google Play

```bash
npx eas-cli@latest build --profile production --platform android
npx eas-cli@latest submit --platform android --latest   # needs a Play Console service-account JSON
```

Or upload the `.aab` from the EAS build page by hand under Internal testing.

## After the first release

Later builds and submissions run non-interactively, including from CI:

```bash
EXPO_TOKEN=... npx eas-cli@latest build --platform all --profile production --non-interactive
```

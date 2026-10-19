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

## Home and the tabs

The bottom bar is Home, Explore, +, Messages, Profile: four tabs (Profile is your own photo in a circle, ringed while
the tab is on screen; the person icon signed out) and, in the middle, Create: the plain "+" inside a thin Aurora ring
(cyan, blue, violet, the glow the app keeps for rings, drawn through a ring-shaped mask), nothing filled and no label
(screen readers hear "Create"); the ring is as tall as a tab's icon and label together and lines up with them. It opens
the create sheet (Post / Reel / Buzz), the same one as the "+" on your photo in Home's top bar. It floats over the content as a rounded
glass pill (`src/app/(tabs)/_layout.tsx`, its size in `src/lib/tab-bar.ts`): on iOS 26 real liquid glass, with what scrolls
under it blurred through, elsewhere a translucent fill; the tab on screen sits in a soft aurora capsule with its icon filled. When you tap
another tab the capsule glides there from the old one, never blinking or fading: its leading edge moves a beat ahead of its trailing edge,
so it stretches a touch in flight and settles as it lands. The new tab's symbol bounces once (silently: no haptic), the tab you left returns
to its plain look with no bounce, and the tabs make room for the capsule, GroupMe style, on a critically damped spring
(`src/components/floating-tab-bar.tsx`, on Reanimated); every tab's list and floating button keeps `tabBarInset` clear
under it. The "+" is an action, not a place: the capsule passes behind it but never stops on it, and it never moves, as
the two tabs on either side make room within their own half of the bar (`action` in FloatingTabBar; its slot is as wide
as an idle tab, so the five sit evenly). Search (find
accounts by name and follow them) is the magnifying glass in the top-right corner of Home's floating top bar, just before
the Notifications bell (`src/components/header-actions.tsx`): it pushes the people search with the box focused
(`src/app/find-people.tsx`, the same screen the share sheet's Find people and a profile's Find friends open). The Notifications bell in the top-right corner of Home's floating top bar opens every
notification the database keeps for you (`src/app/notifications.tsx`: new messages, likes, comments and replies, follows,
saves of your listings, places near campus, newest first, each unread one marked only by a small blue dot, the row
itself like any other in both themes); tapping one marks it read and opens what
it is about, "Mark all read" sits in the header, and the bell's badge counts the unread live. Home opens on **For you**, a blend of posts and reels (anonymous Buzz threads stay on
the Buzz page; the fixed pattern lives in `packages/shared/src/for-you.ts` and is shared with the website). Its
three pages, For you | Buzz | Reels, sit side by side in a pager (Posts is a section without a tab: `HIDDEN_HOME_SECTIONS` in the shared constants keeps it out of the row and the pager while its feed, the post features and the data stay; its Following filter is reachable on the website's `/?tab=posts`; reels also run through For you): swipe left or right to move
between them, or tap a label in the floating top bar. That bar has two rows, like X's (`src/components/home/home-top-tabs.tsx`): your photo in an aurora
ring on the left, which opens your profile, with Instagram's small "+" badge on its corner that opens the create sheet
(Post / Reel / Buzz; over Reels the bar's left slot holds a white "+" instead), the CampConnect wordmark in the middle (it
reads "Following" while that feed shows) and Search and the Notifications bell on the right; then the three labels spread across the row
(`src/components/sliding-tabs.tsx`): the active one bold with a rounded aurora underline as wide as the label, sliding
with the finger over a hairline; moving between sections, by tap or swipe, plays no haptic. Under the labels sits the Campus | Global
toggle, a small segmented pill whose thumb slides to the choice: Campus is your own university, Global every university (and,
only while Posts has a tab, Following: the posts of people you follow, which switches to Posts); the choice scopes For you,
Buzz, Posts and Reels alike (`src/lib/home-scope.ts`). Someone without a university has nothing to choose, so the row is not drawn.
Tapping any reel, or the photo or video of any post (photos, videos or both), anywhere in the app opens it full screen in
the viewer (`src/app/reels/[id].tsx`), like Instagram. It does not slide in: the tapped picture itself grows out of its
place in the feed, the grid or the chat to fill the screen while the screen behind fades to the page's colour (black
behind a video, the theme's behind a photo; a see-through modal with no system animation; the page stays full size inside
the growing frame, scaled so the picture keeps its size and crop), and on the way out (Back or Android's back) it shrinks
back into the same place; opened from a link or a page other than the tapped one, it fades and scales out instead. The
first and last frames are the feed's own picture: the zoom waits, unseen, until the page has drawn the tapped picture (the
photo's `onDisplay`, the video's first frame; a frame or two, 350ms at most, the feed's live picture showing meanwhile), so
it never opens on a black frame or a photo still fading in, and no poster goes over a feed player that has drawn a frame
(`hasDrawn`), even while it buffers or loops; a post partly under Home's floating bars opens out of (and lands on) only the
band between them (`OpeningBand`, from a JS copy of the collapsing bar's position), the bars staying drawn over the rest;
a video is lined up on the whole of its picture (`wholeVideo`: drawn whole, past the page's sides where it
fills a phone taller than 9:16, and trimmed by the page, a carousel's slide or the zoom's opening), so the opening starts on
exactly the feed's crop at the feed's size (the feed trims a vertical video's top and bottom, the viewer its sides) and lands
back on it; and a video's shades and frost come and go with the words and the rail, never over the bare picture. A
sideways swipe, either way, goes back too, under the finger (`usePageSwipe` in `src/lib/viewer-swipe.ts`): the page
follows it, shrinking and rounding its corners as the screen it was opened from shows through, its words and buttons
fading away; let go past about a third of the way, or with a flick, and it carries on, the page it was opened on shrinking
into the post it came from, still exactly where it was (the feed keeps its scroll position, and a carousel post's row has
followed the viewer to the photo on screen, `emitPostSlide`), any other page sliding on out and fading; let go sooner and
it springs back. A post's photos keep their own sideways swipes: only past its first or last photo, or from the left edge,
does a swipe pull the page back. The viewer is a modal screen, outside the view in which the gesture library cancels React
Native's touches, so the page's taps check `swipedJustNow` themselves: a touch that ended a swipe never pauses, likes or
opens anything. Feed and viewer videos skip Live Text on a paused frame (`allowsVideoFrameAnalysis={false}`): its button
would sit over the play control, and its scan was what crashed Expo Go in the simulator. Screens opened from the viewer (a profile, a chat) come up as cards over it. Pictures are laid out
TikTok style (`src/components/home/reel-item.tsx`). A video fills the screen (`placeVideo`): a vertical one edge to edge,
trimmed a little at the sides on a phone taller than 9:16; a square or landscape one whole, as wide as a 9:16 canvas, over
a subtle, dimmed blur of itself. A photo is never stretched or cropped (`photoLayout`): it sits whole and as wide as the
screen at the top, under the top row, on the theme's own colour (white in light, black in dark), which stays free below it
for the name, the words and the comment bar, all in the theme's ink; a photo too tall to leave that space (9:16, a phone
screenshot) is shown full screen on black like a video instead. Over every page, one top row with Back at the left and the
Campus | Global toggle in the middle (for reels and For you); the creator's name, the words and the heart, comments, share,
save and "…" rail sit at the bottom (as on the Reels page), over a video's shades and gradual frost
(`src/components/progressive-blur.tsx`: expo-blur through a gradient mask, left out on a build without them), and under
them an "Add comment…" bar on every page opens the comments sheet straight into typing. Share opens the same share sheet
as the feeds (send to friends, or "Share to…" the system share sheet with the page's link: `/posts/<id>` for posts and
posted reels, `/apartments/<id>` or `/roommates/<id>` for listing tours); the viewer mounts its own `ShareSheetProvider`,
since iOS presents a sheet from the screen on top and the root layout's one cannot appear over this modal screen. On a photo's page each button of
the rail is white where it sits over the photo (a crisp dark edge on its strokes, no shading behind it, keeps it readable on
a white wall) and in the
theme's ink where it sits on the page below; the top row, the status bar and the comment bar follow the page under them,
switching as a page's edge passes, and an opened description brings the page's colour up behind it. A tap pauses a video: a play button appears in the middle with the sound
button just above it, both fading away again the moment it plays (the sound button keeps it paused). A post with several
photos or videos swipes sideways on its page, with dots on a line of their own under the top row (its colours changing
halfway through a swipe), and opens on the one that was showing in the feed; a video plays while its page and slide are on screen, and a double tap anywhere likes. On iOS a video tapped while it plays in the feed is played on in the viewer by the
feed's own player (`src/lib/video-handoff.ts`: lent as the viewer opens, in `openViewer`, so a tap that opens something
else never lends it; counted, so the page showing it borrows it too, for as long as that page is in reach; given back as
the viewer goes), so it opens on the very frame that was showing and never pauses, reloads or jumps, there or back. Neither
side calls play or sets the sound on a player already doing the right thing; closing sets it playing first, so it is
moving as it shrinks back (or as the page in front fades), and sends back no time, which could only make it seek; a feed
row that goes while the viewer still holds its player (`useLendablePlayer`) lets it go only once it is back, and For you
does not reload under the viewer (a Campus | Global choice made there applies once Home is back). Closing from another
page pauses that page's own video, so only the one going back is heard; deleting the opened post stops its player. The
zoom closed brakes evenly to a stop on the feed's own live picture (300ms, `ZOOM_OUT_CURVE`): iOS's long-tailed curve left
the page creeping its last few points for a fifth of a second, and there the page is a scaled copy of the picture, a
little softer than the feed's own (expo-image filters trilinearly) and shimmering as it crept, so going back looked shaky
and blurred. Its edges sit on whole pixels and the page inside is placed from them (`onPixel`), so the picture never
twitches against its frame, and it fades out over the feed's own in the last 50ms, as it covers its last few pixels, so
the crisp one has taken over by the time it stops. The viewer leaves two frames later: the copy of the screen
react-native-screens keeps up while a modal goes is then see-through, never a frozen frame that skips ahead. The feed's
sound button fades away as its video goes full screen and back once it returns, and the status bar takes the viewer's
style only once the page covers most of the screen. Sound is one switch for every feed video, the Reels tab and the viewer
(`src/lib/video-sound.ts`, muted to start), so a video keeps its sound exactly as it was in both directions; so that it is
never heard twice, For you and Posts play one video at a time (the first row on screen that has one) and a carousel's
videos play only while their screen is the one on show; every
player mixes with other audio while muted (`audioMixingMode` "auto"; expo-video's native default stops the person's music
for a muted video scrolling past). Each loop of a short clip still holds about 0.15–0.5s: expo-video loops an HLS stream by
seeking back to its start, and neither a seek just before the end nor buffering changes help (measured); seamless loops
need progressive MP4 renditions with `useCaching`, or a native looper in a development build. Elsewhere (Android cannot
show one player in
two places) it goes on in the viewer from where it
had got to (`startAt`: the feed's poster, then the still from that moment, cover the jump), and the feed's own player
goes on from wherever the viewer leaves it (`emitPostSlide` with a time) rather than starting again. Saved fills the
bookmark in the rail's own colour. Swiping between pages never blinks: two pages ahead (and one behind) are laid out
with their videos loaded and waiting (from the moment the zoom open has finished: until then only the page opened on
has its player, frost and pictures, since a large photo or poster is decoded and resized on the main thread as it
arrives, which made the zoom drop frames; profiled with Instruments), a video's still is its very first frame (Mux `time=0`) so the player takes over
without a jump, and in dark mode the top row keeps one style over photos and videos alike. The bottom tab bar plays no
haptic, and neither do Home's For you | Buzz | Reels, Explore's Room | Roommate | Marketplace and its "+", Messages'
Chats | Groups, the profile's section tabs or the inbox's All | Unread | Requests pills. A swipe up moves on: a reel goes on
into the Reels feed (only reels, page by page, the other campus choice keeping the page on screen while what follows comes
from the new choice); a post in For you goes on down For you, its next pages loading as needed; a square in a profile grid
(Posts, Reels, Saved, Liked) goes on through that grid; a saved post through your saved posts; a post's own screen and a
post shared in a chat go on into the Reels feed. Words-only posts and listings keep their own screens. A Buzz thread with
photos or videos opens here too, from the Buzz list (going on through its other threads with media) or from the thread's
own screen, and stays anonymous: where a post has its author, its page has the topic's icon, the topic and its age ("You"
on your own), one line with the title in bold before the words (a tap opens all of both), and a rail of upvote with the
score, downvote (a double tap upvotes),
replies, share (the link through the system sheet, never a friend card) and "…" (hide, report, or delete your own); the
replies and "Reply anonymously…" open the thread's own screen over the viewer, or, opened from that screen, close the
viewer onto it (`viewerItemFromBuzz`, `BuzzRail` in `src/components/home/reel-item.tsx`). Votes, new replies and a thread
deleted or hidden reach the list, the thread's screen and the viewer's pages alike (`BuzzEvent`). In the Buzz list a thread's
media sits in the same rounded frame and shape as a post's in For you (`frameAspect`), its dots under it, one video
playing at a time. The source hands its pages over (`src/lib/reel-viewer.ts`), so the viewer opens at once with the
row's counts (a grid square, which knows only the post's id, loads its post as it comes near, its picture standing in,
the same view all along, until the loaded page has drawn its own: no black frame between the two), and
what you like, save or comment there shows on the row when you come back (`emitPostEngagement` in `src/lib/posts-events.ts`);
a post deleted there leaves the feeds too.
The bar scrolls like Instagram's (`src/lib/collapsing-header.ts`): it slides up out of the way as the page on screen
scrolls down, by as much as the page moved, and slides back the moment the page scrolls up, however far down it is; a
swipe or a tap between pages brings it back too, and Reels never moves it. The same goes for the Room | Roommate | Marketplace
row on Explore and the pills under it (the bar with its title and Search stays put): they slide up under the fixed bar
as the list under them scrolls down, and back as soon as it
scrolls up. The bottom bar never moves. The choice lives in
`src/lib/home-scope.ts` and drives For you, Buzz and Posts alike: the pages have no filter chips of their own.
Housing (the Explore tab, with a compass icon) works the same way with three pages,
**Room | Roommate | Marketplace** (apartments, roommates, items), under its own top bar laid out like the inbox's (`src/app/(tabs)/housing.tsx`): the big
"Find" title, the three labels with the sliding aurora underline, the inbox's search box (searching the page on screen) with a
round filter button beside it (`src/components/housing/filter-sheet.tsx`: a sheet of the page's own filters, applied on "Show
results", counted on the button; rooms sort, bedrooms, rent, distance from campus, furnished, pets and video tours; roommate
posts a budget cap, who the post is open to, distance and video; items sort, condition and price), and the
pills that narrow the page (All on Room, All | Has a room | Looking for a room on Roommate, All and the item
categories on Marketplace); the labels and the pills slide up under the title as the page scrolls. It opens on Room, a swipe or a tap on the label above the
pager moves to Roommate or the Marketplace and back (silently, by tap or swipe, like Home's), and the floating "+"
(no haptic either) follows the visible page ("List an apartment",
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
post, a reel or a comment buzzes the phone through `expo-haptics` (`src/lib/haptics.ts`). The same file holds the rest of the vocabulary: a selection tick for chips, segments, switches and the sound buttons, the softest impact when a primary button commits or a list is pulled to refresh, success when something is published, and a warning or an error with the alerts that ask before a delete or report a failure (`alertWithHaptic`). Tapping the tab you are on scrolls its page back to the top, as on every iOS tab bar (`src/lib/tab-reselect.ts`).
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
"Messages" title, Chats | Groups with Home's sliding aurora underline, a rounded search box and the All | Unread |
Requests pills (each with its count; Requests on Chats only), then the two pages side by side in a pager like Home's: a
swipe or a tap on a label moves between your direct chats and your group chats, silently, as on Home. On Chats the row of
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
e2e/run.sh e2e/flows/00-signed-out.yaml                 # lands on For you (no Campus | Global toggle signed out), swipes to Buzz, opens Notifications from the bell in Home's top-right corner (signed out: the log-in prompt), Search (the magnifying glass beside the bell: the people list), Messages (bottom tab), Explore (Room, Roommate, swipe back, Marketplace), Profile (several flows at once is fine)
EMAIL=... PASSWORD=... e2e/run.sh e2e/flows/01-signed-in.yaml   # your own profile (adds CS 1428 under Classes and removes it, Saved says only you can see it), then likes, comments (write, heart, reply, delete from the hold menu), shares the top post with Leo and finds the card in your chat with him (Messages), votes, replies, the Campus | Global toggle under the labels, follows and unfollows Maya (her Classes tab shows CS 3358, her Listings tab her apartment), opens your own Followers (Leo) and Maya's Mutual friends (none: Leo follows her one way), as the seeded account
node e2e/sim-seed-thread.mjs                            # nested replies and votes for 03-buzz-thread.yaml
SUPABASE_ACCESS_TOKEN=sbp_... node e2e/sim-cleanup.mjs  # removes the test data afterwards
```

The flows that like, vote or post (01 to 03) only ever act as a seeded `ui-sim-…` account and
stop if someone else is signed in on the simulator (they read the email on the account sheet behind your name on the
Profile tab, which shows "Edit profile" when you are signed in); 00 and 04 only look.

## Look and feel on iPhone

The app keeps its own look (the brand blue, white or black surfaces, the system font) and adds what makes an iPhone app
feel native:

- **The Aurora.** CampConnect's signature is a gradient, cyan → sky blue → periwinkle → violet (`aurora`,
  `auroraGlow` and `auroraWash` in `src/lib/palette.ts`, drawn with `auroraGradient` from `src/lib/theme.ts`). It is used
  sparingly: primary buttons (the compact ones that repeat down a list stay solid blue), the send buttons, the floating
  "+", the active tab's underline in Home, Explore, Messages and on a profile, the selected segment, the soft capsule
  behind the active tab in the bottom bar, and the rings around your photo in the Home bar, on the Profile tab and on a
  profile page. Under white words the stops are deep enough that a label keeps 4.5:1 across the middle where it sits;
  rings and underlines use a brighter version on black. The solid brand blue is the aurora's blue stop (#166fe5 in
  light, 4.7:1 on white), for links, icons and active chips.

- **Icons.** On iOS every icon is the matching SF Symbol (`src/components/icon.tsx`), in Apple's weights and optical
  alignment: filled when on, outlined when off. A like, a save, a vote and a newly chosen tab bounce once. Android keeps Ionicons.
- **Type.** One scale of Apple's text styles (`textStyle` in `src/lib/theme.ts`): the Search, Find and Messages titles
  are iOS Large Titles (34pt bold), names and screen titles are Title 2, sheet titles are Headline. Nothing is heavier
  than bold except the CampConnect wordmark, and the system font keeps its own tracking.
- **Buttons.** One `Button` (`src/components/ui.tsx`), an iOS 26 capsule in three sizes: compact (34pt) in list rows,
  regular (44pt) for most actions, large (50pt) for the action that ends a form or a sheet. Semibold labels, a spring
  press and a soft haptic on the primary ones.
- **Sheets.** One `Sheet` (`src/components/sheet.tsx`) under the comments, share, filter and share-profile sheets: the
  screen dims as the sheet rises on UIKit's presentation spring, the header (or the whole sheet when nothing in it
  scrolls) pulls it down on the UI thread, and a flick or a long pull closes it. Every sheet has the same grabber,
  centred title and close button, floats 8pt in from the screen edges with 34pt continuous corners, and keeps its text
  fields above the keyboard. Menus stay the system's own action sheet.
- **Glass only where it does a job.** The tab bar and the controls over photos and video (Back over a reel, the Campus |
  Global toggle over a reel, Back and the menu over a profile cover) are Liquid Glass on iOS 26
  (`src/components/glass.tsx`). Everything else is solid, including the floating Create button and the Mark all as read
  pill. Reduce Transparency swaps every glass surface for a solid fill.
- **Scrolling.** The For you, Buzz, Room and Roommate feeds draw each row through a memoised component with stable
  handlers, so a scroll only redraws the rows whose content changed, and they keep about four screens of rows mounted
  instead of ten. Photos show the tiny blurred preview saved at upload at once and fade the full photo in over it. On
  Home, a strip in the bar's colour stays under the status bar while the bar slides away, so nothing passes under the clock.
- **Motion.** Buttons and glass controls dip under the finger on a spring, the blue thumb of a segmented control slides
  to the chosen option, and the rows of every feed and list fade in once as they first arrive. Reduce Motion turns the
  scaling, sliding, fading and bouncing off, and sheets then fade instead of sliding (`src/lib/accessibility.ts`).
- **Readability.** Secondary and faint text pass WCAG AA contrast (4.5:1) on the page and on cards in both themes
  (light placeholders sit at about 4.1:1 on the grey input fill). Text follows Apple's type sizes, with nothing under
  11pt apart from the counts and tags on small badges, and the shades at the top and bottom of a reel keep its white
  words readable even on a white frame.

Haptics and tap-to-top are covered with the comments above.

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

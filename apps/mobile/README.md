# UniBuzz – mobile app (Expo)

The UniBuzz app for iOS and Android: a private social network for university life — connecting students, clubs, events, campus news, housing, and the student marketplace in one place. React Native, with Expo. All data access lives in `packages/shared`
(the same code the website uses); this app only adds screens.

## Run it

```bash
# from the repo root, once
npm install

cd apps/mobile
npx expo start               # a development build of the app (see below); press i for the iOS Simulator, a for Android
npx expo start --go --tunnel # phone anywhere with Expo Go: scan the QR code
```

Since `expo-dev-client` is a dependency, a plain `npx expo start` serves development builds; add `--go` for Expo Go.

`.env` holds only public keys (Supabase URL + anon key, website URL). Row-level
security protects the data, so they are safe to ship.

### Development builds (calls need one)

Expo Go cannot carry a call's sound and picture: the LiveKit media module is compiled only into the app's own builds.
`eas.json`'s `development` profile makes a **development build** (an `expo-dev-client` app that loads its JavaScript from
your Metro server, so you keep Fast Refresh): an iOS build for the simulator and an Android APK, built in the cloud by EAS
(the `apartmentbook` Expo account, project `4e98759f-dbc5-4217-b4cb-ec8030ffce49`; no Xcode, CocoaPods or Android SDK needed
on your Mac):

```bash
cd apps/mobile
npx -y eas-cli@latest build --platform ios --profile development      # simulator build (.tar.gz with ApartmentBook.app)
npx -y eas-cli@latest build --platform android --profile development  # APK for any Android phone (install it from the link)
npx expo start                                                         # then open the build: it lists this server
```

Install the simulator build with `xcrun simctl install booted ApartmentBook.app` (after `tar xzf` of the artifact), launch
it, and pick the server from its list; a phone installs the APK from the build page's link or QR code. An iOS build for a
real iPhone (`eas build --platform ios --profile development-device`, the same development build signed for devices)
needs an Apple Developer Program membership: run it once in interactive mode, sign in with the Apple ID, and EAS makes the
certificate and provisioning profile and keeps them (in non-interactive mode it stops with "couldn't find any credentials
suitable for internal distribution"); the phone's UDID has to be registered on the first run (`eas device:create`).
Pushes (new messages, missed calls, and the ring of an incoming call, migration 36) reach only real devices: the app
registers its Expo push token on a phone, never in a simulator. A simulator's camera is a stand-in that sends no frames,
so LiveKit never announces a simulator's video to the others (its audio flows); to see a remote video on a simulator, join
the call from a browser with a fake camera (`chromium.launch({ channel: "chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] })`
with `livekit-client` and a token from the function), which draws in the grid like any phone's.


### Your own iPhone, free (no paid Apple Developer Program)

A free Apple ID can sign the app for your own iPhone through Xcode's **Personal Team**. `app.config.js` keeps app.json
as it is for every other build, and with `CAMPCONNECT_FREE_SIGNING=1` (which `npm run ios:device` sets) it makes the one
build a free team can sign: its own bundle id (`com.apartmentbook.app.<your Mac user name>`, or `CAMPCONNECT_BUNDLE_ID`),
and no Push Notifications entitlement, which only paid teams can sign. Everything else is the real app, LiveKit included.

Once, on the Mac:

1. CocoaPods. With macOS's own Ruby 2.6 it installs into your user folder like this (the macOS 15 SDK builds the
   gems' native parts, and these versions are the last that support Ruby 2.6):
   ```bash
   export LANG=en_US.UTF-8 SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.sdk
   gem install --user-install --no-document ffi -v 1.16.3 --platform ruby
   for g in concurrent-ruby:1.3.4 i18n:1.14.1 tzinfo:2.0.6 minitest:5.18.1 activesupport:6.1.7.10; do
     gem install --user-install --no-document --conservative ${g%%:*} -v ${g##*:}; done
   gem install --user-install --no-document --conservative cocoapods
   ```
   `npm run ios:device` (`scripts/ios-device.mjs`) finds it in `~/.gem/ruby/*/bin` itself.
2. Xcode → Settings → Accounts → **+** → Apple ID: sign in with your Apple ID. It shows "(Personal Team)". Then, in
   the same window, select the account → **Manage Certificates…** → **+** → **Apple Development** → Done. (Expo CLI
   signs with the certificate it finds; signing in alone does not make one.)

Once, on the iPhone:

3. Connect it to the Mac with a cable, unlock it and tap **Trust**.
4. Settings → Privacy & Security → **Developer Mode** → on, and restart when it asks.

Then, from `apps/mobile`, with the iPhone and the Mac on the same Wi-Fi:

```bash
npm run ios:device              # pick your iPhone; or: npm run ios:device -- "iPhone"
```

It generates `ios/` (git-ignored) the first time or when it was made for the normal builds, updates it in place when
app.json or app.config.js changed since (a permission text, a plugin), and puts package.json back as it was each time
(prebuild would rewrite its `ios` and `android` scripts); then `expo run:ios` builds, signs with your
Personal Team, installs and opens the app, and runs Metro on port 8083 for it. It also adapts the local copies of a few files that EAS never needs changed, each only when it
finds the exact published text, and again after a fresh `npm install`:

- **Xcode 26 (Swift 6.2).** SDK 57 is written for Xcode 27. In `expo-modules-jsi` the `SWIFT_RETURNS_RETAINED`
  annotations on `RuntimeScheduler`'s constructors go (Swift 6.2 refuses them, while already treating those
  constructors the way they say; a quick compiler probe decides), and in `JavaScriptRuntime.swift` and
  `expo-modules-core`'s `EventEmitter.swift` the values the code marks `nonisolated(unsafe)` travel in a Sendable
  wrapper instead, because Swift 6.2 ignores that mark there (a compiler bug Expo works around the same way elsewhere).
- **A space in the project's path** ("Apartment Book 3"). The expo-constants and expo-updates script phases, a
  `basename` in expo-constants and the app's "Bundle React Native code and images" phase run a path unquoted; they get
  the quotes (and `pod install` runs again to pick them up).

The `filter_map` warnings `pod install` prints come from macOS's Ruby 2.6 in Expo's optional lookup of precompiled
modules; it then builds every module from source, which is what this build does anyway. If it stops with "No code signing certificates", step 2's certificate is missing. The first time the app opens, iOS refuses it until you trust yourself: Settings →
General → VPN & Device Management → your Apple ID → **Trust**. Allow the local network, microphone and camera when asked.

What a free team cannot do: the copy expires after **7 days** (run `npm run ios:device` again to renew it), at most three
such apps fit on a phone, and it gets **no push notifications**, so a call rings it only while the app is open or when it
comes back to the front (the other side's call row and missed-call notification still arrive). Before an EAS build
nothing needs undoing: `ios/` is git-ignored, so EAS generates its own from app.json. To go back to the normal native
project locally, delete `ios/` (or run `npx expo prebuild --clean` without the flag).

Someone to call: `SUPABASE_ACCESS_TOKEN=sbp_… node e2e/call-partners.mjs make` makes three throwaway accounts (one for
your phone, two for simulators or other phones) with a direct chat and a group chat, and prints their logins (`--with
you@txstate.edu` puts your own account in the chats instead). `… call-partners.mjs bot direct` (or `group`) answers the
call your phone is making as the first partner and joins from a headless Chrome with a fake camera and microphone, so
your iPhone has a moving picture and a tone to receive; `… call-partners.mjs clean` deletes them all again.

To drive a simulator build without touching it, point its launcher at Metro and sign in through Metro's debugger: seed
`expo.devlauncher.recentlyopenedapps` in the app's user defaults with `{"url": "http://127.0.0.1:8081"}` (the launcher opens
the last server itself; `xcrun simctl openurl` with the app's own scheme pops a system "Open in…?" dialog instead), and
sign in with `apartmentbook://dev-login?email=…&password=…` once that dialog has been accepted once on that simulator.

## Home and the tabs

The bottom bar is Home, Discover, Messages, Explore, Profile: five tabs in Instagram's order (Profile is your own photo
in a circle, ringed while the tab is on screen; the person icon signed out). There is no "+" in the bar: creating starts
from Home: Orbit's floating "+", the menu under your photo (Upload) and the "+" over Reels open the create sheet (Post /
Reel / Buzz / Snap). It floats over the content as a rounded
glass pill, low like Instagram's: just above the home indicator (12pt into the home-indicator inset, 22pt up from the screen's edge on a
Face ID iPhone; 10pt up where there is no indicator) (`src/app/(tabs)/_layout.tsx`, its size and place in `src/lib/tab-bar.ts`): on iOS 26 real liquid glass, with what scrolls
under it blurred through, elsewhere a translucent fill; the tab on screen sits in a soft aurora capsule with its icon filled. When you tap
another tab the capsule glides there from the old one, never blinking or fading: its leading edge moves a beat ahead of its trailing edge,
so it stretches a touch in flight and settles as it lands. The new tab's symbol bounces once (silently: no haptic), the tab you left returns
to its plain look with no bounce, and the tabs make room for the capsule, GroupMe style, on a critically damped spring
(`src/components/floating-tab-bar.tsx`, on Reanimated); every tab's list and floating button keeps `tabBarInset` clear
under it. (FloatingTabBar can still hold an action in the middle, `action`, which the capsule passes behind but never
stops on; the app's bar has none.) Search is the Discover tab (below); the people search the share sheet's Find people
and a profile's Find friends push is `src/app/find-people.tsx`. The Notifications bell in the top-right corner of Home's floating top bar opens every
notification the database keeps for you (`src/app/notifications.tsx`: likes, comments and replies, follows,
saves of your listings, places near campus, newest first; new messages and Snaps stay in Messages, with its unread
counts and the push, each unread one marked only by a small blue dot, the row
itself like any other in both themes); tapping one marks it read and opens what
it is about, "Mark all read" sits in the header, and the bell's badge counts the unread live. Home opens on **For you**, a blend of posts and reels (anonymous Buzz threads stay on
the Buzz page; the fixed pattern lives in `packages/shared/src/for-you.ts` and is shared with the website). Its
three pages, For you | Buzz | Reels, sit side by side in a pager (Posts is a section without a tab: `HIDDEN_HOME_SECTIONS` in the shared constants keeps it out of the row and the pager while its feed, the post features and the data stay; its Following filter is reachable on the website's `/?tab=posts`; reels also run through For you): swipe left or right to move
between them, or tap a label in the floating top bar. That bar has two rows, like X's (`src/components/home/home-top-tabs.tsx`): your photo in an aurora
ring on the left, which opens your menu (`src/components/home/profile-menu.tsx`, as UniVerse's: a card with your photo,
name and @username that opens your profile, then Upload, Saved, Settings, Community Guidelines, and Log out on its own;
over Reels the bar's left slot holds a white "+" instead), the UniBuzz wordmark in the middle (it reads "Following" while
that feed shows) and the Notifications bell on the right; then the three labels spread across the row
(`src/components/sliding-tabs.tsx`): the active one bold with a rounded aurora underline as wide as the label, sliding
with the finger over a hairline; moving between sections, by tap or swipe, plays no haptic. Under the labels sits the Campus | Global
toggle, a small segmented pill whose thumb slides to the choice: Campus is your own university, Global every university (and,
only while Posts has a tab, Following: the posts of people you follow, which switches to Posts); the choice scopes For you,
Posts and Reels alike (`src/lib/home-scope.ts`; Buzz has its own Campus | Global, its two feeds being separate). Someone without a university has nothing to choose, so the row is not drawn.
For now the toggle is hidden everywhere, here and in the viewer (`SCOPE_TOGGLE_SHOWN` in `src/lib/home-scope.ts` is
`false`): the bar is just its first two rows and every feed stays on your own campus. Its code is all kept; set the flag
back to `true` to bring it back.
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
fading away; let go past about a third of the way, or with a flick, and it carries on, shrinking into the post it came
from, still exactly where it was (the feed keeps its scroll position and its video plays on, and a carousel post's row has
followed the viewer to the photo on screen, `emitPostSlide`): from the page it opened on, the feed's own picture takes
over as it lands; from any other (a later reel), it fades into that picture on the way (`CROSS_FADE`), as Instagram's
does, and Back does the same. Only a viewer opened from a link, with no post behind it, sends the page sliding on out and
fading. Let go sooner and it springs back. A post's photos keep their own sideways swipes: only past its first or last photo, or from the left edge,
does a swipe pull the page back. The viewer is a modal screen, outside the view in which the gesture library cancels React
Native's touches, so the page's taps check `swipedJustNow` themselves: a touch that ended a swipe never pauses, likes or
opens anything. Feed and viewer videos skip Live Text on a paused frame (`allowsVideoFrameAnalysis={false}`): its button
would sit over the play control, and its scan was what crashed Expo Go in the simulator. Screens opened from the viewer (a profile, a chat) come up as cards over it. Pictures are laid out
TikTok style (`src/components/home/reel-item.tsx`). A video fills the screen (`placeVideo`): a vertical one edge to edge,
trimmed a little at the sides on a phone taller than 9:16; a square or landscape one whole, as wide as a 9:16 canvas, over
a subtle, dimmed blur of itself. A photo is never stretched or cropped (`photoLayout`): it sits whole and as wide as the
screen at the top, under the top row, on the theme's own colour (white in light, black in dark), which stays free below it
for the name and the words, all in the theme's ink; a photo too tall to leave that space (9:16, a phone
screenshot) is shown full screen on black like a video instead. Over every page, one top row with Back at the left and the
Campus | Global toggle in the middle (for reels and For you, while the toggle is shown); the creator's name, the words and the heart, comments, share,
save and "…" rail sit at the bottom (as on the Reels page, the rail a little nearer the right edge: `railRight`), over a
video's shades and gradual frost (`src/components/progressive-blur.tsx`: expo-blur through a gradient mask, left out on a
build without them). Opened over the tabs, the viewer keeps the app's tab bar in view under them: it draws a copy of the
tabs' own bar in the same place (`TabBarMirror` in `src/components/floating-tab-bar.tsx`); the tab it was opened from
closes it like Back, another switches tabs at once. Opened from a profile, a chat, Saved or a link, there is no bar. There
is no comment bar: the rail's Comments (a tour's Inbox) opens the comments or the chat. Share opens the same share sheet
as the feeds (send to friends, or "Share to…" the system share sheet with the page's link: `/posts/<id>` for posts and
posted reels, `/apartments/<id>` or `/roommates/<id>` for listing tours); the viewer mounts its own `ShareSheetProvider`,
since iOS presents a sheet from the screen on top and the root layout's one cannot appear over this modal screen. On a photo's page each button of
the rail is white where it sits over the photo (a crisp dark edge on its strokes, no shading behind it, keeps it readable on
a white wall) and in the
theme's ink where it sits on the page below; the top row and the status bar follow the page under them,
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
haptic, and neither do Home's For you | Buzz | Reels, Explore's Housing | Roommate | Marketplace and its "+", Messages'
Chats | Groups, the profile's section tabs or the inbox's All | Unread | Requests pills. A swipe up moves on: a reel goes on
into the Reels feed (only reels, page by page, the other campus choice keeping the page on screen while what follows comes
from the new choice); a post in For you goes on down For you, its next pages loading as needed; a square in a profile grid
(Posts, Reels, Saved, Liked) goes on through that grid; a saved post through your saved posts; a post's own screen and a
post shared in a chat go on into the Reels feed. Words-only posts and listings keep their own screens. Buzz never comes
here: its anonymous photos open in the plain media viewer and its one video plays in place (see Buzz below). The source
hands its pages over (`src/lib/reel-viewer.ts`), so the viewer opens at once with the
row's counts (a grid square, which knows only the post's id, loads its post as it comes near, its picture standing in,
the same view all along, until the loaded page has drawn its own: no black frame between the two), and
what you like, save or comment there shows on the row when you come back (`emitPostEngagement` in `src/lib/posts-events.ts`);
a post deleted there leaves the feeds too.
The bar scrolls like Instagram's (`src/lib/collapsing-header.ts`): it slides up out of the way as the page on screen
scrolls down, by as much as the page moved, and slides back the moment the page scrolls up, however far down it is; a
swipe or a tap between pages brings it back too, and Reels never moves it. The same goes for the Housing | Roommate | Marketplace
row on Explore and the pills under it (the bar with its title and Search stays put): they slide up under the fixed bar
as the list under them scrolls down, and back as soon as it
scrolls up. The bottom bar never moves. The choice lives in
`src/lib/home-scope.ts` and drives For you and Posts alike: those pages have no filter chips of their own (Buzz keeps its
own filter bar, see Buzz below).
Explore (the Housing tab in the code, with a compass icon) works the same way with three pages,
**Housing | Roommate | Marketplace** (apartments, roommates, items), under its own top bar laid out like the inbox's (`src/app/(tabs)/housing.tsx`): the big
"Find" title, the three labels with the sliding aurora underline, the inbox's search box (searching the page on screen) with a
round filter button beside it (`src/components/housing/filter-sheet.tsx`: a sheet of the page's own filters, applied on "Show
results", counted on the button; rooms sort, bedrooms, rent, distance from campus, furnished, pets and video tours; roommate
posts a budget cap, who the post is open to, distance and video; items sort, condition and price), and the
pills that narrow the page (All on Housing, All | Has a room | Looking for a room on Roommate, All and the item
categories on Marketplace); the labels and the pills slide up under the title as the page scrolls. It opens on Housing, a swipe or a tap on the label above the
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
in Settings) with a QR icon under three lines: the full name, the major, class year and university ("CS ’28 @ Texas
State University", from Settings → Major and Graduation year) and the bio; then Following | Followers | Likes (every like
on your posts, reels and listings), Edit profile / Share profile (a sheet with the profile's QR code and Share) / Find
friends, then the tabs
Posts | Classes | Reels | Saved | Liked | Listings as icons, TikTok style (the open one filled, with the sliding
underline and a small mark of who can see that section: a lock for Only me, two people for Friends, a globe for
Everyone; the filled icon and the mark crossfade with the swipe on the native side, like the underline, so they never
wait for the pager to settle), over a three-column grid with view counts (Listings: your live
apartments, roommate posts and items for sale, each square with its kind and title). The Classes tab lists classes by semester, this one first (up to 12 each; add your own there with the subject and course number as two boxes, "CS" and "3358", kept as the one code "CS 3358" the database checks, the section, the days and times it meets and the room; a hold on a class card offers Edit (the same form, filled in; Save moves you between course chats when the section changes) and Delete, which asks first, and there is no other way to change or remove one; once a class is in or changed, the form closes and a line under "Add class" says so, the button bringing it back). Listing a section puts you in that section's course chat, a group in Messages shared by everyone at your campus taking it this semester: the first classmate's listing creates it, removing the class leaves it, a notification tells you about both, it cannot be renamed or hand-filled, and it goes with the semester after a week's notice (migration 24).
Classes, Saved, Liked and Listings each have a setting (Everyone, Friends, Only me; friends are people you follow who
follow you back), changed from the line at the top of the tab or in Settings → Privacy; by default Classes is Friends and
Saved, Liked and Listings are Only me (migration 37). A visitor without access gets no tab for that section at all (the
pager has one page per tab they get), while you always see all six. Hold one of your own posts or reels in the grid (or use
its ••• menu) to pin it to the top of your profile, three at most. Someone else's profile has Follow, Message and More
(block, report) instead. It needs migration 18 (`supabase/migrations/20260927000000_profile_page.sql`: usernames, the
who-can-see settings, `profile_classes`, likes readable only through functions, `profile_stats`, `post_view_counts` and
`feed_posts.pinned_at`); without it the header still shows, with zeros, and each tab says what it could not load.

The Messages tab is the inbox (`src/app/(tabs)/messages.tsx`): the new-message pencil in the top-right corner, the big
"Messages" title, Chats | Groups with Home's sliding aurora underline, a rounded search box and the All | Unread |
Requests pills (each with its count; Requests on Chats only), then the two pages side by side in a pager like Home's: a
swipe or a tap on a label moves between your direct chats and your group chats, silently, as on Home. On Chats the row of
friends online now sits above the chats (photo, name, the time at the right, the last message under it, no line between
rows; no @usernames anywhere in Messages, names only, though typing a handle still finds the chat). A long press on a row (or Chat
info) mutes that person's messages everywhere or that group, and a group also offers every group chat at once, each for 1, 8 or
24 hours or until unmuted (`src/lib/use-mutes.ts`, migration 26: the message and the unread count still arrive, only the notice is
withheld); a muted chat shows a small bell-slash after its name. While Unread is chosen and lists something, a "Mark all as
read" pill floats above the bottom bar, as in GroupMe: one tap marks every chat it lists read in one call
(`mark_conversations_read`, migration 27), the rows and the Messages badge clearing at once (`reportMessagesRead` in
`src/lib/use-unread.ts`) and the server catching up behind. Requests holds the direct chats that people you do not follow started with you, until you reply or follow them
(`src/lib/use-message-requests.ts`: nothing is stored for it, it is read off the chats, the follow stats and whether you
have written in each, so every device agrees). Searching looks only in the page on screen.

A shared post, reel or listing in a chat is a photo bubble too, as a sent photo would be: its picture fills the chat's photo width
(4:5 for a post or a listing, taller for a reel) with who posted it and its words on a shade along the bottom, and no label of what
it is; one without a picture stays a card of its words. A tap opens it as before (`SharedPostBubble` in `message-bubble.tsx`).

A chat (`src/app/messages/[id].tsx`) is laid out like the Messages app. Its floating top bar (`src/components/messages/chat-header.tsx`)
is one row: Back in a 44pt glass circle on the left, then the other person's photo (with the green dot while they are active; a group
shows its mark), their name in bold with a chevron and their activity line ("Active now", "Active 5 min ago", or "4 members") under
it, and Audio call, Video call and Info in 40pt glass circles on the right (Search is in the chat's details). The photo and the name open the chat's details, as Info does. Nothing
solid sits behind it: the messages scroll under it through a blur that fades in towards the top of the screen. The bubbles (`message-bubble.tsx`) have no photos beside them and, as in Instagram, no times under them: a small centred stamp
("Today 14:05", "Yesterday 09:30", "Mon, 3 Mar 10:15", in the phone's own time zone) sits above the first message of each day and
above any message that comes after half an hour's quiet; a tap on a message's words shows its exact time under it until the next tap
(a hold shows it as the menu's title, for photos, voice messages and the like too); your newest message says "Sending…", "Sent" or
"Delivered" under it; and "Seen", with the readers' small photos, sits under the last message they read. A group shows the sender's
name above a run of theirs, and the words sit in 18pt-cornered blue (yours) or grey bubbles at the body size.
A message that arrives, or that you send, rises in on a spring. The message bar (`composer.tsx`) floats too: "+" in a 44pt glass
circle (photo or video, camera, file), a fully rounded 44pt see-through glass capsule holding the 17pt field (it grows to about six
lines, then scrolls) and, at its end, a 34pt microphone or, once something is typed or picked, the blue Send; the voice recorder
that stands in for it while you record keeps the same sizes; picked files and the message being answered sit on glass panels above it. With the
keyboard down the bar keeps the home-indicator space; with it up the bar rides on the keyboard, the newest message staying in view.

Swipe a message to the right (`swipe-to-reply.tsx`, in direct and group chats alike; a hold offers Reply too) to answer it: a reply
mark surfaces from under it, the phone ticks when the drag is far enough, and letting go puts the quote ("Replying to Maya", the
words or "Photo" / "Voice message" / …, with the picture when it is on screen) above the field, with an ✕. The reply carries a
quote of the original above its bubble (`reply-quote.tsx`), tucked behind it Messenger style; tapping the quote jumps to the
original, loading older pages on the way as a search result does. The database builds the quote itself from the original
(`messages.reply_to`, migration 31, `supabase/migrations/20261024000000_message_replies.sql`): the app sends only the
original's id, the original must be in the same chat, the quote never changes afterwards and stays if the original is deleted;
`replyOf()`, `replySnapshotOf()` and `replyText()` in `packages/shared/src/message-replies.ts` read and build it the same way.

Voice messages (`src/components/messages/voice-recorder.tsx`, `voice-bubble.tsx`, `src/lib/voice.ts`, `src/lib/voice-audio.ts`;
expo-audio): with nothing typed or picked, Send is a microphone. A tap records in the bar (discard, a red dot and the time on a
glass capsule, the voice's level moving as you speak, and Send); it sends at once as an "audio" attachment (mono AAC at 44.1 kHz
and 96 kbps, the encoder's best quality, up to five minutes) into the chat's private files. A voice message plays in a waveform
bubble that fills in as it plays, through the loudspeaker at full level (the playback session is always set, and awaited, before
a play, since the session a recording leaves behind plays through the quiet earpiece path), out loud even on silent, pausing
other apps' music while it plays; once it has started a speed pill offers 1×, 1.5× and 2× (pitch corrected, kept for every voice
message and across launches). A build without expo-audio (made before it) shows no microphone and lists voice messages as files.
Messages' Chats and Groups labels carry red counts of their unread messages (adding up to the tab's badge), refreshed as
messages arrive and as chats are read here or elsewhere.

Snaps (`src/app/snap/index.tsx`, `src/app/snap/[id].tsx`, `src/components/snap/`, `src/lib/snap-capture.ts`; the rules
are migration 28's, see the root README): Snap in the create sheet opens the phone's own camera (a photo, or a video up to
30 seconds; in the Simulator, which has no camera, the photo library) over whatever is on screen, through a see-through
screen that shows nothing until there is something to show, so closing the camera lands you where you were. A photo is
re-encoded as a JPEG at most 1920 px long, without its metadata. The take fills the screen on black (a photo over a blurred
copy of itself) with close and "take another" (the camera again; it waits for Send To to be fully gone, since iOS presents
nothing over a sheet that is still leaving) and the Aurora "Send To". That starts the upload (straight from the file, with
progress) and raises the Send To sheet (`send-to-sheet.tsx`): your direct chats, the most recent first, then your friends,
a search over both, a ring per person that fills with the Aurora when picked (only what turns on bounces), and a bar that
rises with who it goes to and the round send button: a spinner and "Sending… 42%", then the plane flies off and a tick
lands on green, and the Snap fades away. In a chat (`snap-bubble.tsx`) a Snap is the same large bubble as a sent photo, at the Snap's own shape, and never its picture: it
shows only its 32-pixel preview (of the photo, or the first frame of the video) in its own colours, lightly softened under a
semi-transparent pane of frosted glass (Liquid Glass on iOS 26, a thin system blur elsewhere, with a hairline of light round its rim), so
its colours and shapes show softly through and nothing can be made out (with Reduce Transparency there is no pane and the preview is
blurred heavily instead), with "Tap to view" or "Delivered" on a glass mark in the middle and "Snap" in the corner; tapping opens it full screen once (a photo until
you tap, swipe it down or close it; a video plays through once with a bar along the top). Once opened the bubble keeps the same blurred
preview (migration 32 leaves it on the message) at seven tenths of the size, with "Opened" and "You viewed it" / "They viewed it" on the
mark. A Snap that expired, was deleted or went unopened loses its preview, as before, and shows its status on a plain dark surface (so
does a Snap sent from an app too old to make a preview); the chat follows realtime updates of its messages, so both sides change at once.

Under the bubble, Snapchat style, the newest thing that happened to the Snap with its time ("Delivered · 14:02", "Opened · 14:05",
"Screenshot taken · 14:05", "Snap deleted", "Expired"), a quiet grey note for every kind, never a warning, and a tap on it (or Snap activity on a hold) opens the Snap's whole
story on a sheet (`snap-activity-sheet.tsx`): sent, delivered, opened, every screenshot or recording, deleted, expired, each with its
time, on both sides of the chat and kept after the Snap is over. The database logs it on the message (`messages.snap.activity`,
migration 33, `supabase/migrations/20261026000000_snap_activity.sql`): the chat reports "delivered" when a Snap reaches it, the one
view reports "opened" together with what that phone can detect, the viewer reports a screenshot (`report_snap_capture()`, the sender
getting a "snap_activity" notification at once), the sender can take a waiting Snap back (Delete Snap on the sheet or the hold menu:
`delete_snap()`, the file going at once and every chat saying "Snap deleted"), and the purge logs "expired". Detection is only ever what
the viewing phone can do, and the sheet says so (`src/lib/snap-capture-guard.ts`, expo-screen-capture): an iPhone reports every
screenshot and blacks out the screen while it is recorded or mirrored (iOS gives apps no recording event, so none is claimed); an
Android phone blocks screenshots and recordings outright while the Snap is open; a build without the module reports "none", and the
sender is told that nothing on it would be reported. The viewer
opens it once (`open_snap()`), loads it through Storage's signed-in download with your own session (every request, each
range of a video too, is checked against the view, so nothing can be loaded after it), keeps a photo in memory only, and closes with a tap, a swipe down, its close button, the end of a video or the app going to the background,
calling `close_snap()`. Both screens leave on a timer rather than when their fade reports it ended, so an interrupted
fade can never leave an invisible screen taking the touches. Until migration 28 is applied, sending says Snaps aren't set
up yet.

Calls (`src/app/call/[id].tsx`, `src/components/calls/`, `src/lib/calls.ts`, `src/lib/call-sounds.ts`; the rules are migration 35's, see the root README) are **paused** for now: `CALLS_PAUSED` in `src/lib/calls.ts` makes Audio call, Video call, a call row and the incoming ring do nothing but show `coming-soon.tsx`, a small glass "Coming Soon · Audio and video calls" pill under the chat's bar that fades away; start Metro with `EXPO_PUBLIC_CALLS_ENABLED=1` (in a development build) to bring them back. When on: the chat's top bar has Audio call and Video call in glass circles beside Info (Search moved into the chat's details). A call is its own full screen on a dark stage with a soft Aurora wash, like FaceTime: the other person's video filling it (or their photo in a ring while they have no camera) with your own camera in a small window at the top right, mirrored while it is the front one; a group is a grid of two columns, you among them, the people still ringing faded with "ringing" under their names, the one speaking ringed in blue; their name and the call's standing at the top ("Calling…", "Ringing…", "Connecting…", then the running time), and a glass bar along the bottom with mute, speaker, camera, flip camera (while the camera is on) and the people in the call (a group), each filled white when its state is on, and the red End button under it. An audio call starts on the earpiece and a video call on the speaker. `CallProvider` (around the whole app in `_layout.tsx`) watches your own `call_participants` rows over realtime and looks again whenever the app comes to the front: a call ringing you fills the screen over whatever is open (`incoming-call.tsx`: the caller's photo breathing in a ring, "UniBuzz Video", Decline and Accept) while the phone rings and buzzes (`assets/sounds/ring.wav`, through expo-audio, the ring respecting the silent switch), for at most 45 seconds; the caller hears a ringback and gives up at 45 seconds ("No answer"), and two short notes mark every end. In the chat a call is a row (`call-row.tsx`: the phone or camera in a circle, "Video call" with "3:24", "No answer", "In progress" or "Calling…" under it, "Missed audio call" in red) that follows the call live, calls back on a tap or joins a call still going on, and a glass pill under the bar offers to Join a call going on in the chat that you are not in (`call-banner.tsx`). A phone whose app is in the background or closed is rung by a push (migration 36; `src/lib/push.ts` keeps a Calls channel on Android with the app's ring and the expo-notifications plugin bundles `assets/sounds/ring.wav` into both apps): while the app is open the push shows nothing (the app rings on its own), and a tap on it opens the incoming call if it is still ringing, as a tap on any other push opens its link (`watchNotificationTaps`, used by `CallProvider`). The media module is only in the app's own builds (`CALLS_AVAILABLE` in `src/lib/calls.ts` looks for it): in Expo Go a call still rings, answers and writes its rows, and the call screen says this copy cannot carry calls, with End. Leaving the call screen in any way hangs up (`leave_call()` runs when it unmounts too), and when everyone else has gone, yours ends on its own.

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
e2e/run.sh e2e/flows/00-signed-out.yaml                 # lands on For you (no Campus | Global toggle signed out), swipes to Buzz, opens Notifications from the bell in Home's top-right corner (signed out: the log-in prompt), Discover (bottom tab: the search box over the grid), Messages (bottom tab), Explore (Housing, Roommate, swipe back, Marketplace), Profile (several flows at once is fine)
EMAIL=... PASSWORD=... e2e/run.sh e2e/flows/01-signed-in.yaml   # your own profile (adds CS 1428 under Classes and removes it, Saved says only you can see it), then likes, comments (write, heart, reply, delete from the hold menu), shares the top post with Leo and finds the card in your chat with him (Messages), votes, replies, the Campus | Global toggle under the labels (skipped while it is hidden), follows and unfollows Maya (her Classes tab shows CS 3358, her Listings tab her apartment), opens your own Followers (Leo) and Maya's Mutual friends (none: Leo follows her one way), as the seeded account
SUPABASE_ACCESS_TOKEN=sbp_... node e2e/sim-seed-thread.mjs   # nested replies and votes for 03-buzz-thread.yaml (Buzz v2 writes are service-role only)
SUPABASE_ACCESS_TOKEN=sbp_... node e2e/sim-cleanup.mjs  # removes the test data afterwards
```

The flows that like, vote or post (01 to 03) only ever act as a seeded `ui-sim-…` account and
stop if someone else is signed in on the simulator (they read the email on the account sheet behind your name on the
Profile tab, which shows "Edit profile" when you are signed in); 00 and 04 only look.

Roommate posts have no public comments, anywhere: someone looking for a roommate is reached in private. Their screen
(`src/app/roommates/[id].tsx` through `src/components/listing-detail.tsx`) carries the Posts action bar right under the photos
(under the words when there are none), the same one as in the Roommates feed: the heart with its count, Share, the outlined Inbox
pill that opens a private chat with the poster (your own post's opens your Inbox) and the bookmark at the far right; every listing
detail, the poster card with Message, and the menu (Save, Share, Report) stay. A roommate video tour in Reels has an Inbox button on
its rail in place of the comments one; the chat opens with a first message
about the post. `hasPublicComments()` in `packages/shared` decides it for the app and the website; Marketplace items have none either
(the seller is reached through Inbox or Message), while posts, reels, apartments and Buzz keep their threads.

## Discover

The second tab (`src/app/(tabs)/discover.tsx`) is Instagram's search tab for every campus at once. The box at the top
finds people (any university: `searchPeople`), topics (#tags, by their start) and posts (the start of each word typed),
under Top | Accounts | Topics | Posts (`src/components/discover/discover-search.tsx`); a tag typed in full always offers
its page. With the box empty it shows what is popular: trending topics, then the posts and reels with the most going on
lately as Instagram's Explore grid (a tall tile, the first video among five, beside four squares, then a row of three,
the tall side alternating: `discoverMosaic` in packages/shared), with "Suggested for you" (accounts from every
university, with their campus and follower count) a little way down. Everywhere by default, your own campus at a tap.
A tile opens the full-screen viewer with the rest of the grid to swipe through, as on a profile. A #tag in a caption, a
trending topic or a topic result opens the topic's page (`src/app/topics/[tag].tsx`): its post count and grid, Top or
Recent.

The rankings are the database's (migration 44, `supabase/migrations/20261103000300_discover.sql`): `discover_refresh()`
scores every post and reel of the last 90 days (likes, comments and views against age, as Reddit's "hot"), every tag
(recent use, weighted by engagement and by how many different people use it) and every student account (followers, new
followers, engagement on recent posts) every 10 minutes (pg_cron), and the readers (`discover_feed`, `discover_accounts`,
`discover_topics`, `discover_topic_posts`, the searches) run as the caller, so blocks, posts hidden by moderators,
suspended accounts and business sessions stay out exactly as everywhere else. Before migration 44 the tab still works:
the grid is the newest posts and reels, the suggestions the newest people, and topics are empty
(`packages/shared/src/queries/discover.ts`).

## Buzz

Buzz is UniVerse's anonymous campus feed, ported screen for screen (`src/components/buzz/`, the Buzz page of Home in
`src/components/home/buzz-section.tsx`, the screens in `src/app/buzz/`), on the shared Buzz v2 data layer
(`packages/shared/src/buzz`: `buzz_v2_*` database functions for reads and actions, the website's moderated
`POST /api/buzz` and `/api/buzz/<id>/replies` for new buzzes and replies, called with the session's access token). It is
painted in **Phosphor**, UniVerse's incognito world (`phosphor` in `src/lib/palette.ts`: a near-black green canvas, lime
accents, a coral downvote), the same in Light and Dark, and Phosphor appears nowhere else. As Home's pager comes to Buzz
its top bar turns Phosphor too, your photo gives way to a plain person glyph (not drawn at all while the pager rests on
Buzz, so nothing on the Buzz page shows who is looking) and the Buzz label carries a small lime mask
(`src/components/home/buzz-top-bar.tsx`). Home's bar stays put on Buzz; Buzz's own filter bar slides away instead.

- **Gate.** Signed out, the page asks you to log in. Before the current guidelines are accepted it shows the inline
  "Before your first buzz" panel (never a sheet), only while the page is the one on screen, and loads nothing else; "Not
  now" goes back to the section you came from, and swiping through Buzz always works. A thread, Search and My buzzes show
  it with Back.
- **Feed.** Under Home's bar a filter bar (the search pill, Hot | New | Top, Campus | Global) slides up as the feed
  scrolls down and back as it scrolls up; Top adds Today | This week | All time; Hot shows today's prompt with "Answer
  anonymously" and, once anyone has answered on that feed, "See all N answers" (its thread, which Hot then leaves out of
  the list below; "No answers yet. Be the first." before that); small campuses get a note; an empty campus Hot feed moves to Global with a banner (cold start). Cards show
  the alias (an emoji in a dashed ring of its colour, never a photo), "You · Anon X" on your own, the campus on Global,
  your own items' review status, the title and words (six lines, Show more), 1–4 photos (a tap opens them full screen) or
  one video (plays in place with the system controls), a poll (results once you vote), the support link, "Top reply" (the
  thread's most upvoted reply, two lines, a tap opening the thread at it: it unfolds to it, scrolls there and lights it
  up a moment), and the vote pill (optimistic, tap again to undo, coral down), replies and share. A top reply needs 3
  upvotes (`BUZZ_TOP_REPLY_MIN_UPVOTES`) and more up than down; it is never a reply that touched on self-harm, a hidden
  one, one you reported or one from an anon you hid; it keeps its thread alias. The database picks it
  (`supabase/migrations/20261108000100_buzz_top_reply.sql`); without that migration cards show none. Community-collapsed
  cards fold to "Hidden by the community · Tap to view". Under the alias line, the category its author picked ("📚
  Classes"; nothing when none). A day's prompt thread shows "✦ Daily prompt" where the alias
  would be and counts answers; an answer posted as its own buzz has the prompt as its title and "Daily prompt · See all
  answers" linking to that thread. The FAB (a pen with the mask) and the "+" create sheet's Buzz open the composer.
- **Composer.** A full-height sheet (the system's page sheet on iPhone): "You're anonymous", Campus | Global with what
  each means, a category (one row of chips, `BUZZ_CATEGORIES`; optional, tap the chosen one again for none; the line
  under it says what belongs there; a database without `supabase/migrations/20261108000300_buzz_categories.sql` does
  not keep it), an optional title, the words (500), up to 4 photos (re-encoded on the phone,
  no metadata, stored in the anonymous folder: `src/lib/buzz-photos.ts`) or one video of at most a minute (refused before
  upload: `src/lib/buzz-video.ts`), a poll (2–4 options, 1/3/7 days, unlocked 24 hours after joining) and "Buzz it".
  Answering today's prompt ("Answer the prompt"), the prompt is the title, always (the database sets it), and "Where your
  answer goes" picks Prompt's thread (the default: a reply in that day's prompt thread on the feed, words only, then the
  thread opens at it) or Its own buzz (a thread of its own, photos and polls allowed). Each day's prompt has one thread
  per campus and one on Global, owned by no one and made by its first answer
  (`supabase/migrations/20261108000200_buzz_prompt_threads.sql`); on a database without it an answer is its own buzz. While
  the account cannot post, "Muted until … · Details" stands in for the actions. A blocked text gets the engine's sheet
  (Edit, the guidelines, and support resources where they apply); a held one says it is with the safety team.
- **Thread.** The root large, then the conversation as a tree, like Reddit's: every reply under the one it answers, at
  any depth, joined to it by a thread line in the colour of that anon, so a back-and-forth reads top to bottom like a
  story. Best (the default; the choice holds for the session), New or Old orders each level. A tap on a reply's header
  folds it and everything under it ("+N"); past three replies under a top-level one (two deeper) the rest wait behind
  "N more replies", and past six levels "Continue this thread" shows that branch on its own ("All replies" goes back).
  Replies that arrived since you last opened the thread carry a lime dot and "N new" goes to the first (when you last
  looked is kept on the phone only, `src/lib/buzz-seen.ts`). Folds, placeholders, the reply bar ("You're anonymous",
  the "replying to" chip, 500 characters, send) or the locked line. The nesting comes from `treeParentId`
  (`supabase/migrations/20261108000000_buzz_reply_tree.sql`); on a database without it, replies show on two levels,
  deeper ones with "replying to". The tree and its rows are `buildBuzzReplyForest` and `buzzThreadRows` in
  `packages/shared`; the website still shows two levels. Posts publish after a random delay, so nothing is pushed live:
  a thread loads again when it comes back on screen, on pull to refresh, after your own reply and every 30 seconds while
  it is open, keeping the order on screen (a pull to refresh orders it afresh).
- **Menus.** Hide this thread · Hide this anon in this thread · Share (the link through the system sheet) · Report (the
  reasons, a note for "Something else"; the item then leaves your lists) · Delete (your own). Never Block, never a
  profile, never a handle.
- **Search, My buzzes, Settings, Notifications.** Search Buzz (Newest | Top, Campus | Global, suggestions); My buzzes
  (Threads | Replies, your private karma) is reached from Settings → Buzz, never from Home, next to "How Buzz anonymity
  works"; Settings → Safety → Account status lists warnings, removals and restrictions with "Got it" and appeals. Buzz
  notifications carry the mask, never a photo.
- **Memory only.** Drafts, folds, the search and every loaded item live in memory (`src/lib/buzz-store.ts`), never in
  AsyncStorage or SecureStore, and are wiped the moment the session ends.

## Look and feel on iPhone

The app keeps its own look (the brand blue, white or black surfaces, the system font) and adds what makes an iPhone app
feel native:

- **The Aurora.** UniBuzz's signature is a gradient, cyan → sky blue → periwinkle → violet (`aurora`,
  `auroraGlow` and `auroraWash` in `src/lib/palette.ts`, drawn with `auroraGradient` from `src/lib/theme.ts`). It is used
  sparingly: primary buttons (the compact ones that repeat down a list stay solid blue), the send buttons, the floating
  "+", the active tab's underline in Home, Explore, Messages and on a profile, the selected segment, the soft capsule
  behind the active tab in the bottom bar, and the rings around your photo in the Home bar, on the Profile tab and on a
  profile page. Under white words the stops are deep enough that a label keeps 4.5:1 across the middle where it sits;
  rings and underlines use a brighter version on black. The solid brand blue is the aurora's blue stop (#166fe5 in
  light, 4.7:1 on white), for links, icons and active chips. A roommate post's screen wears it most fully, and still
  quietly (`src/components/aurora.tsx`): its sections sit on the page instead of grey cards, its preference cards are
  panels tinted at the Aurora's faintest (`auroraPanel`, with an `auroraEdge` hairline), its status is an Aurora pill, its
  headings carry a short Aurora bar and its fact icons the Aurora's ink (`auroraInk`); the words keep the theme's own
  colours, so the contrast is the same as anywhere else. A "No longer looking" status keeps its amber.

- **Dark by default.** Until someone picks a theme in Settings → Theme the app is Dark, on iOS and Android alike
  (`DEFAULT_THEME_PREFERENCE` in `src/lib/palette.ts`); Light and System Default stay there, and a choice is remembered.
  Anyone who already picked one keeps it.

- **Icons.** On iOS every icon is the matching SF Symbol (`src/components/icon.tsx`), in Apple's weights and optical
  alignment: filled when on, outlined when off. A like, a save, a vote and a newly chosen tab bounce once. Android keeps Ionicons.
- **Type.** One scale of Apple's text styles (`textStyle` in `src/lib/theme.ts`): the Search, Find and Messages titles
  are iOS Large Titles (34pt bold), names and screen titles are Title 2, sheet titles are Headline. Nothing is heavier
  than bold except the UniBuzz wordmark, and the system font keeps its own tracking.
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
- **Scrolling.** The For you, Buzz, Housing and Roommate feeds draw each row through a memoised component with stable
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

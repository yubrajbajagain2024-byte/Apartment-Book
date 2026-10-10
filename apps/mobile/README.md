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

The bottom bar has five tabs: Home, Housing, Messages, Marketplace, Profile. Search (find accounts by name and follow them)
is the magnifier in the top-right corner of every tab, like TikTok; on Home it sits in
the floating top bar. Home opens on **For you**, a blend of posts, reels and hot anonymous Buzz threads
(the fixed pattern lives in `packages/shared/src/for-you.ts` and is shared with the website). Its
four pages, For you | Buzz | Posts | Reels, sit side by side in a pager: swipe left or right to move
between them, or tap a label in the floating top bar. That bar has two rows, like Instagram's
(`src/components/home/home-top-tabs.tsx`): "+" (create), the CampConnect wordmark (`HOME_BRAND` in
`packages/shared`) with a chevron that drops down the feed menu, and Search; then the four labels,
highlighted like X (`src/components/sliding-tabs.tsx`): the active one bold with a rounded underline as wide
as the label, a hairline under the row, and a soft haptic each time the section changes, by tap or swipe. The
menu chooses your university, All universities or, signed in, Following (only the posts of people you follow;
it switches to Posts, and the wordmark reads "Following" while it shows). The choice lives in
`src/lib/home-scope.ts` and drives For you, Buzz and Posts alike: the pages have no filter chips of their own.
Housing works the same way with two pages,
**Apartments | Roommates**: it opens on Apartments, a swipe or a tap on the label above the pager
moves to Roommates and back, and the floating "+" follows the visible half ("List an apartment" or
"Create roommate post"). The order comes from `HOUSING_SECTIONS` in `packages/shared/src/constants.ts`.
Profiles work like Instagram too: a Follow button (it reads "Following" once you follow), follower / following
counts that open the two lists, and, signed in, the Following row of the Home feed menu, which keeps only the posts
of people you follow on Posts. Comments open in a TikTok-style sheet: "N comments" up top with a Top / Newest sort, each comment with
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
Posts | Classes | Reels | Saved | Liked | Listings over a three-column grid with view counts (Listings: your live
apartments, roommate posts and items for sale, each square with its kind and title). The Classes tab lists classes by semester, this one first (up to 12 each; add and remove your own there).
Classes, Saved and Liked each have a setting (Everyone, Friends, Only me; friends are people you follow who follow you
back), changed from the line at the top of the tab or in Settings → Privacy; by default Classes is Friends, Saved is Only
me and Liked is Everyone, and visitors without access see a lock. Hold one of your own posts or reels in the grid (or use
its ••• menu) to pin it to the top of your profile, three at most. Someone else's profile has Follow, Message and More
(block, report) instead. It needs migration 18 (`supabase/migrations/20260927000000_profile_page.sql`: usernames, the
who-can-see settings, `profile_classes`, likes readable only through functions, `profile_stats`, `post_view_counts` and
`feed_posts.pinned_at`); without it the header still shows, with zeros, and each tab says what it could not load.

The Maestro flows in `e2e/flows/` check this in Expo Go on the booted iOS Simulator and save
screenshots to `e2e/screenshots/`. They need [Maestro](https://maestro.mobile.dev) installed in
`~/.maestro`, `npx expo start` running, and seeded test data:

```bash
cd apps/mobile
SUPABASE_ACCESS_TOKEN=sbp_... node e2e/sim-seed.mjs      # test users and sample posts (the test account and Leo follow each other, so Leo is a friend to share with; Maya lists CS 3358 and MATH 3398 for this semester, visible to everyone); prints the login, writes e2e/.sim-state.json
e2e/run.sh e2e/flows/00-signed-out.yaml                 # lands on For you, opens the feed menu (All universities alone, signed out), swipes to Buzz, opens Search from the top-right magnifier, Messages (bottom tab), Housing (Apartments, Roommates, swipe back), Marketplace, Profile (several flows at once is fine)
EMAIL=... PASSWORD=... e2e/run.sh e2e/flows/01-signed-in.yaml   # your own profile (adds CS 1428 under Classes and removes it, Saved says only you can see it), then likes, comments (write, heart, reply, delete from the hold menu), shares the top post with Leo and finds the card in your chat with him (Messages), votes, replies, Following from the feed menu (Leo's post alone, then Maya's too once she is followed), follows and unfollows Maya (her Classes tab shows CS 3358, her Listings tab her apartment), as the seeded account
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

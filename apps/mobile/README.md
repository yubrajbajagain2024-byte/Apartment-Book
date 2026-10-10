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
between them, or tap a label in the floating top bar. Housing works the same way with two pages,
**Apartments | Roommates**: it opens on Apartments, a swipe or a tap on the label above the pager
moves to Roommates and back, and the floating "+" follows the visible half ("List an apartment" or
"Create roommate post"). The order comes from `HOUSING_SECTIONS` in `packages/shared/src/constants.ts`.
Profiles work like Instagram too: a Follow button (it reads "Following" once you follow), follower / following
counts that open the two lists, and, signed in, a Following chip on the Posts page that keeps only the posts
of people you follow. Comments open in a TikTok-style sheet: "N comments" up top with a Top / Newest sort, each comment with
a heart and its count (a dislike stays private), Reply, replies folded behind "View N replies", the composer pinned at the
bottom, and a hold on a comment for Reply / Report / Block / Delete (your own comment, or any comment on your post); a like on a
post, a reel or a comment buzzes the phone through `expo-haptics`.

The Maestro flows in `e2e/flows/` check this in Expo Go on the booted iOS Simulator and save
screenshots to `e2e/screenshots/`. They need [Maestro](https://maestro.mobile.dev) installed in
`~/.maestro`, `npx expo start` running, and seeded test data:

```bash
cd apps/mobile
SUPABASE_ACCESS_TOKEN=sbp_... node e2e/sim-seed.mjs      # test users and sample posts; prints the login, writes e2e/.sim-state.json
e2e/run.sh e2e/flows/00-signed-out.yaml                 # lands on For you, swipes to Buzz, opens Search from the top-right magnifier, Messages (bottom tab), Housing (Apartments, Roommates, swipe back), Marketplace, Profile (several flows at once is fine)
EMAIL=... PASSWORD=... e2e/run.sh e2e/flows/01-signed-in.yaml   # likes, comments (write, heart, reply, delete from the hold menu), votes, replies and follows as the seeded account
node e2e/sim-seed-thread.mjs                            # nested replies and votes for 03-buzz-thread.yaml
SUPABASE_ACCESS_TOKEN=sbp_... node e2e/sim-cleanup.mjs  # removes the test data afterwards
```

The flows that like, vote or post (01 to 03) only ever act as a seeded `ui-sim-…` account and
stop if someone else is signed in on the simulator; 00 and 04 only look.

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

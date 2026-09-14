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

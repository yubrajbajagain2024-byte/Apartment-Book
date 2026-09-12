# Apartment Book – iOS / Android app

Expo (React Native) app that reuses `packages/shared` for every query, schema and
type. Same Supabase backend and the same accounts as the website.

## Run it locally

```bash
npm install                       # from the repo root
cd apps/mobile
npx expo start                    # then press i (iOS simulator), a (Android) or w (web)
```

`apps/mobile/.env` holds the public Supabase URL/anon key and the website URL
(the app calls the website's `/api/video/*` routes for video uploads). These are
public values, safe to commit; row-level security protects the data.

## What the app does

Home (apartments, video-first feed) · Roommates (with the "Online now" row) ·
Marketplace · Messages (live chat with sent/delivered/seen receipts, active
status) · Profile (saved, settings, privacy, terms). Create apartment, roommate
and marketplace posts with photos and video tours. Like, comment, save, share,
report, block, delete account. Push tokens are registered on real devices.

## Ship to the App Store (one-time setup)

1. **Apple Developer Program** ($99/year): https://developer.apple.com/programs/enroll/
2. **Expo account** (free): https://expo.dev/signup, then `npm i -g eas-cli && eas login`.
3. Link the project (writes `extra.eas.projectId` into `app.json`):
   ```bash
   cd apps/mobile
   eas init
   ```
4. Build for TestFlight / the App Store. EAS creates and manages the signing
   certificates for you when you sign in with your Apple ID during the first build:
   ```bash
   eas build --platform ios --profile production
   ```
5. Create the app record in App Store Connect (https://appstoreconnect.apple.com):
   name **Apartment Book**, bundle id `com.apartmentbook.app`, primary category
   **Lifestyle** (or Social Networking). Fill in:
   - Privacy policy URL: `https://apartment-book-vyass.vercel.app/privacy`
   - Support URL: the website
   - App privacy answers: collects name, email, photos/videos, user content,
     messages, device id (push token); not used for tracking, no ads.
   - Age rating: 17+ is safest for user-generated content with messaging,
     or 12+ with "Infrequent/Mild" user-generated content.
   - Screenshots: 6.7" and 6.1" iPhone screenshots (take them in the simulator with
     `npx expo start --ios`, then ⌘S). Put `_` in the `ascAppId` field of
     `eas.json` `submit.production.ios` once the app record exists (the numeric App ID).
6. Submit the build:
   ```bash
   eas submit --platform ios --latest
   ```
7. In App Store Connect add the build to the version, write the review notes,
   and give the reviewer a test account. Because sign-ups need a `@txstate.edu`
   email, create a reviewer account yourself (or temporarily add `apple.com` to
   the allowed domains in the `universities` table) and put the email/password
   in the "Sign-in required" review notes.

Later releases: bump nothing by hand, `eas build --platform ios --profile
production` auto-increments the build number, then `eas submit`.

## Google Play

`eas build --platform android --profile production` produces an `.aab`. Create
the app in the Play Console, upload the bundle to Internal testing, fill in the
Data safety form (same answers as above), then promote to production.

## Push notifications

The app stores an Expo push token per device in `device_push_tokens`. Sending
pushes (for new messages) needs a small server job that calls the Expo push
API; that is the next backend step.

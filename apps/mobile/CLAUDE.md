# apps/mobile/ — Expo app instructions

The iOS and Android app: Expo SDK 58, React Native 0.88, expo-router. The root
[CLAUDE.md](../../CLAUDE.md) has the shared rules; [README.md](README.md) explains each screen,
device builds and store releases.

## Layout

```
src/app/(tabs)/   index (Home: the story tray, then Orbit, Buzz, Reels), housing (Explore), messages,
                  events (For you | All events), profile
src/app/search.tsx  the search screen (people, topics, posts, what is popular): the magnifier beside the bell
src/app/compose/  the create flow behind every "+": camera → edit → publish; listing, listing-form,
                  listing-preview for roommate posts and Marketplace items
src/app/create/   per-kind entry points: post, reel, buzz, apartment, roommate, item
src/app/…         buzz, messages, posts, reels, apartments, roommates, marketplace, profile, follows,
                  call, snap, stories, topics, settings, notifications, saved, find-people, events
                  (an event, saved, interests, new, edit), organizations (page, new, edit, members)
src/lib/          app-only helpers: calls.ts, home-scope.ts, stories-store.ts, event-saves-store.ts,
                  organization-follows-store.ts, campus-time-zone.ts, supabase.ts, dev-overrides.ts, …
e2e/              Maestro flows (flows/*.yaml, run.sh), seed and lifecycle scripts
```

## Commands (from `apps/mobile/`)

```bash
npx expo start              # a development build (calls need one); add --go --tunnel for Expo Go
npm run ios:device          # scripts/ios-device.mjs: a free signed build on your own iPhone
npm run typecheck
npx eas-cli@latest update --channel preview --environment preview   # publish JS to installed builds
```

- **Run every Expo and EAS command from `apps/mobile/`.** At the repo root EAS finds no project
  and writes a stub `app.json` there (it happened on 2026-10-26; see
  docs/branches/business-portal-prelaunch.md).
- `eas update` publishes JavaScript only. A change to native configuration (`app.json` plugins,
  permissions, SDK) needs a new native build; `npx eas-cli@latest build:list` shows which exist.
- Publishing an update reaches real testers, so it is a production write.

## Configuration

- `app.json` plus `app.config.js`, which reads `CAMPCONNECT_BUNDLE_ID` and
  `CAMPCONNECT_FREE_SIGNING` at build time.
- Developer-only settings go in the git-ignored `.env.local`, never in the committed `.env`.

## Flags kept in the code

Why each exists: [docs/decisions.md](../../docs/decisions.md).

- `CALLS_PAUSED` (`src/lib/calls.ts`): calls are off unless `EXPO_PUBLIC_CALLS_ENABLED=1`.
- `SCOPE_TOGGLE_SHOWN = false` (`src/lib/home-scope.ts`): the Campus | Global toggle is hidden.
- `HIDDEN_HOME_SECTIONS = ["posts"]` (`packages/shared/src/constants.ts`, read by the website's
  Home too): Posts has no Home tab.
- `EXPO_PUBLIC_BUZZ_FIXTURES=<variant>` in `.env.local`: development only, answers Buzz from
  sample data.

## End-to-end checks

- Simulator: `e2e/run.sh e2e/flows/00-signed-out.yaml` (Maestro), with data from
  `node e2e/sim-seed.mjs`; remove it afterwards with `node e2e/sim-cleanup.mjs`.
- `e2e/snap-lifecycle.mjs` and `e2e/call-lifecycle.mjs` run between two real accounts.
- **These scripts create throwaway accounts and data on the live project** (they need
  `SUPABASE_ACCESS_TOKEN`), so they are production writes. Always clean up afterwards.

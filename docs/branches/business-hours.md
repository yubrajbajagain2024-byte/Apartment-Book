# business-hours

- **Owner:** Sunil. **As of 2026-10-29:** branched from `main` at PR #58 (`46533e3`); pushed, no PR yet. Written by an
  AI session.
- **Purpose:** the owner's brief: the business's name and photo at the top of the portal's sidebar open a preview of
  exactly how its public profile appears to students; a clickable link to the business's website on that profile;
  and opening hours in the profile settings (each day's opening and closing times, closed days, special holiday
  hours) with an accurate Open/Closed status for students.

## What it does

- **Preview** (`apps/web/src/app/business/(portal)/preview/page.tsx`): the sidebar's header (and the phone top bar)
  links to `/preview`, with "View public profile" under the name and a highlight while it is open. The page renders
  `BusinessProfileView` (`components/business-profile/profile-view.tsx`), the component the student page now renders
  too, in its preview mode: no Message form, menu or links into the student site, but drawn the same. It sits in a
  window bar with the profile's address, under `[data-student-preview]` (`globals.css`), which brings back the student
  site's greys, white panels, Aurora button, font and ink inside either portal theme. Live posts and active listings
  only, as students get them. Every member of the team may open it; before approval a notice says students can't see
  it yet. "Copy profile link" (approved) and "Edit profile" (owner and admins).
- **Website:** a **Website** button beside Message (new tab, `rel="noopener noreferrer nofollow"`), plus the address in
  the contact line, http(s) only. In the app, a Website button beside Message.
- **Hours** (`packages/shared/src/business-hours.ts`, migration 57 `20261110000000_business_hours.sql`):
  - stored as `businesses.hours` jsonb: `{ timezone, week: { mon … sun: [{ open, close }] }, special: [{ date, label,
    closed, hours }] }`; checked by `businesses_hours_check` (`business_hours_valid()`), the same rules as the form's
    `businessHoursSchema`; public with the profile (`grant select (hours)`); 49's audit of profile edits records it;
  - edited in Settings › Business profile (`components/business/hours-editor.tsx`): show or not, time zone, each day's
    switch and times (more than one range for a break, or open 24 hours), "Copy Monday to weekdays", holiday and
    special hours (date, optional name, closed or open with times); saved with the profile, past dates dropped
    (`pruneSpecialHours`). Shown only where the database has the column;
  - shown to students on the website (`components/business-profile/business-hours.tsx`) and in the app
    (`apps/mobile/src/components/business-hours.tsx`): a status line (`businessHoursStatus()`, in the business's time
    zone, again every half minute) that opens into the week and the coming holiday hours.
- **Before migration 57** (production today): `getPublicBusiness()` asks for `hours` and, on "no such column", asks
  again without; the form leaves the hours out (`my_business()` returns the whole row, so their absence shows); the
  preview and the Website button work.
- **The release:** 57 is in `RELEASE` and `BUSINESS` of `supabase/tests/staging/release-rehearsal.mjs` and of
  `supabase/tests/production-rollout.test.mjs`. Once this merges, `db:setup` from `main` applies it with 44, 46 and
  49 to 56; the release's rollback starts with 57's.

## Tests, 2026-10-29

| Suite | Result |
| --- | --- |
| `npm run check` | ✅ 6/6 |
| `npm run test:shared` | ✅ 213/213 (new `business-hours.test.mjs`, 15 tests: the clock and ranges, open/soon/closed, time zones, past midnight, special hours, 24 hours, daylight saving, parsing, the week and holidays, pruning, the schema, the form field) |
| `npm run db:test` | ✅ 42 suites, 1561 checks (new `business-hours.test.mjs`: who sets and reads the hours, 22 malformed values refused, the audit, the rollback; the production rollout with 57 in the release) |
| `apps/web/e2e/business-profile.mjs` on staging | not run yet |
| App (Expo) | typecheck only; not run on a device |

## Pending

1. Run the browser test (and the page smoke, which now opens `/business/preview` and the signed-out profile) on
   staging with the release applied, and the preview in production's state (needs the owner's go-ahead for staging).
2. Open the PR, review and merge. Merging deploys the website; it works without 57.
3. Apply 57 on production with the release (owner's approval; docs/migrations.md).
4. Publish the app's part with an EAS update (owner's approval).
5. Once merged and deleted, a line in docs/history.md and this file removed.

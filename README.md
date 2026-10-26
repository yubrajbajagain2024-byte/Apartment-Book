# Apartment Book

A website for university students to **find apartments near campus**, **find roommates**, **buy and sell move-in essentials** (mattresses, desks, kitchen gear…) and **message each other** in private or group chats. The layout follows the Facebook pattern: a top bar with four tabs (Home = apartments, Roommates, Marketplace, Messages), a create menu and a profile menu; on phones the tabs move to a bottom bar.

Built with **Next.js 16 + TypeScript + Tailwind** on top of **Supabase** (Postgres, auth, realtime chat, image storage). The backend is a hosted service that iOS/Android apps can talk to directly, and all data-access code lives in a shared package, so the future mobile app reuses everything except the screens.

## Feature map

| Feature | How it is built |
| --- | --- |
| Apartments and roommates | Postgres tables with PostGIS: campus and listing coordinates, `apartments_within(university, radius)` for "within 2 miles of campus", distance filled by a trigger. Map view and location picker use Leaflet + OpenStreetMap (free); address search uses Nominatim through `/api/geocode` |
| Marketplace | Same listing pattern with a `category` field. No payments |
| Messaging | Supabase Realtime over `conversations`, `conversation_members`, `messages`. Device push tokens stored in `device_push_tokens` for the future apps |
| Login | `@txstate.edu` only. The allowed domains live on the `universities` table (`email_domain`), the sign-up form validates against them, a `before insert` trigger on `auth.users` rejects everything else (except an address with a pending staff invitation, see the admin section), and new users are attached to their university automatically |

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

A `notifications` table that only its recipient can read, mark or delete; rows are created by database triggers so the mobile app gets them for free: a new message (repeated messages in one chat refresh a single unread entry), someone saved your listing, and a new place pinned within 2 miles of your campus (opt-in per person in Settings). The top bar shows a bell with a live count and dropdown; `/notifications` lists everything. Push delivery can later use the same rows plus the stored device tokens.

## Admin app (CampConnect Admin)

Staff do not use the website to run Apartment Book: they use **CampConnect Admin**, a separate Next.js app in `apps/admin` that talks to the **same Supabase project** as the website and the mobile app. The website has no admin pages, links or controls at all; the admin app has no student features. Both read and write the same database, so whatever staff change in the admin app applies to the website and the app at once.

```bash
npm run dev            # website on http://localhost:3000 and the admin app on http://localhost:3001
npm run dev:admin      # the admin app alone
```

The admin app needs its own `apps/admin/.env.local` (`npm run db:setup` writes it next to the website's; `apps/admin/.env.example` lists every variable). It uses the same Supabase URL and anon key, its own public URL in `NEXT_PUBLIC_SITE_URL` and the website's address in `NEXT_PUBLIC_MAIN_SITE_URL` for "open on site" links. Its `/auth/callback` must be in Supabase's redirect allow-list (the setup script adds it; by hand: Authentication → URL Configuration → Redirect URLs).

### Who gets in

Three gates, in order, and the database is the authority behind all of them:

1. **Sign in** (`/login`, email + password or Google). There is no sign-up: accounts are created on the website or through a staff invitation. A student who signs in is told the account is not on the team (`/no-access`) and offered the way out; nothing of the app is shown.
2. **Staff row.** The layout asks the database (`admin_me`) whether the person is staff and not suspended. Staff permissions live in tables the API cannot read or write (`staff`, `staff_invites`, `staff_audit_log`: row-level security on, no policies, no grants).
3. **Second factor.** Every page except Security needs a session that verified an authenticator-app code (JWT claim `aal = 'aal2'`); the proxy sends anyone else to `/security`. Every database function behind every button re-checks role **and** second factor in SQL (`staff_require`), so opening a page grants nothing.

The app is never indexed (`robots.txt` disallows everything, every response carries `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`), and its session cookies are its own: being signed in on the website does not sign you in here, and the other way round.

### Roles

| Role | Can do |
| --- | --- |
| Owner | Everything: add owners, admins and moderators, change anyone's role, remove anyone, withdraw any invitation |
| Admin | Run the app day to day: add and remove moderators and withdraw moderator invitations, delete content permanently. Cannot touch owners or other admins |
| Moderator | Moderation: review reports, hide and restore content, suspend and unsuspend people (never staff of equal or higher rank), look up accounts, retry media jobs and run the worker. Sees the team (but not who among the owners and admins lacks a second factor) and, in the audit log, moderation activity plus their own actions. No access to pending invitations; cannot change the team; cannot delete content permanently |

Nobody can change their own role or remove themselves, and the last owner can never be demoted or deleted; a database trigger refuses it even for SQL run as the project owner. Every administrative action is a database function (`admin_staff_add`, `admin_user_suspend`, `admin_content_hide`, …) that checks the caller's role in SQL before doing anything. The pages and server actions run the same checks (`apps/admin/src/lib/admin.ts`) only to hide what a person cannot do.

### Two-factor authentication

Every action needs a verified second factor, not only the sign-in. Staff set up an authenticator app (Google Authenticator, 1Password, Authy…) at `/security`; after a code is verified, Supabase Auth re-issues the session with the claim `aal = 'aal2'`, and each admin function checks that claim in SQL (`Two-factor authentication required` otherwise). Turning an authenticator on or off is written to the audit log by a database trigger on Supabase Auth's factor table, so the entry cannot be forged from a session that only has a password.

### Becoming the first owner

Either run the setup script against the live project (it applies any missing migration, 14 to 16, and bootstraps the owner without touching the seed, the env files or the auth URLs):

```bash
SKIP_ENV=1 SKIP_SEED=1 SKIP_AUTH=1 ADMIN_OWNER_EMAIL=you@txstate.edu \
SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=dskbzoqreandwwpxiplh npm run db:setup
```

or do it in the Supabase **SQL Editor**: run the three admin migrations in order (`20261023000000_admin.sql`, `20261024000000_moderation_support.sql`, `20261103100000_admin_dashboard.sql`), then

```sql
select public.admin_bootstrap_owner('you@txstate.edu');
```

The result is `added` (the account exists and is confirmed), `invited` (no confirmed account yet: the owner role is claimed the moment that address confirms its sign-up) or `already owner`. The owner does not have to be a student: sign-ups are normally limited to university addresses, but an address with a pending staff invitation may sign up too, so an invited Gmail owner uses **Continue with Google** (on the website or on the admin app's login page) or the invitation email the Supabase dashboard can send under Authentication → Users → Invite, and is owner as soon as the account exists. It refuses an address that has signed up but not confirmed its email yet, and a second owner (more owners are added from the Staff page); running it again with a corrected address withdraws the earlier, mistyped invitation (logged as `invite.revoke` with the reason `bootstrap superseded`). The function cannot be called through the API at all.

### What the app does

| Page | What is there |
| --- | --- |
| Overview | Open reports, active suspensions, hidden content, the media queue, people, listings, posts and staff at a glance (migration 16's `admin_overview_stats`), the newest open reports, recent audit activity and your own account state |
| Reports | The queue people fill from the website and the app (open, reviewed, dismissed, all; "Load older" paging). A report opens on a review page with the reported content, the reporter's words, the actions, and the decision form. Hiding, deleting or suspending from that page records the matching decision on the report |
| Content | Look up anything by pasting its website link or id, and the list of everything currently hidden (`admin_hidden_content_list`). The review screen shows the author (for Buzz, revealed to staff on purpose and logged as `content.view`), text, photos (signed from the private quarantine bucket when hidden), videos and type-specific fields, with **Hide** (reversible, reason shown to the owner), **Restore**, and, for admins and owners, **Delete permanently** behind a typed confirmation |
| Users | Browse everyone newest first, suspended accounts or staff (`admin_users_list`), or search by name or email. A person's page shows profile, activity counts, reports filed and received, the suspension history, and **Suspend** (reason the person sees, duration, staff note) or **Lift**. A staff target needs a strictly higher role; nobody suspends themselves |
| Media | The clean-up queue (`media_jobs`): pending, failing and done counts, whether the worker's storage, Mux and cron credentials are configured, every job with its attempts, next try and last error, **Retry now** per job and **Run the worker now** |
| Staff | The team, pending invitations and adding people by email, as before |
| Audit log | Every team change, security event and moderation action, newest first, linking to the person, report or content concerned |
| Security | Set up, verify and remove the authenticator |

### Invitation emails (migration 18)

Inviting an owner, admin or moderator on the Staff page sends a real email, if the admin app can. The steps:

1. The database records the invitation (role, who invited, open for 7 days).
2. The admin app asks Supabase Auth to send the invitation (`inviteUserByEmail`, through the project's SMTP settings). Supabase creates the invitee's account at once: unconfirmed, no password.
3. `admin_invite_email_result()` records the outcome (sent or failed, when, how often, the error) and **binds** the invitation to that account. Only that account can ever claim it, so someone signing up with the same address cannot take the role.
4. The invitee opens the link. It works once and expires after the project's email-link time (one hour unless changed). Opening it confirms the address, which proves they own the mailbox, and that is when they become staff.
5. They land on the admin app's `/password` page (staff only), choose a password of at least 12 characters, and go straight to `/security` for mandatory two-factor setup. Nothing else opens before that.

The Staff page shows each pending invitation as "Email sent", "Email failed" with Supabase's reason, or "No email sent", with its expiry. It offers **Send again**, which renews the 7 days and sends a new link, and **Withdraw**. Withdrawing also deletes the account the email created, if nobody has opened or used it, so an old link leads nowhere. An expired invitation is not accepted (logged as `invite.expired`) until it is sent again. Owners and admins can also email a team member a **password-reset** link; there is no anonymous "forgot password" form. Every step is in the audit log: `invite.email_sent`, `invite.email_failed`, `invite.resend`, `invite.expired`, `invite.accepted` (with "via email link").

To send emails, the admin app needs `SUPABASE_SERVICE_ROLE_KEY` on its own Vercel project. Without it, invitations are saved and the confirmation says plainly that no email went out. The key does **not** turn the media worker on (below).

Delivery is Supabase's: its built-in email service sends only a few emails per hour, and only to members of your Supabase organization. To invite anyone, set up custom SMTP, for example Resend or Postmark, both of which have free tiers. `npm run auth:email` reports the project's email settings without changing anything: SMTP, rate limit, link lifetime, whether the invitation template is the server-verified one, whether the admin app's `/auth/**` is an allowed redirect, Confirm email and TOTP. With `--apply`, and after approval, it adds the redirect, installs the invitation template, and sets SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER_EMAIL`) and `INVITE_LINK_HOURS` when given. It never touches the password-reset template, which the mobile app uses.

Tests: `supabase/tests/staff-invite-email.test.mjs` covers binding, expiry, re-sending, withdrawing, permissions and the old sign-up path. `apps/admin/e2e/invite-links.mjs` covers expired and malformed links, the password page's gate, and the worker staying off. `apps/admin/e2e/invite-flow.mjs` is the whole flow for a **staging** Supabase project: invite, link, password, two-factor, dashboard, reuse refused, withdraw. It refuses to run against production.

### Adding staff, and the audit log

From the Staff page an owner or admin types an email address and picks a role. A confirmed account is added at once; any other address is invited and becomes staff when it confirms its sign-up (the same mechanism as the first owner). An address outside the university can be invited as well: the invitation lets it sign up, through Google sign-in or a dashboard invitation, since the website's sign-up form itself only takes university addresses. An address somebody has already signed up with but not confirmed is refused (that person confirms and logs in first, then is added from the list). An invitation is only honoured by an account created after it: when the account predates the invitation the role is not granted, the log gets an `invite.held` row, and an admin adds the person from the list once sure who holds the account. Invitations also go with the inviter's authority: they are withdrawn automatically (and logged with the reason) when the inviter is demoted below the invited role or removed from the team, and disappear when the inviter deletes their account. Everything is written to `staff_audit_log` with who did it, to whom and the details, and the Audit log page shows it newest first. The log is append-only: nobody, staff included, can edit or delete rows through the API.

### Supabase settings

- **Authentication → Multi-Factor**: TOTP (authenticator app) must be enabled. The setup script turns it on when `ADMIN_OWNER_EMAIL` is given together with an access token.
- **Authentication → Providers → Email**: keep **Confirm email** on. Invitations are claimed on confirmation, so an unconfirmed address can never become staff.
- **Authentication → URL Configuration → Redirect URLs**: both apps need their callback: `https://<website>/auth/callback` and `https://<admin app>/auth/callback` (plus the two localhost ones for development). `npm run db:setup` adds them (`SITE_URL`, `ADMIN_URL`).
- Lost authenticator: delete the person's factor in **Authentication → Users** (open the user, Multi-factor), then they set it up again at `/security`. Everything stays blocked for them until they do.
- **Staff deleting their own account**: the website no longer has a second-factor step, and the database refuses to delete a staff account from a session without one. Staff therefore leave the team first (an owner or admin removes them on the Staff page) and then delete their account on the website like anyone else; the website says so. The only owner cannot leave until another owner exists.

### Moderation support (migration 15)

Migration 15 adds the database side of moderation. Every rule is enforced in Supabase itself, so neither app nor a direct API call can get around it:

| Addition | What it does |
| --- | --- |
| Account restrictions (`account_restrictions`) | A suspension with the reason the person sees, a note only staff see, who issued it and an optional end date. The moment it is saved, a trigger on every content table (listings, posts, comments, messages, chats, Buzz, media) refuses the person's inserts and updates, the storage policies refuse their uploads, their profile cannot be edited, and `auth.users.banned_until` stops their next login and token refresh. Their existing listings and posts disappear for everyone else while it lasts. `my_restriction()` tells the apps what to show them. Suspending someone who is already suspended updates the open row; lifting early clears everything. A suspended account cannot delete itself (that would erase the restriction and let the same address sign up again; a timed suspension ends on its own, otherwise support deletes the account from the dashboard), cannot move its files in Storage, and its saves no longer notify listing owners. A suspended staff member loses every admin power the moment the suspension is saved |
| Content moderation status (`hidden_at`, `hidden_reason`) | Reversible removal for apartments, roommate posts, items, posts and reels, comments, messages, Buzz threads and replies. Hidden rows vanish from feeds, profiles, search, the map, detail pages, the reels feed and the Buzz functions; the owner still sees their own row with the reason but cannot un-hide it (a trigger pins the two moderation columns against owner updates), and hidden content accepts no new likes, comments or saves. The copies of a hidden message or comment in notifications and in the chat preview are cleared too. Restoring clears it. Because photos sit in a public bucket and videos on Mux, hiding also queues media jobs (below) that move the photos to a private `quarantine` bucket and disable the video's playback; restoring queues the reverse |
| Permanent deletion | A separate, deliberate act: admins and owners only, a reason required, and the full content (including its author) is written to the audit log before the row goes. Moderators cannot do it |
| Report review fields | `reviewed_by`, `reviewed_at`, `decision` (dismissed, content hidden, content deleted, user suspended, warning, no action) and `notes` on `reports`, with list, resolve and reopen functions. Reporters can still follow the status of their own report, but the review itself (decision, notes, reviewer) is kept out of the API by column privileges, so a Buzz report can never tell its reporter that the anonymous author was suspended. The report list never names the author of a Buzz target; only `admin_content_get` does, and every such look is logged |
| Admin action log | Nothing new: every function writes to `staff_audit_log` through `staff_log()` with the actor and the reason (`user.suspend`, `user.unsuspend`, `content.hide`, `content.restore`, `content.delete`, `content.view`, `report.resolve`, `report.reopen`, `media.retry`) |
| Media jobs (`media_jobs`) | The cleanup queue, generalised. Deleting a listing, post, message or account (by its owner, by staff or by a cascade) queues `delete_object`, `delete_prefix` and `mux_delete` jobs; hiding and restoring queue `quarantine`/`release` and `mux_disable`/`mux_enable`. Only media the row's author could have uploaded is ever queued (their own folder, or the anonymous Buzz folder, on this project's storage; videos they own), so a row that names someone else's photo or video never becomes that person's deletion. Supabase does not allow touching Storage from SQL, so the admin app's worker (below) claims jobs (`media_jobs_claim`), performs them and reports `media_jobs_done` or `media_jobs_failed`; failures back off (10, 40, 90… minutes) and come back, and staff can see the queue and retry a job at once (not one a worker claimed in the last 15 minutes and has not reported failed) |

Buzz stays anonymous through all of this: a suspension never changes what Buzz shows (a suspect's threads vanishing together would point at them), hides are per thread or reply, the id sequences of the closed tables are revoked (a live reply counter would defeat the publication jitter), and the queue cannot be read by users. The same audit also closed a pre-existing hole unrelated to moderation: a chat member could re-point their membership row into any conversation whose id they knew; the policy now requires them to already be a member.

### Dashboard queries (migration 16) and hardening (migration 17)

`20261103100100_hardening.sql` closes two doors found by the production-readiness audit: the API roles lose `TRUNCATE` on every public table (Supabase grants it by default and row-level security does not govern it; the apps never truncate, so nothing changes for them), and `delete_my_account()` is no longer callable by `anon`.

`20261103100000_admin_dashboard.sql` adds four **read-only** functions for the admin app, all behind `staff_require('moderator')`: `admin_overview_stats()` (the overview counts), `admin_users_list(filter, limit, before)` (browse people newest first: all, suspended or staff), `admin_hidden_content_list(type, limit, before)` (everything hidden, across the eight tables, newest hide first) and `admin_report_get(id)` (one report for the review page, same shape and same Buzz rule as the queue). The hidden-content list carries no Buzz author and shows a Buzz row's published time, never its real `created_at`. Until the migration is applied, the admin app shows a short "database update needed" notice where these are used and keeps working from the older functions (search, the suspended list, the report queue).

### The media worker

The worker moves and deletes files, so it runs **only when switched on explicitly**: `MEDIA_WORKER_ENABLED=true` on the admin project, as well as the service-role key. The key alone, which invitation emails need, never starts it. Every path goes through one check inside the worker: after a hide, restore or delete, the Media page button, and the cron endpoint, which answers 503 while the switch is off. The deploy script refuses to deploy with `MEDIA_WORKER_ENABLED`, Mux keys or `CRON_SECRET` present unless `--allow-worker` is given.

The worker lives in the admin app (`apps/admin/src/lib/media-worker.ts`) and needs server-only variables there: `SUPABASE_SERVICE_ROLE_KEY` for Storage (quarantine, release, delete) and the media queue, `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET` for videos (delete playback ids to disable, create a public one and refresh the row's `videos` snapshot to re-enable, delete assets). It runs in three ways: right after every hide, restore and permanent deletion (after the response is sent); from the Media page's **Run the worker now**; and as a scheduled retry sweep through `GET /api/media/worker`, which Vercel's cron (`apps/admin/vercel.json`, daily) calls with `Authorization: Bearer <CRON_SECRET>` (set `CRON_SECRET` in the project; without it the endpoint is off). The service-role key never reaches the browser and is used for nothing but the queue and storage moves; the website does not have it at all. Each job is idempotent (a file already moved, already deleted or an asset already gone counts as done), and anything that fails keeps its error on the Media page and is retried with back-off.

### Test before launch

| Check | Proven by |
| --- | --- |
| Normal users cannot access admin data or actions | `supabase/tests/launch-checklist.test.mjs` (1): every admin function answers "Not allowed" to a student, with or without a second factor; the staff, restriction and media tables are unreadable; visitors get "permission denied". `admin-dashboard.test.mjs` repeats this for migration 16. Browser: `apps/admin/e2e/admin.mjs` (signed-out visitors are sent to login on every page; with `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` a student lands on "not on the team" and never sees the shell), and the website has no `/admin` route any more (it is the ordinary 404) |
| Users cannot give themselves admin permissions | (2): direct writes to `staff`/`staff_invites` are refused, so is the bootstrap through the API, adding or re-roling yourself, and a moderator promoting anyone |
| Suspensions work on web and mobile, including existing sessions | (3): the same database rules serve both apps. A user is suspended while signed in and their next insert, message, Buzz post, chat, upload and profile edit all fail; `banned_until` blocks the next login; lifting restores everything on the same session |
| Removed content cannot be fetched through another route | (4): a hidden listing, reel and Buzz thread are fetched by id, by text search, by owner, by radius search, through the reels feed and the Buzz feed, as another user, as a visitor and as staff reading normally: nothing comes back; its photos and video are queued for quarantine |
| Restoring content works | (5): everything reappears and the hide jobs are superseded by release jobs |
| Every action records its reason and administrator | (6): suspend, lift, hide, restore and delete rows carry the actor's id, email and name and the reason or note; the log cannot be edited through the API |
| Failed media cleanup is retried | (7): a claimed job that fails keeps its error and a later retry time, staff see it and can retry it at once, the second claim succeeds and the stats count it |

Run everything with `npm run db:test` (PGlite, about two minutes, seven suites; `npm run db:rehearse` is the upgrade rehearsal for production, see the launch checklist; `permissions-audit.test.mjs` enumerates the whole function and table surface: every `admin_*` function refuses students and visitors, internal helpers and the worker functions are unreachable from the API, the closed tables, sequences and the quarantine bucket are locked, reporters cannot read or change review columns, TRUNCATE is gone, and the service role can do exactly the worker's work). `BASE=http://localhost:3000 node apps/web/e2e/no-admin.mjs` proves the website has no admin section. One rule for applying migrations by hand: never re-run an older migration after a newer one (11 to 13 recreate Buzz functions and upload policies that 15 hardens; the setup script only ever applies what has not been applied yet, and 14 carries 15's final bodies so re-running 14 is safe; 16 is read-only and safe to re-run). The browser check needs the admin dev server: `npm run dev:admin`, then `BASE=http://localhost:3001 node apps/admin/e2e/admin.mjs`.

### Tests and the mobile app

`npm run db:test` runs the database tests in PGlite (no Docker or Supabase CLI needed): `supabase/tests/admin.test.mjs` covers migration 14 (the bootstrap, the closed tables, the two-factor gate on every function, what each role may do, the last-owner guard, invite claiming and the audit log), `moderation-support.test.mjs` covers migration 15 in depth, `launch-checklist.test.mjs` is the seven-point list above, and `admin-dashboard.test.mjs` covers migration 16 (the gate, the counts, browsing, the hidden list's Buzz rules, one report). `BASE=http://localhost:3001 node apps/admin/e2e/admin.mjs` is the browser check of the admin app (signed-out gates, robots and caching headers, the worker endpoint's secret, and the staff flow through every page when `ADMIN_E2E_EMAIL`, `ADMIN_E2E_PASSWORD` and `ADMIN_E2E_TOTP_SECRET` are set).

The shared package exposes the same functions for the mobile app: `getMyStaffAccess`, `listStaff`, `listStaffInvites`, `addStaff`, `setStaffRole`, `removeStaff`, `revokeStaffInvite` and `listAuditLog` in `packages/shared/src/queries/admin.ts`, plus `getMfaStatus`, `startTotpEnrollment`, `confirmTotpEnrollment`, `verifyTotp` and `removeMfaFactor` in `queries/mfa.ts`, the moderation functions (`getMyRestriction`, `suspendUser`, `hideContent`, `restoreContent`, `deleteContentPermanently`, `listReports`, `resolveReport`, the media job helpers…) in `queries/admin-moderation.ts`, and the dashboard reads (`getOverviewStats`, `listUsers`, `listHiddenContent`, `getReport`) in `queries/admin-dashboard.ts`. The database enforces the rules either way, so an admin screen in the app needs no extra backend, and `getMyRestriction()` is how either app shows a suspended person why they cannot post.

### Deploying the admin app

The admin app ships with security headers (no framing, no sniffing, strict referrer, HSTS), `noindex` and `no-store` on every response, and `server-only` guards on the files that hold the service role and Mux access, so a client component can never import them.

The admin app is its own Vercel project (the website's project stays as it is): **Add New → Project**, import the same repository, set **Root Directory** to `apps/admin`, and add the variables from `apps/admin/.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (the admin app's own address, for example `https://admin.yourbrand.com` or the `*.vercel.app` URL Vercel gives it), `NEXT_PUBLIC_MAIN_SITE_URL` (the website), and, server-side, `SUPABASE_SERVICE_ROLE_KEY`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` and `CRON_SECRET` for the media worker. Then add `https://<admin app>/auth/callback` to Supabase's redirect allow-list. Keep Vercel's Deployment Protection **on** for this project if you like an extra wall in front of the login page; the app does not depend on it. The daily worker sweep in `apps/admin/vercel.json` is picked up automatically (Pro plans may schedule it more often). Set `NEXT_PUBLIC_GOOGLE_LOGIN=off` to hide "Continue with Google" while the Google provider is not enabled in Supabase.

### Launch checklist

**Update 2026-10-26.** Migration 18 (staff invitation emails) was applied to production at 04:15 UTC after a dry run; checked live: the pending invitation shows "not sent" with 7 days left, the new functions are closed to signed-out callers, a non-staff session is refused and an owner without two-factor is told it is required. Main's `trust_safety` and `buzz_v2` migrations reached production at 04:02 UTC (not from this branch): the live Buzz functions no longer check `hidden_at`, so hiding a Buzz thread from this app no longer removes it from Buzz until that is reconciled. Still needed for invitation emails to arrive: custom SMTP in Supabase (`npm run auth:email` reports the built-in service, 2 emails per hour), `SUPABASE_SERVICE_ROLE_KEY` on the admin Vercel project, and a redeploy from this branch.

**Status on 2026-10-25.** The admin app is deployed as its own Vercel project, `campconnect-admin` (Root Directory `apps/admin`, not connected to Git), at **https://campconnect-admin.vercel.app**, with only public variables: the media worker is inert. The live database has all four admin migrations: 14 and 15 (2026-10-25 15:11 UTC) and 16 and 17 (2026-10-25 22:31 UTC, after a dry run and `npm run db:live-order`). Checked live afterwards: the four dashboard functions exist, are security definer and are closed to `anon`; a non-staff session gets "Not allowed", the owner with only a password gets "Two-factor authentication required", the owner with a verified factor gets the counts; no row count changed. TRUNCATE was already closed on this project, so 17's effect there is `delete_my_account()` no longer callable signed out. The owner account (`<owner email>`) is the only owner and already has a verified authenticator. Main's business portal (39) and presence fix (40) are live too (applied 22:09 and 22:14 UTC), so the business-admin two-factor gap below is in production.

**Production's history is not this branch's.** `main` gained 26 migrations while this work was on its branch, and the live database ran them around the admin ones: main's migrations through 36 (`20261029000000_push.sql`), then 14 and 15, then main's 37 onwards. Main keeps exact copies of 14 and 15 in `supabase/applied-outside-repo/` with a review and a plan to bring them into `supabase/migrations` under `20261029100000_admin.sql` and `20261029100100_moderation_support.sql` (with the matching rows in `public._migrations` renamed in the same step). Migrations 16 and 17 were therefore renamed to `20261103100000_admin_dashboard.sql` and `20261103100100_hardening.sql` so that their versions sort after main's newest and collide with nothing; 14 and 15 keep their names on this branch because that is how production tracks them. `npm run db:live-order` takes `origin/main`, puts the four admin migrations at their production positions and runs every suite of both branches.

Every step is reversible except the migrations (which only add read-only functions and remove privileges nothing uses) and turning the media worker on (which moves and deletes files). Nothing here touches the website's Vercel project.

**0. Rehearse locally (already green on this branch).** `npm run db:rehearse` builds a database in production's current state (migrations 1-15 applied and tracked, data, a pending owner invitation, a hidden item with its media job pending), runs the real setup script against it over the Postgres protocol, and checks: the dry run lists exactly 16 and 17; a gap in the tracking table makes the script refuse; a failing migration leaves nothing behind; the upgrade applies both; a re-run applies nothing; no table changed in size; no media job ran; the owner's dashboard account claims the invitation; password-only, forged aal2 and half-finished authenticators are refused; a verified authenticator opens everything; removing it locks everything again; students can still read, post, message and report. `npm run db:test` runs the other seven suites.

**1. Dry run against production (read-only).** First `git fetch origin && npm run db:live-order` (all suites must pass). Then create a Supabase access token (Account → Access Tokens) and run:

```bash
DRY_RUN=1 SKIP_ENV=1 SKIP_SEED=1 SKIP_AUTH=1 \
SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=dskbzoqreandwwpxiplh npm run db:setup
```

It must list exactly `20261103100000_admin_dashboard.sql` and `20261103100100_hardening.sql` (run from this branch, the script only knows this branch's files; main's migrations already on production are left alone). If it lists anything else, or refuses because an older migration is not tracked, stop: compare `select name from public._migrations order by name` with `supabase/migrations/` before doing anything.

**2. Apply the two migrations.** Optional safety net first: Database → Backups (Pro plan) or a `pg_dump`. Then the same command without `DRY_RUN=1`. Each migration runs in its own transaction with its tracking row. Check in the SQL Editor:

```sql
select name from public._migrations order by name desc limit 2;   -- the two new files
select public.admin_overview_stats();                             -- must fail with "Not authenticated" (the gate works)
```

**3. Supabase Auth settings (dashboard).** Authentication → Multi-Factor: TOTP on. Providers → Email: Confirm email on; minimum password length 12 recommended. URL Configuration → Redirect URLs: add `http://localhost:3001/auth/callback` now and `https://<admin domain>/auth/callback` after step 5. Leave the Site URL pointing at the website.

**4. Owner account and two-factor.** The owner account already exists (it claimed its invitation at 15:22 UTC). If you do not know its password, set a new one in the Supabase SQL Editor (a recovery email would land on the website, which has no set-password page): `update auth.users set encrypted_password = extensions.crypt('<new password>', extensions.gen_salt('bf')) where email = '<owner email>';` Then sign in at https://campconnect-admin.vercel.app (or locally: `npm run dev:admin`, http://localhost:3001) and you land on Security: scan the QR code, enter the code, and keep a copy of the setup key in your password manager (it is the only way back in besides another owner removing the factor). Do this right after creating the account: until an authenticator is enrolled, anyone holding the password could enrol theirs. Confirm the Overview shows counts with no "database update needed" notice and that Audit log shows "Joined the team from an invitation" and "Two-factor authentication turned on". Optional end-to-end check with the same account:

```bash
BASE=http://localhost:3001 ADMIN_E2E_EMAIL=… ADMIN_E2E_PASSWORD=… ADMIN_E2E_TOTP_SECRET=<setup key> node apps/admin/e2e/admin.mjs
```

**5. Vercel project for the admin app.** Fastest: `vercel login` once, then `npm run deploy:admin` (a plan that changes nothing) and `npm run deploy:admin -- --apply`. The script creates or updates the `campconnect-admin` project with Root Directory `apps/admin`, sets only the public variables below, refuses to run if worker secrets are present, deploys the committed branch without touching the website's `.vercel` link, and probes the result (login page, noindex, worker endpoint off). The manual route, in the dashboard: The repository root is linked to the website's project, so do not run `vercel deploy` there. Add New → Project → import the same GitHub repository → **Root Directory `apps/admin`** → project name e.g. `campconnect-admin`. Environment variables for Production (and Preview if you want previews):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the same as the website's |
| `NEXT_PUBLIC_SITE_URL` | the admin app's own URL, e.g. `https://campconnect-admin.vercel.app` or `https://admin.yourdomain.com` |
| `NEXT_PUBLIC_MAIN_SITE_URL` | `https://apartment-book-vyass.vercel.app` |
| `NEXT_PUBLIC_GOOGLE_LOGIN` | `off` until the Google provider is enabled in Supabase |

Do **not** add `SUPABASE_SERVICE_ROLE_KEY`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` or `CRON_SECRET` yet: without them the media worker does nothing at all (the Media page shows it as not configured and jobs simply wait). Deploy, then add the production `/auth/callback` from step 3, sign in on the deployed URL and pass Security again (the session there is separate from localhost). Settings → Deployment Protection can stay on (Vercel Authentication) as an extra wall in front of the login page; the app does not depend on either setting. Run `BASE=https://<admin URL> node apps/admin/e2e/admin.mjs` (with the staff variables for the full flow).

**5b. Invitation emails (after approval).** `npm run auth:email` (read-only report, needs an access token) shows what is missing. Then: migration 18 (`20261103100200_staff_invite_email.sql`) with the usual dry run first; custom SMTP plus the admin app's redirect and the invitation template with `npm run auth:email -- --apply` (with `SMTP_*` set); `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API) on the **admin** Vercel project only, and **not** `MEDIA_WORKER_ENABLED`; then `npm run deploy:admin -- --apply`. Check on the Staff page that a test invitation says "Email sent", and run `apps/admin/e2e/invite-flow.mjs` against a staging project for the whole flow.

**6. Turn on the media worker (moves and deletes files: decide deliberately).** Look at the Media page first: every pending job is listed with its kind and file or video. When you agree with them, add `MEDIA_WORKER_ENABLED=true`, `MUX_TOKEN_ID`/`MUX_TOKEN_SECRET` (a Mux token with Video read+write; rotate the old one first, it was pasted in a chat) and a random `CRON_SECRET` (`openssl rand -hex 32`) to the **admin** project only, redeploy, and press **Run the worker now** once while watching the results. From then on hides, restores and deletions run it immediately and the daily cron retries failures. To pause it again, remove `MEDIA_WORKER_ENABLED` and redeploy (the service-role key can stay for invitation emails).

**7. Team.** Add a second owner first (the only owner cannot step back or delete their account), then admins and moderators. Each person enrols an authenticator on first sign-in.

**8. Merge.** `step-admin` sits on top of the unmerged `step-home-feed`; merging it to `main` deploys the website with the new Home and without any admin routes. The website needs no new environment variables. Delete the Supabase access token after step 2.

**Coordination with main (for whoever maintains `main`'s migrations).**
- The admin app is a separate deployment and adds nothing to `apps/web`; merging `step-admin` brings `apps/admin`, the shared admin queries and the admin migrations. Merge `main` into it first; conflicts are expected in the shared package, the README, the setup script and the test harness (this branch's harness adds `service_role`, `auth.users` confirmation/ban columns, `auth.mfa_factors`, `auth.jwt()` and `boot({ upTo })`).
- When 14 and 15 move into `supabase/migrations` under main's proposed names, delete this branch's copies under their old names in the same change and rename their `public._migrations` rows at the same time, or the setup script will try to apply them again. This branch's setup script refuses to run when a pending migration is older than the newest applied one, which catches a half-done rename.
- **Business portal admin (main's migration 39) does not require two-factor.** `require_admin()` checks only `profiles.role = 'admin'`, so approving businesses, recording paid promotions ("Sponsored") and granting "Verified Partner" work with a password alone, from the website at `/business/admin`; suspended staff keep it too, and removing someone from `staff` does not take the role back (39 copied staff owners and admins into it once). Suggested fix, in a new migration after 39: have `require_admin()` call `staff_require('admin')` where the staff table exists (role, suspension and aal2 with a verified factor in one check), and move those screens into the admin app.

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
| Home / Apartments | Listings with photos, rent, address, a map pin (address search or click-to-pin), distance to campus computed automatically with PostGIS, beds/baths, amenities, availability, lease length; list and map views; filters (university, "within 1/2/5/10 miles of campus", price, bedrooms, furnished, pets, sort); save; message the owner; mark as rented; edit/delete |
| Roommates | "I have a room" / "I need a room" posts with budget, move-in date, area (optionally pinned on the map with distance to campus), gender preference, sleep schedule, cleanliness, smoking/pets; filters incl. distance from campus; save; message |
| Marketplace | Items with photos, price (or free), category, condition, pickup location; filters; save; message the seller; mark as sold. No payments on purpose: meet on campus, like Facebook Marketplace |
| Messages | Conversations with participants (a group is simply a conversation with 3+ people): 1:1 chats, group chats (create, rename, add people, leave), Supabase Realtime delivery, unread badges, photo messages, "Message" buttons that pre-fill a first message about the listing. A `device_push_tokens` table is ready for the mobile apps |
| Other | Global search across all three sections, saved listings page, public profile pages with a person's listings, "add your university", SEO metadata + sitemap, PWA manifest |

Security is enforced in the database with row-level security: users can only edit their own listings, only conversation members can read or send messages, and images can only be uploaded to a user's own folder.

## Project structure

```
apartment-book/
├─ apps/
│  ├─ web/                    # Next.js website for students (App Router, src/ layout)
│  │  ├─ src/app/             # routes: (app)/ has the main site, (auth)/ login + signup
│  │  ├─ src/components/      # UI: layout, apartments, roommates, marketplace, messages, profile
│  │  ├─ src/lib/actions/     # server actions (create/edit/delete, auth, chat)
│  │  ├─ src/lib/supabase/    # Supabase clients for browser and server
│  │  ├─ src/proxy.ts         # auth guard: refreshes sessions, protects private routes
│  │  └─ e2e/                 # Playwright browser checks (home-feed.mjs)
│  ├─ admin/                  # CampConnect Admin: the staff-only app on the same Supabase project (port 3001)
│  │  ├─ src/app/             # login, no-access, security, and (admin)/: overview, reports, content, users, media, staff, audit
│  │  ├─ src/lib/admin.ts     # staff access checks (requireStaff, requireStaffAction, canModerateUser)
│  │  ├─ src/lib/media-worker.ts  # the media clean-up worker (service role + Mux); api/media/worker is its cron endpoint
│  │  ├─ src/proxy.ts         # first gate: no session → login, no second factor → /security; noindex + no-store everywhere
│  │  └─ e2e/                 # Playwright browser check (admin.mjs)
│  └─ mobile/                 # Expo app
├─ packages/
│  └─ shared/                 # platform-agnostic code reused by the future mobile app
│     └─ src/
│        ├─ types/            # Database types + models
│        ├─ schemas/          # zod validation for every form
│        ├─ queries/          # all reads/writes (apartments, items, roommates, messages, storage…)
│        └─ constants.ts      # categories, amenities, currencies…
├─ supabase/
│  ├─ migrations/20260906000000_init.sql   # full database schema, policies, chat functions
│  ├─ migrations/…                         # one file per later step, applied in name order
│  ├─ migrations/20261023000000_admin.sql  # migration 14: staff roles, invites, audit log, the two-factor gate
│  ├─ migrations/20261024000000_moderation_support.sql  # migration 15: account restrictions, hidden content, report review, media jobs
│  ├─ migrations/20261103100000_admin_dashboard.sql     # migration 16: read-only dashboard queries for the admin app
│  ├─ tests/                               # database tests in PGlite (npm run db:test): admin, moderation-support, launch-checklist…
│  └─ seed.sql                             # starter list of universities
├─ scripts/                   # supabase-setup.mjs (one-shot setup), e2e-check.mjs (live backend check)
├─ turbo.json                 # Turborepo task pipeline (typecheck -> lint -> build, with caching)
└─ package.json               # npm workspaces root
```

Rules for `packages/shared`: no imports from `next/*`, `react-dom` or browser globals (`window`, `document`, `localStorage`); every query takes the Supabase client as its first argument; keep `types/database.ts` in sync with the migration. Both Next.js apps' ESLint and type-checks run through Turborepo (`npm run check`).

## 1. Run it locally

Requirements: Node.js 20 or newer (22 recommended) and npm.

```bash
npm install
```

### Project status

The Supabase project for this app (`dskbzoqreandwwpxiplh`, region us-west-2) is already set up: migrations 1 to 13 and the universities (with campus coordinates and the `txstate.edu` domain) are loaded (migrations 14 and 15, the admin section, still have to be applied there: see [Becoming the first owner](#becoming-the-first-owner)), `apps/web/.env.local` is written, and the auth URLs point at `http://localhost:3000`. Sign-ups therefore require a `@txstate.edu` address right now. The steps below are for reference, for a second environment, or if you start a fresh project.

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

The admin app is deployed as a second Vercel project with Root Directory `apps/admin` (see "Deploying the admin app" above). The site is live at **https://apartment-book-vyass.vercel.app** (Vercel project `apartment-book` in the `vyass` team of the `yubrajbajagain2024-2020` account, Root Directory `apps/web`, production environment variables set, Deployment Protection turned off so the public can reach it). Supabase's auth Site URL points at that address. To ship a new version from this machine:

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

Map view with pins (Google Maps or Mapbox), university email verification badges, saved searches with email alerts, push notifications, ratings for sellers, and the moderation screens inside `/admin` (reports queue, content review, people, media jobs) plus the media worker, now that the database side of moderation is in place.

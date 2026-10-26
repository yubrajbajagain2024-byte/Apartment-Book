# Migrations applied outside this repo

Four migrations reached the live Supabase project (`dskbzoqreandwwpxiplh`) on 2026-10-25 without coming from `main`: CampConnect Admin's, the separate staff app. They are kept here so the repo matches what production runs. `scripts/supabase-setup.mjs` and the Supabase CLI only read `supabase/migrations`; `supabase/tests/harness.mjs` applies these where they ran when a suite asks for production's order (`boot({ live: true })`).

| File | Its own title | Recorded in `public._migrations` |
|---|---|---|
| `20261023000000_admin.sql` | migration 14: staff access for the private /admin section | 2026-10-25 15:11:59 UTC |
| `20261024000000_moderation_support.sql` | migration 15: database support for moderation | 2026-10-25 15:12:00 UTC |
| `20261103100000_admin_dashboard.sql` | migration 16: read-only queries for the separate admin app | 2026-10-25 22:31:16 UTC |
| `20261103100100_hardening.sql` | migration 17: privilege hardening | 2026-10-25 22:31:17 UTC |

16 and 17 are copied unchanged from the `step-admin` branch on GitHub, where CampConnect Admin lives. `verify.mjs --live --except 20261103000000_trust_safety.sql,20261103000100_buzz_v2.sql` matched the live catalog exactly on 2026-10-26 (256 functions, 451 columns, 262 constraints, 97 triggers, 111 policies), before this repo's migrations 41 and 42 were applied.

The sections below are about 14 and 15.

## Where they came from

- They were applied as the `postgres` role over a direct database connection and recorded in `public._migrations`. That is what `scripts/supabase-setup.mjs` does when run with `SUPABASE_DB_URL` instead of an access token. That mode also skips the Vault and auth-settings steps, and neither changed that day.
- One second later, `admin_bootstrap_owner()` was called through the Management API with a scoped access token (the API tags the query `scoped_pat:3a1d67d0-…`).
- The staff table's only owner is the project owner's account (`yubrajbajagain2024`). It accepted its owner invite at 15:22 UTC.
- The files are in no branch on GitHub, including `ankur/dev`, which has different moderation migrations (`trust_safety`, `buzz_v2`) that are **not** applied live. Neither file is on this Mac either. The original files are most likely on the project owner's machine.

## How these copies were recovered

Postgres's `pg_stat_statements` kept the text of every statement Postgres first saw in those two seconds, comments included. The files here are those statements, in the order they ran, with three exceptions:

1. Postgres keeps one entry per statement text. Eleven `drop policy if exists …` statements matched text this repo's own migrations had run before, so the window lacks them. Each one is back, without comments, right before the `create policy` that needs it: `uploads_insert_own_folder`, `uploads_insert_buzz` and `uploads_update_own_folder` on `storage.objects`; and `apartments_select`, `roommate_posts_select`, `items_select`, `feed_posts_select`, `post_comments_select`, `post_likes_insert_own`, `post_comments_insert_own` and `saved_listings_insert_own`.
2. Postgres replaced the values of one statement with placeholders: the insert that creates the private `quarantine` storage bucket. They are filled in from the live row as `('quarantine', 'quarantine', false)`.
3. Any other statement whose text had already run before and that changed nothing, such as a repeated grant, is missing too. Such statements leave no trace in the schema.

The result reproduces production exactly. Apply this repo's migrations through 36, then these two, then 37, and every function body, column, constraint, trigger and policy matches the live project. Check it with:

```
node supabase/applied-outside-repo/verify.mjs                                    # offline
SUPABASE_ACCESS_TOKEN=… node supabase/applied-outside-repo/verify.mjs --live     # and against production, read-only
```

If the original files turn up, compare them with these. Any difference should only be comments and spacing.

## Security review (2026-10-25)

What the two migrations add is well locked down:

- **New tables are closed to the API.** `staff`, `staff_invites`, `staff_audit_log`, `account_restrictions` and `media_jobs` have row-level security on, no policies and no grants for `anon` or `authenticated`. Their sequences are closed too.
- **Owner-rights functions are pinned.** All 51 security definer functions set a fixed `search_path`.
- **Admin functions check the caller first.** Of the 26 admin functions, 22 start with `staff_require(role)`, which also demands two-factor sign-in (`aal2`). `admin_me()` skips the check but returns only the caller's own staff row. The other three can't be called from the API at all: `admin_bootstrap_owner`, `admin_content_snapshot` and `admin_content_table`.
- **Staff invites are claimed safely.** A claim needs a confirmed email, never goes to an account older than the invite, and checks that the inviter may still grant the role.
- **Hidden-content columns are protected.** `hidden_at` and `hidden_reason` change only while the setting `app.moderation` is `on`, which the API cannot set. Suspended accounts can't write content.
- **The new `quarantine` bucket is private** and has no policies, so only the service role can use it.

Worth knowing:

- **Anyone signed out can call `is_suspended(uuid)`**, so they can check whether any given account is currently suspended. RLS policies need it through `content_visible()`. Making `content_visible()` security definer would let the grant on `is_suspended` go. Low severity.
- **Staff can sign up with any email.** `enforce_university_email()` now accepts an email with a pending staff invite, even outside the university domains. That is by design.

## A regression these migrations brought: Reels like counts

Migration 15 rewrote `reels_feed()` to leave out hidden content and suspended accounts. In the same edit it replaced `post_like_count()` with a plain count over `post_likes`. `reels_feed()` runs with the caller's rights, and since migration 18 nobody may read other people's like rows. So the live feed now counts only the reader's own like: a signed-out visitor sees 0 on every reel, where the real counts are 2, 2 and 3. The app mostly hides this, because Home's Reels replace the count with separately loaded engagement once it arrives.

The fix is migration 38, `supabase/migrations/20261031000000_reels_feed_like_counts.sql`: the live definition with `post_like_count()` restored and nothing else changed. It acts only where this moderation schema exists, so a database built from this repo alone is left as it is. `supabase/tests/reels-feed-like-counts.test.mjs` checks both cases. Until 38 is applied live, `verify.mjs --live` reports one difference: the body of `reels_feed()`.

## Reconciling the migration history (not done; needs approval)

1. **Ask the project owner for the original files** and compare them with these.
2. **Bring the two into `supabase/migrations` under unique, order-preserving names,** for example `20261029100000_admin.sql` and `20261029100100_moderation_support.sql`. That puts them after push and before profile privacy, the order they ran live. Rename their two rows in `public._migrations` in the same step, so `npm run db:setup` does not apply them again. Their current versions collide with `20261023000000_snap_close_deletes.sql` and `20261024000000_message_replies.sql`, and the Supabase CLI keys migrations by version alone.
3. **Teach `supabase/tests/harness.mjs` what they use:** the `service_role` role, `auth.users.email_confirmed_at`, `created_at` and `banned_until`, `auth.mfa_factors` and `auth.jwt()`. `verify.mjs` shows the minimum.
4. **Move migration 38's moderation branch** into the plain migration chain once the two files are in it.
5. **Only then reconcile the Supabase CLI's own history.** It is empty on the live project, so `supabase db push --dry-run` lists every migration. Mark them applied with `supabase migration repair --status applied <version>…` and check that a dry run lists nothing. Until then, never run a real `supabase db push`: it would rerun every migration over production and undo the work above.
6. **Review `ankur/dev`'s `trust_safety` and `buzz_v2` migrations against these** before applying them. They cover the same ground.

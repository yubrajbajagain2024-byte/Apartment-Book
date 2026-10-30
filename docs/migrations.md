# Migrations: production rollout

Which migration is on the live project. How to write and apply one is in
[supabase/CLAUDE.md](../supabase/CLAUDE.md). A migration's row (❌ not applied) goes in with its PR;
when it reaches production, update the row with a docs-only PR (root CLAUDE.md, documentation
rule 2). On `main` as of 2026-10-28: 55 files in `supabase/migrations/` and 16 rollbacks, for the
newer migrations, in `supabase/rollbacks/` (49 and 50 came with PR #49, 51 to 54 with PR #50, 55
and 56 with PR #51).

**As of 2026-10-27.** Assembled from commit messages, `supabase/applied-outside-repo/README.md` and
the owner's deploy notes (read-only checks of production's `public._migrations`, latest 2026-10-27
00:32 UTC). **Not read from the live catalog**; confirm with `verify.mjs --live` before acting on it.
The README's statement that 41 and 42 are not live is out of date.

| # | File | Live? |
| --- | --- | --- |
| 1–37 | `20260906000000_init.sql` … `20261030000000_profile_privacy.sql` | ✅ applied |
| — | 4 admin migrations from `step-admin`: copies in `supabase/applied-outside-repo/` (`…admin`, `…moderation_support`, `…admin_dashboard`, `…hardening`) | ✅ applied 2026-10-25, outside this folder |
| 38 | `20261031000000_reels_feed_like_counts.sql`: restores `post_like_count()` in `reels_feed()` | ✅ applied |
| 39 | `20261101000000_business_portal.sql`: roles, standings, listings, deals, inquiries, analytics, team | ✅ applied 2026-10-25 |
| 40 | `20261102000000_presence_channel_join.sql`: private-channel join check | ✅ applied |
| 41 | `20261103000000_trust_safety.sql`: reports, queue, sanctions, appeals, audit log | ✅ applied 2026-10-26 04:02 UTC (Ankur) |
| 42 | `20261103000100_buzz_v2.sql`: Buzz tables, aliases, serializer, reads and interactions | ✅ applied 2026-10-26 04:02 UTC (Ankur) |
| 43 | `20261103000200_marketplace_video.sql`: one video per Marketplace item | ✅ applied 2026-10-26, by 04:57 UTC |
| 44 | `20261103000300_discover.sql`: Discover rankings (hot posts, trending topics, accounts) | ❌ **not applied** |
| 45 | `20261104000000_post_details.sql`: post title, link, audience, comments switch | ✅ applied 2026-10-27 00:32 UTC |
| 46 | `20261104000100_discover_audience.sql`: `discover_refresh()` ranks Global posts only | ❌ **not applied** |
| 47 | `20261105000000_anonymous_listings.sql`: anonymous roommate/marketplace posts, listing audiences, anonymous inquiry chats | ✅ applied 2026-10-27 04:37 UTC (in production's `_migrations`, found by a read-only check on 2026-10-28; who applied it is not recorded), before 44 and 46 |
| 49 | `20261107000000_business_teams.sql` (merged in PR #49): business team roles (owner, admin, editor, analyst), the business audit log, `business` notifications | ❌ **not applied** |
| 50 | `20261107000100_business_ads.sql` (merged in PR #49): business posts, ads and their review, serving, students' hide/report/block, events and analytics, Fair Housing screen, v1 promotions migrated to ads, the `ads-sweep` pg_cron job | ❌ **not applied** |
| 51 | `20261108000000_buzz_reply_tree.sql` (merged in PR #50): each Buzz reply says which reply it answers at any depth (`treeParentId`), for the app's Reddit-style thread | ❌ **not applied** |
| 52 | `20261108000100_buzz_top_reply.sql` (merged in PR #50): a feed card's "Top reply" (`topReply` in `buzz_v2_feed`), with a partial index | ❌ **not applied** |
| 53 | `20261108000200_buzz_prompt_threads.sql` (merged in PR #50): one thread per day's prompt per campus and one on Global (`buzz_prompt_threads`, `buzz_v2_prompt_thread()`); a prompt's answer always titled with the prompt, existing ones included | ❌ **not applied** |
| 54 | `20261108000300_buzz_categories.sql` (merged in PR #50): an optional category on a buzz (`buzz_posts.category`, a fixed list), read by `buzz_v2_create` and shown by `buzz_root_json` | ❌ **not applied** |
| 55 | `20261109000000_media_server_fields.sql` (merged in PR #51; its fix on `business-v2`): a video's processing details are written by the server only; 30 new videos a day per person; ready videos 10 minutes at most | ❌ **not applied** |
| 56 | `20261109000100_business_hardening.sql` (merged in PR #51; its fixes on `business-v2`): Business v2 hardening after an independent review: ads show the reviewed copy of what they promote and pause when it changes, every ad screened for Fair Housing, ad photos from this project's storage, chats visible to a business once the student writes, blocks stop chats, server-set dates, payments kept, stricter event counting | ❌ **not applied** |
| 57 | `20261110000000_business_hours.sql` (merged in PR #59, 2026-10-29): a business's opening hours, `businesses.hours` (time zone, weekly ranges, special dates), checked by `businesses_hours_check`, public with the profile; 49's audit of profile edits records them. Needs only 39 (and 49 for the audit); the website and the app work without it (no hours shown, none offered) | ❌ **not applied** |
| (18) | `20261103100200_staff_invite_email.sql`: **file only on `step-admin`** (in neither `supabase/migrations/` nor `supabase/applied-outside-repo/` here) | ✅ applied |

**What the gaps cost today:** without 44, Discover falls back to newest posts and people. `main`
already carries the code for 44 and 46, so production's website most likely does too (it deploys
from `main`; not verified). Production state, read-only, 2026-10-28: `verify.mjs --live --except`
the 10 pending files matches this repo's model except CampConnect Admin's staff-invite objects
(`step-admin` migration 18, not in this repo); 44 and 46 share no object with 47, so applying them
after it is safe.

**Order constraints:** apply in file order, and **44 and 46 in the same run, never 44 alone**:
`discover_refresh()` runs with definer rights and fills world-readable ranking tables, so without
46 a friends-only or campus-only post's `#tag` would trend for everyone.

**Business v2 (49 and 50, then 55 and 56):** `db:setup` applies whatever is pending, in file order,
so one run from `main` applies 44, 46, 49, 50, Buzz's 51 to 54, 55 and 56 (47 is applied). PR #49 merged 49
and 50's code on 2026-10-28 at 04:07 UTC, when its own docs said they were not on production (still
not applied, by a read-only check of production on 2026-10-28). 55 and 56 reached `main` with PR #51 (2026-10-28, 07:06 UTC), whose video routes
write a video's processing details with the service role, which works with or without 55. The full
list, with the rollbacks, is "Production deployment checklist" in
[branches/business-v2.md](branches/business-v2.md). In short:
1. `business-v2`'s fixes to 50, 55 and 56 (the ad trigger found on staging, and a second independent
   review's eight findings) are on `main` since PR #52 (2026-10-28, 19:03 UTC).
2. Back up production first: it has no restorable backup yet (Free plan, read-only check on
   2026-10-28), so Pro's daily backups or a Supabase CLI dump, plus `scripts/backup.mjs` for row
   counts. Then check with `verify.mjs --live --except …` that production is still in the state that
   was rehearsed.
3. Run `db:setup` once from `main`: 44, 46 and 49 to 57 (57 on `main` since PR #59; it is in the
   rehearsal's and the offline rollout's release since 2026-10-29).

Applying 55 under the older video routes would leave new uploads "processing". Applying 49 and 50
without 55 and 56 would let ads rely on unchecked video details: run them together. 55 also needs
`SUPABASE_SERVICE_ROLE_KEY` on the website (Buzz already does). The run is rehearsed offline
(`supabase/tests/production-rollout.test.mjs`) and on staging on 2026-10-28
(`supabase/tests/staging/release-rehearsal.mjs`): applied in order while students used the API,
the release's own rollback (57, 56, 55, 50, 49, with Buzz's 51 to 54 left as they are, every Buzz
object and row compared), applied again, and every rollback in reverse. 56's rollback restores the
versions of 39's, 49's and 50's functions it replaced. 49's and 50's restore the functions they
replaced verbatim; 50's refuses while an ad that promoted no listing or post has a recorded payment.
50's ad trigger was corrected on 2026-10-28 on `business-v2` (50 is on `main` since PR #49; by
this table it is not on production, so the correction lands before 50 does).

**Buzz (51 to 54):** apply in file order, after every earlier migration; 54 needs 53 (both
replace `buzz_root_json`, 54 with 53's version plus the category). The code does not need them:
without them the app shows two levels of replies, no top reply and prompt answers as buzzes of
their own, and a picked category is simply not kept, so the `ankur/dev` PR can merge first. Each
rollback restores the functions it replaced verbatim; 53's keeps the prompt threads as ordinary
buzzes and 54's keeps the categories (nothing reads them).

**Numbering quirk:** both `20261103000300_discover.sql` and `20261104000000_post_details.sql` call
themselves "migration 44" in their header comments. File order (timestamps) is authoritative;
this table numbers them 44 and 45. Fix the headers when either file is next touched.
55 and 56 were 51 and 52 on `business-v2` (`20261107000200` and `20261107000300`, never pushed
or applied) until 2026-10-28, when PR #50's Buzz migrations reached `main` first; they were renamed to
sort after them, and the branch's earlier commit messages still say 51 and 52.

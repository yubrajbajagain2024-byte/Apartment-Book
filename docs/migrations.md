# Migrations: production rollout

Which migration is on the live project. How to write and apply one is in
[supabase/CLAUDE.md](../supabase/CLAUDE.md). A migration's row (❌ not applied) goes in with its PR;
when it reaches production, update the row with a docs-only PR (root CLAUDE.md, documentation
rule 2). On `main` as of 2026-10-28: 49 files in `supabase/migrations/` and 10 rollbacks, for the
newer migrations, in `supabase/rollbacks/` (49 and 50 came with PR #49); the `ankur/dev` PR adds
51 to 54, with their rollbacks.

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
| 47 | `20261105000000_anonymous_listings.sql`: anonymous roommate/marketplace posts, listing audiences, anonymous inquiry chats | ❌ **not applied** |
| 49 | `20261107000000_business_teams.sql` (merged in PR #49): business team roles (owner, admin, editor, analyst), the business audit log, `business` notifications | ❌ **not applied** |
| 50 | `20261107000100_business_ads.sql` (merged in PR #49): business posts, ads and their review, serving, students' hide/report/block, events and analytics, Fair Housing screen, v1 promotions migrated to ads, the `ads-sweep` pg_cron job | ❌ **not applied** |
| 51 | `20261108000000_buzz_reply_tree.sql` (branch `ankur/dev`): each Buzz reply says which reply it answers at any depth (`treeParentId`), for the app's Reddit-style thread | ❌ **not applied** |
| 52 | `20261108000100_buzz_top_reply.sql` (branch `ankur/dev`): a feed card's "Top reply" (`topReply` in `buzz_v2_feed`), with a partial index | ❌ **not applied** |
| 53 | `20261108000200_buzz_prompt_threads.sql` (branch `ankur/dev`): one thread per day's prompt per campus and one on Global (`buzz_prompt_threads`, `buzz_v2_prompt_thread()`); a prompt's answer always titled with the prompt, existing ones included | ❌ **not applied** |
| 54 | `20261108000300_buzz_categories.sql` (branch `ankur/dev`): an optional category on a buzz (`buzz_posts.category`, a fixed list), read by `buzz_v2_create` and shown by `buzz_root_json` | ❌ **not applied** |
| 55 | `20261109000000_report_auto_hide.sql` (branch `auto-hide-reports`): content 10 different eligible people report is hidden, flagged for CampConnect Admin (`report_auto_hides`), its owner told and the hide audited; restores need 10 new reporters; the console's approve/restore un-hides public content. Needs CampConnect Admin's schema (no-op without it) | ❌ **not applied** |
| (18) | `20261103100200_staff_invite_email.sql`: **file only on `step-admin`** (in neither `supabase/migrations/` nor `supabase/applied-outside-repo/` here) | ✅ applied |

**What the gaps cost today:** without 44, Discover falls back to newest posts and people; without
47, anonymous listings, listing audiences and anonymous inquiry chats do not work. `main` already
carries the code for 44, 46 and 47, so production's website most likely does too (it deploys from
`main`; not verified).

**Order constraints:** apply in file order, and **44 and 46 in the same run, never 44 alone**:
`discover_refresh()` runs with definer rights and fills world-readable ranking tables, so without
46 a friends-only or campus-only post's `#tag` would trend for everyone.

**Business v2 (49 and 50):** apply both in the same run, in file order, after every earlier
migration (`db:setup` applies whatever is pending, in order, so 44, 46 and 47 go first). The code
of the `business-v2` branch needs both: apply them before that branch is merged, since merging
deploys. PR #49 merged it on 2026-10-27, when its own docs said 49 and 50 were not on production
(not checked since). Both rollbacks restore the functions they replaced verbatim; 50's refuses while an ad
that promoted no listing or post has a recorded payment.

**Buzz (51 to 54):** apply in file order, after every earlier migration; 54 needs 53 (both
replace `buzz_root_json`, 54 with 53's version plus the category). The code does not need them:
without them the app shows two levels of replies, no top reply and prompt answers as buzzes of
their own, and a picked category is simply not kept, so the `ankur/dev` PR can merge first. Each
rollback restores the functions it replaced verbatim; 53's keeps the prompt threads as ordinary
buzzes and 54's keeps the categories (nothing reads them).

**Report auto-hide (55):** does not need 44, 46, 47 or 49 to 54. Its suite also runs it on production as it is today
(those left out), so it may be applied alone, ahead of them: one transaction with its `public._migrations` row
(supabase/CLAUDE.md), then `notify pgrst`. It replaces CampConnect Admin's `admin_content_hide/restore/delete` and
`admin_reports_list` with bodies taken from `applied-outside-repo/`; check them against production's first. Its rollback
restores those and Trust & Safety's `ts_snapshot()` and `ts_set_content_status()` verbatim. Content it hid stays hidden
after a rollback.

**Numbering quirk:** both `20261103000300_discover.sql` and `20261104000000_post_details.sql` call
themselves "migration 44" in their header comments. File order (timestamps) is authoritative;
this table numbers them 44 and 45. Fix the headers when either file is next touched.

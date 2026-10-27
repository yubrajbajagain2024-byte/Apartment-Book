# Migrations: production rollout

Which migration is on the live project. How to write and apply one is in
[supabase/CLAUDE.md](../supabase/CLAUDE.md). A migration's row (❌ not applied) goes in with its PR;
when it reaches production, update the row with a docs-only PR (root CLAUDE.md, documentation
rule 2). On `main` as of 2026-10-27: 47 files in `supabase/migrations/` and 8 rollbacks, for the
newer migrations, in `supabase/rollbacks/`.

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
| (18) | `20261103100200_staff_invite_email.sql`: **file only on `step-admin`** (in neither `supabase/migrations/` nor `supabase/applied-outside-repo/` here) | ✅ applied |

**What the gaps cost today:** without 44, Discover falls back to newest posts and people; without
47, anonymous listings, listing audiences and anonymous inquiry chats do not work. `main` already
carries the code for 44, 46 and 47, so production's website most likely does too (it deploys from
`main`; not verified).

**Order constraints:** apply in file order, and **44 and 46 in the same run, never 44 alone**:
`discover_refresh()` runs with definer rights and fills world-readable ranking tables, so without
46 a friends-only or campus-only post's `#tag` would trend for everyone.

**Numbering quirk:** both `20261103000300_discover.sql` and `20261104000000_post_details.sql` call
themselves "migration 44" in their header comments. File order (timestamps) is authoritative;
this table numbers them 44 and 45. Fix the headers when either file is next touched.

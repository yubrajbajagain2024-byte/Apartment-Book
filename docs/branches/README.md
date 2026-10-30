# Branches

Every branch at a glance, **as of 2026-10-27**. GitHub: `yubrajbajagain2024-byte/UniBuzz`
(public); default branch `main`; work lands through pull requests (PRs #1 – #47 so far). One file
per branch holds the details, tips and counts included: `<branch name>.md`, with a slash in the
name as a folder. The rules for these files are in the root CLAUDE.md ("Documentation: keep it
current", rules 2 and 3).

| Branch | Owner | What it is | State | Details |
| --- | --- | --- | --- | --- |
| `main` | everyone, via PRs | integration branch; **every push deploys production** | — | [../status.md](../status.md) |
| `ankur/dev` | Ankur | Ankur's feature line | merged (PRs #35, #38, #41, and #50 on 2026-10-28: Buzz threaded replies, top reply, prompt threads, categories, migrations 51 to 54, not on production) | [ankur/dev.md](ankur/dev.md) |
| `ankur/owner-moderation` | Ankur | Buzz v2 and Trust & Safety | merged (PR #37) | [ankur/owner-moderation.md](ankur/owner-moderation.md) |
| `step-admin` | Yubraj | **CampConnect Admin**, the separate staff app, and migrations 14–18 | **not merged**; merge plan in its `docs/step-admin-merge-plan.md` | [step-admin.md](step-admin.md) |
| `step-1-brand-shell` | Yubraj | first brand-and-shell pass (2026-09-07) | **1 commit never merged**; superseded | [step-1-brand-shell.md](step-1-brand-shell.md) |
| `step-home-feed` | Sunil | the main feature line, 2026-10-09 to 10-25 | merged (PRs #1 – #32); since then 1 old `CLAUDE.md` commit; **PR #46** carries only that copy | [step-home-feed.md](step-home-feed.md) |
| `business-portal-prelaunch` | Sunil | the business portal | merged (PR #33, `fee2e8f`); since then the stray `app.json` commit and 1 old `CLAUDE.md` commit; **PR #47** carries only those two | [business-portal-prelaunch.md](business-portal-prelaunch.md) |
| `create-flow-redesign` | Sunil | camera-first create flow, post details | merged (via PR #40); since then 2 old `CLAUDE.md` commits; **PR #44 open** | [create-flow-redesign.md](create-flow-redesign.md) |
| `listing-flow-redesign` | Sunil | anonymous listings, Roommate and Marketplace create flow | merged (PR #40); since then 2 old `CLAUDE.md` commits; **PR #43 open** | [listing-flow-redesign.md](listing-flow-redesign.md) |
| `docs/claude-md` | Sunil | the first root `CLAUDE.md` | merged (PR #42); nothing left on it | [../history.md](../history.md) |
| `docs/claude-structure` | Sunil | one shared `CLAUDE.md` plus `docs/` | merged (PR #45); nothing left on it | [../history.md](../history.md) |
| (one local branch) | Sunil | the pending security fix ([../status.md](../status.md), "Security fix pending") | local only, **not pushed** while production is unpatched | on the branch itself |
| `business-v2` | Sunil | UniBuzz Business v2: roles, posts, Ads Manager, Sponsored ads, business profiles, analytics (migrations 49, 50, 55, 56) | merged (PR #49, 2026-10-28 04:07 UTC; PR #51, 07:06 UTC: 55, 56, review fixes) before its migrations were applied; PR #52, 19:03 UTC: the fixes to 50, 55 and 56 from the staging rehearsal and a second independent review | [business-v2.md](business-v2.md) |
| `business-sidebar` | Sunil | The business portal's sidebar: Overview, Advertisements, Inbox, Products & Services, Analytics, Billing, Settings (no migration) | merged (PR #56, 2026-10-29 03:34 UTC); nothing left on it | [business-sidebar.md](business-sidebar.md) |
| `business-inbox` | Sunil | The business Inbox, directly below Overview: Instagram-style list, filters, alerts, inquiry context (no migration) | merged (PR #57, 2026-10-29 04:06 UTC; its later commit is on `business-inbox-pending`) | [business-inbox.md](business-inbox.md) |
| `business-inbox-pending` | Sunil | The Inbox for a business awaiting review: below Overview, saying it opens on approval (no migration) | merged (PR #58, 2026-10-29 06:14 UTC) | [business-inbox-pending.md](business-inbox-pending.md) |
| `business-hours` | Sunil | The public profile's preview from the sidebar, a Website button, and opening hours with "open now" (migration 57) | merged (PR #59, by 2026-10-29; 57 not on production) | [business-hours.md](business-hours.md) |
| `admin-analytics-business` | Yubraj | The staff console's Analytics and Business sections: growth, active and engaged students, ad delivery, revenue; advertisers, campaigns, payments, pricing, reports (migration 59) | draft PR, **not to be merged as it is**: the tabs move into `apps/admin` first (from `main` at PR #59) | [admin-analytics-business.md](admin-analytics-business.md) |
| `claude/claude-md-documentation-0b8750` | — | leftover worktree branch of a 2026-10-26 AI session | no commits of its own; left untouched until the owner says otherwise | — |

**Safe to delete once their owner agrees**, because `main` has all their work (what is left on them
is an old `CLAUDE.md` copy or, on `business-portal-prelaunch`, the stray `app.json`):
`docs/claude-md`, `docs/claude-structure`, `listing-flow-redesign`, `create-flow-redesign`,
`step-home-feed`, `business-portal-prelaunch` (Sunil's; close PRs #43, #44, #46 and #47 first);
`ankur/owner-moderation` (Ankur's).

## Old per-branch CLAUDE.md copies

On 2026-10-27 each branch got its own `CLAUDE.md` with a branch-specific §9. That design was replaced
the same day (docs/decisions.md, last row); every §9 now lives in the files here.

- Copies pushed to GitHub: `listing-flow-redesign`, `create-flow-redesign`, `step-home-feed`,
  `business-portal-prelaunch`. PRs #43, #44, #46 and #47 would bring all four into `main` (and #47
  the stray `app.json`): close them instead of merging. Checked 2026-10-27 for #46 and #47: each
  commit on those branches that `main` lacks only adds an old copy or the stub, and every note in
  the copies is in these docs.
- Copies committed only on the owner's Mac, never pushed: `ankur/dev`, `ankur/owner-moderation`,
  `step-admin`, `step-1-brand-shell` (one local commit each; reset to `origin/<branch>` to drop it).
- If you continue a branch that has a copy, merge `main` into it and resolve `CLAUDE.md` by taking
  `main`'s version.

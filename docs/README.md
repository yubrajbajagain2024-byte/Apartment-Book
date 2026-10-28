# docs/

Project documentation that changes as work happens. How to keep it current is in the root
[CLAUDE.md](../CLAUDE.md) (section "Documentation: keep it current"); this page is the map.

| File | What it holds | Changes when |
| --- | --- | --- |
| [status.md](status.md) | completed work, open work in priority order, blockers and risks, future plans | work finishes, starts or gets stuck |
| [migrations.md](migrations.md) | every migration's production status and the order constraints | a migration is added or applied |
| [testing.md](testing.md) | every test suite, how to run it, its latest result | a suite is added, run or fails |
| [decisions.md](decisions.md) | settled decisions and their reasons | a decision is made |
| [history.md](history.md) | dated history: names, merges, production events, retired branches | something lands or ships |
| [environment.md](environment.md) | environment variable names and where their values live | the code reads a new variable |
| [branches/README.md](branches/README.md) | every branch at a glance, and old per-branch CLAUDE.md copies | a branch is created, merged or deleted |
| `branches/<branch name>.md` | one branch: purpose, progress, pending work, next steps | work happens on that branch |
| [technical-reference.md](technical-reference.md) | the old README: every feature's design in full | rarely |

Instructions for working in a folder are not here but in the CLAUDE.md files: the root one,
[apps/mobile/CLAUDE.md](../apps/mobile/CLAUDE.md) and [supabase/CLAUDE.md](../supabase/CLAUDE.md).

# ankur/owner-moderation

- **Owner:** Ankur. **As of 2026-10-27:** fully merged (PR #37, 2026-10-25); tip `fb3ddf7`. Its tree
  has 42 migrations.
- **Purpose:** make Buzz v2 and Trust & Safety fit the admin schema that production received from
  `step-admin`.

## Completed

- `fb3ddf7`: migrations 41 (`20261103000000_trust_safety.sql`) and 42
  (`20261103000100_buzz_v2.sql`) rebuilt to sit on the four out-of-repo admin migrations, with
  their tests. Both are on production (applied 2026-10-26 04:02 UTC, per the owner's deploy notes).

## Pending

- [ ] Delete the branch once Ankur agrees.

## Tests

- Not run on this tree on 2026-10-27; the same migrations pass on `main`
  ([../../testing.md](../../testing.md)).

## Next steps

1. Historical. No new work here; branch from `main`.

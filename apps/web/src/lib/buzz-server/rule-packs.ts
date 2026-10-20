import "server-only";

/**
 * The engine's rule packs (id, version, rule count) for the staff console's Rules page. Re-exported from here so the
 * engine keeps a single way into the website (`packages/moderation/tests/compat.test.ts`).
 */
export { listRulePacks } from "@apartment-book/moderation";

// Unit tests for anonymous listings and listing audiences on the apps' side (20261105000000_anonymous_listings.sql):
// the schemas' new fields and their defaults, the columns a new listing writes (only what differs, so older databases
// keep working), the plain error on a database without the migration, finding your own anonymous listings, and how a
// hidden poster's messages read on their own screen. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as in media.test.mjs).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);
const { itemSchema, roommatePostSchema } = await import("../src/schemas/index.ts");
const { LISTING_PRIVACY_UNAVAILABLE, isMyListing, listingPrivacyColumns, myAnonymousListings } = await import("../src/queries/listing-privacy.ts");
const { createItem } = await import("../src/queries/items.ts");
const { createRoommatePost } = await import("../src/queries/roommates.ts");
const { asSeenBy } = await import("../src/queries/messages.ts");
const { LISTING_AUDIENCES, LISTING_AUDIENCE_VALUES } = await import("../src/constants.ts");

const UNI = "00000000-0000-4000-8000-000000000001";
const ITEM = { title: "IKEA desk", description: "Sturdy desk, small scratch.", price: "80", currency: "USD", category: "furniture", condition: "good", images: [], imageMeta: [], videos: [] };
const ROOM = { postType: "needs_room", title: "Room wanted now", description: "Quiet student, early riser, tidy.", currency: "USD", genderPreference: "any", smokingOk: false, petsOk: false, images: [], imageMeta: [], videos: [] };

/** A stand-in for supabase-js: records the insert and answers with `reply`. */
function client(reply) {
  const calls = [];
  const chain = { select: () => chain, single: async () => reply, limit: async () => reply };
  return {
    calls,
    from(table) {
      return {
        insert(row) {
          calls.push({ table, row });
          return chain;
        },
        select: async () => reply,
      };
    },
  };
}

test("listing audiences: campus, global and friends, no selected people", () => {
  assert.deepEqual(LISTING_AUDIENCE_VALUES, ["campus", "global", "friends"]);
  assert.deepEqual(LISTING_AUDIENCES.map((a) => a.value), ["campus", "global", "friends"]);
});

test("schemas: a listing is public and global unless chosen otherwise (the website's forms send neither)", () => {
  const item = itemSchema.parse(ITEM);
  const room = roommatePostSchema.parse(ROOM);
  for (const v of [item, room]) {
    assert.equal(v.isAnonymous, false);
    assert.equal(v.audience, "global");
  }
  const chosen = itemSchema.parse({ ...ITEM, isAnonymous: true, audience: "friends" });
  assert.equal(chosen.isAnonymous, true);
  assert.equal(chosen.audience, "friends");
});

test("schemas: no 'selected' audience for listings, and a campus listing needs a university", () => {
  assert.equal(itemSchema.safeParse({ ...ITEM, audience: "selected" }).success, false);
  const campus = roommatePostSchema.safeParse({ ...ROOM, audience: "campus" });
  assert.equal(campus.success, false);
  assert.equal(campus.error.issues[0].path[0], "audience");
  assert.equal(roommatePostSchema.safeParse({ ...ROOM, audience: "campus", universityId: UNI }).success, true);
});

test("schemas: the old rules still hold (titles, descriptions, budgets, prices)", () => {
  assert.equal(roommatePostSchema.safeParse({ ...ROOM, title: "Room" }).success, false);
  assert.equal(roommatePostSchema.safeParse({ ...ROOM, description: "too short" }).success, false);
  assert.equal(roommatePostSchema.safeParse({ ...ROOM, budgetMin: "700", budgetMax: "400" }).success, false);
  assert.equal(itemSchema.safeParse({ ...ITEM, title: "ab" }).success, false);
  assert.equal(itemSchema.safeParse({ ...ITEM, price: undefined }).success, false);
  assert.equal(itemSchema.parse({ ...ITEM, price: "0" }).price, 0);
});

test("listingPrivacyColumns: only what differs from a plain listing", () => {
  assert.deepEqual(listingPrivacyColumns({ isAnonymous: false, audience: "global" }), {});
  assert.deepEqual(listingPrivacyColumns({}), {});
  assert.deepEqual(listingPrivacyColumns({ isAnonymous: true, audience: "campus" }), { is_anonymous: true, audience: "campus" });
});

test("creating: a plain listing writes the same row as before; an anonymous one is written with its poster", async () => {
  const plain = client({ data: { id: "i1" }, error: null });
  await createItem(plain, "u1", itemSchema.parse(ITEM));
  assert.equal(plain.calls[0].row.seller_id, "u1");
  assert.equal("is_anonymous" in plain.calls[0].row, false);
  assert.equal("audience" in plain.calls[0].row, false);

  const anon = client({ data: { id: "r1" }, error: null });
  await createRoommatePost(anon, "u1", roommatePostSchema.parse({ ...ROOM, isAnonymous: true, audience: "friends" }));
  assert.equal(anon.calls[0].row.author_id, "u1");
  assert.equal(anon.calls[0].row.is_anonymous, true);
  assert.equal(anon.calls[0].row.audience, "friends");
});

test("creating on a database without the migration: a plain error, never a quiet public listing", async () => {
  const missing = client({ data: null, error: { code: "PGRST204", message: "Could not find the 'is_anonymous' column of 'items' in the schema cache" } });
  await assert.rejects(createItem(missing, "u1", itemSchema.parse({ ...ITEM, isAnonymous: true })), { message: LISTING_PRIVACY_UNAVAILABLE });
  const missingRoom = client({ data: null, error: { code: "42703", message: 'column "audience" does not exist' } });
  await assert.rejects(createRoommatePost(missingRoom, "u1", roommatePostSchema.parse({ ...ROOM, audience: "friends" })), { message: LISTING_PRIVACY_UNAVAILABLE });
  // The marketplace video column's own message is left for the apps to explain (migration 43).
  const video = client({ data: null, error: { code: "PGRST204", message: "Could not find the 'videos' column of 'items' in the schema cache" } });
  await assert.rejects(createItem(video, "u1", itemSchema.parse(ITEM)), { message: /'videos' column/ });
});

test("myAnonymousListings and isMyListing: your own anonymous listings, and nothing on an older database", async () => {
  const rows = { data: [{ roommate_post_id: "r1", item_id: null }, { roommate_post_id: null, item_id: "i2" }], error: null };
  assert.deepEqual(await myAnonymousListings(client(rows)), { roommate: ["r1"], item: ["i2"] });
  assert.deepEqual(await myAnonymousListings(client({ data: null, error: { code: "42P01" } })), { roommate: [], item: [] });
  assert.equal(await isMyListing(client(rows), "u1", "item", { id: "i9", seller_id: "u1" }), true);
  assert.equal(await isMyListing(client(rows), "u1", "item", { id: "i9", seller_id: "u2" }), false);
  assert.equal(await isMyListing(client(rows), "u1", "item", { id: "i2", seller_id: null, is_anonymous: true }), true);
  assert.equal(await isMyListing(client(rows), "u1", "roommate", { id: "r7", author_id: null, is_anonymous: true }), false);
});

test("asSeenBy: a hidden poster's own messages are theirs on their screen, and nobody else's changes", () => {
  const masked = { id: "m1", sender_id: null, anonymous: true };
  const poster = { role: "poster", hidden: true, revealedAt: null, target: null };
  const asker = { role: "asker", hidden: true, revealedAt: null, target: null };
  assert.equal(asSeenBy(masked, "ann", poster).sender_id, "ann");
  assert.equal(asSeenBy(masked, "cara", asker).sender_id, null);
  assert.equal(asSeenBy(masked, "cara", null).sender_id, null);
  const theirs = { id: "m2", sender_id: "cara", anonymous: false };
  assert.equal(asSeenBy(theirs, "ann", poster), theirs);
});

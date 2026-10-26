// Unit tests for selling and editing an item with or without a video (src/queries/items.ts, src/schemas). Run: npm run test:shared
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
const { createItem, updateItem } = await import("../src/queries/items.ts");
const { itemSchema } = await import("../src/schemas/index.ts");

/** A client that records the row it is asked to write. */
function recorder() {
  const seen = {};
  const chain = { select: () => chain, single: async () => ({ data: seen.row, error: null }), eq: () => chain };
  return {
    seen,
    from: (table) => ({
      insert: (row) => ((seen.table = table), (seen.op = "insert"), (seen.row = row), chain),
      update: (row) => ((seen.table = table), (seen.op = "update"), (seen.row = row), chain),
    }),
  };
}
const base = { title: "Desk lamp", description: "Works fine, warm white bulb included", price: "12", currency: "USD", category: "decor", condition: "good", images: ["https://example.com/a.jpg"], imageMeta: [] };
const video = { media_id: "11111111-1111-4111-8111-111111111111", playback_id: "pb1", poster_url: null, width: 1080, height: 1920, duration_seconds: 9 };

test("an item with photos only writes no videos column (a database without migration 41 still takes it)", async () => {
  const input = itemSchema.parse(base);
  assert.deepEqual(input.videos, []);
  const db = recorder();
  await createItem(db, "seller-1", input);
  assert.equal(db.seen.table, "items");
  assert.equal("videos" in db.seen.row, false);
  assert.equal(db.seen.row.seller_id, "seller-1");
});

test("an item with one video writes it", async () => {
  const input = itemSchema.parse({ ...base, videos: [JSON.stringify(video)] });
  const db = recorder();
  await createItem(db, "seller-1", input);
  assert.deepEqual(db.seen.row.videos, [video]);
});

test("an edit without the field (the web's form) leaves the item's video alone", async () => {
  const input = itemSchema.parse(base);
  const db = recorder();
  await updateItem(db, "item-1", input);
  assert.equal(db.seen.op, "update");
  assert.equal("videos" in db.seen.row, false);
});

test("a second video is refused", () => {
  const parsed = itemSchema.safeParse({ ...base, videos: [JSON.stringify(video), JSON.stringify({ ...video, playback_id: "pb2" })] });
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /One video per item/);
});

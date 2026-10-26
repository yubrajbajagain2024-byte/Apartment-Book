// Migration 41 (videos on Marketplace items) against PGlite: a seller adds one video and has_video follows it, a second
// video or a non-list is refused, nobody else can change it, the migration re-runs cleanly, and its rollback refuses
// while an item has a video and undoes it otherwise.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261103000000_item_videos.sql";
const ROLLBACK = "rollbacks/20261103000000_item_videos.down.sql";
const clip = (n) => `{"media_id":"00000000-0000-4000-8000-00000000000${n}","playback_id":"pb${n}","poster_url":null,"width":1080,"height":1920,"duration_seconds":9}`;
const ONE = `'[${clip(1)}]'::jsonb`;
const TWO = `'[${clip(1)},${clip(2)}]'::jsonb`;

const { db, mk, as } = await boot();
const A = await mk("ann@txstate.edu", "Ann");
const B = await mk("ben@txstate.edu", "Ben");
const sell = (videos) => as(A, () => db.query(`insert into public.items (seller_id, title, description, price, category, images, videos) values ($1, 'Desk lamp', 'Works fine, bulb included', 12, 'decor', array['https://example.com/a.jpg'], ${videos}) returning id, has_video`, [A]));

await expectOk("an existing-style item (no video given) has an empty list and no has_video", async () => {
  const r = (await as(A, () => db.query("insert into public.items (seller_id, title, description, price, category) values ($1, 'Chair', 'Sturdy wooden chair', 10, 'furniture') returning videos, has_video", [A]))).rows[0];
  if (JSON.stringify(r.videos) !== "[]" || r.has_video !== false) throw new Error(JSON.stringify(r));
});
const item = await expectOk("a seller adds one video: has_video is set", async () => {
  const r = (await sell(ONE)).rows[0];
  if (r.has_video !== true) throw new Error(JSON.stringify(r));
  return r.id;
});
await expectError("two videos are refused", () => sell(TWO), "items_videos_shape");
await expectError("a video list that is not a list is refused", () => sell(`'{"playback_id":"pb"}'::jsonb`), "items_videos_shape");
await expectOk("removing the video clears has_video", async () => {
  await as(A, () => db.query("update public.items set videos = '[]'::jsonb where id = $1", [item]));
  const r = (await db.query("select has_video from public.items where id = $1", [item])).rows[0];
  if (r.has_video !== false) throw new Error(JSON.stringify(r));
  await as(A, () => db.query(`update public.items set videos = ${ONE} where id = $1`, [item]));
});
await expectOk("someone else cannot change the item's video", async () => {
  await as(B, () => db.query("update public.items set videos = '[]'::jsonb where id = $1", [item]));
  const r = (await db.query("select jsonb_array_length(videos) as n from public.items where id = $1", [item])).rows[0];
  if (r.n !== 1) throw new Error(`videos now ${r.n}`);
});
await expectOk("anyone signed in can read an item's video", async () => {
  const r = (await as(B, () => db.query("select videos->0->>'playback_id' as pb from public.items where id = $1", [item]))).rows[0];
  if (r?.pb !== "pb1") throw new Error(JSON.stringify(r));
});
await expectOk("the migration re-runs cleanly", async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read(MIGRATION));
});
await expectError("the rollback refuses while an item has a video", () => db.exec(read(ROLLBACK)), "items with videos exist");
await expectOk("with no videos left, the rollback removes the columns and the trigger", async () => {
  await db.query("update public.items set videos = '[]'::jsonb");
  await db.exec(read(ROLLBACK));
  const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name in ('videos', 'has_video')")).rows;
  const trig = (await db.query("select 1 from pg_trigger where tgname = 'items_set_has_video'")).rows;
  if (cols.length || trig.length) throw new Error(JSON.stringify({ cols, trig }));
});
await expectOk("and the migration applies again after it", async () => {
  await db.exec(read(MIGRATION));
  const r = (await sell(ONE)).rows[0];
  if (r.has_video !== true) throw new Error(JSON.stringify(r));
});
done("MIGRATION-41 ITEM VIDEOS");

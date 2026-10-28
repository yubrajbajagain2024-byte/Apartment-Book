// Migration 55 (a video's processing details come from the server only) against PGlite: a signed-in session's insert
// starts as 'uploading' with no provider details, its updates leave them as they are; the server (the service role)
// writes them; 30 new videos a day per person; a ready video longer than 10 minutes is stored as failed; deleting one's
// own video still works; and the rollback. Also on production's migration order (boot({ live: true })).
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261109000000_media_server_fields.sql";
const ROLLBACK = "rollbacks/20261109000000_media_server_fields.down.sql";

for (const live of [false, true]) {
  const label = live ? "production order: " : "";
  const { db, mk, as, asService } = await boot({ live });
  const one = async (p) => (await p).rows[0];
  const ben = await mk(`ben${live ? 1 : 0}@txstate.edu`, "Ben Brooks");
  const cat = await mk(`cat${live ? 1 : 0}@txstate.edu`, "Cat Cruz");
  const insert = (who, fields) => as(who, () => one(db.query(
    "insert into public.media (owner_id, status, provider_upload_id, provider_asset_id, playback_id, width, height, duration_seconds, poster_url, size_bytes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *",
    [who, fields.status ?? "uploading", fields.upload ?? null, fields.asset ?? null, fields.playback ?? null, fields.width ?? null, fields.height ?? null, fields.seconds ?? null, fields.poster ?? null, fields.size ?? 1000],
  )));
  let video;
  await expectOk(`${label}a session's insert starts uploading, with none of the provider's details whatever it sends`, async () => {
    video = await insert(ben, { status: "ready", upload: "up-1", asset: "as-1", playback: "pb-someone-elses", width: 1080, height: 1920, seconds: 12, poster: "https://evil.example/p.jpg" });
    const keys = ["provider_upload_id", "provider_asset_id", "playback_id", "width", "height", "duration_seconds", "poster_url"];
    if (video.status !== "uploading" || keys.some((k) => video[k] !== null) || Number(video.size_bytes) !== 1000) throw new Error(JSON.stringify(video));
  });
  await expectOk(`${label}nor do its updates change them`, async () => {
    await as(ben, () => db.query("update public.media set status = 'ready', playback_id = 'pb-x', width = 1080, height = 1920, duration_seconds = 5, provider_upload_id = 'up-x', size_bytes = 1 where id = $1", [video.id]));
    const r = await one(db.query("select status, playback_id, width, provider_upload_id, size_bytes from public.media where id = $1", [video.id]));
    if (r.status !== "uploading" || r.playback_id !== null || r.width !== null || r.provider_upload_id !== null || Number(r.size_bytes) !== 1000) throw new Error(JSON.stringify(r));
  });
  await expectOk(`${label}the server (service role) writes them`, async () => {
    await asService(() => db.query("update public.media set provider_upload_id = 'up-1' where id = $1", [video.id]));
    await asService(() => db.query("update public.media set status = 'ready', provider_asset_id = 'as-1', playback_id = 'pb-1', width = 1080, height = 1920, duration_seconds = 42 where id = $1", [video.id]));
    const r = await one(db.query("select status, playback_id, width, height, duration_seconds from public.media where id = $1", [video.id]));
    if (r.status !== "ready" || r.playback_id !== "pb-1" || r.width !== 1080 || r.height !== 1920) throw new Error(JSON.stringify(r));
  });
  await expectOk(`${label}a ready video over 10 minutes is stored as failed, with the reason, whoever writes it`, async () => {
    const long = await insert(ben, {});
    await asService(() => db.query("update public.media set status = 'ready', playback_id = 'pb-long', duration_seconds = 601 where id = $1", [long.id]));
    const r = await one(db.query("select status, error from public.media where id = $1", [long.id]));
    if (r.status !== "failed" || !r.error.includes("10 minutes")) throw new Error(JSON.stringify(r));
  });
  await expectOk(`${label}another person's video is not theirs to touch; the owner still deletes their own`, async () => {
    const r = await as(cat, () => db.query("update public.media set original_path = 'x' where id = $1 returning id", [video.id]));
    if (r.rows.length) throw new Error("cat changed ben's video");
    const mine = await insert(cat, {});
    const d = await as(cat, () => db.query("delete from public.media where id = $1 returning id", [mine.id]));
    if (d.rows.length !== 1) throw new Error("could not delete own video");
  });
  await expectOk(`${label}reading is as before (migration 11): the owner reads their video, nobody else does`, async () => {
    const mine = await as(ben, () => db.query("select id from public.media where id = $1", [video.id]));
    const theirs = await as(cat, () => db.query("select id from public.media where id = $1", [video.id]));
    if (mine.rows.length !== 1 || theirs.rows.length !== 0) throw new Error(`${mine.rows.length} / ${theirs.rows.length}`);
  });
  await expectError(`${label}30 new videos a day per person`, async () => {
    for (let i = 0; i < 31; i++) await insert(cat, {});
  }, "30 videos today");
  await expectOk(`${label}the migration re-runs cleanly`, () => db.exec(read(MIGRATION)));
  await expectOk(`${label}the rollback puts media back as it was: a session's update goes through again`, async () => {
    await db.exec(read(ROLLBACK));
    await as(ben, () => db.query("update public.media set width = 7 where id = $1", [video.id]));
    if ((await one(db.query("select width from public.media where id = $1", [video.id]))).width !== 7) throw new Error("still kept");
    await db.exec(read(MIGRATION));
  });
  await db.close();
}

done("MIGRATION-55 MEDIA SERVER FIELDS");

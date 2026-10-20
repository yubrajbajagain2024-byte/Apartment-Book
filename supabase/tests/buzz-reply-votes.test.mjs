import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon, asService } = await boot();
await expectOk("the Home-feed migrations re-run cleanly, in order", async () => {
  for (const f of ["20260920000000_home_feed.sql", "20260921000000_buzz_storage_folder.sql", "20260922000000_buzz_reply_votes.sql"]) await db.exec(read(`migrations/${f}`));
});
// Re-running them brought back the old Buzz functions (buzz_comment_vote among them): migration 30 (Buzz v2) replaces
// them again. A reply is voted on with buzz_v2_vote(reply id) now.
await db.exec(read("migrations/20261021000100_buzz_v2.sql"));
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
for (const u of [A, B, C]) {
  await db.query("update public.profiles set created_at = now() - interval '30 days' where id = $1", [u]);
  await as(u, () => db.query("select public.buzz_v2_accept_gate('2026-10-21')"));
}
const one = async (p) => (await p).rows[0];
const thread = (await asService(() => one(db.query("select public.buzz_v2_create($1, $2::jsonb) as r", [A, JSON.stringify({ title: "Summer class fees?", text: "", scope: "global" })])))).r.id;
const reply = (uid, body, parent = null, status = "active") =>
  asService(() => one(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, $4) as r", [uid, thread, JSON.stringify(parent ? { text: body, parentId: parent } : { text: body }), status]))).then((r) => r.r.id);
const r1 = await reply(B, "You pay the fees either way."), r2 = await reply(C, "Try community college for the basics."), r3 = await reply(A, "Thanks both", r2);
const list = (uid) => as(uid, () => one(db.query("select public.buzz_v2_replies($1) as r", [thread]))).then((r) => r.r.items);
const vote = (uid, id, val) => as(uid, () => one(db.query("select public.buzz_v2_vote($1,$2) as r", [id, val]))).then((r) => r.r);
await expectOk("replies list carries score and my vote, and still no identities", async () => {
  const rows = await list(C);
  if (rows.length !== 3 || rows.some((r) => r.score !== 0 || r.myVote !== 0)) throw new Error(JSON.stringify(rows));
  for (const r of rows) if (Object.keys(r).some((k) => /author|user|visible|seq/i.test(k)) || [A, B, C].some((u) => JSON.stringify(r).includes(u))) throw new Error("leak " + JSON.stringify(r));
  if (rows.find((r) => r.id === r3).parentId !== r2) throw new Error("nesting lost");
});
await expectError("signed-out visitors cannot read replies", () => asAnon(() => db.query("select public.buzz_v2_replies($1)", [thread])), "permission denied");
await expectOk("vote on a reply: up, switch, clear; one vote per person; myVote is per viewer", async () => {
  let r = await vote(A, r1, 1); if (r.score !== 1 || r.myVote !== 1) throw new Error("up " + JSON.stringify(r));
  r = await vote(A, r1, 1); if (r.score !== 1) throw new Error("double " + JSON.stringify(r));
  await vote(C, r1, 1); r = await vote(A, r1, -1); if (r.score !== 0 || r.myVote !== -1) throw new Error("switch " + JSON.stringify(r));
  r = await vote(A, r1, 0); if (r.score !== 1 || r.myVote !== 0) throw new Error("clear " + JSON.stringify(r));
  const mine = (await list(C)).find((x) => x.id === r1), theirs = (await list(B)).find((x) => x.id === r1);
  if (mine.myVote !== 1 || theirs.myVote !== 0 || mine.score !== 1) throw new Error(JSON.stringify({ mine, theirs }));
});
await expectError("signed-out visitors cannot vote", () => asAnon(() => db.query("select public.buzz_v2_vote($1,1)", [r1])), "permission denied");
await expectError("invalid values are rejected", () => as(A, () => db.query("select public.buzz_v2_vote($1,7)", [r1])), "buzz:validation_failed:");
await expectError("nobody votes on their own reply", () => as(B, () => db.query("select public.buzz_v2_vote($1,1)", [r1])), "buzz:own_item:");
await expectError("the old reply-vote function is gone for old builds", () => as(A, () => db.query("select * from public.buzz_comment_vote($1,1)", [r1])), "buzz:update_required:");
await expectError("the votes table is closed to the API", () => as(A, () => db.query("select * from public.buzz_comment_votes")), "permission denied");
await expectError("the votes table cannot be written directly", () => as(A, () => db.query("insert into public.buzz_comment_votes (comment_id, user_id, value) values ($1,$2,1)", [r2, A])), "permission denied");
await expectOk("no voting on replies you cannot see (unpublished, held for review); a reply you folded away stays votable", async () => {
  const hiddenReply = await reply(B, "not published yet"); await db.query("update public.buzz_comments set visible_at = now() + interval '20 minutes' where id=$1", [hiddenReply]);
  let threw = false; try { await vote(C, hiddenReply, 1); } catch (e) { threw = /^buzz:not_found:/.test(e.message); } if (!threw) throw new Error("voted on an unpublished reply");
  const held = await reply(B, "held for review", null, "held");
  threw = false; try { await vote(C, held, 1); } catch (e) { threw = /^buzz:not_found:/.test(e.message); } if (!threw) throw new Error("voted on a held reply");
  await as(A, () => db.query("select public.buzz_v2_hide_author($1)", [r2]));
  if (!(await list(A)).find((x) => x.id === r2).collapsed) throw new Error("not folded");
  if ((await vote(A, r2, 1)).myVote !== 1) throw new Error("a folded reply is not votable");
});
await expectOk("a deleted reply can no longer be voted on; a deleted account's votes go with it", async () => {
  await as(B, () => db.query("select public.buzz_v2_delete($1)", [r1]));
  let threw = false; try { await vote(C, r1, -1); } catch (e) { threw = /^buzz:not_found:/.test(e.message); } if (!threw) throw new Error("voted on a deleted reply");
  await db.query("delete from auth.users where id=$1", [C]);
  if (Number((await one(db.query("select count(*) n from public.buzz_comment_votes where user_id=$1", [C]))).n) !== 0) throw new Error("orphan votes");
});
done("MIGRATION-13");

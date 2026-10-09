import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the Home-feed migrations re-run cleanly, in order", async () => {
  for (const f of ["20260920000000_home_feed.sql", "20260921000000_buzz_storage_folder.sql", "20260922000000_buzz_reply_votes.sql"]) await db.exec(read(`migrations/${f}`));
});
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const A = await mk("a@txstate.edu", "Alice"), B = await mk("b@txstate.edu", "Bob"), C = await mk("c@txstate.edu", "Carol");
const one = async (p) => (await p).rows[0];
const thread = (await as(A, () => one(db.query("select public.buzz_create(p_topic => 'question', p_title => 'Summer class fees?') as id")))).id;
const reply = (uid, body, parent = null) => as(uid, () => one(db.query("select public.buzz_reply($1,$2,$3) as id", [thread, body, parent]))).then((r) => r.id);
const r1 = await reply(B, "You pay the fees either way."), r2 = await reply(C, "Try community college for the basics."), r3 = await reply(A, "Thanks both", r2);
const list = (uid) => (uid ? as(uid, () => db.query("select * from public.buzz_comments_list($1)", [thread])) : asAnon(() => db.query("select * from public.buzz_comments_list($1)", [thread]))).then((r) => r.rows);
await expectOk("replies list carries score and my vote, and still no identities", async () => {
  const rows = await list(null);
  if (rows.length !== 3 || rows.some((r) => r.score !== 0 || r.my_vote !== 0)) throw new Error(JSON.stringify(rows));
  for (const r of rows) if (Object.keys(r).some((k) => /author|user|visible|seq/.test(k)) || Object.values(r).some((v) => [A, B, C].includes(v))) throw new Error("leak " + JSON.stringify(r));
  if (rows.find((r) => r.id === r3).parent_id !== r2) throw new Error("nesting lost");
});
await expectOk("vote on a reply: up, switch, clear; one vote per person; my_vote is per viewer", async () => {
  const v = (uid, id, val) => as(uid, () => one(db.query("select * from public.buzz_comment_vote($1,$2)", [id, val])));
  let r = await v(A, r1, 1); if (r.score !== 1 || r.my_vote !== 1) throw new Error("up " + JSON.stringify(r));
  r = await v(A, r1, 1); if (r.score !== 1) throw new Error("double " + JSON.stringify(r));
  await v(C, r1, 1); r = await v(A, r1, -1); if (r.score !== 0 || r.my_vote !== -1) throw new Error("switch " + JSON.stringify(r));
  r = await v(A, r1, 0); if (r.score !== 1 || r.my_vote !== 0) throw new Error("clear " + JSON.stringify(r));
  const mine = (await list(C)).find((x) => x.id === r1), theirs = (await list(B)).find((x) => x.id === r1);
  if (mine.my_vote !== 1 || theirs.my_vote !== 0 || mine.score !== 1) throw new Error(JSON.stringify({ mine, theirs }));
});
await expectError("signed-out visitors cannot vote", () => asAnon(() => db.query("select * from public.buzz_comment_vote($1,1)", [r1])), "");
await expectError("invalid values are rejected", () => as(A, () => db.query("select * from public.buzz_comment_vote($1,7)", [r1])), "Invalid vote");
await expectError("the votes table is closed to the API", () => as(A, () => db.query("select * from public.buzz_comment_votes")), "permission denied");
await expectError("the votes table cannot be written directly", () => as(A, () => db.query("insert into public.buzz_comment_votes (comment_id, user_id, value) values ($1,$2,1)", [r2, A])), "permission denied");
await expectOk("no voting on replies you cannot see (unpublished, or hidden by you)", async () => {
  const hiddenReply = await reply(B, "not published yet"); await db.query("update public.buzz_comments set visible_at = now() + interval '20 minutes' where id=$1", [hiddenReply]);
  let threw = false; try { await as(C, () => db.query("select * from public.buzz_comment_vote($1,1)", [hiddenReply])); } catch (e) { threw = /Reply not found/.test(e.message); } if (!threw) throw new Error("voted on an unpublished reply");
  await as(B, () => db.query("select * from public.buzz_comment_vote($1,1)", [hiddenReply])); // its writer can
  await as(A, () => db.query("select public.buzz_mute(p_comment_id => $1)", [r2]));
  threw = false; try { await as(A, () => db.query("select * from public.buzz_comment_vote($1,1)", [r2])); } catch (e) { threw = /Reply not found/.test(e.message); } if (!threw) throw new Error("voted on a hidden reply");
});
await expectOk("votes disappear with the reply", async () => {
  await as(B, () => db.query("select public.buzz_delete_comment($1)", [r1]));
  if (Number((await one(db.query("select count(*) n from public.buzz_comment_votes where comment_id=$1", [r1]))).n) !== 0) throw new Error("orphan votes");
});
done("MIGRATION-13");

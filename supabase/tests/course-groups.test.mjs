// Migrations 24 and 25 (course chats) against PGlite: a class with a section creates or joins its section's chat,
// removing it leaves, an empty chat goes, course chats cannot be renamed or hand-filled, nobody can forge their way
// in, and the rollover warns a week before a semester ends and deletes the chats after it, keeping the classes as
// the profile's history.
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
const { db, mk, as, asAnon } = await boot();
await expectOk("the course-chat migrations re-run cleanly", async () => {
  for (const f of ["20261017000000_course_groups.sql", "20261018000000_course_groups_rollover_params.sql"]) await db.exec(read(`migrations/${f}`));
});
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const count = async (sql, params = []) => Number((await one(db.query(sql, params))).n);

const uni = (await one(db.query("select id from public.universities order by name limit 1"))).id;
const A = await mk("a@txstate.edu", "Ada Adams"), B = await mk("b@txstate.edu", "Bo Bright"), C = await mk("c@txstate.edu", "Cy Cole"), D = await mk("d@txstate.edu", "Di Dale");
for (const u of [A, B, C]) await db.query("update public.profiles set university_id = $2 where id = $1", [u, uni]);
await db.query("update public.profiles set university_id = null where id = $1", [D]);

const T = "Fall 2099";
const addClass = (uid, fields) =>
  as(uid, () => one(db.query(
    "insert into public.profile_classes (user_id, term, code, section, meetings, location, course_group_id) values ($1,$2,$3,$4,$5,$6,$7) returning *",
    [uid, fields.term ?? T, fields.code, fields.section ?? null, JSON.stringify(fields.meetings ?? []), fields.location ?? null, fields.course_group_id ?? null],
  )));
const members = async (conversationId) => (await rows(db.query("select user_id from public.conversation_members where conversation_id = $1", [conversationId]))).map((r) => r.user_id);
const groupOf = (id) => one(db.query("select * from public.course_groups where id = $1", [id]));
const notice = (uid, dedupe) => one(db.query("select title, body, link from public.notifications where user_id = $1 and data ->> 'dedupe' = $2", [uid, dedupe]));

// --- creating and joining ------------------------------------------------------
let a1, g1;
await expectOk("the first student to list a section gets its chat: named after the class, with them in it, and a notice", async () => {
  a1 = await addClass(A, { code: "cs3358", section: " 001 ", meetings: [{ days: ["mon", "wed", "fri"], start: "10:00", end: "10:50" }], location: "  Derrick Hall   240 " });
  if (a1.code !== "CS 3358" || a1.section !== "001" || a1.location !== "Derrick Hall 240") throw new Error("not tidied: " + JSON.stringify([a1.code, a1.section, a1.location]));
  if (!a1.course_group_id) throw new Error("no course group");
  g1 = await groupOf(a1.course_group_id);
  if (g1.university_id !== uni || g1.term !== T || g1.code !== "CS 3358" || g1.section !== "001") throw new Error("group: " + JSON.stringify(g1));
  const conv = await one(db.query("select type, name, created_by from public.conversations where id = $1", [g1.conversation_id]));
  if (conv.type !== "group" || conv.name !== "CS 3358-001 · Fall 2099" || conv.created_by !== A) throw new Error("conversation: " + JSON.stringify(conv));
  if (!(await members(g1.conversation_id)).includes(A)) throw new Error("A is not a member");
  const n = await notice(A, `course_join:${g1.id}`);
  if (!n || n.link !== `/messages/${g1.conversation_id}` || !n.title.includes("CS 3358-001")) throw new Error("notice: " + JSON.stringify(n));
});
let b1;
await expectOk("the next student listing the same section joins the same chat", async () => {
  b1 = await addClass(B, { code: "CS 3358", section: "001" });
  if (b1.course_group_id !== g1.id) throw new Error("B got another group");
  const m = await members(g1.conversation_id);
  if (!(m.includes(A) && m.includes(B) && m.length === 2)) throw new Error("members: " + m.join(","));
});
await expectOk("another section is another chat; a student without a university, or a semester already over, gets none", async () => {
  const c1 = await addClass(C, { code: "CS 3358", section: "002" });
  if (!c1.course_group_id || c1.course_group_id === g1.id) throw new Error("C's group: " + c1.course_group_id);
  const d1 = await addClass(D, { code: "CS 3358", section: "001" });
  if (d1.course_group_id !== null) throw new Error("D got a group without a university");
  const old = await addClass(A, { code: "HIST 1310", section: "001", term: "Spring 2001" });
  if (old.course_group_id !== null) throw new Error("a past semester got a group");
  if ((await count("select count(*)::int as n from public.course_groups where term = 'Spring 2001'")) !== 0) throw new Error("a group for a past semester exists");
});

// --- what nobody may do ----------------------------------------------------------
await expectError("a course chat cannot be renamed", () => as(A, () => db.query("update public.conversations set name = 'Renamed' where id = $1", [g1.conversation_id])), "named after their class");
await expectError("a course chat cannot be hand-filled", () => as(A, () => db.query("select public.add_group_members($1, array[$2]::uuid[])", [g1.conversation_id, C])), "fill themselves");
await expectError("course group rows cannot be written by students", () => as(A, () => db.query("insert into public.course_groups (university_id, term, code, section, conversation_id) values ($1, $2, 'X 1', '1', $3)", [uni, T, g1.conversation_id])));
await expectError("the rollover cannot be run by students", () => as(A, () => db.query("select public.course_groups_rollover()")), "permission denied");
await expectOk("a forged course_group_id on a class is ignored: the trigger decides", async () => {
  const c2 = await addClass(C, { code: "MATH 3398", section: "001", course_group_id: g1.id });
  if (c2.course_group_id === g1.id) throw new Error("the forged id stuck");
  if (!c2.course_group_id) throw new Error("no group of its own");
  if ((await members(g1.conversation_id)).includes(C)) throw new Error("C got into A's chat");
});
await expectOk("only members can read a course group row; strangers and visitors see nothing", async () => {
  const seen = await as(C, () => rows(db.query("select id from public.course_groups where id = $1", [g1.id])));
  if (seen.length !== 0) throw new Error("C can read A's group");
  const anon = await asAnon(() => rows(db.query("select id from public.course_groups where id = $1", [g1.id])));
  if (anon.length !== 0) throw new Error("anon can read a group");
  const mine = await as(A, () => rows(db.query("select id from public.course_groups where id = $1", [g1.id])));
  if (mine.length !== 1) throw new Error("A cannot read their own group");
});
await expectError("bad meeting times are refused by the database", () => addClass(B, { code: "ENG 1310", section: "001", meetings: [{ days: ["mon"], start: "11:00", end: "10:00" }] }), "profile_classes_meetings_check");
await expectError("a bad section is refused by the database", () => addClass(B, { code: "ENG 1310", section: "00 1" }), "profile_classes_section_check");

// --- leaving ----------------------------------------------------------------------------
await expectOk("removing the class leaves the chat; the last one out takes the chat with them", async () => {
  await as(A, () => db.query("delete from public.profile_classes where id = $1", [a1.id]));
  const m = await members(g1.conversation_id);
  if (m.includes(A) || !m.includes(B)) throw new Error("after A left: " + m.join(","));
  await as(B, () => db.query("delete from public.profile_classes where id = $1", [b1.id]));
  if ((await count("select count(*)::int as n from public.conversations where id = $1", [g1.conversation_id])) !== 0) throw new Error("the empty chat is still there");
  if ((await count("select count(*)::int as n from public.course_groups where id = $1", [g1.id])) !== 0) throw new Error("the group row is still there");
});
await expectOk("leaving the chat by hand also prunes it once empty; changing the section moves the student over", async () => {
  const a2 = await addClass(A, { code: "CS 3358", section: "001" });
  const g2 = await groupOf(a2.course_group_id);
  await as(A, () => db.query("delete from public.conversation_members where conversation_id = $1 and user_id = $2", [g2.conversation_id, A]));
  if ((await count("select count(*)::int as n from public.conversations where id = $1", [g2.conversation_id])) !== 0) throw new Error("a chat left by hand was not pruned");
  const a3 = await addClass(A, { code: "CS 2308", section: "001" });
  const before = await groupOf(a3.course_group_id);
  const moved = await as(A, () => one(db.query("update public.profile_classes set section = '004' where id = $1 returning course_group_id", [a3.id])));
  if (moved.course_group_id === before.id || !moved.course_group_id) throw new Error("the section change did not move the student");
  if ((await count("select count(*)::int as n from public.course_groups where id = $1", [before.id])) !== 0) throw new Error("the old chat lingered");
  const after = await groupOf(moved.course_group_id);
  if (after.section !== "004" || !(await members(after.conversation_id)).includes(A)) throw new Error("the new chat is wrong");
});

// --- the end of a semester -----------------------------------------------------------
let gf, gs, af, bf, as1;
await expectOk("a week before the semester ends every member is told once; another semester's chat is left alone", async () => {
  af = await addClass(A, { code: "BIO 1330", section: "001" });
  bf = await addClass(B, { code: "BIO 1330", section: "001" });
  gf = await groupOf(af.course_group_id);
  as1 = await addClass(A, { code: "BIO 1331", section: "001", term: "Spring 2100" });
  gs = await groupOf(as1.course_group_id);
  await db.query("select public.course_groups_rollover('2099-12-26'::date, $1)", [T]);
  for (const u of [A, B]) {
    const n = await notice(u, `course_end:${gf.id}`);
    if (!n || !n.title.includes("chat ends December 31") || n.link !== `/messages/${gf.conversation_id}`) throw new Error("reminder for " + u + ": " + JSON.stringify(n));
  }
  if (!(await groupOf(gf.id)).reminded_at) throw new Error("reminded_at not set");
  if (await notice(A, `course_end:${gs.id}`)) throw new Error("the other semester got a reminder");
  await db.query("select public.course_groups_rollover('2099-12-27'::date, $1)", [T]);
  if ((await count("select count(*)::int as n from public.notifications where user_id = $1 and data ->> 'dedupe' = $2", [A, `course_end:${gf.id}`])) !== 1) throw new Error("reminded twice");
});
await expectOk("the day after it ends, members are told, the chats go, and the classes stay as history with no chat", async () => {
  await db.query("select public.course_groups_rollover('2100-01-01'::date, $1)", [T]);
  const n = await notice(B, `course_term_over:${T}`);
  if (!n || !n.title.includes("Fall 2099 course chats have ended") || !n.body.includes("Spring 2100") || n.link !== `/profile/${B}`) throw new Error("end notice: " + JSON.stringify(n));
  if ((await count("select count(*)::int as n from public.conversations where id = $1", [gf.conversation_id])) !== 0) throw new Error("the chat survived the semester");
  if ((await count("select count(*)::int as n from public.conversation_members where conversation_id = $1", [gf.conversation_id])) !== 0) throw new Error("members survived");
  if ((await count("select count(*)::int as n from public.course_groups where term = $1", [T])) !== 0) throw new Error("groups survived");
  const kept = await one(db.query("select code, course_group_id from public.profile_classes where id = $1", [af.id]));
  if (!kept || kept.course_group_id !== null) throw new Error("the class row did not stay as history without a chat: " + JSON.stringify(kept));
  if ((await count("select count(*)::int as n from public.course_groups where id = $1", [gs.id])) !== 1) throw new Error("the next semester's chat was touched");
});
await expectOk("without a term the rollover covers every semester whose day has come, and the daily call still works bare", async () => {
  await db.query("select public.course_groups_rollover('2100-06-01'::date)");
  if ((await count("select count(*)::int as n from public.course_groups where id = $1", [gs.id])) !== 0) throw new Error("Spring 2100 was not rolled over");
  await db.query("select public.course_groups_rollover()");
});
done("MIGRATION-24/25 COURSE CHATS");

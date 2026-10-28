// One thread per day's prompt (20261108000200_buzz_prompt_threads.sql) against PGlite, in production's order: the
// first answer makes today's prompt thread on a feed (one per campus, one on Global), owned by no one, titled with the
// prompt; the answers are its replies; meta says which thread is today's and how many answers it has. A prompt answered
// on its own buzz carries the prompt as its title (an answer posted before this file only where it had none: a title
// its author wrote stays) and points at its prompt thread. Only signed-in people who may post can make one; its helpers stay internal. buzz_v2.sql runs again
// over the file, the rollback keeps the threads as ordinary buzzes, and the migration applies again.
import { boot, read, expectOk, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION as VERSION } from "../../packages/shared/src/buzz/constants.ts";

const MIGRATION = "migrations/20261108000200_buzz_prompt_threads.sql";
const ROLLBACK = "rollbacks/20261108000200_buzz_prompt_threads.down.sql";
const check = (cond, message) => { if (!cond) throw new Error(message); };

const { db, mk, as, asAnon, asService } = await boot({ live: true });
const one = async (p) => (await p).rows[0];
const val = async (p) => {
  const row = (await p).rows[0];
  return row ? row[Object.keys(row)[0]] : undefined;
};
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const UT = (await one(db.query("insert into public.universities (name, email_domain) values ('The University of Texas at Austin', 'utexas.edu') returning id"))).id;
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, min_campus_size = 1");

const user = async (email, name, { uni = TX, gate = true } = {}) => {
  const uid = await mk(email, name);
  await db.query("update public.profiles set university_id = $2, created_at = now() - interval '30 days' where id = $1", [uid, uni]);
  if (gate) await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [VERSION]));
  return uid;
};
const call = (uid, fn, args) => as(uid, () => val(db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)));
const fails = async (fn, code) => {
  try {
    await fn();
  } catch (e) {
    if (String(e.message).startsWith(`buzz:${code}:`) || (code === "denied" && /permission denied/.test(String(e.message)))) return;
    throw new Error(`expected ${code}, got ${e.message}`);
  }
  throw new Error(`expected ${code}, got no error`);
};
const unrated = (uid) => db.query("delete from public.buzz_rate_log where user_id = $1", [uid]);
const create = async (uid, input) => {
  await unrated(uid);
  return asService(() => val(db.query("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null) as r", [uid, JSON.stringify(input)])));
};
const reply = async (uid, thread, text, parentId = null) => {
  await unrated(uid);
  return asService(() => val(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null) as r", [uid, thread, JSON.stringify(parentId ? { text, parentId } : { text })])));
};
const meta = (uid, scope = "campus") => call(uid, "buzz_v2_meta", [scope]);
const feedItem = async (uid, id, scope = "campus") => (await call(uid, "buzz_v2_feed", [scope, "new", "day", null, 50, 0, null])).items.find((b) => b.id === id);

const ANA = await user("ana@txstate.edu", "Ana Alvarez");
const BO = await user("bo@txstate.edu", "Bo Brooks");
const CY = await user("cy@utexas.edu", "Cy Chen", { uni: UT });
const NOCAMPUS = await user("nomad@txstate.edu", "Noa Nomad", { uni: null });
const UNGATED = await user("new@txstate.edu", "Nell Newcomer", { gate: false });
const today = (await one(db.query("select * from public.buzz_v2_today_prompt()")));

let campusThread, globalThread;

await expectOk("today's prompt is the one meta has always shown, and nothing is made before the first answer", async () => {
  const m = await meta(ANA);
  check(m.prompt.id === today.prompt_id && m.prompt.text === today.prompt_text, "meta and buzz_v2_today_prompt agree");
  const legacy = await one(db.query("select p.id from public.buzz_prompts p where p.idx = (floor(extract(epoch from now()) / 86400)::bigint % (select count(*) from public.buzz_prompts))::int"));
  check(legacy.id === today.prompt_id, "the same prompt as the old formula");
  check(m.prompt.threadId === null && m.prompt.answers === 0, `no thread yet: ${JSON.stringify(m.prompt)}`);
  check((await val(db.query("select count(*)::int from public.buzz_prompt_threads"))) === 0, "no thread rows");
});

await expectOk("the first answer makes the campus thread: owned by no one, titled with the prompt; the next answer finds it", async () => {
  campusThread = await call(ANA, "buzz_v2_prompt_thread", [today.prompt_id, "campus"]);
  const row = await one(db.query("select author_id, title, body, scope, university_id, prompt_id, status from public.buzz_posts where id = $1", [campusThread]));
  check(row.author_id === null && row.title === today.prompt_text.slice(0, 100) && row.body === "" && row.scope === "campus" && row.university_id === TX && row.prompt_id === today.prompt_id && row.status === "active", JSON.stringify(row));
  check((await call(BO, "buzz_v2_prompt_thread", [today.prompt_id, "campus"])) === campusThread, "Bo, same campus: the same thread");
  check((await call(ANA, "buzz_v2_prompt_thread", [today.prompt_id, "campus"])) === campusThread, "asked again: the same thread");
  const ut = await call(CY, "buzz_v2_prompt_thread", [today.prompt_id, "campus"]);
  check(ut !== campusThread, "another campus has its own");
  globalThread = await call(ANA, "buzz_v2_prompt_thread", [today.prompt_id, "global"]);
  check(globalThread !== campusThread && (await call(CY, "buzz_v2_prompt_thread", [today.prompt_id, "global"])) === globalThread, "one Global thread for everyone");
  check((await val(db.query("select count(*)::int from public.buzz_prompt_threads"))) === 3, "three threads: two campuses and Global");
});

await expectOk("answers are replies; meta counts them; nobody is OP and nobody gets a notification for an answer to the prompt", async () => {
  const a1 = await reply(ANA, campusThread, "The bench behind the music building");
  const a2 = await reply(BO, campusThread, "Alkek 7th floor at sunset");
  await reply(ANA, campusThread, "Honestly yes", a2.id);
  const t = await call(ANA, "buzz_v2_thread", [campusThread, 50]);
  check(t.replies.items.length === 3 && t.replies.items.every((r) => r.isOp === false), "three answers, no OP");
  const m = await meta(BO);
  check(m.prompt.threadId === campusThread && m.prompt.answers === 3, `meta: ${JSON.stringify(m.prompt)}`);
  check((await meta(CY)).prompt.answers === 0, "the other campus's thread has none");
  check((await meta(ANA, "global")).prompt.threadId === globalThread, "Global meta points at the Global thread");
  const notes = (await db.query("select user_id from public.notifications where type = 'buzz_reply'")).rows.map((r) => r.user_id);
  check(notes.length === 1 && notes[0] === BO, `only Bo, whose answer got a reply, is notified: ${JSON.stringify(notes)}`);
  check(a1.kind === "reply", "the website's reply call answers as usual");
});

await expectOk("in the feed the thread says it is the prompt's; it has no promptThreadId of its own", async () => {
  const b = await feedItem(BO, campusThread);
  check(b && b.isPromptThread === true && b.promptThreadId === null && b.title === today.prompt_text.slice(0, 100) && b.isMine === false, JSON.stringify(b));
  check(b.replyCount === 3, `replyCount ${b.replyCount}`);
});

await expectOk("an answer posted on its own buzz carries the prompt as its title, whatever was sent, and points at its prompt thread", async () => {
  const own = await create(BO, { title: "My own title", text: "Mine is the river at 7am", promptId: today.prompt_id });
  check(own.title === today.prompt_text.slice(0, 100), `title ${own.title}`);
  const b = await feedItem(ANA, own.id);
  check(b.isPromptThread === false && b.promptThreadId === campusThread, JSON.stringify({ isPromptThread: b.isPromptThread, promptThreadId: b.promptThreadId }));
  const onGlobal = await create(BO, { text: "Same answer, for everyone", promptId: today.prompt_id, scope: "global" });
  check((await feedItem(ANA, onGlobal.id, "global")).promptThreadId === globalThread, "a Global answer points at the Global thread");
  await db.query("update public.buzz_posts set title = 'changed later' where id = $1", [own.id]);
  check((await val(db.query("select title from public.buzz_posts where id = $1", [own.id]))) === today.prompt_text.slice(0, 100), "an edit cannot take the prompt away");
  const plain = await create(BO, { title: "Not a prompt answer", text: "Just a buzz" });
  check(plain.title === "Not a prompt answer" && (await feedItem(ANA, plain.id)).promptThreadId === null, "a buzz without a prompt keeps its own title");
});

await expectOk("who may make one: signed in, guidelines accepted, today's prompt, a campus for Campus", async () => {
  await fails(() => call(UNGATED, "buzz_v2_prompt_thread", [today.prompt_id, "campus"]), "buzz_gate_required");
  await fails(() => call(NOCAMPUS, "buzz_v2_prompt_thread", [today.prompt_id, "campus"]), "validation_failed");
  check(typeof (await call(NOCAMPUS, "buzz_v2_prompt_thread", [today.prompt_id, "global"])) === "string", "no campus: Global still works");
  const other = await val(db.query("select id from public.buzz_prompts where id <> $1 limit 1", [today.prompt_id]));
  await fails(() => call(ANA, "buzz_v2_prompt_thread", [other, "campus"]), "prompt_ended");
  await fails(() => call(ANA, "buzz_v2_prompt_thread", [today.prompt_id, "everywhere"]), "validation_failed");
  await fails(() => asAnon(() => db.query("select public.buzz_v2_prompt_thread($1, 'campus')", [today.prompt_id])), "denied");
  for (const fn of ["public.buzz_v2_today_prompt()", "public.buzz_v2_prompt_thread_id(uuid, date, text, uuid)", "public.buzz_v2_prompt_title()", "public.buzz_root_json(public.buzz_posts, uuid, boolean)"]) {
    for (const role of ["anon", "authenticated", "service_role"]) check(!(await val(db.query("select has_function_privilege($1, $2, 'execute') as r", [role, fn]))), `${role} may run ${fn}`);
  }
  check(await val(db.query("select has_function_privilege('authenticated', 'public.buzz_v2_prompt_thread(uuid, text)', 'execute') as r")), "signed-in people may answer in the thread");
  for (const role of ["anon", "authenticated"]) {
    let denied = false;
    try {
      await (role === "anon" ? asAnon : (f) => as(ANA, f))(() => db.query("select * from public.buzz_prompt_threads"));
    } catch (e) {
      denied = /permission denied/.test(String(e.message));
    }
    check(denied, `${role} cannot read the table`);
  }
});

await expectOk("answers posted before this file get the prompt as their title where they have none; a title someone wrote stays", async () => {
  await db.exec(read(ROLLBACK));
  const old = await create(ANA, { text: "an answer from before", promptId: today.prompt_id });
  // buzz_posts.title is never null (20260920000000_home_feed.sql), so "none" is empty or only spaces.
  const spaces = await create(BO, { text: "an answer whose title is blank", promptId: today.prompt_id });
  const typed = await create(ANA, { title: "Sunrise at the river", text: "an answer with a title of its own", promptId: today.prompt_id });
  await db.query("update public.buzz_posts set title = '   ' where id = $1", [spaces.id]);
  check(old.title === "" && typed.title === "Sunrise at the river", "before: no title, and a title of its own");
  await db.exec(read(MIGRATION));
  const title = (id) => val(db.query("select title from public.buzz_posts where id = $1", [id]));
  for (const b of [old, spaces]) check((await title(b.id)) === today.prompt_text.slice(0, 100), `after: the prompt for ${b.text}`);
  check((await title(typed.id)) === "Sunrise at the river", "after: the title its author wrote");
  await db.exec(read(MIGRATION));
  check((await title(typed.id)) === "Sunrise at the river", "and it stays when the file runs again");
  check((await feedItem(ANA, typed.id)).promptThreadId === campusThread, "it still points at its prompt thread");
  check((await meta(ANA)).prompt.threadId === campusThread, "the thread is found again after the rollback and back");
});

await expectOk("it applies again over itself, and 20261103000100_buzz_v2.sql runs again over it", async () => {
  await db.exec(read(MIGRATION));
  await db.exec(read("migrations/20261103000100_buzz_v2.sql"));
  check(!("threadId" in (await meta(ANA)).prompt), "buzz_v2.sql's meta has no threadId");
  await db.exec(read(MIGRATION));
  check((await meta(ANA)).prompt.threadId === campusThread, "and this file brings it back");
});

await expectOk("the rollback drops the table and functions; the threads and their answers stay as ordinary buzzes", async () => {
  await db.exec(read(ROLLBACK));
  check((await val(db.query("select to_regclass('public.buzz_prompt_threads') as r"))) === null, "the table is gone");
  check((await val(db.query("select to_regprocedure('public.buzz_v2_prompt_thread(uuid, text)') as r"))) === null, "the function is gone");
  const t = await call(BO, "buzz_v2_thread", [campusThread, 50]);
  check(t.root.title === today.prompt_text.slice(0, 100) && t.replies.items.length === 3 && !("isPromptThread" in t.root), "the thread and its answers are still there");
  await db.exec(read(MIGRATION));
});

done("BUZZ PROMPT THREADS");

// Buzz v2 and Trust & Safety (migrations 41 and 42) on production's schema: this repo's migrations with the four that
// reached production from outside it (CampConnect Admin's staff, moderation support, dashboard and hardening) where
// they ran. Checks that the two moderation systems work as one: CampConnect Admin's staff list and two-factor rule run
// the website's console, its hide and restore move Buzz items, Buzz removals show in its hidden list, Buzz reports
// reach its report queue, its suspensions stop Buzz writes without changing what Buzz shows, and its permission rule
// (no staff_* helper callable from the API) holds. Usage: node supabase/tests/campconnect-admin-buzz.test.mjs
import { boot, expectOk, expectError, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION } from "../../packages/shared/src/buzz/constants.ts";

const { db, mk, as, asService } = await boot({ live: true });
const MFA = { aal: "aal2" };
const one = async (p) => (await p).rows[0];
const val = async (p) => { const row = (await p).rows[0]; return row ? row[Object.keys(row)[0]] : undefined; };
const check = (cond, message) => { if (!cond) throw new Error(message); };
/** `select <expr>` as a signed-in user (two-factor sign-in unless claims say otherwise). */
const call = (uid, expr, params = [], claims = MFA) => as(uid, () => val(db.query(`select ${expr}`, params)), claims);
const rowsAs = (uid, sql, params = []) => as(uid, async () => (await db.query(sql, params)).rows, MFA);

await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
const person = async (email, name) => {
  const uid = await mk(email, name);
  await db.query("update public.profiles set university_id = $2, created_at = now() - interval '30 days' where id = $1", [uid, TX]);
  await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [BUZZ_GUIDELINES_VERSION]));
  return uid;
};
const OWNER = await person("owner@txstate.edu", "Olivia Owner");
await db.query("select public.admin_bootstrap_owner('owner@txstate.edu')");
const MODR = await person("moderator@txstate.edu", "Mo Derator");
await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'moderator', $2)", [MODR, OWNER]);
const LEGACY = await person("legacy@txstate.edu", "Lee Gacy");
await db.query("insert into public.staff_members (user_id, role) values ($1, 'admin')", [LEGACY]);
const A = await person("alex@txstate.edu", "Alex Author");
const B = await person("blair@txstate.edu", "Blair Replier");
const C = await person("casey@txstate.edu", "Casey Reader");

const clearRates = () => db.query("delete from public.buzz_rate_log");
const create = async (uid, input) => { await clearRates(); return asService(() => val(db.query("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null)", [uid, JSON.stringify(input)]))); };
const reply = async (uid, thread, text) => { await clearRates(); return asService(() => val(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null)", [uid, thread, JSON.stringify({ text })]))); };
const feedIds = async (uid) => (await call(uid, "public.buzz_v2_feed('campus', 'new', 'day', null, 50, 0, null)")).items.map((b) => b.id);
const statusOf = async (table, id) => one(db.query(`select status, hidden_at, hidden_reason, hidden_from_status from public.${table} where id = $1`, [id]));

// --- Staff: one list, one two-factor rule -------------------------------------------------------------------------
await expectOk("staff: CampConnect Admin's owner is an admin in the console, its moderator a moderator", async () => {
  check((await call(OWNER, "public.ts_staff_role()")) === "admin", "owner");
  check((await call(MODR, "public.ts_staff_role()")) === "moderator", "moderator");
});
await expectOk("staff: a staff_members row alone is nobody where CampConnect Admin's list exists", async () => {
  check((await call(LEGACY, "public.ts_staff_role()")) === null, "legacy row still staff");
});
await expectError("staff: the console needs two-factor sign-in", () => call(MODR, "public.console_queue_counts()", [], {}), "ts:mfa_required:");
await expectOk("staff: with it, the console answers", async () => { check((await call(MODR, "public.console_queue_counts()")) !== null, "no counts"); });
await expectError("staff: the console's role changes are refused: staff are managed in CampConnect Admin", () => call(OWNER, "public.console_grant_role($1, 'moderator')", [C]), "ts:not_supported:");
await expectError("staff: a suspended staff member is nobody", async () => {
  const S = await person("suspended.mod@txstate.edu", "Sue Spended");
  await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'moderator', $2)", [S, OWNER]);
  await call(OWNER, "public.admin_user_suspend($1, 'Testing a staff suspension')", [S]);
  await call(S, "public.console_queue_counts()");
}, "ts:not_found:");

// --- Hide and restore -----------------------------------------------------------------------------------------------
const t = await create(A, { text: "The east garage elevator is out again", title: "Garage" });
const r = await reply(B, t.id, "Third time this month, take the stairs");
await expectOk("CampConnect Admin hides a buzz: it is removed (out of the feed, a placeholder in its thread, still the author's)", async () => {
  check((await feedIds(C)).includes(t.id), "setup: not in the feed");
  await call(OWNER, "public.admin_content_hide('buzz', $1, 'Off-topic for Buzz')", [t.id]);
  const s = await statusOf("buzz_posts", t.id);
  check(s.status === "removed" && s.hidden_from_status === "active" && s.hidden_at, JSON.stringify(s));
  check(!(await feedIds(C)).includes(t.id), "still in someone else's feed");
  const root = (await call(C, "public.buzz_v2_thread($1, 50)", [t.id])).root;
  check(root.status === "removed" && !root.text && !root.title, `placeholder: ${JSON.stringify(root)}`);
  const mine = await call(A, "public.buzz_v2_mine('threads', 0, 20)");
  check(mine.items.some((m) => m.item.id === t.id && m.item.status === "removed"), "the author lost it");
});
await expectOk("CampConnect Admin restores it: back to what it was", async () => {
  await call(OWNER, "public.admin_content_restore('buzz', $1)", [t.id]);
  const s = await statusOf("buzz_posts", t.id);
  check(s.status === "active" && s.hidden_from_status === null && s.hidden_at === null, JSON.stringify(s));
  check((await feedIds(C)).includes(t.id), "not back in the feed");
});
await expectOk("CampConnect Admin hides and restores a reply ('buzz_comment')", async () => {
  await call(OWNER, "public.admin_content_hide('buzz_comment', $1, 'Personal attack')", [r.id]);
  check((await statusOf("buzz_comments", r.id)).status === "removed", "reply not removed");
  const item = (await call(C, "public.buzz_v2_replies($1, 0, 50)", [t.id])).items.find((x) => x.id === r.id);
  check(item && item.status === "removed" && !item.text, `reply placeholder: ${JSON.stringify(item)}`);
  await call(OWNER, "public.admin_content_restore('buzz_comment', $1)", [r.id]);
  check((await statusOf("buzz_comments", r.id)).status === "active", "reply not restored");
});
await expectOk("a hidden_at change without CampConnect Admin's staff functions changes nothing", async () => {
  await db.query("update public.buzz_posts set hidden_at = now() where id = $1", [t.id]);
  const s = await statusOf("buzz_posts", t.id);
  check(s.status === "active" && s.hidden_at === null, JSON.stringify(s));
});
await expectOk("a Buzz removal shows in CampConnect Admin's hidden list, and its restore undoes it", async () => {
  const t2 = await create(A, { text: "Selling answers to the chem final, DM me" });
  await db.query("select public.buzz_v2_set_status('buzz', $1, 'removed')", [t2.id]);
  const s = await statusOf("buzz_posts", t2.id);
  check(s.status === "removed" && s.hidden_at && s.hidden_reason === "Removed by Buzz moderation" && s.hidden_from_status === "active", JSON.stringify(s));
  const hidden = await rowsAs(OWNER, "select * from public.admin_hidden_content_list(null, 50, null)");
  const row = hidden.find((h) => h.target_type === "buzz" && h.target_id === t2.id);
  check(row && row.author_id === null && row.author_name === null, `hidden list: ${JSON.stringify(row)}`);
  await call(OWNER, "public.admin_content_restore('buzz', $1)", [t2.id]);
  check((await statusOf("buzz_posts", t2.id)).status === "active", "not restored");
  await db.query("select public.buzz_v2_set_status('buzz', $1, 'active')", [t2.id]);
  check((await statusOf("buzz_posts", t2.id)).hidden_at === null, "a Buzz restore leaves hidden_at");
});

// --- Reports --------------------------------------------------------------------------------------------------------
await expectOk("Buzz reports reach CampConnect Admin's report queue: a reply is a 'buzz_comment' with its text and no author", async () => {
  const res = await call(C, "public.buzz_v2_report($1, 'harassment', null)", [r.id]);
  check(res.alreadyReported === false, JSON.stringify(res));
  const stored = await one(db.query("select target_type from public.reports where target_id = $1", [r.id]));
  check(stored.target_type === "buzz_comment", stored.target_type);
  const list = await rowsAs(OWNER, "select * from public.admin_reports_list('open', 50, null)");
  const row = list.find((x) => x.target_id === r.id);
  check(row && row.target_type === "buzz_comment" && row.target_exists && row.target_author_id === null && /take the stairs/.test(row.target_preview), JSON.stringify(row));
  check((await call(C, "public.buzz_v2_report($1, 'harassment', null)", [r.id])).alreadyReported === true, "not idempotent");
  const counts = await call(MODR, "public.console_queue_counts()");
  check(Object.values(counts).some((n) => Number(n) > 0), `console queue empty: ${JSON.stringify(counts)}`);
});

// --- Suspensions ----------------------------------------------------------------------------------------------------
const poll = await create(C, { text: "Best late-night food?", poll: { options: ["Tacos", "Pizza"], durationDays: 1 } });
await expectOk("a CampConnect Admin suspension: Buzz says so", async () => {
  await call(OWNER, "public.admin_user_suspend($1, 'Spamming the feed')", [A]);
  const s = await call(A, "public.buzz_v2_posting_status()");
  check(s.allowed === false && s.reason === "suspended", JSON.stringify(s));
});
await expectError("... and refuses a post written by the website's server", () => create(A, { text: "Back again" }), "buzz:suspended:");
await expectError("... and a reply", () => reply(A, t.id, "me again"), "buzz:suspended:");
await expectError("... and a vote the account makes itself", () => call(A, "public.buzz_v2_vote($1, 1)", [poll.id]), "suspended");
await expectError("... and a poll vote", () => call(A, "public.buzz_v2_poll_vote($1, $2)", [poll.id, poll.poll.options[0].id]), "suspended");
await expectOk("... without changing what Buzz shows (a suspect's threads vanishing together would point at them)", async () => {
  check((await feedIds(C)).includes(t.id), "the suspended author's thread left the feed");
});
await expectOk("lifting it lets the account post again", async () => {
  await call(OWNER, "public.admin_user_unsuspend($1)", [A]);
  check((await create(A, { text: "Thanks for fixing the elevator" })).id, "no thread");
});

// --- CampConnect Admin's own rules still hold ------------------------------------------------------------------------
await expectOk("no staff_* helper is executable by the API roles (CampConnect Admin's permissions audit)", async () => {
  const bad = (await db.query(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^staff_'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows.map((x) => x.proname);
  check(bad.length === 0, bad.join(", "));
});
await expectOk("CampConnect Admin's overview counts and user list still run", async () => {
  check((await call(OWNER, "public.admin_overview_stats()")) !== null, "overview");
  check((await rowsAs(OWNER, "select * from public.admin_users_list('all', 50, null)")).length >= 5, "users");
});

done("CAMPCONNECT ADMIN + BUZZ");

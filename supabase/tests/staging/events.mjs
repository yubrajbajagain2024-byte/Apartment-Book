// Events (migration 61) on the staging project, through the real Supabase stack the app uses: Auth sessions, the REST
// API (PostgREST's embeds by foreign-key name, the policies, the functions), Storage (an event's photo from its author's
// own folder) and the feed sync's writes with the service role (the same shared code the website runs, on an inline
// calendar rather than a fetched one). Never runs against production: it refuses production's ref and any project not
// named as staging.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/events.mjs [--restore]
//
// Applies 61 when staging does not have it yet (the file, then its public._migrations row, as db:setup records them;
// the earlier pending migrations are left alone, as production's own apply ahead of the release leaves them). Then two
// students (confirmed txstate.edu accounts made by the admin API, no email sent) do what the app does: one creates an
// organization and an event (pending: the other student and the signed-out see nothing), staff verify it (as the
// database, since the console's two-factor check needs an enrolled authenticator), everyone sees it, the other student
// saves it, follows the organization, opens it, searches for it; a photo uploaded to events/<author>/ is accepted and one
// from another folder refused; the feeds table is closed; a calendar is synced twice with the service role (three
// events, then one dropped and one changed). Everything made is deleted at the end and every table's row count compared
// with the start. With --restore, 61 is rolled back afterwards (its rollback file and the removal of its _migrations row).
import fs from "node:fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";

// The shared sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as the
// unit tests in packages/shared/tests do), so the sync's own code can run here against staging.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const RESTORE = process.argv.includes("--restore");
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This test writes, deletes and may roll a migration back: it never runs against production.");

const ROOT = new URL("../../../", import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), "utf8");
const MIGRATION = "20261113000000_events.sql";
const { parseIcs } = await import(new URL("packages/shared/src/events/ics.ts", ROOT));
const { planFeedSync } = await import(new URL("packages/shared/src/events/sync.ts", ROOT));
const { applyFeedSyncPlan, listFeedEventsForSync, listFeedsToSync, recordFeedSync } = await import(new URL("packages/shared/src/queries/event-sync.ts", ROOT));
// The list's read, as packages/shared/src/queries/events.ts sends it.
const EVENT_SELECT = "id, university_id, organization_id, feed_id, title, description, starts_at, ends_at, all_day, location, category, image_url, registration_url, source, status, save_count, click_count, created_by, created_at, organization:organizations!events_organization_id_fkey(id, name, kind, avatar_url, verified)";

async function mgmt(method, path, body) {
  const r = await fetch(`https://api.supabase.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query });
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const anon = createClient(URL_, ANON, opts);

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const val = async (q) => { const row = (await sql(q))[0]; return row ? row[Object.keys(row)[0]] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passes = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 500)}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }
const must = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code ?? ""} ${error.message}`); return data; };
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const refused = async (p, pattern) => { const { error } = await p; expect(error && new RegExp(pattern, "i").test(`${error.code ?? ""} ${error.message}`), error ? `other error: ${error.code} ${error.message}` : "it was allowed"); };
async function counts() {
  const tables = (await sql("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).map((r) => r.relname);
  return Object.fromEntries((await sql(`select ${tables.map((t) => `(select count(*)::int from public."${t}") as "${t}"`).join(", ")}`)).map((r) => Object.entries(r))[0]);
}

const run = Date.now().toString(36);
const accounts = [];
const files = [];
console.log(`Staging project ${project.name} (${REF}): Events (run ${run})${RESTORE ? ", restoring afterwards" : ""}`);

// --- 61 on staging, as production takes it ---------------------------------------------------------------------------------
const before = new Set((await sql("select name from public._migrations")).map((r) => r.name));
if (before.has(MIGRATION)) ok(`${MIGRATION} is already on staging`);
else {
  const earlierPending = fs.readdirSync(new URL("supabase/migrations/", ROOT)).filter((f) => f.endsWith(".sql") && f < MIGRATION && !before.has(f)).length;
  await check(`${MIGRATION} applies ahead of the ${earlierPending} earlier migrations still pending, and is recorded`, async () => {
    const t0 = Date.now();
    await sql(read(`supabase/migrations/${MIGRATION}`));
    await sql(`insert into public._migrations (name) values (${lit(MIGRATION)}) on conflict do nothing`);
    console.log(`    applied in ${Date.now() - t0} ms`);
  });
}
await sql("notify pgrst, 'reload schema'");
await sleep(4000);
await check("the objects are there: eight tables, the console functions, the triggers, the campuses' time zones", async () => {
  const o = (await sql(`select
    (select count(*)::int from pg_tables where schemaname = 'public' and tablename in ('organizations', 'organization_members', 'organization_follows', 'event_feeds', 'events', 'event_saves', 'event_interests', 'event_engagement')) as tables,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'events_console_%') as console,
    (select count(*)::int from pg_trigger where tgname in ('events_before_write', 'organizations_before_write', 'organizations_after_insert', 'organization_members_guard', 'event_saves_count', 'organization_follows_count')) as triggers,
    (select timezone from public.universities where email_domain = 'txstate.edu') as tz`))[0];
  // Nine events_console_* functions: the eight the console calls and events_console_write(), the triggers' flag.
  expect(o.tables === 8 && o.console === 9 && o.triggers === 6 && o.tz === "America/Chicago", JSON.stringify(o));
});
const baseline = await counts();

// --- People ------------------------------------------------------------------------------------------------------------------
async function student(name) {
  const email = `st-ev-${run}-${name}@txstate.edu`;
  const password = `Ev-${run}-${Math.random().toString(36).slice(2, 10)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${name} Events` } });
  if (error) throw new Error(error.message);
  accounts.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(s.error.message);
  return { id: data.user.id, c };
}
const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
let ann, bob;
await check("two students sign in", async () => {
  ann = await student("ann");
  bob = await student("bob");
});

// --- An organization and its event --------------------------------------------------------------------------------------------
let org, ev;
await check("Ann creates an organization: on her campus, unverified, her own as owner; everyone sees it", async () => {
  org = await must(ann.c.from("organizations").insert({ name: `Staging Robotics ${run}`, kind: "club", description: "Robots." }).select("*").single());
  expect(org.university_id === TX && org.verified === false && org.created_by === ann.id, JSON.stringify(org));
  const members = await must(anon.from("organization_members").select("user_id, role").eq("organization_id", org.id));
  expect(members.length === 1 && members[0].role === "owner", JSON.stringify(members));
});
// Whole seconds: a calendar's times have none finer, and the duplicate check below compares instants exactly.
const soon = new Date(Math.floor(Date.now() / 1000) * 1000 + 3 * 86400_000).toISOString();
await check("her event is pending: she sees it, Bob and the signed-out do not; Bob cannot add one", async () => {
  ev = await must(ann.c.from("events").insert({ organization_id: org.id, title: `Robot Races ${run}`, description: "Bring your bot.", starts_at: soon, location: "LBJ", category: "tech", source: "organization" }).select(EVENT_SELECT).single());
  expect(ev.status === "pending" && ev.university_id === TX && ev.organization.name === org.name, JSON.stringify(ev));
  expect((await must(bob.c.from("events").select("id").eq("id", ev.id))).length === 0, "Bob sees it");
  expect((await must(anon.from("events").select("id").eq("id", ev.id))).length === 0, "anon sees it");
  await refused(bob.c.from("events").insert({ organization_id: org.id, title: "Bob's", starts_at: soon, source: "organization" }), "42501|row-level");
});
await check("a photo from Ann's events folder is accepted; one from another folder is refused", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const path = `events/${ann.id}/poster-${run}.png`;
  await must(ann.c.storage.from("uploads").upload(path, png, { contentType: "image/png" }));
  files.push(path);
  const url = ann.c.storage.from("uploads").getPublicUrl(path).data.publicUrl;
  await must(ann.c.from("events").update({ image_url: url }).eq("id", ev.id));
  await refused(ann.c.from("events").update({ image_url: url.replace(`events/${ann.id}/`, `events/${bob.id}/`) }).eq("id", ev.id), "Upload the photo first");
});
await check("staff verify the organization (as the database): the event is scheduled and everyone sees it, with its organization embedded", async () => {
  await sql(`update public.organizations set verified = true, verified_at = now() where id = ${lit(org.id)}; update public.events set status = 'scheduled' where organization_id = ${lit(org.id)} and status = 'pending';`);
  const mine = await must(anon.from("events").select(EVENT_SELECT).eq("id", ev.id).single());
  expect(mine.status === "scheduled" && mine.organization.verified === true, JSON.stringify(mine));
});
await check("Bob saves it, follows the organization, opens it twice (counted once) and finds it by a word", async () => {
  await must(bob.c.from("event_saves").insert({ event_id: ev.id, user_id: bob.id }));
  await must(bob.c.from("organization_follows").insert({ organization_id: org.id, user_id: bob.id }));
  await must(bob.c.rpc("record_event_click", { p_event: ev.id, p_kind: "open" }));
  await must(bob.c.rpc("record_event_click", { p_event: ev.id, p_kind: "open" }));
  const e = await must(bob.c.from("events").select("save_count, click_count").eq("id", ev.id).single());
  expect(e.save_count === 1 && e.click_count === 1, JSON.stringify(e));
  expect((await val(`select follower_count from public.organizations where id = ${lit(org.id)}`)) === 1, "follower count");
  const found = await must(bob.c.from("events").select("id").textSearch("tsv", "robot", { type: "websearch", config: "simple" }).eq("university_id", TX));
  expect(found.some((r) => r.id === ev.id), "not found by word");
  expect((await must(ann.c.from("event_saves").select("user_id").eq("event_id", ev.id))).length === 0, "Ann reads Bob's save");
});
await check("the feeds table is closed to students; the console functions answer them 'not found'", async () => {
  await refused(bob.c.from("event_feeds").select("*"), "42501|permission denied");
  await refused(bob.c.rpc("events_console_counts"), "not_found");
});

// --- A calendar synced with the service role ----------------------------------------------------------------------------------
let feed;
const ics = (lines) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${lines.map((l) => `BEGIN:VEVENT\r\n${l}\r\nEND:VEVENT`).join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const day = (d, h) => { const t = new Date(Date.now() + d * 86400_000); return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}0000Z`; };
async function sync(text) {
  const [f] = await listFeedsToSync(admin, { feedId: feed.id });
  const now = Date.now();
  const windowStart = now - 86400_000;
  const parsed = parseIcs(text, { defaultTimeZone: f.timezone, windowStart, windowEnd: now + 120 * 86400_000 });
  const existing = await listFeedEventsForSync(admin, f.id, new Date(windowStart).toISOString());
  const result = await applyFeedSyncPlan(admin, f, planFeedSync(parsed, existing, f, now));
  await recordFeedSync(admin, f.id, { status: "ok", itemsSeen: parsed.length, etag: `W/"${run}"` });
  return result;
}
await check("a feed is added (as the database); its first sync inserts three events, one cancelled, with guessed categories", async () => {
  feed = (await sql(`insert into public.event_feeds (university_id, name, url, kind, default_category) values (${lit(TX)}, ${lit(`Staging calendar ${run}`)}, ${lit(`https://events.example/${run}.ics`)}, 'ics', 'academic') returning id`))[0];
  const r = await sync(ics([`UID:a-${run}\r\nSUMMARY:Career Fair ${run}\r\nDTSTART:${day(5, 15)}\r\nDTEND:${day(5, 19)}\r\nLOCATION:LBJ Ballroom`, `UID:b-${run}\r\nSUMMARY:Finals Study Night ${run}\r\nDTSTART:${day(6, 1)}`, `UID:c-${run}\r\nSUMMARY:Choir Concert ${run}\r\nDTSTART:${day(7, 1)}\r\nSTATUS:CANCELLED`]));
  expect(r.inserted === 3 && r.updated === 0 && r.cancelled === 0 && r.duplicates === 0, JSON.stringify(r));
  const rows = await must(anon.from("events").select("external_uid, category, status, location").eq("feed_id", feed.id).order("starts_at"));
  expect(rows.map((x) => `${x.category}:${x.status}`).join() === "career:scheduled,academic:scheduled,music:cancelled" && rows[0].location === "LBJ Ballroom", JSON.stringify(rows));
  const f = (await sql(`select last_status, items_seen, etag from public.event_feeds where id = ${lit(feed.id)}`))[0];
  expect(f.last_status === "ok" && f.items_seen === 3 && f.etag === `W/"${run}"`, JSON.stringify(f));
});
await check("the second sync: a moved event is updated, a dropped one cancelled, the rest unchanged; a duplicate of Ann's event is not inserted again", async () => {
  const r = await sync(ics([`UID:a-${run}\r\nSUMMARY:Career Fair ${run}\r\nDTSTART:${day(5, 16)}\r\nDTEND:${day(5, 19)}\r\nLOCATION:LBJ Ballroom`, `UID:c-${run}\r\nSUMMARY:Choir Concert ${run}\r\nDTSTART:${day(7, 1)}\r\nSTATUS:CANCELLED`, `UID:dup-${run}\r\nSUMMARY:${ev.title}\r\nDTSTART:${soon.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`]));
  expect(r.inserted === 0 && r.updated === 1 && r.cancelled === 1 && r.duplicates === 1, JSON.stringify(r));
  const b = await must(anon.from("events").select("status").eq("feed_id", feed.id).eq("external_uid", `b-${run}`).single());
  expect(b.status === "cancelled", "the dropped event is not cancelled");
  expect((await val(`select count(*)::int from public.events where title = ${lit(ev.title)}`)) === 1, "Ann's event was duplicated");
});

// --- Cleanup -----------------------------------------------------------------------------------------------------------------
await check("everything made is deleted; every table's row count is as at the start", async () => {
  await sql(`delete from public.event_feeds where id = ${lit(feed.id)}`);
  await must(ann.c.from("organizations").delete().eq("id", org.id));
  if (files.length > 0) await admin.storage.from("uploads").remove(files);
  for (const id of accounts) await admin.auth.admin.deleteUser(id);
  const after = await counts();
  const drift = Object.entries(after).filter(([t, n]) => t !== "media_jobs" && n !== baseline[t]).map(([t, n]) => `${t}: ${baseline[t]} → ${n}`);
  expect(drift.length === 0, drift.join(", "));
});
if (RESTORE) {
  await check("61 rolled back: its rollback file and its _migrations row removed", async () => {
    await sql(read("supabase/rollbacks/20261113000000_events.down.sql"));
    await sql(`delete from public._migrations where name = ${lit(MIGRATION)}`);
    expect((await val("select to_regclass('public.events') is null")) === true, "events still there");
  });
}
console.log(`${failures ? "✗" : "✓"} events on staging: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

// Migration 61 (Events) against PGlite: the campuses' time zones; an organization made by a student (owner at once,
// never verified by its maker, one name per campus, owners alone change it and its members, always one owner left,
// anyone may leave); its events (pending until staff verify it, members alone see and manage them, the server stamps
// the campus, the author and the source, a photo must be the author's own upload, hidden stays hidden); staff
// verifying, unverifying and hiding through the console (audited, pending events published and taken back); saves,
// interests, follows and record_event_click() with their counters; feeds closed to the API, managed by admins, fed by
// the service role, deleted with their events; the console's listing; an account's deletion cascading through a last
// owner; the rollback restoring 60 exactly, and a second apply.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, read, ok, fail, expectOk, expectError, done } from "./harness.mjs";
import { catalog, diffCatalogs } from "./catalog.mjs";

const NAME = "20261113000000_events.sql";
const MIGRATION = `migrations/${NAME}`;
const ROLLBACK = "rollbacks/20261113000000_events.down.sql";
const BEFORE = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations")).filter((f) => f.endsWith(".sql") && f < NAME).sort().at(-1);
const check = (cond, message) => { if (!cond) throw new Error(message); };
/** A staff function's refusal: ts:<code>:… */
const expectTs = async (name, fn, code) => {
  try { await fn(); fail(name, "no error"); } catch (e) { if (e.message.includes(`ts:${code}:`)) ok(name); else fail(name, e.message); }
};

const { db, mk, as, asAnon, asService } = await boot({ upTo: BEFORE });
const one = async (p) => (await p).rows[0];
const rows = async (p) => (await p).rows;
const val = async (q, params = []) => { const r = await one(db.query(q, params)); return r[Object.keys(r)[0]]; };
await expectOk(`the migration applies after ${BEFORE} and re-runs cleanly`, async () => { await db.exec(read(MIGRATION)); await db.exec(read(MIGRATION)); });

// --- Campuses and people -------------------------------------------------------------------------------------------
await expectOk("every campus has a time zone: Texas State Central, Harvard Eastern, Michigan Detroit, Oxford London, a new campus Central", async () => {
  const tz = async (name) => val("select timezone from public.universities where name = $1", [name]);
  check((await tz("Texas State University")) === "America/Chicago", "Texas State");
  check((await tz("Harvard University")) === "America/New_York", "Harvard");
  check((await tz("University of Michigan")) === "America/Detroit", "Michigan");
  check((await tz("University of Oxford")) === "Europe/London", "Oxford");
  check((await tz("Stanford University")) === "America/Los_Angeles", "Stanford");
  const fresh = await one(db.query("insert into public.universities (name, city, country) values ('Test Tech', 'Nowhere', 'United States') returning timezone"));
  check(fresh.timezone === "America/Chicago", "default");
});
await expectError("a time zone must look like one", () => db.query("update public.universities set timezone = 'not a zone' where name = 'Test Tech'"), "universities_timezone_check");

const TX = await val("select id from public.universities where email_domain = 'txstate.edu'");
const UT = await val("select id from public.universities where name = 'University of Texas at Austin'");
await db.query("update public.universities set email_domain = 'utexas.edu' where id = $1", [UT]);
const ANN = await mk("ann@txstate.edu", "Ann Owner");
const ED = await mk("ed@txstate.edu", "Ed Editor");
const BOB = await mk("bob@txstate.edu", "Bob Student");
const OLI = await mk("oli@utexas.edu", "Oli Other");
const MOD = await mk("mod@txstate.edu", "Mo Moderator");
const ADMIN = await mk("adm@txstate.edu", "Ada Admin");
await db.query("insert into public.staff_members (user_id, role) values ($1, 'moderator'), ($2, 'admin')", [MOD, ADMIN]);
const asStaff = (uid, fn) => as(uid, fn, { aal: "aal2" });
const BASE = "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/uploads/";
/** A file in someone's folder, as Storage records an upload. */
const upload = async (owner, pathname) => { await db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('uploads', $1, $2, $3)", [pathname, owner, owner]); return BASE + pathname; };

// --- Organizations -------------------------------------------------------------------------------------------------
let org;
await expectOk("a student creates an organization: on their own campus, unverified whatever they sent, and its owner at once", async () => {
  org = await as(ANN, () => one(db.query("insert into public.organizations (university_id, name, kind, description, verified, status, created_by) values ($1, '  Robotics Club ', 'club', 'We build robots.', true, 'hidden', $2) returning *", [UT, BOB])));
  check(org.university_id === TX && org.verified === false && org.status === "active" && org.created_by === ANN && org.name === "Robotics Club", JSON.stringify(org));
  const role = await as(ANN, () => val("select public.organization_role($1)", [org.id]));
  check(role === "owner", `role ${role}`);
});
await expectError("one organization of a name per campus, whatever the case", () => as(BOB, () => db.query("insert into public.organizations (name) values ('robotics club')")), "organizations_name_once");
await expectOk("another campus may have its own Robotics Club", () => as(OLI, () => db.query("insert into public.organizations (name) values ('Robotics Club')")));
await expectOk("everyone sees an active organization and its members; nobody but its owner changes it", async () => {
  check((await asAnon(() => rows(db.query("select id from public.organizations where id = $1", [org.id])))).length === 1, "anon");
  check((await as(BOB, () => rows(db.query("select user_id, role from public.organization_members where organization_id = $1", [org.id])))).length === 1, "members");
  const bob = await as(BOB, () => db.query("update public.organizations set description = 'Mine now' where id = $1", [org.id]));
  check(bob.affectedRows === 0, "Bob changed it");
  await as(ANN, () => db.query("update public.organizations set description = 'We build robots and race them.', verified = true, status = 'hidden', follower_count = 99 where id = $1", [org.id]));
  const after = await one(db.query("select description, verified, status, follower_count from public.organizations where id = $1", [org.id]));
  check(after.description === "We build robots and race them." && after.verified === false && after.status === "active" && after.follower_count === 0, JSON.stringify(after));
});
await expectError("the picture must be the owner's own upload in the organizations folder", () => as(ANN, () => db.query("update public.organizations set avatar_url = $2 where id = $1", [org.id, `${BASE}organizations/${BOB}/logo.png`])), "Upload the picture first");
await expectOk("…and is kept when it is", async () => {
  const url = await upload(ANN, `organizations/${ANN}/logo.png`);
  await as(ANN, () => db.query("update public.organizations set avatar_url = $2 where id = $1", [org.id, url]));
  check((await val("select avatar_url from public.organizations where id = $1", [org.id])) === url, "not kept");
});
await expectOk("the owner adds an editor; an editor adds nobody; the last owner cannot leave; a second owner lets the first go", async () => {
  await as(ANN, () => db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'editor')", [org.id, ED]));
  let refused = false;
  try { await as(ED, () => db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'editor')", [org.id, BOB])); } catch (e) { refused = /row-level security/.test(e.message); }
  check(refused, "Ed added Bob");
  let kept = false;
  try { await as(ANN, () => db.query("delete from public.organization_members where organization_id = $1 and user_id = $2", [org.id, ANN])); } catch (e) { kept = /at least one owner/.test(e.message); }
  check(kept, "the last owner left");
  await as(ANN, () => db.query("update public.organization_members set role = 'owner' where organization_id = $1 and user_id = $2", [org.id, ED]));
  await as(ANN, () => db.query("delete from public.organization_members where organization_id = $1 and user_id = $2", [org.id, ANN]));
  check((await val("select count(*)::int from public.organization_members where organization_id = $1", [org.id])) === 1, "Ann did not leave");
  // Back as before: Ed is the owner now and makes Ann an owner again, himself an editor.
  await as(ED, () => db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [org.id, ANN]));
  await as(ED, () => db.query("update public.organization_members set role = 'editor' where organization_id = $1 and user_id = $2", [org.id, ED]));
});

// --- Events of an unverified organization ---------------------------------------------------------------------------
const soon = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
const later = new Date(Date.now() + 2 * 24 * 3600_000 + 7200_000).toISOString();
let ev;
await expectOk("a member's event: the campus, the author and the source are the server's; pending while the organization is unverified", async () => {
  ev = await as(ED, () => one(db.query("insert into public.events (organization_id, university_id, title, description, starts_at, ends_at, location, category, source, feed_id, external_uid, status, save_count, created_by) values ($1, $2, ' Robot Races ', 'Bring your bot.', $3, $4, 'LBJ Student Center', 'tech', 'feed', null, null, 'scheduled', 50, $5) returning *", [org.id, UT, soon, later, BOB])));
  check(ev.university_id === TX && ev.created_by === ED && ev.source === "organization" && ev.status === "pending" && ev.save_count === 0 && ev.title === "Robot Races", JSON.stringify(ev));
});
await expectOk("its members and staff see a pending event; the campus, another member's campus and the signed-out do not", async () => {
  const sees = async (fn) => (await fn(() => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 1;
  check(await sees((f) => as(ANN, f)), "Ann");
  check(await sees((f) => as(ED, f)), "Ed");
  check(await sees((f) => asStaff(MOD, f)), "staff");
  check(!(await sees((f) => as(BOB, f))), "Bob");
  check(!(await sees((f) => as(OLI, f))), "Oli");
  check(!(await sees(asAnon)), "anon");
});
await expectError("an event needs an organization", () => as(ANN, () => db.query("insert into public.events (title, starts_at, source) values ('Loose', now(), 'organization')")), "belongs to an organization");
await expectOk("a non-member cannot add an event to an organization", async () => {
  let refused = false;
  try { await as(BOB, () => db.query("insert into public.events (organization_id, title, starts_at, source) values ($1, 'Bob''s', now(), 'organization')", [org.id])); } catch (e) { refused = /row-level security/.test(e.message); }
  check(refused, "Bob added one");
});
await expectError("an event ends after it starts", () => as(ANN, () => db.query("insert into public.events (organization_id, title, starts_at, ends_at, source) values ($1, 'Backwards', now(), now() - interval '1 hour', 'organization')", [org.id])), "events_ends_after_start");
await expectError("a category comes from the list", () => as(ANN, () => db.query("insert into public.events (organization_id, title, starts_at, source, category) values ($1, 'Odd', now(), 'organization', 'party')", [org.id])), "events_category_check");
await expectError("a registration link is a web address", () => as(ANN, () => db.query("insert into public.events (organization_id, title, starts_at, source, registration_url) values ($1, 'Odd', now(), 'organization', 'javascript:alert(1)')", [org.id])), "events_registration_url_check");
await expectError("the photo must be the author's own upload in the events folder", () => as(ANN, () => db.query("update public.events set image_url = $2 where id = $1", [ev.id, `${BASE}events/${ED}/poster.jpg`])), "Upload the photo first");
await expectOk("…and is kept when it is; another member editing the words leaves it in place", async () => {
  const url = await upload(ANN, `events/${ANN}/poster.jpg`);
  await as(ANN, () => db.query("update public.events set image_url = $2 where id = $1", [ev.id, url]));
  await as(ED, () => db.query("update public.events set description = 'Bring your bot and a charger.' where id = $1", [ev.id]));
  const after = await one(db.query("select image_url, description, created_by from public.events where id = $1", [ev.id]));
  check(after.image_url === url && after.description === "Bring your bot and a charger." && after.created_by === ED, JSON.stringify(after));
});

// --- Staff: the console ---------------------------------------------------------------------------------------------
await expectTs("a student calling a console function is told 'not found'", () => as(BOB, () => db.query("select public.events_console_counts()")), "not_found");
await expectTs("…and so is staff without two-factor sign-in", () => as(MOD, () => db.query("select public.events_console_counts()")), "mfa_required");
await expectOk("the counts: one organization waiting", async () => {
  const c = await asStaff(MOD, () => val("select public.events_console_counts()"));
  check(c.organizations_pending === 2 && c.events_upcoming === 0, JSON.stringify(c));
});
await expectOk("staff list the organizations waiting, with their members and events", async () => {
  const list = await asStaff(MOD, () => val("select public.events_console_organizations('{\"verified\": false}')"));
  const mine = list.find((o) => o.id === org.id);
  check(mine && mine.members === 2 && mine.events === 1 && mine.university_name === "Texas State University" && mine.creator_username, JSON.stringify(mine));
});
await expectOk("verifying the organization publishes its pending events (audited); the campus and the signed-out now see them", async () => {
  const r = await asStaff(MOD, () => val("select public.events_console_set_organization($1, true, null, 'Checked with Student Involvement')", [org.id]));
  check(r.verified === true && r.status === "active", JSON.stringify(r));
  const o = await one(db.query("select verified, verified_by, verified_at from public.organizations where id = $1", [org.id]));
  check(o.verified && o.verified_by === MOD && o.verified_at, JSON.stringify(o));
  check((await val("select status from public.events where id = $1", [ev.id])) === "scheduled", "not published");
  check((await as(BOB, () => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 1, "Bob");
  check((await asAnon(() => rows(db.query("select id, title, tsv is not null as searchable from public.events where id = $1", [ev.id])))).length === 1, "anon");
  const audit = await one(db.query("select actor_id, actor_role, action, target_id, reason, metadata from public.audit_log where action = 'organization.verify' order by created_at desc limit 1"));
  check(audit && audit.actor_id === MOD && audit.actor_role === "moderator" && audit.target_id === org.id && audit.reason === "Checked with Student Involvement" && audit.metadata.name === "Robotics Club", JSON.stringify(audit));
});
await expectOk("a member may cancel and reschedule, never hide; staff hide, and hidden stays hidden through a member's edit", async () => {
  await as(ANN, () => db.query("update public.events set status = 'cancelled' where id = $1", [ev.id]));
  check((await val("select status from public.events where id = $1", [ev.id])) === "cancelled", "not cancelled");
  check((await asAnon(() => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 1, "a cancelled event is still shown");
  await as(ANN, () => db.query("update public.events set status = 'hidden' where id = $1", [ev.id]));
  check((await val("select status from public.events where id = $1", [ev.id])) === "scheduled", "a member hid it");
  const r = await asStaff(MOD, () => val("select public.events_console_set_event($1, 'hidden', 'Not a campus event')", [ev.id]));
  check(r.status === "hidden", JSON.stringify(r));
  check((await as(BOB, () => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 0, "Bob still sees it");
  check((await as(ANN, () => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 1, "the owner lost sight of it");
  await as(ANN, () => db.query("update public.events set status = 'scheduled', title = 'Robot Races!' where id = $1", [ev.id]));
  check((await val("select status from public.events where id = $1", [ev.id])) === "hidden", "the member unhid it");
  const audit = await val("select count(*)::int from public.audit_log where action = 'event.hidden' and target_id = $1", [ev.id]);
  check(audit === 1, `audit rows ${audit}`);
  await asStaff(MOD, () => db.query("select public.events_console_set_event($1, 'scheduled')", [ev.id]));
  check((await val("select status from public.events where id = $1", [ev.id])) === "scheduled", "not restored");
});
await expectTs("an unknown status is refused", () => asStaff(MOD, () => db.query("select public.events_console_set_event($1, 'gone')", [ev.id])), "validation_failed");
await expectOk("unverifying takes the organization's events back to pending", async () => {
  await asStaff(ADMIN, () => db.query("select public.events_console_set_organization($1, false)", [org.id]));
  check((await val("select status from public.events where id = $1", [ev.id])) === "pending", "still public");
  check((await as(BOB, () => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 0, "Bob sees a pending event");
  await asStaff(ADMIN, () => db.query("select public.events_console_set_organization($1, true)", [org.id]));
  check((await val("select status from public.events where id = $1", [ev.id])) === "scheduled", "not published again");
});
await expectOk("hiding an organization hides it and its events from the campus, not from its members", async () => {
  await asStaff(ADMIN, () => db.query("select public.events_console_set_organization($1, null, 'hidden')", [org.id]));
  check((await as(BOB, () => rows(db.query("select id from public.organizations where id = $1", [org.id])))).length === 0, "Bob sees the organization");
  check((await as(BOB, () => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 0, "Bob sees its event");
  check((await as(ED, () => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 1, "Ed lost it");
  await asStaff(ADMIN, () => db.query("select public.events_console_set_organization($1, null, 'active')", [org.id]));
  check((await as(BOB, () => rows(db.query("select id from public.events where id = $1", [ev.id])))).length === 1, "not restored");
});

// --- Saves, interests, follows, clicks --------------------------------------------------------------------------------
await expectOk("saving counts once per person, unsaving counts down, and a save is its owner's alone", async () => {
  await as(BOB, () => db.query("insert into public.event_saves (event_id, user_id) values ($1, $2)", [ev.id, BOB]));
  await as(OLI, () => db.query("insert into public.event_saves (event_id, user_id) values ($1, $2)", [ev.id, OLI]));
  check((await val("select save_count from public.events where id = $1", [ev.id])) === 2, "count");
  check((await as(ANN, () => rows(db.query("select user_id from public.event_saves where event_id = $1", [ev.id])))).length === 0, "Ann reads others' saves");
  let refused = false;
  try { await as(BOB, () => db.query("insert into public.event_saves (event_id, user_id) values ($1, $2)", [ev.id, ANN])); } catch (e) { refused = /row-level security/.test(e.message); }
  check(refused, "Bob saved for Ann");
  await as(OLI, () => db.query("delete from public.event_saves where event_id = $1 and user_id = $2", [ev.id, OLI]));
  check((await val("select save_count from public.events where id = $1", [ev.id])) === 1, "count after");
});
await expectOk("interests: a student's own, from the list", async () => {
  await as(BOB, () => db.query("insert into public.event_interests (user_id, category) values ($1, 'tech'), ($1, 'music')", [BOB]));
  check((await as(BOB, () => rows(db.query("select category from public.event_interests order by 1")))).map((r) => r.category).join() === "music,tech", "Bob's");
  check((await as(ANN, () => rows(db.query("select category from public.event_interests")))).length === 0, "Ann sees Bob's");
  let refused = false;
  try { await as(BOB, () => db.query("insert into public.event_interests (user_id, category) values ($1, 'parties')", [BOB])); } catch (e) { refused = /event_interests_category_check/.test(e.message); }
  check(refused, "an odd category");
});
await expectOk("following counts, once per person", async () => {
  await as(BOB, () => db.query("insert into public.organization_follows (organization_id, user_id) values ($1, $2)", [org.id, BOB]));
  check((await val("select follower_count from public.organizations where id = $1", [org.id])) === 1, "count");
  await as(BOB, () => db.query("delete from public.organization_follows where organization_id = $1 and user_id = $2", [org.id, BOB]));
  check((await val("select follower_count from public.organizations where id = $1", [org.id])) === 0, "count after");
  await as(BOB, () => db.query("insert into public.organization_follows (organization_id, user_id) values ($1, $2)", [org.id, BOB]));
});
await expectOk("record_event_click: once a day per kind and person; nothing signed out, nothing on a pending event; the rows are the recorder's to read only", async () => {
  await as(BOB, () => db.query("select public.record_event_click($1, 'open')", [ev.id]));
  await as(BOB, () => db.query("select public.record_event_click($1, 'open')", [ev.id]));
  await as(BOB, () => db.query("select public.record_event_click($1, 'register')", [ev.id]));
  await as(BOB, () => db.query("select public.record_event_click($1, 'nope')", [ev.id]));
  check((await val("select click_count from public.events where id = $1", [ev.id])) === 2, "count");
  let anonRefused = false;
  try { await asAnon(() => db.query("select public.record_event_click($1, 'open')", [ev.id])); } catch (e) { anonRefused = /permission denied/.test(e.message); }
  check(anonRefused, "anon ran it");
  check((await as(BOB, () => rows(db.query("select kind from public.event_engagement where event_id = $1 order by 1", [ev.id])))).map((r) => r.kind).join() === "open,register", "Bob's rows");
  check((await as(ANN, () => rows(db.query("select kind from public.event_engagement where event_id = $1", [ev.id])))).length === 0, "Ann reads Bob's");
  let writeRefused = false;
  try { await as(BOB, () => db.query("insert into public.event_engagement (event_id, user_id, kind) values ($1, $2, 'share')", [ev.id, BOB])); } catch (e) { writeRefused = /permission denied/.test(e.message); }
  check(writeRefused, "Bob wrote a row himself");
});

// --- Feeds ----------------------------------------------------------------------------------------------------------
await expectOk("event_feeds is closed to the API", async () => {
  let refused = false;
  try { await as(BOB, () => db.query("select * from public.event_feeds")); } catch (e) { refused = /permission denied/.test(e.message); }
  check(refused, "a student read the feeds");
});
await expectTs("a moderator reads the feeds but adds none", () => asStaff(MOD, () => db.query("select public.events_console_feed_save('{\"university_id\": \"" + TX + "\", \"name\": \"Campus calendar\", \"url\": \"https://events.txst.edu/calendar.ics\", \"kind\": \"ics\"}')")), "not_found");
let feed;
await expectOk("an admin adds a feed (audited); the list shows it", async () => {
  feed = await asStaff(ADMIN, () => val("select public.events_console_feed_save($1)", [JSON.stringify({ university_id: TX, name: "Campus calendar", url: "https://events.txst.edu/calendar.ics", kind: "ics", default_category: "academic" })]));
  const list = await asStaff(MOD, () => val("select public.events_console_feeds()"));
  check(list.length === 1 && list[0].id === feed.id && list[0].enabled === true && list[0].university_name === "Texas State University" && list[0].upcoming === 0, JSON.stringify(list));
  check((await val("select count(*)::int from public.audit_log where action = 'event_feed.create' and target_id = $1", [feed.id])) === 1, "audit");
});
await expectTs("the same address twice on a campus is refused", () => asStaff(ADMIN, () => db.query("select public.events_console_feed_save($1)", [JSON.stringify({ university_id: TX, name: "Again", url: "https://events.txst.edu/calendar.ics", kind: "ics" })])), "validation_failed");
await expectTs("a feed address must be https", () => asStaff(ADMIN, () => db.query("select public.events_console_feed_save($1)", [JSON.stringify({ university_id: TX, name: "Plain", url: "http://events.txst.edu/calendar.ics", kind: "ics" })])), "validation_failed");
await expectTs("a feed is ics or rss", () => asStaff(ADMIN, () => db.query("select public.events_console_feed_save($1)", [JSON.stringify({ university_id: TX, name: "Odd", url: "https://x.example/feed.json", kind: "json" })])), "validation_failed");
await expectTs("an organization's feed must be on the same campus", () => asStaff(ADMIN, () => db.query("select public.events_console_feed_save($1)", [JSON.stringify({ university_id: UT, organization_id: org.id, name: "Club cal", url: "https://x.example/club.ics", kind: "ics" })])), "validation_failed");
let fe1, fe2;
await expectOk("the sync (service role) writes a feed's events as it says them; one row per uid per feed", async () => {
  const ins = (uid, title, status = "scheduled") => asService(() => one(db.query("insert into public.events (university_id, feed_id, external_uid, title, starts_at, ends_at, location, category, source, status) values ($1, $2, $3, $4, $5, $6, 'Alkek Library', 'academic', 'feed', $7) returning *", [TX, feed.id, uid, title, soon, later, status])));
  fe1 = await ins("uid-1@txst", "Finals Study Night");
  fe2 = await ins("uid-2@txst", "Career Fair", "cancelled");
  check(fe1.source === "feed" && fe1.status === "scheduled" && fe1.created_by === null && fe1.title_key === "finals study night", JSON.stringify(fe1));
  let dup = false;
  try { await ins("uid-1@txst", "Finals Study Night again"); } catch (e) { dup = /events_feed_uid_once/.test(e.message); }
  check(dup, "a second row for the uid");
  check((await asAnon(() => rows(db.query("select id from public.events where feed_id = $1 order by starts_at", [feed.id])))).length === 2, "anon sees the feed's events");
});
await expectError("a feed event names its feed and uid", () => asService(() => db.query("insert into public.events (university_id, title, starts_at, source) values ($1, 'Loose', now(), 'feed')", [TX])), "events_feed_fields_check");
await expectOk("the search column finds words in the title, the description and the place", async () => {
  const hits = await as(BOB, () => rows(db.query("select title from public.events where tsv @@ websearch_to_tsquery('simple', 'alkek') order by title")));
  check(hits.length === 2, JSON.stringify(hits));
});
await expectOk("staff list and filter the events: everything, by status, by words", async () => {
  const all = await asStaff(MOD, () => val("select public.events_console_events('{}')"));
  check(all.total === 3 && all.items.length === 3 && all.items[0].university_name === "Texas State University", JSON.stringify(all));
  const cancelled = await asStaff(MOD, () => val("select public.events_console_events('{\"status\": \"cancelled\"}')"));
  check(cancelled.total === 1 && cancelled.items[0].id === fe2.id && cancelled.items[0].feed_name === "Campus calendar", JSON.stringify(cancelled));
  const words = await asStaff(MOD, () => val("select public.events_console_events('{\"q\": \"robot\"}')"));
  check(words.total === 1 && words.items[0].organization_name === "Robotics Club" && words.items[0].organization_verified === true, JSON.stringify(words));
  const c = await asStaff(MOD, () => val("select public.events_console_counts()"));
  check(c.events_upcoming === 2 && c.organizations_pending === 1, JSON.stringify(c));
});
await expectOk("staff hide a feed's event; a sync update leaves it hidden only if the sync keeps the status, which is the sync's job: the trigger stamps nothing on the service role", async () => {
  await asStaff(MOD, () => db.query("select public.events_console_set_event($1, 'hidden', 'Spam')", [fe1.id]));
  check((await as(BOB, () => rows(db.query("select id from public.events where id = $1", [fe1.id])))).length === 0, "Bob sees it");
  await asService(() => db.query("update public.events set title = 'Finals Study Night (updated)' where id = $1", [fe1.id]));
  check((await val("select status from public.events where id = $1", [fe1.id])) === "hidden", "the status moved");
});
await expectOk("disabling and renaming a feed; changing its address forgets the etag", async () => {
  await asService(() => db.query("update public.event_feeds set etag = 'W/\"1\"' where id = $1", [feed.id]));
  await asStaff(ADMIN, () => db.query("select public.events_console_feed_save($1)", [JSON.stringify({ id: feed.id, university_id: TX, name: "Campus calendar (main)", url: "https://events.txst.edu/calendar.ics", kind: "ics", enabled: false })]));
  let f = await one(db.query("select name, enabled, etag from public.event_feeds where id = $1", [feed.id]));
  check(f.name === "Campus calendar (main)" && f.enabled === false && f.etag === 'W/"1"', JSON.stringify(f));
  await asStaff(ADMIN, () => db.query("select public.events_console_feed_save($1)", [JSON.stringify({ id: feed.id, university_id: TX, name: "Campus calendar (main)", url: "https://events.txst.edu/all.ics", kind: "ics", enabled: true })]));
  f = await one(db.query("select enabled, etag from public.event_feeds where id = $1", [feed.id]));
  check(f.enabled === true && f.etag === null, JSON.stringify(f));
});
await expectOk("deleting a feed deletes its events, saves included (audited with the count)", async () => {
  await as(BOB, () => db.query("insert into public.event_saves (event_id, user_id) values ($1, $2)", [fe2.id, BOB]));
  const r = await asStaff(ADMIN, () => val("select public.events_console_feed_delete($1)", [feed.id]));
  check(r.events === 2, JSON.stringify(r));
  check((await val("select count(*)::int from public.events where feed_id = $1", [feed.id])) === 0, "events stayed");
  check((await val("select count(*)::int from public.event_saves where event_id = $1", [fe2.id])) === 0, "saves stayed");
  check((await val("select (metadata ->> 'events')::int from public.audit_log where action = 'event_feed.delete' and target_id = $1", [feed.id])) === 2, "audit");
});
await expectTs("deleting it again is 'not found'", () => asStaff(ADMIN, () => db.query("select public.events_console_feed_delete($1)", [feed.id])), "not_found");

// --- Deletions ------------------------------------------------------------------------------------------------------
await expectOk("an owner deletes the organization: its events, members and follows go with it", async () => {
  const other = await as(ANN, () => one(db.query("insert into public.organizations (name) values ('Chess Club') returning id")));
  const e = await as(ANN, () => one(db.query("insert into public.events (organization_id, title, starts_at, source) values ($1, 'Blitz night', now() + interval '1 day', 'organization') returning id", [other.id])));
  await as(BOB, () => db.query("insert into public.organization_follows (organization_id, user_id) values ($1, $2)", [other.id, BOB]));
  const bob = await as(BOB, () => db.query("delete from public.organizations where id = $1", [other.id]));
  check(bob.affectedRows === 0, "Bob deleted it");
  await as(ANN, () => db.query("delete from public.organizations where id = $1", [other.id]));
  check((await val("select count(*)::int from public.events where id = $1", [e.id])) === 0, "the event stayed");
  check((await val("select count(*)::int from public.organization_members where organization_id = $1", [other.id])) === 0, "members stayed");
  check((await val("select count(*)::int from public.organization_follows where organization_id = $1", [other.id])) === 0, "follows stayed");
});
await expectOk("an account's deletion cascades through a last owner's membership, saves, interests and follows", async () => {
  const solo = await mk("solo@txstate.edu", "Sol Solo");
  const o = await as(solo, () => one(db.query("insert into public.organizations (name) values ('Solo Society') returning id")));
  await as(solo, () => db.query("insert into public.event_saves (event_id, user_id) values ($1, $2)", [ev.id, solo]));
  await db.query("delete from auth.users where id = $1", [solo]);
  check((await val("select count(*)::int from public.organization_members where organization_id = $1", [o.id])) === 0, "membership stayed");
  check((await val("select count(*)::int from public.event_saves where user_id = $1", [solo])) === 0, "save stayed");
  check((await val("select save_count from public.events where id = $1", [ev.id])) === 1, "the counter did not follow");
});

// --- Rollback -------------------------------------------------------------------------------------------------------
await expectOk("the rollback restores 60 exactly (schema as a database that never had 61); the migration applies again", async () => {
  await db.exec(read(ROLLBACK));
  const reference = await boot({ upTo: BEFORE });
  const changed = diffCatalogs(await catalog(async (q) => (await reference.db.query(q)).rows), await catalog(async (q) => (await db.query(q)).rows));
  await reference.db.close();
  check(changed.length === 0, changed.join("; "));
  check((await val("select count(*)::int from information_schema.columns where table_name = 'universities' and column_name = 'timezone'")) === 0, "timezone stayed");
  await db.exec(read(MIGRATION));
  check((await val("select to_regclass('public.events') is not null")) === true, "not re-applied");
});

done("MIGRATION-61 EVENTS");

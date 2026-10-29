// Migration 57 (a business's opening hours) against PGlite: the owner and admins set them, editors, analysts and
// students cannot; everyone reads them on an approved business's profile, and no one on a pending one's but its team;
// the database keeps the shape the portal's form sends (a listed time zone, every weekday, HH:MM times, real and unique
// special dates, closed or with hours) and refuses anything else; the audit log records the change; the migration
// re-runs, and its rollback removes the column and the check.
import { isDeepStrictEqual } from "node:util";
import { boot, read, expectOk, expectError, done } from "./harness.mjs";

const MIGRATION = "migrations/20261110000000_business_hours.sql";
const ROLLBACK = "rollbacks/20261110000000_business_hours.down.sql";

const { db, mk, as, asAnon } = await boot();
const one = async (p) => (await p).rows[0];
const signUp = async (email, meta) => (await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, JSON.stringify(meta)])).rows[0].id;
const confirm = (id) => db.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
const review = (admin, business, decision) => as(admin, () => db.query("select public.admin_review_business($1, $2, null)", [business, decision]));
const join = async (by, email, role, name) => {
  const inv = await as(by, () => one(db.query("select * from public.business_invite_create($1, $2)", [email, role])));
  const id = await signUp(email, { account_type: "business", full_name: name, business_invite: inv.token });
  await confirm(id);
  return id;
};

const admin = await mk("ann@txstate.edu", "Ann Avery");
await db.query("select public.grant_role($1, 'admin')", [admin]);
const student = await mk("ben@txstate.edu", "Ben Brooks");
const owner = await signUp("rita@riverrock.example", { account_type: "business", full_name: "Rita Rivers", business_name: "River Rock", business_category: "housing" });
await confirm(owner);
const business = (await one(db.query("select id from public.businesses where owner_id = $1", [owner]))).id;
const boss = await join(owner, "adam@riverrock.example", "admin", "Adam Admin");
const editor = await join(owner, "ed@riverrock.example", "editor", "Ed Editor");
const analyst = await join(owner, "ana@riverrock.example", "analyst", "Ana Analyst");

const nine = [{ open: "09:00", close: "17:00" }];
const HOURS = {
  timezone: "America/Chicago",
  week: { mon: nine, tue: nine, wed: nine, thu: nine, fri: [{ open: "09:00", close: "13:00" }, { open: "14:00", close: "02:00" }], sat: [{ open: "00:00", close: "24:00" }], sun: [] },
  special: [
    { date: "2026-11-26", label: "Thanksgiving", closed: true, hours: [] },
    { date: "2026-12-24", label: null, closed: false, hours: [{ open: "10:00", close: "14:00" }] },
  ],
};
const setHours = (uid, hours) => as(uid, () => db.query("update public.businesses set hours = $2::jsonb where id = $1 returning id", [business, hours === null ? null : JSON.stringify(hours)]));
const hoursNow = async () => (await one(db.query("select hours from public.businesses where id = $1", [business]))).hours;
const mustChange = async (fn) => {
  const r = await fn();
  if (!r.rows.length) throw new Error("no rows: row-level security");
};
const changesNothing = async (fn) => {
  const r = await fn();
  if (r.rows.length) throw new Error("it changed the hours");
};

await expectOk("the migration re-runs cleanly", () => db.exec(read(MIGRATION)));

// --- Who sets them -------------------------------------------------------------------------------------------------
await expectOk("the owner sets the hours while the business waits for review; they read back as sent", async () => {
  await mustChange(() => setHours(owner, HOURS));
  if (!isDeepStrictEqual(await hoursNow(), HOURS)) throw new Error(JSON.stringify(await hoursNow()));
});
await expectOk("an admin of the team changes them too", async () => {
  await mustChange(() => setHours(boss, { ...HOURS, special: [] }));
  await mustChange(() => setHours(owner, HOURS));
});
await expectOk("an editor cannot change them", () => changesNothing(() => setHours(editor, { ...HOURS, special: [] })));
await expectOk("an analyst cannot change them", () => changesNothing(() => setHours(analyst, { ...HOURS, special: [] })));
await expectOk("a student cannot change them", () => changesNothing(() => setHours(student, null)));
await expectOk("the audit log records the change, by field", async () => {
  const r = await one(db.query("select count(*)::int as n from public.business_audit_log where business_id = $1 and action = 'profile_updated' and detail->'fields' ? 'hours'", [business]));
  if (!r.n) throw new Error("no audit row for hours");
});

// --- Who reads them ------------------------------------------------------------------------------------------------
await expectOk("before approval, students and visitors see no hours (no profile at all); the team does", async () => {
  const s = await as(student, () => db.query("select hours from public.businesses where id = $1", [business]));
  const a = await asAnon(() => db.query("select hours from public.businesses where id = $1", [business]));
  if (s.rows.length || a.rows.length) throw new Error("a pending business's hours are public");
  const e = await as(editor, () => one(db.query("select hours from public.businesses where id = $1", [business])));
  if (!e?.hours) throw new Error("the editor cannot read them");
});
await review(admin, business, "approved");
await expectOk("once approved, students and signed-out visitors read the hours with the public profile", async () => {
  const cols = "id, name, category, description, website, phone, address, city, logo_url, university_ids, status, verified_partner, created_at, hours";
  const s = await as(student, () => one(db.query(`select ${cols} from public.businesses where id = $1`, [business])));
  const a = await asAnon(() => one(db.query(`select ${cols} from public.businesses where id = $1`, [business])));
  if (s?.hours?.timezone !== "America/Chicago" || a?.hours?.week?.sat?.[0]?.close !== "24:00") throw new Error(JSON.stringify({ s, a }));
});
await expectOk("the private columns stay private: a student still cannot read the contact email", async () => {
  try {
    await as(student, () => db.query("select contact_email from public.businesses where id = $1", [business]));
  } catch (e) {
    if (/permission denied/.test(e.message)) return;
    throw e;
  }
  throw new Error("a student read the contact email");
});
await expectOk("my_business() hands the team the hours with the rest of the row", async () => {
  const r = await as(editor, () => one(db.query("select public.my_business() as m")));
  if (!r.m.business.hours || r.m.business.hours.timezone !== "America/Chicago") throw new Error(JSON.stringify(r.m.business.hours));
});
await expectOk("the owner takes the hours off the profile (null)", async () => {
  await mustChange(() => setHours(owner, null));
  if ((await hoursNow()) !== null) throw new Error("still there");
  await mustChange(() => setHours(owner, HOURS));
});

// --- What the database keeps ---------------------------------------------------------------------------------------
const bad = (n, change) => expectError(`refused: ${n}`, () => setHours(owner, change(structuredClone(HOURS))), "businesses_hours_check");
await bad("not an object", () => ["mon"]);
await bad("another key", (h) => ({ ...h, note: "x" }));
await bad("a time zone outside the list", (h) => ({ ...h, timezone: "Europe/London" }));
await bad("no time zone", (h) => ({ week: h.week, special: h.special }));
await bad("a missing weekday", (h) => ({ ...h, week: { ...h.week, sun: undefined } }));
await bad("an unknown day", (h) => ({ ...h, week: { ...h.week, fun: [] } }));
await bad("a time that is not HH:MM", (h) => ({ ...h, week: { ...h.week, mon: [{ open: "9:00", close: "17:00" }] } }));
await bad("an hour past 24", (h) => ({ ...h, week: { ...h.week, mon: [{ open: "09:00", close: "25:00" }] } }));
await bad("opening at 24:00", (h) => ({ ...h, week: { ...h.week, mon: [{ open: "24:00", close: "02:00" }] } }));
await bad("the same opening and closing time", (h) => ({ ...h, week: { ...h.week, mon: [{ open: "09:00", close: "09:00" }] } }));
await bad("four ranges in a day", (h) => ({ ...h, week: { ...h.week, mon: [1, 2, 3, 4].map((i) => ({ open: `0${i}:00`, close: `0${i}:30` })) } }));
await bad("a range with another key", (h) => ({ ...h, week: { ...h.week, mon: [{ open: "09:00", close: "17:00", note: "x" }] } }));
await bad("a date that does not exist", (h) => ({ ...h, special: [{ date: "2026-02-30", label: null, closed: true, hours: [] }] }));
await bad("a date not as YYYY-MM-DD", (h) => ({ ...h, special: [{ date: "11/26/2026", label: null, closed: true, hours: [] }] }));
await bad("the same date twice", (h) => ({ ...h, special: [h.special[0], { ...h.special[0], label: "Again" }] }));
await bad("closed with hours", (h) => ({ ...h, special: [{ ...h.special[0], hours: nine }] }));
await bad("open without hours", (h) => ({ ...h, special: [{ ...h.special[1], hours: [] }] }));
await bad("a name over 40 characters", (h) => ({ ...h, special: [{ ...h.special[0], label: "x".repeat(41) }] }));
await bad("a name that is not text", (h) => ({ ...h, special: [{ ...h.special[0], label: 7 }] }));
await bad("closed that is not true or false", (h) => ({ ...h, special: [{ ...h.special[0], closed: "yes" }] }));
await bad("61 special dates", (h) => ({ ...h, special: Array.from({ length: 61 }, (_, i) => ({ date: `2027-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, label: null, closed: true, hours: [] })) }));
await expectOk("60 special dates, a leap day and an empty week are fine", async () => {
  const special = Array.from({ length: 59 }, (_, i) => ({ date: `2027-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, label: null, closed: true, hours: [] }));
  special.push({ date: "2028-02-29", label: "Leap day", closed: false, hours: [{ open: "22:00", close: "03:00" }] });
  await mustChange(() => setHours(owner, { timezone: "Pacific/Honolulu", week: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, special }));
  await mustChange(() => setHours(owner, HOURS));
});

// --- Rollback -------------------------------------------------------------------------------------------------------
await expectOk("the rollback removes the column, the check and its functions; the migration then applies again", async () => {
  await db.exec(read(ROLLBACK));
  const col = await db.query("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name = 'hours'");
  const fn = await db.query("select 1 from pg_proc where proname in ('business_hours_valid', 'business_hours_ranges_valid')");
  if (col.rows.length || fn.rows.length) throw new Error("left behind");
  const r = await as(owner, () => one(db.query("select public.my_business() as m")));
  if ("hours" in r.m.business) throw new Error("my_business() still has hours");
  await db.exec(read(MIGRATION));
  await mustChange(() => setHours(owner, HOURS));
});

done("BUSINESS HOURS");

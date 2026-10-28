// The report auto-hide backstop (20261110000000_report_auto_hide.sql) on production's schema: content 10 different
// legitimate people report is hidden for everyone but its owner, flagged for CampConnect Admin, its owner told and the
// hide audited; duplicates and people who do not count are left out, and the author cannot cancel reports by blocking;
// Buzz stays anonymous and Trust & Safety's own thresholds still work; a restore needs 10 new people to hide it again;
// keep hidden, delete and the website console's approve settle the flag; the new table and helpers are closed. Then
// the same core on production as it is today (the migrations not live yet left out, since this one may be applied
// alone), and on this repo's schema alone, where it changes nothing.
// Usage: node supabase/tests/report-auto-hide.test.mjs
import { boot, read, expectOk, expectError, done } from "./harness.mjs";
import { BUZZ_GUIDELINES_VERSION } from "../../packages/shared/src/buzz/constants.ts";

const MIGRATION = "migrations/20261110000000_report_auto_hide.sql";
const MFA = { aal: "aal2" };
const THRESHOLD = 10;
const check = (cond, message) => { if (!cond) throw new Error(message); };
// Production's migrations as of 2026-10-28: these are in this repo but not live yet (docs/migrations.md).
const NOT_LIVE = [
  "20261103000300_discover.sql", "20261104000100_discover_audience.sql", "20261105000000_anonymous_listings.sql",
  "20261107000000_business_teams.sql", "20261107000100_business_ads.sql", "20261108000000_buzz_reply_tree.sql",
  "20261108000100_buzz_top_reply.sql", "20261108000200_buzz_prompt_threads.sql", "20261108000300_buzz_categories.sql",
  "20261109000000_media_server_fields.sql", "20261109000100_business_hardening.sql",
];

/** One database and the helpers every section uses. */
async function setup(bootOpts) {
  const env = await boot(bootOpts);
  const { db, mk, as, asService } = env;
  const one = async (p) => (await p).rows[0];
  const val = async (p) => { const row = (await p).rows[0]; return row ? row[Object.keys(row)[0]] : undefined; };
  const call = (uid, expr, params = [], claims = MFA) => as(uid, () => val(db.query(`select ${expr}`, params)), claims);
  const rowsAs = (uid, sql, params = [], claims = MFA) => as(uid, async () => (await db.query(sql, params)).rows, claims);

  // No publication delay, and this project's storage origin (media jobs are queued only for its own uploads).
  await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, storage_origin = 'https://proj.supabase.co'");
  const TX = (await one(db.query("select id from public.universities where email_domain = 'txstate.edu'"))).id;
  let n = 0;
  const person = async (name, { days = 30, confirmed = true } = {}) => {
    const uid = await mk(`p${++n}.${name.toLowerCase().replace(/\W+/g, "")}@txstate.edu`, name, { confirmed });
    await db.query("update public.profiles set university_id = $2, created_at = now() - make_interval(days => $3) where id = $1", [uid, TX, days]);
    await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [BUZZ_GUIDELINES_VERSION]));
    return uid;
  };
  const people = async (count, prefix) => { const out = []; for (let i = 0; i < count; i++) out.push(await person(`${prefix} Number${i}`)); return out; };

  // Content, as its author writes it.
  const ins = (uid, sql, params) => as(uid, () => val(db.query(sql, params)));
  const make = {
    post: (a, body = "Move-in day at the river apartments") => ins(a, "insert into public.feed_posts (author_id, kind, body) values ($1, 'post', $2) returning id", [a, body]),
    reel: (a) => ins(a, "insert into public.feed_posts (author_id, kind, body, videos) values ($1, 'reel', 'Sunset from the quad', '[{\"playback_id\":\"abc123\"}]'::jsonb) returning id", [a]),
    comment: async (a, on) => ins(a, "insert into public.post_comments (user_id, target_type, target_id, body) values ($1, 'post', $2, 'This is not okay at all') returning id", [a, on]),
    apartment: (a, images = []) => ins(a, "insert into public.apartments (owner_id, title, description, price_per_month, address, images) values ($1, 'Two-bed by the river', 'Pool and gym', 900, '1 River Rd', $2) returning id", [a, images]),
    item: (a) => ins(a, "insert into public.items (seller_id, title, description, price, category) values ($1, 'Desk lamp', 'Barely used, works great', 15, 'furniture') returning id", [a]),
    roommate: (a) => ins(a, "insert into public.roommate_posts (author_id, post_type, title, description) values ($1, 'needs_room', 'Room wanted', 'Quiet student looking for a room.') returning id", [a]),
    buzz: async (a, text = "The east garage elevator is out again") => {
      await db.query("delete from public.buzz_rate_log");
      return (await asService(() => val(db.query("select public.buzz_v2_create($1, $2::jsonb, 'active', false, null)", [a, JSON.stringify({ text, title: "Garage" })])))).id;
    },
    reply: async (a, thread, text = "Third time this month, take the stairs") => {
      await db.query("delete from public.buzz_rate_log");
      return (await asService(() => val(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, 'active', false, null)", [a, thread, JSON.stringify({ text })])))).id;
    },
  };
  const TABLE = { post: "feed_posts", reel: "feed_posts", comment: "post_comments", apartment: "apartments", item: "items", roommate: "roommate_posts", buzz: "buzz_posts", buzz_comment: "buzz_comments" };
  const REPORT_TYPE = { reel: "post" };

  /** Report as uid. Public content: the API's insert; Buzz: buzz_v2_report. Returns Buzz's answer. */
  const report = async (uid, kind, id, reason = "harassment") => {
    if (kind === "buzz" || kind === "buzz_comment") return call(uid, "public.buzz_v2_report($1, $2, null)", [id, reason], {});
    await as(uid, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4)", [uid, REPORT_TYPE[kind] ?? kind, id, reason]));
  };
  const reportAll = async (uids, kind, id, reason) => { const out = []; for (const u of uids) out.push(await report(u, kind, id, reason)); return out; };
  /** Is the item visible to uid through the table's own policies? (Buzz: through the thread, which shows a placeholder.) */
  const sees = async (uid, kind, id) => {
    if (kind === "buzz") return (await call(uid, "public.buzz_v2_thread($1, 50)", [id], {})).root?.status === "active";
    if (kind === "buzz_comment") {
      const thread = (await one(db.query("select post_id from public.buzz_comments where id = $1", [id]))).post_id;
      const t = await call(uid, "public.buzz_v2_thread($1, 50)", [thread], {});
      return JSON.stringify(t).includes(id) && !JSON.stringify(t.replies ?? t.comments ?? t).includes('"status":"removed"') && (await statusOf(kind, id)).status === "active";
    }
    return Number(await as(uid, () => val(db.query(`select count(*) from public.${TABLE[kind]} where id = $1`, [id])))) === 1;
  };
  const statusOf = (kind, id) => one(db.query(`select to_jsonb(x) ->> 'status' as status, hidden_at, hidden_reason from public.${TABLE[kind]} x where id = $1`, [id]));
  const hiddenAt = async (kind, id) => (await statusOf(kind, id))?.hidden_at ?? null;
  const flags = (type, id) => db.query("select * from public.report_auto_hides where target_type = $1 and target_id = $2 order by created_at, hidden_at", [type, id]).then((r) => r.rows);
  const audits = (action, id) => db.query("select * from public.staff_audit_log where action = $1 and target_id = $2 order by id", [action, String(id)]).then((r) => r.rows);
  const notices = (uid, event) => db.query("select * from public.notifications where user_id = $1 and type = 'moderation' and data ->> 'event' = $2", [uid, event]).then((r) => r.rows);

  // Staff: CampConnect Admin's owner, an admin and a moderator.
  const OWNER = await person("Olivia Owner");
  await db.query("select public.admin_bootstrap_owner((select email from auth.users where id = $1))", [OWNER]);
  const ADMIN = await person("Ada Admin");
  const MOD = await person("Mo Derator");
  await db.query("insert into public.staff (user_id, role, granted_by) values ($1, 'admin', $3), ($2, 'moderator', $3)", [ADMIN, MOD, OWNER]);
  return { ...env, one, val, call, rowsAs, person, people, make, report, reportAll, sees, statusOf, hiddenAt, flags, audits, notices, OWNER, ADMIN, MOD, TX };
}

// =====================================================================================================================
// Production's schema (this repo's migrations with the four that reached production from outside it)
// =====================================================================================================================
const E = await setup({ live: true });
const { db, as, asAnon, call, rowsAs, person, people, make, report, reportAll, sees, statusOf, hiddenAt, flags, audits, notices, OWNER, ADMIN, MOD } = E;
await expectOk("the migration re-runs cleanly", () => db.exec(read(MIGRATION)));

const AUTHOR = await person("Alex Author");
const VIEWER = await person("Vera Viewer");
const R = await people(30, "Reporter");
const first9 = R.slice(0, 9);
const tenth = R[9];

// --- Every kind of content: 9 reports change nothing, the 10th hides it ------------------------------------------
const anchor = await make.post(AUTHOR, "The post comments hang off");
const targets = {
  post: await make.post(AUTHOR),
  reel: await make.reel(AUTHOR),
  comment: await make.comment(AUTHOR, anchor),
  apartment: await make.apartment(AUTHOR),
  item: await make.item(AUTHOR),
  roommate: await make.roommate(AUTHOR),
  buzz: await make.buzz(AUTHOR),
};
targets.buzz_comment = await make.reply(AUTHOR, await make.buzz(VIEWER, "Is the library open late tonight"));
// Trust & Safety hides Buzz at a weighted 3 on its own; staff approval makes an item immune to that, never to this.
await db.query("select public.buzz_v2_set_status('buzz', $1, 'active', true), public.buzz_v2_set_status('buzz_reply', $2, 'active', true)", [targets.buzz, targets.buzz_comment]);
const FLAG_TYPE = (kind) => (kind === "reel" ? "post" : kind);

for (const [kind, id] of Object.entries(targets)) {
  await expectOk(`${kind}: 9 people reporting it change nothing`, async () => {
    await reportAll(first9, kind, id, kind === "item" ? "scam" : "harassment");
    check(await sees(VIEWER, kind, id), "already hidden");
    check((await hiddenAt(kind, id)) === null, "hidden_at set");
    check((await flags(FLAG_TYPE(kind), id)).length === 0, "flagged");
  });
  await expectOk(`${kind}: the 10th hides it from everyone else, flags it, tells the owner, audits it`, async () => {
    await report(tenth, kind, id, "hate");
    check(!(await sees(VIEWER, kind, id)), "a viewer still sees it");
    check(!(await sees(R[20], kind, id)), "a reporter still sees it");
    check((await hiddenAt(kind, id)) !== null, "no hidden_at");
    const f = await flags(FLAG_TYPE(kind), id);
    check(f.length === 1 && f[0].status === "pending" && f[0].source === "report_threshold" && f[0].reporter_count === THRESHOLD, JSON.stringify(f));
    check(f[0].reasons.hate === 1 && Object.values(f[0].reasons).reduce((a, b) => a + b, 0) === THRESHOLD, JSON.stringify(f[0].reasons));
    const n = await notices(AUTHOR, "content_hidden");
    check(n.some((x) => x.actor_id === null && /hidden while our team reviews it/.test(x.title)), "owner not told");
    const a = await audits("content.auto_hide", id);
    check(a.length === 1 && a[0].actor_id === null && a[0].actor_email === null && a[0].details.reporter_count === THRESHOLD, JSON.stringify(a));
    const anon = kind === "buzz" || kind === "buzz_comment";
    check(anon ? !("author_id" in a[0].details) : a[0].details.author_id === AUTHOR, `author in audit: ${JSON.stringify(a[0].details)}`);
    const ts = await db.query("select * from public.audit_log where action = 'auto_hide' and target_id = $1", [id]);
    check(ts.rows.length === 1 && ts.rows[0].actor_role === "system", "no Trust & Safety audit row");
  });
  if (kind !== "buzz" && kind !== "buzz_comment") {
    await expectOk(`${kind}: its owner still sees it`, async () => check(await sees(AUTHOR, kind, id), "owner lost it"));
  }
}
await expectOk("reel: gone from reels_feed too", async () => {
  const feed = await rowsAs(VIEWER, "select source_id from public.reels_feed(null, 100, 0)", [], {});
  check(!feed.some((r) => r.source_id === targets.reel), "still in reels_feed");
});
await expectOk("buzz: gone from the feed, its author keeps it", async () => {
  const feed = await call(VIEWER, "public.buzz_v2_feed('campus', 'new', 'day', null, 50, 0, null)", [], {});
  check(!feed.items.some((b) => b.id === targets.buzz), "still in the feed");
  const mine = await call(AUTHOR, "public.buzz_v2_mine('threads', 0, 20)", [], {});
  check(mine.items.some((m) => m.item.id === targets.buzz), "the author lost it");
});
await expectOk("a hidden comment's copy in the post owner's notifications is blanked, as for a staff hide", async () => {
  const n = await db.query("select body from public.notifications where type = 'comment' and data ->> 'comment_id' = $1", [targets.comment]);
  check(n.rows.every((x) => x.body === null), JSON.stringify(n.rows));
});

// --- Who counts ---------------------------------------------------------------------------------------------------
const P = await make.post(AUTHOR, "A post for the manipulation checks");
await expectOk("a repeat report is a quiet no-op and counts once", async () => {
  await reportAll(first9, "post", P);
  await reportAll(first9, "post", P);
  const c = await db.query("select count(*)::int as n from public.reports where target_id = $1", [P]);
  check(c.rows[0].n === 9, `stored ${c.rows[0].n}`);
  check(await sees(VIEWER, "post", P), "hidden by repeats");
});
await expectError("a reporter cannot set eligibility, weight or status", () => as(R[25], () => db.query(
  "insert into public.reports (reporter_id, target_type, target_id, reason, eligible, weight, status) values ($1, 'post', $2, 'spam', true, 2, 'open')", [R[25], P])), "permission denied");
await expectError("the author cannot report their own post", () => report(AUTHOR, "post", P), "own content");
await expectOk("none of these count: a new account, an unconfirmed email, a suspended, muted, banned or low-trust person, a self-harm report", async () => {
  const young = await person("Young Account", { days: 0 });
  const unconfirmed = await person("Una Confirmed", { confirmed: false });
  const suspended = await person("Sus Pended");
  await call(OWNER, "public.admin_user_suspend($1, 'Spamming the feed')", [suspended]);
  const muted = await person("Mute Dperson");
  await db.query("insert into public.user_sanctions (user_id, kind, scope, origin, effective_at, expires_at) values ($1, 'mute', 'all', 'public', now(), now() + interval '1 day')", [muted]);
  const banned = await person("Ban Nedperson");
  await db.query("update auth.users set banned_until = now() + interval '30 days' where id = $1", [banned]);
  const lowTrust = await person("Low Trust");
  const old = await make.post(VIEWER, "Something lowTrust reported in bad faith");
  await report(lowTrust, "post", old);
  await db.query("update public.reports set status = 'dismissed', bad_faith = true, closed_at = now() where reporter_id = $1", [lowTrust]);
  const worried = await person("Worried Friend");
  for (const u of [young, unconfirmed, suspended, muted, banned, lowTrust]) await report(u, "post", P).catch(() => undefined);
  await report(worried, "post", P, "self_harm");
  check(await sees(VIEWER, "post", P), "hidden by people who do not count");
  check((await flags("post", P)).length === 0, "flagged");
});
await expectOk("someone suspended after reporting stops counting", async () => {
  await call(OWNER, "public.admin_user_suspend($1, 'Coordinated reporting')", [R[0]]);
  await report(tenth, "post", P);
  check(await sees(VIEWER, "post", P), "hidden with a suspended reporter counted");
  await call(OWNER, "public.admin_user_unsuspend($1)", [R[0]]);
});
await expectOk("... and once 10 legitimate people remain, the next report hides it", async () => {
  await report(R[10], "post", P);
  check(!(await sees(VIEWER, "post", P)), "not hidden");
  check((await flags("post", P))[0].reporter_count === 11, JSON.stringify(await flags("post", P)));
});
await expectOk("the author blocking reporters afterwards does not cancel their reports", async () => {
  const Q = await make.post(AUTHOR, "A post whose author blocks the reporters");
  await reportAll(first9, "post", Q);
  for (const u of first9.slice(0, 5)) await as(AUTHOR, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [AUTHOR, u]));
  await report(R[11], "post", Q);
  check((await hiddenAt("post", Q)) !== null, "blocking cancelled the reports");
  for (const u of first9.slice(0, 5)) await db.query("delete from public.blocks where blocker_id = $1 and blocked_id = $2", [AUTHOR, u]);
});
await expectError("the daily report limit still applies", async () => {
  const busy = await person("Busy Reporter");
  for (let i = 0; i < 21; i++) await report(busy, "post", await make.post(VIEWER, `Post number ${i} for the rate limit`), "spam");
}, "a lot of reports");

// --- Buzz -----------------------------------------------------------------------------------------------------------
await expectOk("Buzz: Trust & Safety's own hide at 3 still works, and is flagged as its own", async () => {
  const b = await make.buzz(AUTHOR, "Who keeps leaving carts in the stairwell");
  await reportAll(R.slice(0, 3), "buzz", b);
  check((await statusOf("buzz", b)).status === "hidden", JSON.stringify(await statusOf("buzz", b)));
  const f = await flags("buzz", b);
  check(f.length === 1 && f[0].source === "trust_safety" && f[0].status === "pending", JSON.stringify(f));
  const a = await audits("content.auto_hide", b);
  check(a.length === 1 && a[0].details.source === "trust_safety" && !("author_id" in a[0].details), JSON.stringify(a));
});
await expectOk("Buzz: a reporter is told the same thing whether or not their report hid it", async () => {
  const b = await make.buzz(AUTHOR, "Parking tickets on Sunday again");
  await db.query("select public.buzz_v2_set_status('buzz', $1, 'active', true)", [b]);
  const answers = await reportAll(R.slice(0, THRESHOLD), "buzz", b);
  check((await statusOf("buzz", b)).status === "hidden", "not hidden");
  check(new Set(answers.map((x) => JSON.stringify(x))).size === 1, JSON.stringify(answers));
});
await expectOk("Buzz: nothing staff read about a flag names its author", async () => {
  const cols = await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'report_auto_hides'");
  check(!cols.rows.some((c) => /author|user/.test(c.column_name)), JSON.stringify(cols.rows));
  const list = await rowsAs(MOD, "select * from public.admin_auto_hidden_list('all', 200, null)");
  const buzzRows = list.filter((x) => x.target_type === "buzz" || x.target_type === "buzz_comment");
  check(buzzRows.length >= 3 && buzzRows.every((x) => x.author_id === null && x.author_name === null), JSON.stringify(buzzRows));
  const pub = list.find((x) => x.target_id === targets.post);
  check(pub && pub.author_id === AUTHOR, "public rows lost their author");
});

// --- Review: restore, keep hidden, delete ---------------------------------------------------------------------------
const reportsOf = (id) => db.query("select reporter_id, status, decision, reviewed_by from public.reports where target_id = $1", [id]).then((r) => r.rows);
await expectOk("restore: back for everyone, reports dismissed, flag restored, owner and reporters told", async () => {
  await call(MOD, "public.admin_content_restore('post', $1)", [targets.post]);
  check(await sees(VIEWER, "post", targets.post), "still hidden");
  const reps = await reportsOf(targets.post);
  check(reps.length === THRESHOLD && reps.every((r) => r.status === "dismissed" && r.decision === "dismissed" && r.reviewed_by === MOD), JSON.stringify(reps));
  const f = await flags("post", targets.post);
  check(f[0].status === "restored" && f[0].reviewed_by === MOD, JSON.stringify(f));
  check((await notices(AUTHOR, "content_restored")).length >= 1, "owner not told");
  check((await notices(R[0], "report_resolved")).length >= 1, "reporter not told");
  const a = await audits("content.restore", targets.post);
  check(a.length === 1 && a[0].actor_id === MOD, JSON.stringify(a));
});
await expectOk("restore: the same 10 people cannot hide it again", async () => {
  await reportAll(R.slice(0, THRESHOLD), "post", targets.post);
  check(await sees(VIEWER, "post", targets.post), "re-hidden by the same reports");
});
await expectOk("restore: 9 new people do not either; a 10th new one does", async () => {
  const fresh = R.slice(12, 22);
  await reportAll(fresh.slice(0, 9), "post", targets.post);
  check(await sees(VIEWER, "post", targets.post), "hidden by 9 new reports");
  await report(fresh[9], "post", targets.post);
  check(!(await sees(VIEWER, "post", targets.post)), "10 new reports did not hide it");
  const f = await flags("post", targets.post);
  check(f.length === 2 && f[1].status === "pending" && f[1].reporter_count === THRESHOLD, JSON.stringify(f));
});
await expectOk("keep hidden: stays hidden, flag upheld, reports actioned, owner told, audited", async () => {
  const flag = (await flags("post", targets.post))[1];
  await call(MOD, "public.admin_auto_hide_uphold($1, 'Targeted harassment, confirmed')", [flag.id]);
  check(!(await sees(VIEWER, "post", targets.post)), "visible again");
  const s = await statusOf("post", targets.post);
  check(s.hidden_reason === "Kept hidden after review", JSON.stringify(s));
  const f = (await flags("post", targets.post))[1];
  check(f.status === "upheld" && f.reviewed_by === MOD && f.review_note === "Targeted harassment, confirmed", JSON.stringify(f));
  const open = (await reportsOf(targets.post)).filter((r) => r.status === "actioned");
  check(open.length === THRESHOLD && open.every((r) => r.decision === "content_hidden"), JSON.stringify(open));
  check((await notices(AUTHOR, "content_kept_hidden")).length === 1, "owner not told");
  check((await audits("content.auto_hide_upheld", targets.post)).length === 1, "not audited");
});
await expectError("keep hidden: only once", async () => call(MOD, "public.admin_auto_hide_uphold($1)", [(await flags("post", targets.post))[1].id]), "already reviewed");
await expectOk("restore of a Buzz item: it comes back as it was, and needs 10 new people too", async () => {
  await call(MOD, "public.admin_content_restore('buzz', $1)", [targets.buzz]);
  const s = await statusOf("buzz", targets.buzz);
  check(s.status === "active" && s.hidden_at === null, JSON.stringify(s));
  check((await flags("buzz", targets.buzz))[0].status === "restored", "flag not settled");
  await reportAll(R.slice(0, THRESHOLD), "buzz", targets.buzz);
  check((await statusOf("buzz", targets.buzz)).status === "active", "re-hidden by the same reports");
});
await expectOk("people whose reports staff keep dismissing stop counting (Trust & Safety's reporter trust)", async () => {
  const brigade = await people(THRESHOLD, "Brigade");
  for (let round = 0; round < 3; round++) {
    const id = await make.post(VIEWER, `Harmless post number ${round}`);
    await reportAll(brigade, "post", id);
    check(!(await sees(AUTHOR, "post", id)), `round ${round} not hidden`);
    await call(MOD, "public.admin_content_restore('post', $1)", [id]);
  }
  const next = await make.post(VIEWER, "Another harmless post");
  await reportAll(brigade, "post", next);
  check(await sees(AUTHOR, "post", next), "a brigade restored three times still hides content");
  const w = await db.query("select count(*) filter (where eligible)::int as n from public.reports where target_id = $1", [next]);
  check(w.rows[0].n === 0, `eligible: ${w.rows[0].n}`);
});

// An apartment with photos the owner uploaded, so the media queue can be checked.
const PHOTO = (owner) => `https://proj.supabase.co/storage/v1/object/public/uploads/apartments/${owner}/1.jpg`;
const APT = await make.apartment(AUTHOR, [PHOTO(AUTHOR)]);
await expectOk("a hide queues the owner's photos for quarantine, as a staff hide does", async () => {
  await reportAll(R.slice(0, THRESHOLD), "apartment", APT);
  const jobs = await db.query("select kind, ref from public.media_jobs where target_id = $1", [APT]);
  check(jobs.rows.some((j) => j.kind === "quarantine" && j.ref === `apartments/${AUTHOR}/1.jpg`), JSON.stringify(jobs.rows));
});
await expectError("delete: moderators cannot", () => call(MOD, "public.admin_content_delete('apartment', $1, 'Scam listing')", [APT]), "Not allowed");
await expectOk("delete: an admin can; flag deleted, reports actioned, owner told, files queued for removal", async () => {
  await call(ADMIN, "public.admin_content_delete('apartment', $1, 'Scam listing, confirmed')", [APT]);
  check((await db.query("select 1 from public.apartments where id = $1", [APT])).rows.length === 0, "still there");
  const f = await flags("apartment", APT);
  check(f[0].status === "deleted" && f[0].reviewed_by === ADMIN, JSON.stringify(f));
  const reps = await reportsOf(APT);
  check(reps.every((r) => r.status === "actioned" && r.decision === "content_deleted"), JSON.stringify(reps));
  check((await notices(AUTHOR, "content_removed")).length === 1, "owner not told");
  const jobs = await db.query("select kind from public.media_jobs where ref = $1 and done_at is null", [`apartments/${AUTHOR}/1.jpg`]);
  check(jobs.rows.some((j) => j.kind === "delete_object"), JSON.stringify(jobs.rows));
});
await expectOk("content its author deletes leaves no pending flag", async () => {
  await as(AUTHOR, () => db.query("delete from public.items where id = $1", [targets.item]));
  check((await flags("item", targets.item))[0].status === "deleted", JSON.stringify(await flags("item", targets.item)));
});
await expectOk("the reports queue lists actioned reports under reviewed", async () => {
  const reviewed = await rowsAs(MOD, "select * from public.admin_reports_list('reviewed', 200, null)");
  check(reviewed.some((r) => r.status === "actioned" && r.target_id === targets.post), "actioned reports missing");
});
await expectOk("one item's flags, newest first (the content page's panel)", async () => {
  const mine = await rowsAs(MOD, "select * from public.admin_auto_hidden_list('all', 10, null, 'post', $1)", [targets.post]);
  check(mine.length === 2 && mine.every((f) => f.target_id === targets.post) && mine[0].status === "upheld" && mine[1].status === "restored", JSON.stringify(mine));
  check((await rowsAs(MOD, "select * from public.admin_auto_hidden_list('pending', 10, null, 'post', $1)", [targets.post])).length === 0, "pending filter");
});
await expectOk("counts per status", async () => {
  const c = await call(MOD, "public.admin_auto_hidden_counts()");
  check(c.upheld >= 1 && c.restored >= 2 && c.deleted >= 2 && c.pending >= 4, JSON.stringify(c));
});

// --- The website console agrees ---------------------------------------------------------------------------------------
await expectOk("console: a hidden public item is listed as auto-hidden", async () => {
  const q = await call(MOD, "public.console_queue('auto_hidden', 100, 0, '{}'::jsonb)");
  check(q.items.some((i) => i.entityId === targets.comment && i.contentStatus === "hidden"), JSON.stringify(q.items.map((i) => [i.entityType, i.contentStatus])));
});
await expectOk("console: approving it brings it back, settles the flag, tells the owner", async () => {
  const before = (await notices(AUTHOR, "content_restored")).length;
  const qid = (await db.query("select id from public.mod_queue where entity_type = 'comment' and entity_id = $1 and status <> 'closed'", [targets.comment])).rows[0].id;
  await call(MOD, "public.console_act($1, 'approve', 'harassment_bullying', 'Fine on review')", [qid]);
  check(await sees(VIEWER, "comment", targets.comment), "still hidden");
  check((await flags("comment", targets.comment))[0].status === "restored", "flag not settled");
  check((await notices(AUTHOR, "content_restored")).length === before + 1, "owner not told");
});

// --- Permissions ------------------------------------------------------------------------------------------------------
await expectError("the flags table is closed to students", () => as(VIEWER, () => db.query("select * from public.report_auto_hides")), "permission denied");
await expectError("... and to visitors", () => asAnon(() => db.query("select * from public.report_auto_hides")), "permission denied");
for (const fn of [
  "public.report_auto_hide_evaluate('post', gen_random_uuid())", "public.report_auto_hide_count('post', gen_random_uuid())",
  "public.report_auto_hide_settle('post', gen_random_uuid(), 'restored', null)", "public.moderation_content_hide('post', gen_random_uuid(), 'x')",
  "public.moderation_content_restore('post', gen_random_uuid())", "public.report_hidden_at('post', gen_random_uuid())",
  "public.report_auto_hide_tell_owner('post', gen_random_uuid(), '{}'::jsonb, 'content_restored')",
  "public.report_auto_hide_close('post', gen_random_uuid(), 'dismissed', 'dismissed', null, null, 'approved')",
]) {
  await expectError(`students cannot call ${fn.split("(")[0]}`, () => call(VIEWER, fn, [], {}), "permission denied");
}
for (const fn of ["public.admin_auto_hidden_list()", "public.admin_auto_hidden_list('all', 1, null, 'post', gen_random_uuid())", "public.admin_auto_hidden_counts()", "public.admin_auto_hide_uphold(gen_random_uuid())"]) {
  await expectError(`${fn.split("(")[0]} refuses students`, () => call(VIEWER, fn), "Not allowed");
  await expectError(`${fn.split("(")[0]} refuses visitors`, () => asAnon(() => db.query(`select ${fn}`)), "permission denied");
  await expectError(`${fn.split("(")[0]} needs two-factor sign-in`, () => call(MOD, fn, [], {}), "Two-factor authentication required");
}
await expectError("an unknown status is refused", () => call(MOD, "public.admin_auto_hidden_list('nope')"), "Invalid status");

// =====================================================================================================================
// Production as it is today: this migration applied alone, ahead of the ones not live yet
// =====================================================================================================================
{
  const T = await setup({ live: true, skip: NOT_LIVE });
  await expectOk("today's production: the migration applies and re-runs", () => T.db.exec(read(MIGRATION)));
  const author = await T.person("Tara Today");
  const viewer = await T.person("Vic Today");
  for (const kind of ["post", "comment", "roommate", "buzz"]) {
    // New people for each kind: three dismissed reports would make anyone low-trust (checked above).
    const rs = await T.people(THRESHOLD, `Today ${kind} Reporter`);
    await expectOk(`today's production: ${kind} hides at 10, restores, and the same reports cannot hide it again`, async () => {
      const id = kind === "comment" ? await T.make.comment(author, await T.make.post(author)) : await T.make[kind](author);
      if (kind === "buzz") await T.db.query("select public.buzz_v2_set_status('buzz', $1, 'active', true)", [id]);
      await T.reportAll(rs.slice(0, 9), kind, id);
      check(await T.sees(viewer, kind, id), "hidden at 9");
      await T.report(rs[9], kind, id);
      check(!(await T.sees(viewer, kind, id)), "visible at 10");
      check((await T.flags(kind, id))[0]?.status === "pending", "not flagged");
      await T.call(T.MOD, `public.admin_content_restore('${kind}', $1)`, [id]);
      await T.reportAll(rs.slice(0, THRESHOLD), kind, id);
      check(await T.sees(viewer, kind, id), "re-hidden by the same reports");
    });
  }
}

// =====================================================================================================================
// This repo's schema alone (no CampConnect Admin): nothing to hide public content with, so nothing changes
// =====================================================================================================================
{
  const { db: rdb, mk, as: ras } = await boot();
  await expectOk("repo schema: the migration re-runs, and the CampConnect Admin parts are not created", async () => {
    await rdb.exec(read(MIGRATION));
    const r = (await rdb.query("select to_regprocedure('public.admin_auto_hidden_list(text,int,timestamptz)') as a, to_regprocedure('public.moderation_content_hide(text,uuid,text)') as m")).rows[0];
    check(r.a === null && r.m === null, JSON.stringify(r));
  });
  await expectOk("repo schema: 10 reports raise no error and flag nothing", async () => {
    const a = await mk("repo.author@txstate.edu", "Repo Author");
    const post = (await ras(a, () => rdb.query("insert into public.feed_posts (author_id, kind, body) values ($1, 'post', 'Hello') returning id", [a]))).rows[0].id;
    for (let i = 0; i < THRESHOLD; i++) {
      const u = await mk(`repo.r${i}@txstate.edu`, `Repo Reporter${i}`);
      await rdb.query("update public.profiles set created_at = now() - interval '30 days' where id = $1", [u]);
      await ras(u, () => rdb.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'harassment')", [u, post]));
    }
    check((await rdb.query("select count(*)::int as n from public.report_auto_hides")).rows[0].n === 0, "flagged");
    check((await rdb.query("select count(*)::int as n from public.reports where target_id = $1", [post])).rows[0].n === THRESHOLD, "reports lost");
  });
}

done("REPORT-AUTO-HIDE");

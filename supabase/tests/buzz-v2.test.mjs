// =============================================================================
// Buzz v2 (migration 42), offline in PGlite. Ports UniVerse's server/tests/buzz.test.ts, buzz-media-search.test.ts and
// hardening/buzz-*.test.ts: the anonymity firewall over every function's output (forbidden keys + every test user's
// id / name / username / email), aliases, minute-floored times, publication jitter, the block oracle, 404 parity, the
// gate, public-signal isolation, polls, votes and the community thresholds (eligible vs ineligible voters),
// milestones, anonymous notifications, reports through migration 41, rate limits, media checks, small campuses, the
// adapters Trust & Safety uses, the old-function stubs, and the conversion of data written by the old functions.
// Usage: node supabase/tests/buzz-v2.test.mjs
// =============================================================================
import crypto from "node:crypto";
import { boot, read, ok, fail, expectOk, done } from "./harness.mjs";
import { buzzSearchTerms } from "../../packages/shared/src/buzz/helpers.ts";
import { BUZZ_AUTO_HIDE, BUZZ_COLLAPSE, BUZZ_GUIDELINES_VERSION, BUZZ_LIMITS, BUZZ_MILESTONES } from "../../packages/shared/src/buzz/constants.ts";

const V2 = "migrations/20261103000100_buzz_v2.sql";
const OLD = ["20260920000000_home_feed.sql", "20260921000000_buzz_storage_folder.sql", "20260922000000_buzz_reply_votes.sql"];
const MIN = 60_000;
const VERSION = BUZZ_GUIDELINES_VERSION;
const ORIGIN = "https://dskbzoqreandwwpxiplh.supabase.co/storage/v1/object/public/uploads/";
// UniVerse's lists (server/src/services/buzz/alias.ts), to check the database derives exactly the same aliases.
const EMOJI = ["☄️", "🌟", "🌌", "🌙", "🪐", "🚀", "🛰️", "🌠", "☀️", "🌍", "🔭", "👽", "🛸", "🌑", "⭐", "✨", "🌀", "⚡", "🔥", "❄️", "🌊", "🌪️", "🌈", "☁️", "🦊", "🦉", "🐺", "🦅", "🐙", "🐬", "🦋", "🐝", "🦎", "🐢", "🦈", "🐼", "🦁", "🐯", "🐻", "🦌", "🦜", "🦩", "🦔", "🦦", "🌵", "🍄", "🌻", "🍀", "🌲", "🍁", "🌸", "🥑", "🍋", "🍉", "🥨", "🍩", "🧊", "💎", "🎲", "🧭", "🎧", "🪁", "🔮", "🗝️"];
const NOUNS = ["Comet", "Nova", "Nebula", "Moon", "Saturn", "Rocket", "Satellite", "Meteor", "Sol", "Terra", "Scope", "Alien", "Saucer", "Eclipse", "Star", "Spark", "Vortex", "Bolt", "Ember", "Frost", "Tide", "Cyclone", "Prism", "Cloud", "Fox", "Owl", "Wolf", "Falcon", "Kraken", "Dolphin", "Moth", "Bee", "Gecko", "Turtle", "Shark", "Panda", "Lion", "Tiger", "Bear", "Stag", "Parrot", "Flamingo", "Hedgehog", "Otter", "Cactus", "Mushroom", "Sunflower", "Clover", "Pine", "Maple", "Blossom", "Avocado", "Lemon", "Melon", "Pretzel", "Donut", "Cube", "Gem", "Dice", "Compass", "Headphones", "Kite", "Oracle", "Key"];
const COLORS = ["#7C9BFF", "#5EEAD4", "#F472B6", "#FBBF24", "#A78BFA", "#34D399", "#FB7185", "#38BDF8", "#F97316", "#A3E635", "#E879F9", "#94A3B8"];
const BUZZ_KEYS = ["alias", "campusShortName", "collapsed", "createdAt", "id", "isMine", "isOp", "kind", "locked", "media", "myVote", "poll", "promptId", "replyCount", "scope", "score", "status", "supportLink", "text", "threadId", "title"];
const REPLY_KEYS = ["alias", "collapsed", "createdAt", "depth", "id", "isMine", "isOp", "kind", "myVote", "parentId", "replyingTo", "score", "status", "supportLink", "text", "threadId"];
const FORBIDDEN = new Set(["authorId", "author_id", "userId", "user_id", "handle", "name", "displayName", "avatar", "avatarUrl", "email", "universityEmail", "profile"]);

// ---- plumbing ------------------------------------------------------------------------------------------------------
function harness(h) {
  const { db, mk, as, asAnon, asService } = h;
  const one = async (p) => (await p).rows[0];
  const val = async (p) => {
    const row = (await p).rows[0];
    return row ? row[Object.keys(row)[0]] : undefined;
  };
  const served = [];
  const keep = (label, body) => {
    served.push([label, body]);
    return body;
  };
  const call = (uid, fn, args = [], label = fn) =>
    as(uid, () => val(db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).then((r) => keep(label, r));
  const uniId = async (name) => (await one(db.query("select id from public.universities where name = $1", [name]))).id;
  let identityCache = null;
  const identities = async () => {
    if (identityCache) return identityCache;
    const rows = (await db.query("select p.id::text as id, p.full_name, p.username, u.email from public.profiles p left join auth.users u on u.id = p.id")).rows;
    const out = new Set();
    for (const r of rows) for (const v of [r.id, r.full_name, r.username, r.email, ...String(r.full_name ?? "").split(/\s+/)]) if (v && v.length >= 4) out.add(v.toLowerCase());
    return (identityCache = [...out]);
  };
  const user = async (name, { uni, ageDays = 30, gate = true, id = null } = {}) => {
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@txstate.edu`;
    const uid = id
      ? (await one(db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) returning id", [id, email, JSON.stringify({ full_name: name })]))).id
      : await mk(email, name);
    await db.query("update public.profiles set university_id = $2, created_at = now() - make_interval(days => $3::int) where id = $1", [uid, uni, ageDays]);
    if (gate) await as(uid, () => db.query("select public.buzz_v2_accept_gate($1)", [VERSION]));
    identityCache = null;
    return uid;
  };
  const clearRates = (uid) => db.query("delete from public.buzz_rate_log where user_id = $1", [uid]);
  const create = async (uid, input, { status = "active", support = false, moderation = null, keepRate = false } = {}) => {
    if (!keepRate) await clearRates(uid);
    return keep("buzz_v2_create", await asService(() => val(db.query("select public.buzz_v2_create($1, $2::jsonb, $3, $4, $5::jsonb) as r",
      [uid, JSON.stringify(input), status, support, moderation === null ? null : JSON.stringify(moderation)]))));
  };
  const reply = async (uid, thread, input, { status = "active", support = false, moderation = null, keepRate = false } = {}) => {
    if (!keepRate) await clearRates(uid);
    return keep("buzz_v2_reply", await asService(() => val(db.query("select public.buzz_v2_reply($1, $2, $3::jsonb, $4, $5, $6::jsonb) as r",
      [uid, thread, JSON.stringify(typeof input === "string" ? { text: input } : input), status, support, moderation === null ? null : JSON.stringify(moderation)]))));
  };
  const feed = (uid, o = {}) =>
    call(uid, "buzz_v2_feed", [o.scope ?? "campus", o.sort ?? "new", o.window ?? "day", o.q ?? null, o.limit ?? 50, o.offset ?? 0, o.rankAt ?? null],
      `feed ${o.scope ?? "campus"}/${o.sort ?? "new"}/${o.window ?? "day"}${o.q ? ` q=${o.q}` : ""}`);
  const ids = async (uid, o) => (await feed(uid, o)).items.map((b) => b.id);
  const thread = (uid, id, limit = 50) => call(uid, "buzz_v2_thread", [id, limit]);
  const replies = (uid, id, offset = 0, limit = 50) => call(uid, "buzz_v2_replies", [id, offset, limit]);
  const vote = (uid, id, value) => call(uid, "buzz_v2_vote", [id, value]);
  const notes = (uid) => db.query("select * from public.notifications where user_id = $1 and type like 'buzz%' order by created_at, id", [uid]).then((r) => r.rows);
  return { db, mk, as, asAnon, asService, one, val, served, keep, call, uniId, identities, user, clearRates, create, reply, feed, ids, thread, replies, vote, notes };
}

const errorOf = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e.message);
  }
};
async function expectCode(name, fn, code) {
  const msg = await errorOf(fn);
  if (msg === null) fail(name, "no error");
  else if (msg.startsWith(`buzz:${code}:`)) ok(name);
  else fail(name, msg);
}
const mustFail = async (fn, code, what) => {
  const msg = await errorOf(fn);
  if (msg === null || !msg.startsWith(`buzz:${code}:`)) throw new Error(`${what}: expected buzz:${code}, got ${msg}`);
};
const mustDeny = async (fn, what) => {
  const msg = await errorOf(fn);
  if (!/permission denied/.test(msg ?? "")) throw new Error(`${what}: expected permission denied, got ${msg}`);
};
const walk = (v, path, visit) => {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    visit(k, `${path}.${k}`, x);
    walk(x, `${path}.${k}`, visit);
  }
};
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const hex = (n) => crypto.randomBytes(n).toString("hex").slice(0, n);

// The firewall (UniVerse assertNoForbiddenKeys + assertNoIdentityLeak + minute-floored times). meta.campus.name is the
// viewer's own university, fixed by BuzzFeedMeta in packages/shared/src/buzz/types.ts: the one allowed "name" key.
async function firewall(t, label, body, { allow = [] } = {}) {
  const hits = [];
  walk(body, "$", (k, p, x) => {
    if (FORBIDDEN.has(k) && !allow.includes(p)) hits.push(p);
    if ((k === "createdAt" || k === "closesAt") && x !== null && (typeof x !== "number" || x % MIN !== 0)) hits.push(`${p}=${x} (not a minute)`);
  });
  if (hits.length) throw new Error(`${label}: ${hits.join(", ")}`);
  const text = JSON.stringify(body ?? null).toLowerCase();
  const leaks = (await t.identities()).filter((s) => text.includes(s));
  if (leaks.length) throw new Error(`${label}: identity leak (${leaks.slice(0, 3).join(", ")})`);
}

// =============================================================================
// World 1: everything written through v2
// =============================================================================
const T = harness(await boot());
const { db, as, asAnon, asService, one, val, call, user, create, reply, feed, ids, thread, replies, vote, notes } = T;
await db.exec(read(V2)); // the seed ran after the migrations: once more, so the seeded Texas State gets its short name
await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
const TXST = await T.uniId("Texas State University");
const UTA = await T.uniId("University of Texas at Austin");
const SALT = (await one(db.query("select salt from public.buzz_secrets where id = 1"))).salt;
const digest = (threadId, key) => crypto.createHash("sha256").update(`${SALT}${threadId}:${key}`, "utf8").digest();
const aliasOf = (threadId, key, suffix = 0) => {
  const d = digest(threadId, key);
  const n = d.readUInt16BE(0) % 64;
  return { emoji: EMOJI[n], label: `Anon ${NOUNS[n]}${suffix > 0 ? ` ${suffix + 1}` : ""}`, color: COLORS[d.readUInt16BE(2) % 12] };
};

const OP = await user("Quinn Harlow", { uni: TXST });
const R1 = await user("Rowan Vale", { uni: TXST });
const R2 = await user("Juniper Okafor", { uni: TXST });
const R3 = await user("Thaddeus Pryce", { uni: TXST });
const VIEW = await user("Marisol Ventura", { uni: TXST });
const FRESH = await user("Ezra Lindqvist", { uni: TXST, ageDays: 0 });
const FAR = await user("Delphine Arceneaux", { uni: UTA });
const NOUNI = await user("Bram Kowalczyk", { uni: null });
const UNGATED = await user("Ottoline Fairweather", { uni: TXST, gate: false });

// ---- 1. access, the gate, who may call what --------------------------------------------------------------------------
const TABLES = ["buzz_posts", "buzz_comments", "buzz_votes", "buzz_comment_votes", "buzz_mutes", "buzz_rate_log", "buzz_secrets", "buzz_prompts", "buzz_polls",
  "buzz_poll_options", "buzz_poll_votes", "buzz_hidden_threads", "buzz_milestones", "buzz_gate", "buzz_notification_refs"];
await expectOk("every Buzz table is closed to the API, signed in or not, for reading and for writing (no row estimates either)", async () => {
  for (const t of TABLES) {
    await mustDeny(() => as(OP, () => db.query(`select * from public.${t} limit 1`)), `authenticated reads ${t}`);
    await mustDeny(() => asAnon(() => db.query(`select * from public.${t} limit 1`)), `anon reads ${t}`);
    await mustDeny(() => as(OP, () => db.query(`delete from public.${t}`)), `authenticated deletes ${t}`);
  }
  await mustDeny(() => as(OP, () => db.query("insert into public.buzz_posts (author_id, title, body, score) values ($1, 'forged', 'x', 999)", [OP])), "forged thread");
  await mustDeny(() => as(OP, () => db.query("insert into public.buzz_gate (user_id, version) values ($1, '2099-01-01')", [OP])), "forged gate");
  // the replies' arrival counter would date reply writes exactly
  const seq = await val(db.query("select pg_get_serial_sequence('public.buzz_comments', 'seq')"));
  for (const role of ["anon", "authenticated"]) {
    if (await val(db.query("select has_sequence_privilege($1, $2, 'select') or has_sequence_privilege($1, $2, 'usage')", [role, seq]))) throw new Error(`${role} may read ${seq}`);
  }
  await mustDeny(() => as(OP, () => db.query(`select last_value from ${seq}`)), "reading the reply counter");
});
await expectOk("the database and the shared constants agree on the guidelines version and the limits", async () => {
  if ((await val(db.query("select public.buzz_guidelines_version()"))) !== VERSION) throw new Error("version mismatch");
  if (BUZZ_LIMITS.title !== 100 || BUZZ_LIMITS.text !== 500 || BUZZ_LIMITS.replyText !== 500 || BUZZ_LIMITS.images !== 4 || BUZZ_LIMITS.pollOptionText !== 60 || BUZZ_LIMITS.search !== 80) throw new Error("limits changed: update migration 42 too");
  if (BUZZ_COLLAPSE.score !== -5 || BUZZ_COLLAPSE.votes !== 8 || BUZZ_AUTO_HIDE.score !== -10 || BUZZ_AUTO_HIDE.votes !== 12) throw new Error("thresholds changed: update migration 42 too");
  if (JSON.stringify(BUZZ_MILESTONES) !== "[10,25,50,100,250]") throw new Error("milestones changed: update migration 42 too");
});

const first = await create(OP, { text: "The second-floor study rooms are finally quiet again", title: "Quiet floor" });
await expectOk("the gate: before acceptance every Buzz read and interaction answers buzz_gate_required; the gate, acceptance and posting status work", async () => {
  const g = await call(UNGATED, "buzz_v2_gate");
  if (g.accepted !== false || g.acceptedVersion !== null || g.currentVersion !== VERSION) throw new Error(JSON.stringify(g));
  const gated = [
    ["buzz_v2_feed", ["campus", "hot", "day", null, 20, 0, null]], ["buzz_v2_meta", ["campus"]], ["buzz_v2_thread", [first.id, 50]],
    ["buzz_v2_replies", [first.id, 0, 50]], ["buzz_v2_vote", [first.id, 1]], ["buzz_v2_poll_vote", [first.id, first.id]], ["buzz_v2_delete", [first.id]],
    ["buzz_v2_hide_thread", [first.id, true]], ["buzz_v2_hide_author", [first.id]], ["buzz_v2_mine", ["threads", 0, 20]], ["buzz_v2_karma", []],
    ["buzz_v2_report", [first.id, "spam_scam", null]], ["buzz_v2_share_snapshot", [first.id]],
  ];
  for (const [fn, args] of gated) await mustFail(() => call(UNGATED, fn, args), "buzz_gate_required", fn);
  const status = await call(UNGATED, "buzz_v2_posting_status");
  if (status.allowed !== true || status.pollsUnlockAt !== null) throw new Error(JSON.stringify(status));
  await mustFail(() => create(UNGATED, { text: "before the gate" }), "buzz_gate_required", "the write API checks the gate too");
  await mustFail(() => reply(UNGATED, first.id, "before the gate"), "buzz_gate_required", "replies check the gate too");
  await mustFail(() => call(UNGATED, "buzz_v2_accept_gate", ["2020-01-01"]), "validation_failed", "an old version");
  const accepted = await call(UNGATED, "buzz_v2_accept_gate", [VERSION]);
  if (!accepted.accepted || accepted.acceptedVersion !== VERSION) throw new Error(JSON.stringify(accepted));
  if (!(await ids(UNGATED, { sort: "new" })).includes(first.id)) throw new Error("feed after acceptance");
  // a bumped version asks again
  await db.query("update public.buzz_gate set version = '2026-01-01' where user_id = $1", [UNGATED]);
  await mustFail(() => feed(UNGATED), "buzz_gate_required", "an outdated acceptance");
  await call(UNGATED, "buzz_v2_accept_gate", [VERSION]);
});
await expectOk("signed-out visitors can call no Buzz function at all", async () => {
  for (const sql of ["select public.buzz_v2_feed()", "select public.buzz_v2_gate()", "select public.buzz_v2_meta()", `select public.buzz_v2_thread('${first.id}')`,
    "select public.buzz_v2_posting_status()", "select public.buzz_guidelines_version()"]) await mustDeny(() => asAnon(() => db.query(sql)), sql);
});
await expectOk("writes come only from the server: buzz_v2_create / buzz_v2_reply refuse signed-in and signed-out callers, accept the service role", async () => {
  const input = JSON.stringify({ text: "trying to skip moderation" });
  await mustDeny(() => as(OP, () => db.query("select public.buzz_v2_create($1, $2::jsonb)", [OP, input])), "authenticated create");
  await mustDeny(() => asAnon(() => db.query("select public.buzz_v2_create($1, $2::jsonb)", [OP, input])), "anon create");
  await mustDeny(() => as(OP, () => db.query("select public.buzz_v2_reply($1, $2, $3::jsonb)", [OP, first.id, input])), "authenticated reply");
  await mustDeny(() => asAnon(() => db.query("select public.buzz_v2_reply($1, $2, $3::jsonb)", [OP, first.id, input])), "anon reply");
  const r = await reply(R1, first.id, "Agreed, it has been peaceful");
  if (r.kind !== "reply" || !r.isMine) throw new Error(JSON.stringify(r));
});
await expectOk("the engine's record reaches Trust & Safety (its events, the queue item it asked for); held content always gets a queue item", async () => {
  const record = {
    events: [{ field: "body", action: "flag", visibility: "held", category: "academic_dishonesty", subcode: "answer_key", severity: "medium", ruleIds: ["baseline.academic"], matches: [], signals: {}, textHash: "abc", engineVersion: "test" }],
    queue: { source: "rule_flag", category: "academic_dishonesty", severity: "medium", priority: "p2", label: null, ruleIds: ["baseline.academic"], aiVerdict: null },
  };
  const held = await create(R1, { text: "anyone got the answer key for the midterm" }, { status: "held", moderation: record });
  if (held.status !== "held" || held.text !== "anyone got the answer key for the midterm" || !held.isMine) throw new Error(`author view ${JSON.stringify(held)}`);
  const ev = await one(db.query("select count(*)::int as n from public.moderation_events where entity_type = 'buzz' and entity_id = $1", [held.id]));
  const q = await one(db.query("select source, category, priority, author_id from public.mod_queue where entity_type = 'buzz' and entity_id = $1", [held.id]));
  if (ev.n !== 1 || !q || q.source !== "rule_flag" || q.category !== "academic_dishonesty" || q.author_id !== R1) throw new Error(JSON.stringify({ ev, q }));
  const hr = await reply(R2, first.id, "held without a queue entry", { status: "held", moderation: { events: [], queue: null } });
  if (!(await one(db.query("select 1 as x from public.mod_queue where entity_type = 'buzz_reply' and entity_id = $1", [hr.id])))) throw new Error("held reply not queued");
  const support = await create(R3, { text: "rough week, could use some kindness" }, { support: true });
  if (support.supportLink !== true || support.status !== "active") throw new Error("support link");
  await mustFail(() => create(R1, { text: "status check" }, { status: "removed" }), "validation_failed", "a write with another status");
});
await expectOk("the internals (serializer, aliases, adapters, notifications, housekeeping) are not reachable through the API", async () => {
  const internal = [
    "buzz_root_json(public.buzz_posts, uuid, boolean)", "buzz_reply_json(public.buzz_comments, uuid, boolean, uuid, integer, jsonb, jsonb, text)",
    "buzz_alias_json(bytea, integer)", "buzz_alias_digest(uuid, text)", "buzz_author_key(uuid, text)", "buzz_v2_alias_book(uuid)", "buzz_v2_visible_replies(uuid, uuid, boolean)",
    "buzz_v2_reply_page(public.buzz_posts, uuid, integer, integer, boolean)", "buzz_v2_snapshot(text, uuid)", "buzz_v2_author_of(text, uuid)",
    "buzz_v2_set_locked(uuid, boolean)", "buzz_v2_staff_context(text, uuid)", "buzz_v2_notify(uuid, text, text, text, uuid, text, uuid, timestamp with time zone)",
    "buzz_v2_drop_notifications(text, uuid)", "buzz_v2_close_due_polls(uuid)", "buzz_v2_housekeeping()", "buzz_v2_rate_limit(uuid, text)",
    "buzz_v2_assert_writer(uuid)", "buzz_v2_notify_reply()", "buzz_v2_reach(uuid, uuid)",
  ];
  for (const sig of internal) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      if (await val(db.query("select has_function_privilege($1, $2, 'execute')", [role, `public.${sig}`]))) throw new Error(`${role} may execute ${sig}`);
    }
  }
  const setStatus = "public.buzz_v2_set_status(text, uuid, text, boolean)";
  if (await val(db.query("select has_function_privilege('authenticated', $1, 'execute') or has_function_privilege('anon', $1, 'execute')", [setStatus]))) throw new Error("set_status open to the API");
  if (!(await val(db.query("select has_function_privilege('service_role', $1, 'execute')", [setStatus])))) throw new Error("the AI second pass needs set_status");
  await mustDeny(() => as(OP, () => db.query("select public.buzz_v2_author_of('buzz', $1)", [first.id])), "author_of");
  await mustDeny(() => asService(() => db.query("select public.buzz_v2_author_of('buzz', $1)", [first.id])), "author_of as service");
});

// ---- 2. writing: validation, campus, media, polls, prompts ----------------------------------------------------------
await expectOk("create: one of title / body, title <= 100, body <= 500, Campus or Global; replies 1-500 characters", async () => {
  for (const [input, what] of [[{ text: "   " }, "empty"], [{}, "nothing"], [{ title: "  ", text: "" }, "blank title"], [{ text: "x".repeat(501) }, "501 characters"],
    [{ title: "x".repeat(101), text: "ok" }, "101-character title"], [{ text: "hello", scope: "everywhere" }, "unknown scope"], [{ text: 5 }, "a number"]]) {
    await mustFail(() => create(OP, input), "validation_failed", what);
  }
  const titled = await create(OP, { title: "  Just a headline  " });
  if (titled.title !== "Just a headline" || titled.text !== "") throw new Error(JSON.stringify(titled));
  const long = await create(OP, { text: "y".repeat(500), title: "t".repeat(100) });
  if (long.text.length !== 500) throw new Error("500 characters refused");
  await mustFail(() => reply(R1, first.id, "   "), "validation_failed", "empty reply");
  await mustFail(() => reply(R1, first.id, "z".repeat(501)), "validation_failed", "501-character reply");
  await mustFail(() => create(NOUNI, { text: "no campus to post to" }), "validation_failed", "campus buzz without a university");
  const g = await create(NOUNI, { text: "Global works without a campus", scope: "global" });
  if (g.scope !== "global") throw new Error(JSON.stringify(g));
  if ((await one(db.query("select university_id from public.buzz_posts where id = $1", [titled.id]))).university_id !== TXST) throw new Error("campus not stored");
  if ((await one(db.query("select university_id from public.buzz_posts where id = $1", [g.id]))).university_id !== null) throw new Error("phantom campus");
});
await expectOk("photos: up to 4 from this project's anonymous folder, random names, really uploaded by the author; junk meta dropped", async () => {
  const photo = async (uid) => {
    const name = `buzz/anon/${hex(48)}.jpg`;
    await as(uid, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads', $1, $2)", [name, uid]));
    return ORIGIN + name;
  };
  const good = await photo(R2);
  const theirs = await photo(R3);
  const bads = [`${ORIGIN}posts/${R2}/1.jpg`, "https://tracker.example/pixel.gif", `${good}?u=${R2}`, good.replace("dskbzoqreandwwpxiplh", "evil-tracker"),
    `${ORIGIN}buzz/anon/1758412345678-${hex(32)}.jpg`, `${ORIGIN}buzz/anon/${hex(48)}.jpg`, theirs, `${ORIGIN}buzz/anon/${hex(48)}.gif`];
  for (const bad of bads) await mustFail(() => create(R2, { text: "photo check", images: [bad] }), "validation_failed", bad);
  await mustFail(() => create(R2, { text: "photo check", images: [null] }), "validation_failed", "null photo");
  await mustFail(() => create(R2, { text: "photo check", images: [[good]] }), "validation_failed", "nested array");
  const five = [];
  for (let i = 0; i < 5; i++) five.push(await photo(R2));
  await mustFail(() => create(R2, { text: "five photos", images: five }), "validation_failed", "five photos");
  const junk = Array.from({ length: 20 }, () => ({ url: good, width: { junk: "x".repeat(3000) }, height: "NaN", blur: "x".repeat(9000) }));
  const b = await create(R2, { text: "with a good photo", images: [good, good], imageMeta: [...junk, { url: "https://x.example/other.jpg", width: 1, height: 1, blur: null }] });
  if (b.media.length !== 1 || !same(b.media[0], { type: "image", url: good, width: null, height: null, blur: null })) throw new Error(JSON.stringify(b.media));
  const four = await create(R2, { text: "four photos", images: five.slice(0, 4), imageMeta: [{ url: five[0], width: 1200, height: 900, blur: "data:image/webp;base64,AAAA" }] });
  if (four.media.length !== 4 || four.media[0].width !== 1200 || four.media[0].blur !== "data:image/webp;base64,AAAA" || four.media[1].width !== null) throw new Error(JSON.stringify(four.media));
});
await expectOk("video: one finished Mux upload of the author's own, 60 s at most, stored without its media id; photos and video never together", async () => {
  const media = async (uid, pb, { status = "ready", seconds = 12 } = {}) =>
    db.query("insert into public.media (owner_id, provider, status, playback_id, duration_seconds, width, height, poster_url) values ($1, 'mux', $2, $3, $4, 720, 1280, $5)",
      [uid, status, pb, seconds, `https://image.mux.com/${pb}/thumbnail.jpg?time=1&width=1080&fit_mode=preserve`]);
  await media(R3, "pbOwnVideo123");
  await media(R1, "pbSomeoneElse99");
  await media(R3, "pbStillWorking1", { status: "processing" });
  await media(R3, "pbTooLongClip77", { seconds: 61 });
  const v = await create(R3, { text: "clip from the quad", video: { playbackId: "pbOwnVideo123", posterUrl: "https://evil.example/x.jpg", width: 99999, height: 3, durationSeconds: 999 } });
  if (v.media.length !== 1 || !same(v.media[0], { type: "video", playbackId: "pbOwnVideo123", posterUrl: "https://image.mux.com/pbOwnVideo123/thumbnail.jpg?time=1&width=1080&fit_mode=preserve", width: 720, height: 1280, durationSeconds: 12 })) throw new Error(JSON.stringify(v.media));
  const stored = (await one(db.query("select videos from public.buzz_posts where id = $1", [v.id]))).videos;
  if (stored.length !== 1 || stored[0].media_id !== "00000000-0000-0000-0000-000000000000") throw new Error(JSON.stringify(stored));
  if ((await as(R1, () => db.query("select * from public.media where playback_id = 'pbOwnVideo123'"))).rows.length) throw new Error("media owner readable");
  for (const [pb, what] of [["pbSomeoneElse99", "someone else's video"], ["pbStillWorking1", "an unfinished video"], ["pbTooLongClip77", "a 61 s video"], ["nope!", "a malformed id"], ["pbNeverUpload1", "an unknown video"]]) {
    await mustFail(() => create(R3, { text: "video check", video: { playbackId: pb } }), "validation_failed", what);
  }
  const img = `buzz/anon/${hex(48)}.jpg`;
  await as(R3, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads', $1, $2)", [img, R3]));
  await mustFail(() => create(R3, { text: "both", images: [ORIGIN + img], video: { playbackId: "pbOwnVideo123" } }), "validation_failed", "photos and a video");
});
await expectOk("polls: 2-4 different options of 1-60 characters for 1, 3 or 7 days; accounts under a day old cannot create them", async () => {
  for (const [poll, what] of [[{ options: ["one"], durationDays: 1 }, "one option"], [{ options: ["a", "b", "c", "d", "e"], durationDays: 1 }, "five options"],
    [{ options: ["Same", "same"], durationDays: 1 }, "duplicate (case-insensitive)"], [{ options: ["a", "x".repeat(61)], durationDays: 1 }, "61-character option"],
    [{ options: ["a", " "], durationDays: 1 }, "blank option"], [{ options: ["a", "b"], durationDays: 2 }, "2 days"], [{ options: ["a", 5], durationDays: 1 }, "a number option"], ["yes", "not an object"]]) {
    await mustFail(() => create(OP, { text: "poll?", poll }), "validation_failed", what);
  }
  await mustFail(() => create(FRESH, { text: "poll?", poll: { options: ["a", "b"], durationDays: 1 } }), "too_new", "a new account's poll");
  const status = await call(FRESH, "buzz_v2_posting_status");
  if (status.allowed !== true || typeof status.pollsUnlockAt !== "number" || status.pollsUnlockAt <= Date.now()) throw new Error(JSON.stringify(status));
});
await expectOk("prompts: UniVerse's 60 Daily Campus Prompts; meta serves today's (day % 60); answering one stores it; an unknown one is refused", async () => {
  const rows = (await db.query("select idx, text from public.buzz_prompts order by idx")).rows;
  if (rows.length !== 60 || rows[0].text !== "What is the most underrated spot on campus?" || rows[59].text !== "What is your favorite campus sound?") throw new Error("prompts");
  const meta = await call(OP, "buzz_v2_meta", ["campus"]);
  const today = Math.floor(Date.now() / 86_400_000) % 60;
  const expected = (await one(db.query("select id, text from public.buzz_prompts where idx = $1", [today])));
  if (!meta.prompt || meta.prompt.id !== expected.id || meta.prompt.text !== expected.text) throw new Error(JSON.stringify(meta));
  const b = await create(OP, { text: "The turtle pond, no contest", promptId: meta.prompt.id });
  if (b.promptId !== meta.prompt.id) throw new Error(JSON.stringify(b));
  await mustFail(() => create(OP, { text: "x", promptId: crypto.randomUUID() }), "validation_failed", "unknown prompt");
  await mustFail(() => create(OP, { text: "x", promptId: "nope" }), "validation_failed", "malformed prompt");
});

// ---- 3. feeds: Campus vs Global, search, Hot, rankAt -------------------------------------------------------------------
await expectOk("Campus and Global are separate feeds: a campus buzz shows only on its campus, a global one in Global for every campus", async () => {
  const campus = await create(R1, { text: "campus only, about the dining hall" });
  const global = await create(R1, { text: "global only, about dining abroad", scope: "global" });
  if (campus.scope !== "campus" || global.scope !== "global") throw new Error("scope");
  for (const sort of ["hot", "new", "top"]) {
    const q = { sort, window: "all" };
    const mine = await ids(VIEW, { ...q, scope: "campus" });
    const mineG = await ids(VIEW, { ...q, scope: "global" });
    const far = await ids(FAR, { ...q, scope: "campus" });
    const farG = await ids(FAR, { ...q, scope: "global" });
    if (!mine.includes(campus.id) || mine.includes(global.id)) throw new Error(`${sort}: campus feed`);
    if (!mineG.includes(global.id) || mineG.includes(campus.id)) throw new Error(`${sort}: global feed`);
    if (far.includes(campus.id) || far.includes(global.id)) throw new Error(`${sort}: another campus sees it`);
    if (!farG.includes(global.id) || farG.includes(campus.id)) throw new Error(`${sort}: global for another campus`);
  }
  for (const scope of ["campus", "global"]) for (const b of (await feed(VIEW, { scope })).items) if (b.scope !== scope) throw new Error("wrong scope served");
  if ((await feed(NOUNI, { scope: "campus" })).items.length !== 0) throw new Error("a campus feed without a campus");
  await mustFail(() => feed(VIEW, { scope: "mars" }), "validation_failed", "unknown scope");
  await mustFail(() => feed(VIEW, { sort: "best" }), "validation_failed", "unknown sort");
  await mustFail(() => feed(VIEW, { sort: "top", window: "year" }), "validation_failed", "unknown window");
});
await expectOk("search: every word in the title or the body, any case, within the chosen feed; wildcards are literal; nothing searchable finds nothing", async () => {
  const tag = `zq${hex(6)}`;
  const a = await create(R2, { title: `Dining hall ${tag}`, text: "The tacos are back on Tuesdays." });
  const b = await create(R2, { text: `Is the ${tag} dining plan worth it? Food is fine.` });
  const c = await create(R2, { text: `${tag} parking is a nightmare` });
  const g = await create(R2, { text: `${tag} dining abroad`, scope: "global" });
  const pct = await create(R2, { text: `${tag} 100% sure about this one` });
  const find = (q, scope = "campus") => ids(VIEW, { q, scope });
  const both = await find(`${tag} dining`);
  if (!both.includes(a.id) || !both.includes(b.id) || both.includes(c.id) || both.includes(g.id)) throw new Error(`dining: ${both}`);
  if (!same(await find(`${tag.toUpperCase()} TACOS`), [a.id])) throw new Error("body of a titled buzz, any case");
  if (!same(await find(`${tag} parking`), [c.id])) throw new Error("parking");
  if (!same(await find(`${tag} dining`, "global"), [g.id])) throw new Error("global search");
  if ((await find(`${tag} pizza`)).length !== 0) throw new Error("pizza");
  if (!same(await find(`${tag} 100%`), [pct.id])) throw new Error("100% is the word 100");
  for (const q of ["%", "%%", "_", "_%_", "a", "\\", "!!"]) if ((await feed(VIEW, { q })).items.length !== 0) throw new Error(`${q} matched something`);
  if ((await feed(VIEW, { q: "   " })).items.length === 0) throw new Error("a blank query is the normal feed");
  await mustFail(() => feed(VIEW, { q: "x".repeat(81) }), "validation_failed", "81 characters");
  const hiddenOne = await create(R2, { text: `${tag} secret words` });
  await db.query("update public.buzz_posts set status = 'hidden' where id = $1", [hiddenOne.id]);
  if ((await find(`${tag} secret`)).length !== 0) throw new Error("hidden words searchable by others");
  if (!(await ids(R2, { q: `${tag} secret` })).includes(hiddenOne.id)) throw new Error("the author cannot find their own");
  // the database splits a query exactly like buzzSearchTerms() in packages/shared
  for (const q of ["Parking  at the LIBRARY, a b", "100%_\\", "one two three four five six seven", "", "rock'n'roll -- A&W #1 c++ ...dots... 'quoted'", "café NAÏVE señor", "x.y.z e-mail"]) {
    const sql = await val(db.query("select public.buzz_search_terms($1)", [q]));
    if (!same(sql, buzzSearchTerms(q))) throw new Error(`terms of ${JSON.stringify(q)}: ${JSON.stringify(sql)} vs ${JSON.stringify(buzzSearchTerms(q))}`);
  }
});
await expectOk("Hot = (score + 2 x published replies) / (age hours + 2)^1.5 from the minute-floored publication; every page ranks at rankAt", async () => {
  const tag = `zh${hex(6)}`;
  const made = [];
  for (const [score, hoursAgo, replyCount] of [[40, 30, 0], [5, 1, 2], [12, 6, 1], [0, 0.2, 0], [-3, 2, 3]]) {
    const b = await create(R3, { text: `${tag} hot ranking case`, scope: "global" });
    for (let i = 0; i < replyCount; i++) await reply(R1, b.id, `reply ${i} on the ranking case`);
    await db.query("update public.buzz_posts set score = $2, visible_at = now() - make_interval(secs => $3::float8 * 3600) where id = $1", [b.id, score, hoursAgo]);
    await db.query("update public.buzz_comments set visible_at = (select visible_at from public.buzz_posts where id = $1) + interval '1 minute' where post_id = $1", [b.id]);
    made.push({ id: b.id, score, replyCount });
  }
  const page = await feed(VIEW, { scope: "global", sort: "hot", q: tag });
  const rankAt = Date.parse(page.rankAt);
  if (rankAt % MIN !== 0) throw new Error(`rankAt ${page.rankAt}`);
  const rows = (await db.query("select id, visible_at from public.buzz_posts where id = any($1::uuid[])", [made.map((m) => m.id)])).rows;
  const hot = (m) => {
    const vis = Math.floor(+rows.find((r) => r.id === m.id).visible_at / MIN) * MIN;
    return (m.score + 2 * m.replyCount) / Math.pow(Math.max((rankAt - vis) / 3_600_000, 0) + 2, 1.5);
  };
  const expected = [...made].sort((x, y) => hot(y) - hot(x) || (y.id > x.id ? 1 : -1)).map((m) => m.id);
  if (!same(page.items.map((b) => b.id), expected)) throw new Error(`hot order ${JSON.stringify(page.items.map((b) => b.id))} vs ${JSON.stringify(expected)}`);
  // pages at a fixed rankAt: no repeats, no gaps, and something published after it waits for a refresh
  const past = new Date(Date.now() - 2 * MIN).toISOString();
  const p1 = await feed(VIEW, { scope: "global", sort: "hot", q: tag, limit: 2, rankAt: past });
  const late = await create(R3, { text: `${tag} published after the first page`, scope: "global" });
  const p2 = await feed(VIEW, { scope: "global", sort: "hot", q: tag, limit: 2, offset: 2, rankAt: p1.rankAt });
  const p3 = await feed(VIEW, { scope: "global", sort: "hot", q: tag, limit: 2, offset: 4, rankAt: p1.rankAt });
  const walked = [...p1.items, ...p2.items, ...p3.items].map((b) => b.id);
  if (p1.nextOffset !== 2 || p2.nextOffset !== 4 || p3.nextOffset !== null) throw new Error(`offsets ${p1.nextOffset} ${p2.nextOffset} ${p3.nextOffset}`);
  if (new Set(walked).size !== 5 || walked.includes(late.id)) throw new Error(`paging ${walked}`);
  if (!(await ids(VIEW, { scope: "global", sort: "hot", q: tag })).includes(late.id)) throw new Error("a refresh shows it");
  // a future rankAt is "now": it cannot count replies that are not published yet
  const future = await feed(VIEW, { scope: "global", sort: "hot", q: tag, rankAt: new Date(Date.now() + 86_400_000).toISOString() });
  if (Date.parse(future.rankAt) > Date.now()) throw new Error("rankAt in the future");
});

// ---- 4. threads ------------------------------------------------------------------------------------------------------
const root = await create(OP, { text: "Which coffee spot near the library is worth it?" });
const r1 = await reply(R1, root.id, "The cart by the fountain");
const r2 = await reply(OP, root.id, { text: "Even on Mondays?", parentId: r1.id });
const r3 = await reply(R2, root.id, { text: "Mondays are the best day for it", parentId: r2.id });
const r4 = await reply(R1, root.id, { text: "Agreed, no line before nine", parentId: r3.id });
await expectOk("replies: oldest first, two levels, deeper ones flattened under their depth-1 reply with replyingTo, OP badge, isMine", async () => {
  if (!(r1.depth === 1 && r1.parentId === root.id && r1.replyingTo === null && !r1.isOp)) throw new Error(`r1 ${JSON.stringify(r1)}`);
  if (!(r2.depth === 2 && r2.parentId === r1.id && r2.replyingTo === null && r2.isOp && r2.isMine)) throw new Error(`r2 ${JSON.stringify(r2)}`);
  if (!(r3.depth === 2 && r3.parentId === r1.id && same(r3.replyingTo, r2.alias))) throw new Error(`r3 ${JSON.stringify(r3)}`);
  if (!(r4.depth === 2 && r4.parentId === r1.id && same(r4.replyingTo, r3.alias) && same(r4.alias, r1.alias))) throw new Error(`r4 ${JSON.stringify(r4)}`);
  const t = await thread(R3, root.id, 2);
  if (t.root.replyCount !== 4 || !same(t.replies.items.map((r) => r.id), [r1.id, r2.id]) || t.replies.nextOffset !== 2) throw new Error(JSON.stringify(t.replies));
  const page2 = await replies(R3, root.id, 2, 2);
  if (!same(page2.items.map((r) => r.id), [r3.id, r4.id]) || page2.nextOffset !== null) throw new Error(JSON.stringify(page2));
  if (page2.items.some((r) => r.isMine) || t.root.isMine || !t.root.isOp) throw new Error("isMine / isOp for a stranger");
  const mine = await replies(R1, root.id);
  if (!mine.items.find((r) => r.id === r1.id).isMine || !mine.items.find((r) => r.id === r4.id).isMine) throw new Error("own replies");
  for (const r of [...t.replies.items, ...page2.items]) if (!same(Object.keys(r).sort(), REPLY_KEYS)) throw new Error(`reply keys ${Object.keys(r)}`);
  if (!same(Object.keys(t.root).sort(), BUZZ_KEYS)) throw new Error(`buzz keys ${Object.keys(t.root)}`);
  const another = await create(R3, { text: "another thread" });
  await mustFail(() => reply(R3, root.id, { text: "cross-thread", parentId: another.id }), "not_found", "a thread as a parent");
  const other = await create(R2, { text: "other thread for a cross-thread parent" });
  await mustFail(() => reply(R3, other.id, { text: "cross-thread", parentId: r1.id }), "not_found", "a reply from another thread");
  await mustFail(() => reply(R3, root.id, { text: "x", parentId: "not-a-uuid" }), "not_found", "a malformed parent");
});
await expectOk("held replies reach only their author; deleted ones stay as placeholders only above a visible reply; reported ones leave the reporter's view", async () => {
  const t = await create(OP, { text: "Thread for the placeholder rules" });
  const a = await reply(R1, t.id, "first answer");
  const held = await reply(R2, t.id, { text: "a held answer", parentId: a.id }, { status: "held" });
  const b = await reply(R3, t.id, { text: "second answer", parentId: a.id });
  const leaf = await reply(R1, t.id, "a leaf to delete");
  if (held.status !== "held" || held.text !== "a held answer") throw new Error("author view of a held reply");
  const others = (await replies(VIEW, t.id)).items;
  if (others.some((r) => r.id === held.id)) throw new Error("a held reply reached someone else");
  if (!(await replies(R2, t.id)).items.some((r) => r.id === held.id && r.status === "held")) throw new Error("its author lost it");
  await call(R1, "buzz_v2_delete", [a.id]);
  await call(R1, "buzz_v2_delete", [leaf.id]);
  const after = (await replies(VIEW, t.id)).items;
  const ph = after.find((r) => r.id === a.id);
  if (!ph || ph.status !== "deleted" || ph.text !== "") throw new Error(`placeholder ${JSON.stringify(ph)}`);
  if (after.some((r) => r.id === leaf.id)) throw new Error("a deleted leaf still listed");
  if (after.find((r) => r.id === b.id).parentId !== a.id) throw new Error("child of a placeholder");
  if ((await thread(VIEW, t.id)).root.replyCount !== 1) throw new Error("reply count counts deleted / held replies");
  // reporting b: it leaves VIEW's thread; then a has nothing visible below it for VIEW and disappears too
  await call(VIEW, "buzz_v2_report", [b.id, "spam_scam", null]);
  const v2 = (await replies(VIEW, t.id)).items;
  if (v2.some((r) => r.id === b.id || r.id === a.id)) throw new Error(`reported reply still shown: ${JSON.stringify(v2.map((r) => r.id))}`);
  if (!(await replies(R1, t.id)).items.some((r) => r.id === b.id)) throw new Error("the report hid it for everyone");
  // a reply whose parent does not show hangs from the nearest one that does (and the deleted a is a placeholder again,
  // since a reply below it shows)
  const c = await reply(R2, t.id, { text: "deeper answer", parentId: b.id });
  const v3 = (await replies(VIEW, t.id)).items;
  const shaped = v3.find((r) => r.id === c.id);
  if (!shaped || shaped.depth !== 2 || shaped.parentId !== a.id || shaped.replyingTo !== null) throw new Error(`re-attached ${JSON.stringify(shaped)}`);
  if (!v3.some((r) => r.id === a.id && r.status === "deleted") || v3.some((r) => r.id === b.id)) throw new Error(JSON.stringify(v3.map((r) => [r.id, r.status])));
  const lone = await create(OP, { text: "a thread with a lone reply" });
  const only = await reply(R1, lone.id, "only reply");
  const under = await reply(R2, lone.id, { text: "under the only reply", parentId: only.id });
  await call(VIEW, "buzz_v2_report", [only.id, "spam_scam", null]);
  const moved = (await replies(VIEW, lone.id)).items;
  if (!same(moved.map((r) => [r.id, r.depth, r.parentId]), [[under.id, 1, lone.id]])) throw new Error(`moved up ${JSON.stringify(moved)}`);
});
await expectOk("hide this anon in this thread: their replies fold for you only, and only in that thread (keyed on thread + author inside the database)", async () => {
  const t1 = await create(OP, { text: "hide me thread one" });
  const t2 = await create(OP, { text: "hide me thread two" });
  const x1 = await reply(R3, t1.id, "noise in thread one");
  const x2 = await reply(R3, t1.id, "more noise in thread one");
  const y1 = await reply(R3, t2.id, "noise in thread two");
  await call(VIEW, "buzz_v2_hide_author", [x1.id]);
  const mine = (await replies(VIEW, t1.id)).items;
  if (!mine.find((r) => r.id === x1.id).collapsed || !mine.find((r) => r.id === x2.id).collapsed) throw new Error("not collapsed");
  if ((await replies(VIEW, t2.id)).items.find((r) => r.id === y1.id).collapsed) throw new Error("hid them in another thread");
  if ((await replies(R1, t1.id)).items.find((r) => r.id === x1.id).collapsed) throw new Error("hid them for someone else");
  await call(R3, "buzz_v2_hide_author", [x1.id]); // your own: quietly nothing
  if ((await one(db.query("select count(*)::int as n from public.buzz_mutes where user_id = $1", [R3]))).n !== 0) throw new Error("hid yourself");
  await call(VIEW, "buzz_v2_hide_author", [t2.id]); // the thread's author, in that thread
  if ((await one(db.query("select count(*)::int as n from public.buzz_mutes where user_id = $1 and post_id = $2 and muted_id = $3", [VIEW, t2.id, OP]))).n !== 1) throw new Error("hide the OP");
});
await expectOk("hide thread: it leaves your feeds (every sort and search) but still opens from a link; bring it back", async () => {
  const t = await create(R2, { text: "hide this whole thread zqhide" });
  await call(VIEW, "buzz_v2_hide_thread", [t.id, true]);
  for (const sort of ["hot", "new", "top"]) if ((await ids(VIEW, { sort, window: "all" })).includes(t.id)) throw new Error(`still in ${sort}`);
  if ((await ids(VIEW, { q: "zqhide" })).includes(t.id)) throw new Error("still in search");
  if ((await thread(VIEW, t.id)).root.id !== t.id) throw new Error("link broken");
  if (!(await ids(R1, { sort: "new" })).includes(t.id)) throw new Error("hidden for someone else");
  await call(VIEW, "buzz_v2_hide_thread", [t.id, false]);
  if (!(await ids(VIEW, { sort: "new" })).includes(t.id)) throw new Error("did not come back");
  await call(VIEW, "buzz_v2_hide_thread", [crypto.randomUUID(), false]); // unhiding something never hidden is fine
});
await expectOk("delete: soft and own-only; a deleted thread is gone for everyone (its author too) with its notifications; locked threads refuse replies", async () => {
  const t = await create(OP, { text: "this thread will be deleted" });
  await reply(R1, t.id, "a reply that notifies the author");
  if (!(await notes(OP)).some((n) => n.data.target_id === t.id)) throw new Error("setup: no notification");
  await mustFail(() => call(R1, "buzz_v2_delete", [t.id]), "not_found", "someone else's thread");
  await call(OP, "buzz_v2_delete", [t.id]);
  const row = await one(db.query("select status, deleted_at from public.buzz_posts where id = $1", [t.id]));
  if (row.status !== "deleted" || !row.deleted_at) throw new Error("not soft-deleted");
  for (const who of [OP, R1]) await mustFail(() => thread(who, t.id), "not_found", "a deleted thread");
  if ((await ids(OP, { sort: "new" })).includes(t.id)) throw new Error("deleted thread in the feed");
  if ((await notes(OP)).some((n) => n.data.target_id === t.id)) throw new Error("its notifications stayed");
  await mustFail(() => call(OP, "buzz_v2_delete", [t.id]), "not_found", "twice");
  const locked = await create(OP, { text: "this thread gets locked" });
  await db.query("select public.buzz_v2_set_locked($1, true)", [locked.id]);
  await mustFail(() => reply(R1, locked.id, "too late"), "locked", "a locked thread");
  if ((await thread(R1, locked.id)).root.locked !== true) throw new Error("locked flag");
  await db.query("select public.buzz_v2_set_locked($1, false)", [locked.id]);
  await reply(R1, locked.id, "open again");
});

// ---- 5. votes and the community thresholds ----------------------------------------------------------------------------
const eligible = [];
for (let i = 0; i < 14; i++) eligible.push(await user(`Zq${i} Wobbleton`, { uni: TXST }));
const ineligible = [];
for (let i = 0; i < 8; i++) ineligible.push(await user(`Zf${i} Quillfeather`, { uni: TXST, ageDays: 0 }));
await expectOk("votes: your own -> own_item; up, switch, clear (tap again to undo); only up / down / nothing; others' votes are private", async () => {
  const b = await create(OP, { text: "vote on me" });
  await mustFail(() => vote(OP, b.id, 1), "own_item", "own buzz");
  await mustFail(() => vote(OP, r2.id, 1), "own_item", "own reply");
  await mustFail(() => vote(R1, b.id, 2), "validation_failed", "a vote of 2");
  let s = await vote(R1, b.id, 1);
  if (!same(s, { score: 1, myVote: 1, collapsed: false })) throw new Error(JSON.stringify(s));
  s = await vote(R1, b.id, -1);
  if (!same(s, { score: -1, myVote: -1, collapsed: false })) throw new Error(JSON.stringify(s));
  s = await vote(R1, b.id, 0);
  if (!same(s, { score: 0, myVote: 0, collapsed: false })) throw new Error(JSON.stringify(s));
  if ((await one(db.query("select count(*)::int as n from public.buzz_votes where post_id = $1", [b.id]))).n !== 0) throw new Error("cleared vote kept");
  await vote(R1, b.id, 1);
  await vote(R2, b.id, 1);
  const seen = (await thread(R3, b.id)).root;
  if (seen.score !== 2 || seen.myVote !== 0) throw new Error(JSON.stringify(seen));
  if ((await thread(R1, b.id)).root.myVote !== 1) throw new Error("my vote");
  const rv = await vote(R3, r1.id, 1);
  if (rv.score !== 1 || rv.myVote !== 1) throw new Error("reply vote");
  if ((await replies(R3, root.id)).items.find((r) => r.id === r1.id).myVote !== 1) throw new Error("reply myVote");
});
await expectOk("collapse at eligible score <= -5 with >= 8 eligible votes (new accounts' votes count in the score, not the thresholds); auto-hide at <= -10 with >= 12", async () => {
  const b = await create(OP, { text: "an unpopular take on the parking garage" });
  for (const v of ineligible) await vote(v, b.id, -1);
  let seen = (await feed(VIEW, { sort: "new" })).items.find((x) => x.id === b.id);
  if (!(seen.score === -8 && seen.collapsed === false)) throw new Error(`ineligible votes collapsed it ${JSON.stringify(seen)}`);
  for (const v of eligible.slice(0, 8)) await vote(v, b.id, -1);
  seen = (await thread(VIEW, b.id)).root;
  if (!(seen.score === -16 && seen.collapsed === true && seen.status === "active")) throw new Error(`collapse ${JSON.stringify(seen)}`);
  if ((await ids(VIEW, { sort: "hot" })).includes(b.id) || (await ids(VIEW, { sort: "top", window: "all" })).includes(b.id)) throw new Error("collapsed in hot / top");
  if (!(await feed(VIEW, { sort: "new" })).items.find((x) => x.id === b.id)?.collapsed) throw new Error("collapsed missing from new");
  for (const v of eligible.slice(8, 12)) await vote(v, b.id, -1);
  const row = await one(db.query("select status, eligible_votes, eligible_score, upvotes, downvotes, score from public.buzz_posts where id = $1", [b.id]));
  if (!(row.status === "hidden" && row.eligible_votes === 12 && row.eligible_score === -12 && row.downvotes === 20 && row.score === -20)) throw new Error(JSON.stringify(row));
  const q = await one(db.query("select source, priority, author_id from public.mod_queue where entity_type = 'buzz' and entity_id = $1", [b.id]));
  if (!q || q.source !== "community_score" || q.priority !== "p2" || q.author_id !== OP) throw new Error(`queue ${JSON.stringify(q)}`);
  if ((await ids(VIEW, { sort: "new" })).includes(b.id)) throw new Error("hidden buzz in others' feed");
  const placeholder = (await thread(VIEW, b.id)).root;
  if (!(placeholder.status === "hidden" && placeholder.text === "" && placeholder.title === "" && placeholder.media.length === 0 && placeholder.poll === null)) throw new Error(JSON.stringify(placeholder));
  const own = (await feed(OP, { sort: "new" })).items.find((x) => x.id === b.id);
  if (!(own && own.status === "hidden" && own.text === "an unpopular take on the parking garage" && own.isMine)) throw new Error(`author view ${JSON.stringify(own)}`);
  await mustFail(() => vote(eligible[13], b.id, 1), "not_found", "voting on a hidden buzz");
  // staff approve it (immune): score never hides it again
  await db.query("select public.buzz_v2_set_status('buzz', $1, 'active', true)", [b.id]);
  await vote(eligible[13], b.id, -1);
  if ((await one(db.query("select status from public.buzz_posts where id = $1", [b.id]))).status !== "active") throw new Error("immune item hidden again");
});
await expectOk("eligibility: a muted voter's and a low-trust voter's votes count in the score but not toward the thresholds", async () => {
  const b = await create(OP, { text: "eligibility probe" });
  const muted = eligible[12];
  await db.query("insert into public.user_sanctions (user_id, kind, scope, origin, expires_at) values ($1, 'mute', 'buzz_only', 'public', now() + interval '1 day')", [muted]);
  await vote(muted, b.id, -1);
  // a reporter whose report was found to be in bad faith is 'low' trust (migration 41)
  const low = eligible[11];
  const post = (await one(as(R1, () => db.query("insert into public.feed_posts (author_id, body) values ($1, 'a public post to report') returning id", [R1])))).id;
  await as(low, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam')", [low, post]));
  await db.query("update public.reports set status = 'dismissed', bad_faith = true, closed_at = now() where reporter_id = $1", [low]);
  if ((await val(db.query("select public.ts_reporter_trust($1)", [low]))) !== "low") throw new Error("setup: trust");
  await vote(low, b.id, -1);
  await vote(eligible[10], b.id, -1);
  const rows = (await db.query("select user_id, eligible from public.buzz_votes where post_id = $1", [b.id])).rows;
  const of = (u) => rows.find((r) => r.user_id === u).eligible;
  if (of(muted) !== false || of(low) !== false || of(eligible[10]) !== true) throw new Error(JSON.stringify(rows));
  const counts = await one(db.query("select score, eligible_votes from public.buzz_posts where id = $1", [b.id]));
  if (counts.score !== -3 || counts.eligible_votes !== 1) throw new Error(JSON.stringify(counts));
  await db.query("delete from public.user_sanctions where user_id = $1", [muted]);
});
await expectOk("milestones at 10 and 25 upvotes: one anonymous notification each, once (undo and redo adds nothing); replies too", async () => {
  const b = await create(OP, { text: "milestone candidate about the quad" });
  for (const v of eligible.slice(0, 10)) await vote(v, b.id, 1);
  let rows = (await notes(OP)).filter((n) => n.type === "buzz_milestone" && n.data.target_id === b.id);
  if (rows.length !== 1 || rows[0].title !== "Your buzz passed 10 upvotes" || rows[0].actor_id !== null) throw new Error(JSON.stringify(rows));
  await vote(eligible[0], b.id, 0);
  await vote(eligible[0], b.id, 1);
  rows = (await notes(OP)).filter((n) => n.type === "buzz_milestone" && n.data.target_id === b.id);
  if (rows.length !== 1) throw new Error("milestone twice");
  const more = [...eligible.slice(10), ...ineligible, R1, R2, R3, VIEW, FAR, NOUNI, UNGATED];
  for (const v of more.slice(0, 15)) await vote(v, b.id, 1);
  rows = (await notes(OP)).filter((n) => n.type === "buzz_milestone" && n.data.target_id === b.id);
  if (rows.length !== 2 || !rows.some((n) => n.title === "Your buzz passed 25 upvotes")) throw new Error(JSON.stringify(rows.map((n) => n.title)));
  if ((await one(db.query("select count(*)::int as n from public.buzz_milestones where target_id = $1", [b.id]))).n !== 2) throw new Error("milestone rows");
  const rep = await reply(R2, b.id, "a reply that also gets popular");
  for (const v of eligible.slice(0, 10)) await vote(v, rep.id, 1);
  if (!(await notes(R2)).some((n) => n.type === "buzz_milestone" && n.data.target_id === b.id)) throw new Error("reply milestone");
});

// ---- 6. polls ----------------------------------------------------------------------------------------------------------
await expectOk("polls: results hidden until you vote, it closes, or it is yours; one vote, no change; not your own; closed refuses; closesAt is minute-aligned", async () => {
  await db.exec("update public.buzz_secrets set thread_jitter_seconds = 120");
  const p = await create(OP, { text: "Best study spot?", poll: { options: ["Library", "Union", "Bed"], durationDays: 1 } });
  await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0");
  // closesAt counts from the jittered publication, floored to the minute: minus the duration it says nothing finer
  const pub = await one(db.query("select created_at, visible_at from public.buzz_posts where id = $1", [p.id]));
  const pollRow = await one(db.query("select closes_at from public.buzz_polls where post_id = $1", [p.id]));
  if (+pollRow.closes_at !== Math.floor(+pub.visible_at / MIN) * MIN + 86_400_000 || p.poll.closesAt !== +pollRow.closes_at) throw new Error("closes_at");
  await db.query("update public.buzz_posts set visible_at = now() - interval '1 minute' where id = $1", [p.id]);
  if (!(p.poll && p.poll.resultsVisible === true && p.poll.totalVotes === 0 && p.poll.myChoice === null && p.poll.closed === false)) throw new Error(`owner ${JSON.stringify(p.poll)}`);
  const seen = (await thread(VIEW, p.id)).root.poll;
  if (!(seen.resultsVisible === false && seen.totalVotes === null && seen.options.every((o) => o.votes === null && o.pct === null))) throw new Error(JSON.stringify(seen));
  await mustFail(() => call(OP, "buzz_v2_poll_vote", [p.id, p.poll.options[0].id]), "own_item", "own poll");
  const opt = p.poll.options[1].id;
  const voted = await call(VIEW, "buzz_v2_poll_vote", [p.id, opt]);
  if (!(voted.resultsVisible && voted.totalVotes === 1 && voted.myChoice === opt && voted.options[1].votes === 1 && voted.options[1].pct === 100 && voted.options[0].pct === 0)) throw new Error(JSON.stringify(voted));
  await call(VIEW, "buzz_v2_poll_vote", [p.id, opt]); // the same option again: fine, nothing changes
  await mustFail(() => call(VIEW, "buzz_v2_poll_vote", [p.id, p.poll.options[0].id]), "already_voted", "changing the vote");
  await mustFail(() => call(R1, "buzz_v2_poll_vote", [p.id, crypto.randomUUID()]), "validation_failed", "an unknown option");
  await mustFail(() => call(R1, "buzz_v2_poll_vote", [r1.id, opt]), "not_found", "a reply is not a thread");
  await mustFail(() => call(R1, "buzz_v2_poll_vote", [first.id, opt]), "not_found", "a thread without a poll");
  if ((await one(db.query("select vote_count from public.buzz_poll_options where id = $1", [opt]))).vote_count !== 1) throw new Error("vote_count");
  await db.query("update public.buzz_polls set closes_at = now() - interval '1 minute' where post_id = $1", [p.id]);
  await mustFail(() => call(R1, "buzz_v2_poll_vote", [p.id, opt]), "poll_closed", "a closed poll");
  const closed = (await thread(R2, p.id)).root.poll;
  if (!(closed.closed && closed.resultsVisible && closed.totalVotes === 1)) throw new Error(JSON.stringify(closed));
  // the author hears about it once, anonymously, when they next open Buzz
  await call(OP, "buzz_v2_meta", ["campus"]);
  await call(OP, "buzz_v2_meta", ["campus"]);
  const rows = (await notes(OP)).filter((n) => n.type === "buzz_poll_closed" && n.data.target_id === p.id);
  if (rows.length !== 1 || rows[0].title !== "Your poll closed · 1 vote" || rows[0].actor_id !== null) throw new Error(JSON.stringify(rows));
  // housekeeping closes everyone else's
  const q = await create(R1, { text: "Pizza or tacos?", poll: { options: ["Pizza", "Tacos"], durationDays: 3 } });
  await db.query("update public.buzz_polls set closes_at = now() - interval '1 minute' where post_id = $1", [q.id]);
  const hk = await val(db.query("select public.buzz_v2_housekeeping()"));
  if (hk.pollsClosed < 1 || !(await notes(R1)).some((n) => n.type === "buzz_poll_closed" && n.title === "Your poll closed · 0 votes")) throw new Error(JSON.stringify(hk));
});

// ---- 7. notifications ----------------------------------------------------------------------------------------------------
await expectOk("reply notifications: to the parent's author and the thread's author, never yourself, never twice; quoting only the recipient's own words", async () => {
  const t = await create(OP, { title: "Laundry room etiquette", text: "Who takes wet clothes out of the machine?" });
  const of = async (uid) => (await notes(uid)).filter((n) => n.data.target_id === t.id);
  const a = await reply(R1, t.id, "Not me, never touched them");
  const b = await reply(OP, t.id, { text: "Somebody did it twice!", parentId: a.id });
  const c = await reply(R2, t.id, { text: "SECRET-REPLY-TEXT do not quote me", parentId: b.id });
  await reply(R2, t.id, { text: "a held reply notifies nobody", parentId: a.id }, { status: "held" });
  const op = await of(OP);
  const n1 = await of(R1);
  const n2 = await of(R2);
  // a -> OP; b (OP to R1) -> R1 only; c (R2 to OP's b) -> OP once (parent and thread author are the same person)
  if (op.length !== 2 || n1.length !== 1 || n2.length !== 0) throw new Error(`counts op ${op.length} r1 ${n1.length} r2 ${n2.length}`);
  for (const n of [...op, ...n1]) {
    if (n.type !== "buzz_reply" || n.title !== "Someone replied to your buzz" || n.actor_id !== null || n.link !== `/buzz/${t.id}`) throw new Error(JSON.stringify(n));
    if (!same(n.data, { target_type: "buzz", target_id: t.id, anonymous: true })) throw new Error(`data ${JSON.stringify(n.data)}`);
    if (+n.created_at % MIN !== 0 || +n.visible_at % MIN !== 0) throw new Error("notification times not minute-aligned");
  }
  // never the words of the reply that caused it
  if (op.some((n) => /SECRET-REPLY-TEXT|Not me/.test(n.body ?? "")) || n1.some((n) => /Somebody did/.test(n.body ?? ""))) throw new Error("quoted the reply");
  if (op.some((n) => n.body !== "Laundry room etiquette")) throw new Error(`OP snippet ${op.map((n) => n.body)}`);
  if (n1[0].body !== "Not me, never touched them") throw new Error(`R1 snippet ${n1[0].body}`);
  // hiding that anon in this thread stops their notifications to you
  await call(OP, "buzz_v2_hide_author", [c.id]);
  await reply(R2, t.id, "another one from the hidden anon");
  if ((await of(OP)).length !== 2) throw new Error("a hidden anon still notifies");
  // deleting a reply takes the notifications it caused with it
  const d = await reply(R3, t.id, "this reply gets deleted");
  if ((await of(OP)).length !== 3) throw new Error("setup: no notification for the reply");
  await call(R3, "buzz_v2_delete", [d.id]);
  if ((await of(OP)).length !== 2) throw new Error("the deleted reply's notification stayed");
});

// ---- 8. reports, adapters, staff context, share card --------------------------------------------------------------------
await expectOk("report: through Trust & Safety; idempotent; the item leaves the reporter's feeds; 3 eligible reporters hide it; never your own", async () => {
  const b = await create(OP, { text: "reportable thing about the bus schedule" });
  await mustFail(() => call(OP, "buzz_v2_report", [b.id, "spam_scam", null]), "own_item", "own buzz");
  await mustFail(() => call(R1, "buzz_v2_report", [b.id, "bogus", null]), "validation_failed", "unknown reason");
  await mustFail(() => call(R1, "buzz_v2_report", [b.id, "other", "short"]), "validation_failed", "other without a real note");
  await mustFail(() => call(R1, "buzz_v2_report", [crypto.randomUUID(), "spam_scam", null]), "not_found", "missing");
  const res = await call(eligible[0], "buzz_v2_report", [b.id, "harassment", null]);
  if (!same(res, { alreadyReported: false })) throw new Error(JSON.stringify(res));
  if (!same(await call(eligible[0], "buzz_v2_report", [b.id, "harassment", null]), { alreadyReported: true })) throw new Error("repeat");
  for (const sort of ["hot", "new", "top"]) if ((await ids(eligible[0], { sort, window: "all" })).includes(b.id)) throw new Error(`still in the reporter's ${sort}`);
  if (!(await ids(eligible[1], { sort: "new" })).includes(b.id)) throw new Error("gone for everyone");
  await call(eligible[1], "buzz_v2_report", [b.id, "harassment", null]);
  await call(eligible[2], "buzz_v2_report", [b.id, "harassment", null]);
  if ((await one(db.query("select status from public.buzz_posts where id = $1", [b.id]))).status !== "hidden") throw new Error("3 eligible reporters did not hide it");
  const told = (await db.query("select actor_id, data from public.notifications where user_id = $1 and type = 'moderation'", [OP])).rows;
  if (!told.length || told.some((n) => n.actor_id !== null)) throw new Error(`author notice ${JSON.stringify(told)}`);
  const rep = (await db.query("select target_type, eligible, weight from public.reports where target_id = $1", [b.id])).rows;
  if (rep.length !== 3 || rep.some((r) => r.target_type !== "buzz" || !r.eligible || r.weight !== 1)) throw new Error(JSON.stringify(rep));
  // the reports table refuses Buzz targets from the API (they go through buzz_v2_report)
  const direct = await errorOf(() => as(R1, () => db.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'buzz', $2, 'spam')", [R1, b.id])));
  if (!/row-level security/.test(direct ?? "")) throw new Error(`direct Buzz report: ${direct}`);
  const replyTarget = await reply(R1, first.id, "a reply to report");
  if (!same(await call(VIEW, "buzz_v2_report", [replyTarget.id, "other", "This reply is off-topic spam."]), { alreadyReported: false })) throw new Error("reply report");
  if ((await one(db.query("select target_type from public.reports where target_id = $1", [replyTarget.id]))).target_type !== "buzz_reply") throw new Error("reply report type");
  if ((await replies(VIEW, first.id)).items.some((r) => r.id === replyTarget.id)) throw new Error("reported reply still in the reporter's thread");
});
await expectOk("adapters: snapshot (no author), author_of (the only way to the author), set_status (removed takes notifications), staff context (blind)", async () => {
  const t = await create(OP, { title: "Adapter title", text: "adapter body", poll: { options: ["yes", "no"], durationDays: 1 } });
  const a = await reply(R1, t.id, "adapter reply one");
  const held = await reply(R2, t.id, { text: "adapter held reply", parentId: a.id }, { status: "held" });
  const c = await reply(R3, t.id, { text: "adapter reply three", parentId: a.id });
  const snap = await val(db.query("select public.buzz_v2_snapshot('buzz', $1)", [t.id]));
  if (!(snap.entityType === "buzz" && snap.entityId === t.id && snap.status === "active" && snap.label === "buzz" && snap.surface === "buzz" && snap.href === `/buzz/${t.id}` && snap.parent === null && snap.universityId === TXST)) throw new Error(JSON.stringify(snap));
  if (!same(snap.fields.map((f) => f.field), ["title", "body", "option", "option"])) throw new Error(JSON.stringify(snap.fields));
  if ((await val(db.query("select public.buzz_v2_snapshot('buzz', $1)", [a.id]))) !== null) throw new Error("a reply as a buzz");
  const rs = await val(db.query("select public.buzz_v2_snapshot('buzz_reply', $1)", [held.id]));
  if (!(rs.label === "reply" && rs.status === "held" && same(rs.parent, { entityType: "buzz_reply", entityId: a.id }))) throw new Error(JSON.stringify(rs));
  for (const s of [snap, rs]) await firewall(T, "snapshot", s);
  if ((await val(db.query("select public.buzz_v2_author_of('buzz_reply', $1)", [held.id]))) !== R2) throw new Error("author_of");
  const ctx = await val(db.query("select public.buzz_v2_staff_context('buzz_reply', $1)", [held.id]));
  await firewall(T, "staff context", ctx);
  if (!(ctx.item.id === held.id && ctx.item.text === "adapter held reply" && ctx.item.isMine === false && ctx.item.myVote === 0)) throw new Error(JSON.stringify(ctx.item));
  if (!same(ctx.parents.map((p) => p.id), [a.id]) || !same(ctx.siblings.map((s) => s.id), [a.id, c.id])) throw new Error(`context ${JSON.stringify({ p: ctx.parents.map((p) => p.id), s: ctx.siblings.map((s) => s.id) })}`);
  if (ctx.root.poll.resultsVisible !== false || ctx.root.isMine !== false) throw new Error("blind root");
  const aNote = async () => val(db.query("select count(*)::int from public.buzz_notification_refs where entity_type = 'buzz_reply' and entity_id = $1", [a.id]));
  if ((await aNote()) !== 1) throw new Error("setup: a notified the thread's author");
  await db.query("select public.buzz_v2_set_status('buzz_reply', $1, 'removed')", [a.id]);
  if ((await aNote()) !== 0) throw new Error("a removed reply's notification stayed");
  await db.query("select public.buzz_v2_set_status('buzz', $1, 'hidden')", [t.id]);
  const ctx2 = await val(db.query("select public.buzz_v2_staff_context('buzz', $1)", [t.id]));
  if (!(ctx2.item.status === "hidden" && ctx2.item.text === "adapter body" && ctx2.siblings.find((s) => s.id === a.id).text === "adapter reply one")) throw new Error("staff read the words of every status");
  await firewall(T, "staff context of a thread", ctx2);
  const op = (await thread(OP, t.id)).replies.items;
  if (!(op.find((r) => r.id === a.id).status === "removed" && op.find((r) => r.id === a.id).text === "") || op.some((r) => r.id === held.id)) throw new Error("member view after removal");
  await mustFail(() => db.query("select public.buzz_v2_set_status('buzz', $1, 'gone')", [t.id]), "validation_failed", "unknown status");
  // the AI second pass (service role) may hide what it just wrote
  await asService(() => db.query("select public.buzz_v2_set_status('buzz_reply', $1, 'hidden')", [c.id]));
  if ((await one(db.query("select status from public.buzz_comments where id = $1", [c.id]))).status !== "hidden") throw new Error("service-role hide");
});
await expectOk("share card: headline and \"Buzz\" (+ campus only when it is big enough to be named), no alias, no image; unavailable otherwise", async () => {
  const b = await create(OP, { text: "x".repeat(150) });
  let card = await call(VIEW, "buzz_v2_share_snapshot", [b.id]);
  if (!(card.status === "available" && card.title.length === 100 && card.title.endsWith("…") && card.imageUrl === null && card.href === `/buzz/${b.id}`)) throw new Error(JSON.stringify(card));
  if (card.subtitle !== "Buzz") throw new Error(`a small campus was named: ${card.subtitle}`);
  await db.exec("update public.buzz_secrets set min_campus_named = 2");
  card = await call(VIEW, "buzz_v2_share_snapshot", [b.id]);
  if (card.subtitle !== "Buzz · Texas State") throw new Error(card.subtitle);
  await db.exec("update public.buzz_secrets set min_campus_named = 50");
  for (const id of [crypto.randomUUID(), (await create(OP, { text: "held card" }, { status: "held" })).id]) {
    const u = await call(VIEW, "buzz_v2_share_snapshot", [id]);
    if (!(u.status === "unavailable" && u.title === null && u.subtitle === "Buzz")) throw new Error(JSON.stringify(u));
  }
});

// ---- 9. my buzzes and karma -------------------------------------------------------------------------------------------
await expectOk("my buzzes: own threads and replies with snippets, only ever your own; karma = the sum of your scores", async () => {
  const me = await user("Leopold Brightwater", { uni: TXST });
  const t = await create(me, { text: "my own thread about the shuttle" });
  const theirs = await create(R1, { title: "Their thread headline", text: "their body" });
  const a = await reply(me, theirs.id, "my first reply");
  const b = await reply(me, theirs.id, { text: "my reply under my reply", parentId: a.id });
  const c = await reply(me, theirs.id, { text: "deeper still", parentId: b.id });
  await vote(R1, t.id, 1);
  await vote(R2, a.id, 1);
  const threads = await call(me, "buzz_v2_mine", ["threads", 0, 20]);
  if (!same(threads.items.map((m) => m.item.id), [t.id]) || threads.items[0].threadSnippet !== "my own thread about the shuttle" || !threads.items[0].item.isMine) throw new Error(JSON.stringify(threads));
  const rs = await call(me, "buzz_v2_mine", ["replies", 0, 20]);
  const by = new Map(rs.items.map((m) => [m.item.id, m]));
  if (rs.items.length !== 3 || rs.nextOffset !== null) throw new Error(JSON.stringify(rs));
  if (!(by.get(a.id).item.depth === 1 && by.get(a.id).threadSnippet === "Their thread headline")) throw new Error("reply a");
  if (!(by.get(b.id).item.depth === 2 && by.get(b.id).item.parentId === a.id)) throw new Error("reply b");
  if (!(by.get(c.id).item.parentId === a.id && same(by.get(c.id).item.replyingTo, by.get(b.id).item.alias))) throw new Error("reply c");
  if (!same(by.get(a.id).item.alias, by.get(c.id).item.alias)) throw new Error("same thread, same alias");
  const page = await call(me, "buzz_v2_mine", ["replies", 0, 2]);
  if (page.items.length !== 2 || page.nextOffset !== 2) throw new Error("paging");
  if ((await call(R3, "buzz_v2_mine", ["replies", 0, 50])).items.some((m) => by.has(m.item.id))) throw new Error("someone else's replies");
  if ((await call(me, "buzz_v2_karma")) !== 2) throw new Error("karma");
  await call(me, "buzz_v2_delete", [t.id]);
  if ((await call(me, "buzz_v2_karma")) !== 1 || (await call(me, "buzz_v2_mine", ["threads", 0, 20])).items.length !== 0) throw new Error("deleted ones count");
  await mustFail(() => call(me, "buzz_v2_mine", ["everything", 0, 20]), "validation_failed", "unknown kind");
});

// ---- 10. aliases ------------------------------------------------------------------------------------------------------
await expectOk("alias: UniVerse's derivation exactly; stable in a thread, different across threads; collision suffix by first post; ties by id", async () => {
  const key = (threadId, uid) => {
    const d = digest(threadId, uid);
    return `${d.readUInt16BE(0) % 64}:${d.readUInt16BE(2) % 12}`;
  };
  // (keeps the thread's author out of any collision with the account the check is about: 1 in 768 otherwise)
  const freshThread = async (text, notLike) => {
    for (;;) {
      const t = await create(OP, { text });
      if (key(t.id, OP) !== key(t.id, notLike)) return t;
    }
  };
  const t1 = await freshThread("alias thread one", R1);
  const t2 = await freshThread("alias thread two", R1);
  if (!same(t1.alias, aliasOf(t1.id, OP))) throw new Error(`derivation ${JSON.stringify(t1.alias)} vs ${JSON.stringify(aliasOf(t1.id, OP))}`);
  const a1 = await reply(R1, t1.id, "alias reply one");
  const a2 = await reply(R1, t1.id, "alias reply two");
  const b1 = await reply(R1, t2.id, "alias reply three");
  if (!same(a1.alias, a2.alias) || !same(a1.alias, aliasOf(t1.id, R1)) || !same(b1.alias, aliasOf(t2.id, R1))) throw new Error("stable in a thread");
  if (digest(t1.id, R1).equals(digest(t2.id, R1))) throw new Error("same digest across threads");
  const own = await reply(OP, t1.id, "OP joins in");
  if (!own.isOp || !same(own.alias, t1.alias)) throw new Error("OP's reply");
  const feedCard = (await feed(VIEW, { sort: "new" })).items.find((x) => x.id === t1.id);
  if (!same(feedCard.alias, t1.alias)) throw new Error("feed card alias differs from the thread's");
  // one author across many threads: not one alias everywhere
  const many = [];
  for (let i = 0; i < 6; i++) many.push((await create(R3, { text: `spread thread ${i}`, scope: "global" })).alias.label);
  if (new Set(many).size < 2) throw new Error("the same alias in every thread");
  // collision: an account whose (noun, colour) in a thread equals R1's, joining after R1, is "<label> 2"
  const tc = await freshThread("collision thread", R1);
  const c1 = await reply(R1, tc.id, "first of the pair");
  let twin = null;
  for (let i = 0; i < 200000 && !twin; i++) {
    const cand = crypto.randomUUID();
    if (key(tc.id, cand) === key(tc.id, R1)) twin = cand;
  }
  const T1 = await user("Ignatius Fernsby", { uni: TXST, id: twin });
  const tw = await reply(T1, tc.id, "the twin arrives");
  if (tw.alias.label !== `${c1.alias.label} 2` || tw.alias.emoji !== c1.alias.emoji || tw.alias.color !== c1.alias.color) throw new Error(`suffix ${JSON.stringify(tw.alias)} vs ${JSON.stringify(c1.alias)}`);
  const listed = (await replies(VIEW, tc.id)).items;
  if (listed.find((r) => r.id === c1.id).alias.label !== c1.alias.label || listed.find((r) => r.id === tw.id).alias.label !== tw.alias.label) throw new Error("suffixes as read");
  if ((await thread(VIEW, tc.id)).root.alias.label.endsWith(" 2")) throw new Error("the thread's author got a suffix");
  // ties on the first post's time break by its id
  const t3 = await freshThread("tie thread", R2);
  let twin3 = null;
  for (let i = 0; i < 200000 && !twin3; i++) { const cand = crypto.randomUUID(); if (key(t3.id, cand) === key(t3.id, R2)) twin3 = cand; }
  const T3 = await user("Perpetua Holloway", { uni: TXST, id: twin3 });
  const x = await reply(R2, t3.id, "tie one");
  const y = await reply(T3, t3.id, "tie two");
  await db.query("update public.buzz_comments set visible_at = (select visible_at from public.buzz_posts where id = $1) + interval '5 seconds' where post_id = $1", [t3.id]);
  const shown = (await replies(VIEW, t3.id)).items;
  const plain = x.id < y.id ? x.id : y.id;
  for (const r of shown) {
    const suffixed = r.alias.label.endsWith(" 2");
    if ((r.id === plain) === suffixed) throw new Error(`tie: ${r.id} ${r.alias.label}`);
  }
});
await expectOk("the alias is never stored: no table holds any label served so far", async () => {
  const labels = new Set();
  for (const [, body] of T.served) walk(body, "$", (k, _p, x) => { if (k === "alias" && x && typeof x.label === "string") labels.add(x.label); });
  if (labels.size < 5) throw new Error("not enough aliases served to check");
  const pattern = [...labels].map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const cols = (await db.query(`select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`)).rows;
  for (const { table_name, column_name } of cols) {
    const n = await val(db.query(`select count(*)::int from public."${table_name}" where "${column_name}"::text ~ $1`, [pattern]));
    if (n) throw new Error(`${table_name}.${column_name} holds an alias`);
  }
});

// ---- 11. jitter --------------------------------------------------------------------------------------------------------
await expectOk("jitter: others see a thread only after its delay, the author at once; only the published time, floored, is ever shown", async () => {
  await db.exec("update public.buzz_secrets set thread_jitter_seconds = 3600, reply_jitter_seconds = 3600");
  const late = await create(R2, { text: "a delayed thought on the library hours" });
  await db.query("update public.buzz_posts set visible_at = now() + interval '30 minutes' where id = $1", [late.id]);
  if ((await ids(VIEW, { sort: "new" })).includes(late.id)) throw new Error("listed before its time");
  await mustFail(() => thread(VIEW, late.id), "not_found", "opened before its time");
  await mustFail(() => vote(VIEW, late.id, 1), "not_found", "voted before its time");
  await mustFail(() => reply(VIEW, late.id, "guessing the id"), "not_found", "replied before its time");
  const own = (await thread(R2, late.id)).root;
  if (own.createdAt > Date.now() || own.createdAt % MIN !== 0) throw new Error("the author sees a future or unfloored time");
  // a reply never shows before its thread or its parent; its notification shows when it does, minute-aligned
  const host = await create(OP, { text: "host thread for a delayed reply" });
  await db.query("update public.buzz_posts set visible_at = now() - interval '10 minutes' where id = $1", [host.id]);
  const rr = await reply(R1, host.id, "a delayed reply");
  await db.query("update public.buzz_comments set visible_at = now() + interval '30 minutes' where id = $1", [rr.id]);
  await db.query("update public.notifications n set created_at = public.buzz_floor_minute(now() + interval '30 minutes'), visible_at = public.buzz_ceil_minute(now() + interval '30 minutes') from public.buzz_notification_refs r where r.notification_id = n.id and r.entity_id = $1", [rr.id]);
  if ((await replies(VIEW, host.id)).items.some((r) => r.id === rr.id)) throw new Error("reply visible early");
  if ((await thread(VIEW, host.id)).root.replyCount !== 0) throw new Error("the count reveals an unpublished reply");
  await mustFail(() => reply(VIEW, host.id, { text: "attaching to it", parentId: rr.id }), "not_found", "an unpublished parent");
  if ((await as(OP, () => db.query("select 1 from public.notifications where link = $1", [`/buzz/${host.id}`]))).rows.length) throw new Error("the author was told early");
  const real = await one(db.query("select created_at, visible_at from public.buzz_comments where id = $1", [rr.id]));
  const note = await one(db.query("select n.created_at, n.visible_at from public.notifications n join public.buzz_notification_refs r on r.notification_id = n.id where r.entity_id = $1", [rr.id]));
  if (+note.created_at === +real.created_at || +note.created_at % MIN !== 0 || +note.visible_at % MIN !== 0 || +note.visible_at < +real.visible_at) throw new Error(JSON.stringify({ note, real }));
  const own2 = await reply(R1, host.id, { text: "under my own delayed reply", parentId: rr.id });
  if (+(await one(db.query("select visible_at from public.buzz_comments where id = $1", [own2.id]))).visible_at < +real.visible_at) throw new Error("a reply showed before its parent");
  // Hot ranking does not move when an unpublished reply lands
  const at = new Date().toISOString();
  const hotBefore = JSON.stringify(await feed(VIEW, { sort: "hot", rankAt: at }));
  for (let i = 0; i < 6; i++) {
    const x = await reply(R3, first.id, `pile-on ${i}`);
    await db.query("update public.buzz_comments set visible_at = now() + interval '30 minutes' where id = $1", [x.id]);
  }
  if (JSON.stringify(await feed(VIEW, { sort: "hot", rankAt: at })) !== hotBefore) throw new Error("unpublished replies moved the hot ranking (or a count)");
  await db.query("update public.buzz_posts set visible_at = now() - interval '1 second' where id = $1", [late.id]);
  const pub = (await thread(VIEW, late.id)).root;
  const row = await one(db.query("select created_at, visible_at from public.buzz_posts where id = $1", [late.id]));
  if (pub.createdAt !== Math.floor(+row.visible_at / MIN) * MIN) throw new Error("not the published minute");
  await db.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0");
});

// ---- 12. the block oracle, 404 parity, public-signal isolation ----------------------------------------------------------
await expectOk("block oracle: blocking a buzz author changes no byte of any feed, thread or reply page for the blocker", async () => {
  const t = await create(R1, { text: "block oracle thread", scope: "global" });
  await reply(R1, t.id, "author's own reply in the oracle thread");
  const at = new Date().toISOString();
  const snap = async () => {
    const out = [];
    for (const scope of ["campus", "global"]) for (const sort of ["hot", "new", "top"]) out.push(JSON.stringify(await feed(VIEW, { scope, sort, window: "all", rankAt: at })));
    out.push(JSON.stringify(await thread(VIEW, t.id)), JSON.stringify(await replies(VIEW, root.id)), JSON.stringify(await call(VIEW, "buzz_v2_meta", ["global"])));
    return out;
  };
  const before = await snap();
  await as(VIEW, () => db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2), ($1, $3)", [VIEW, R1, OP]));
  const after = await snap();
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) throw new Error(`response ${i} changed after a block`);
  await as(VIEW, () => db.query("delete from public.blocks where blocker_id = $1", [VIEW]));
});
await expectOk("404 parity: someone else's delete, and every route on someone else's held buzz, answer exactly like a missing id", async () => {
  const mine = await create(OP, { text: "parity check thread" });
  const missing = crypto.randomUUID();
  const same404 = async (a, b, what) => {
    const x = await errorOf(a);
    const y = await errorOf(b);
    if (x === null || x !== y || !x.startsWith("buzz:not_found:")) throw new Error(`${what}: ${x} vs ${y}`);
  };
  await same404(() => call(R1, "buzz_v2_delete", [mine.id]), () => call(R1, "buzz_v2_delete", [missing]), "delete");
  await same404(() => call(R2, "buzz_v2_delete", [r1.id]), () => call(R2, "buzz_v2_delete", [missing]), "someone else's reply");
  await db.query("update public.buzz_posts set status = 'held' where id = $1", [mine.id]);
  const routes = [["buzz_v2_vote", (id) => [id, 1]], ["buzz_v2_thread", (id) => [id, 50]], ["buzz_v2_replies", (id) => [id, 0, 50]], ["buzz_v2_hide_thread", (id) => [id, true]],
    ["buzz_v2_hide_author", (id) => [id]], ["buzz_v2_poll_vote", (id) => [id, crypto.randomUUID()]], ["buzz_v2_report", (id) => [id, "spam_scam", null]]];
  for (const [fn, args] of routes) await same404(() => call(R1, fn, args(mine.id)), () => call(R1, fn, args(missing)), fn);
  await same404(() => reply(R1, mine.id, "hello"), () => reply(R1, missing, "hello"), "reply");
  if ((await one(db.query("select count(*)::int as n from public.buzz_hidden_threads where thread_id = $1", [mine.id]))).n !== 0) throw new Error("hid a held thread");
  await mustFail(() => vote(OP, mine.id, 1), "own_item", "the owner learns only what they can see");
  if (!(await thread(OP, mine.id)).root.text) throw new Error("the author reads their held buzz");
  await db.query("update public.buzz_posts set status = 'active' where id = $1", [mine.id]);
  const v = await vote(R1, mine.id, 1);
  if (!same(Object.keys(v).sort(), ["collapsed", "myVote", "score"])) throw new Error(JSON.stringify(v));
});
await expectOk("public-signal isolation: buzzing, replying, voting, poll-voting, hiding and reporting change nothing public about the person", async () => {
  const x = await user("Cordelia Ashgrove", { uni: TXST });
  const snap = async () => JSON.stringify({
    profile: await one(db.query("select * from public.profiles where id = $1", [x])),
    feedPosts: await val(db.query("select count(*)::int from public.feed_posts")),
    follows: await val(db.query("select count(*)::int from public.follows")),
    likes: await val(db.query("select count(*)::int from public.post_likes")),
    comments: await val(db.query("select count(*)::int from public.post_comments")),
    actorNotes: await val(db.query("select count(*)::int from public.notifications where actor_id is not null")),
    activity: await val(db.query("select count(*)::int from public.user_activity")),
  });
  const before = await snap();
  const own = await create(x, { text: "isolation probe", poll: { options: ["a", "b"], durationDays: 1 } });
  const other = await create(R1, { text: "isolation target", poll: { options: ["c", "d"], durationDays: 1 } });
  await reply(x, other.id, "x replies here");
  await vote(x, other.id, 1);
  await call(x, "buzz_v2_poll_vote", [other.id, other.poll.options[0].id]);
  await call(x, "buzz_v2_hide_thread", [other.id, true]);
  await call(x, "buzz_v2_report", [other.id, "spam_scam", null]);
  await reply(R1, own.id, "someone answers x");
  await vote(R1, own.id, 1);
  if ((await snap()) !== before) throw new Error(`changed: ${before} -> ${await snap()}`);
});

// ---- 13. rate limits ---------------------------------------------------------------------------------------------------
await expectOk("rate limits: 6 threads an hour (2 for a new account), deleting gives no slot back; replies 10 an hour and votes 60 for a new account", async () => {
  const heavy = await user("Barnaby Thistlewood", { uni: TXST });
  for (let i = 0; i < 6; i++) {
    const b = await create(heavy, { text: `rate ${i}` }, { keepRate: true });
    if (i === 5) await call(heavy, "buzz_v2_delete", [b.id]);
  }
  const msg = await errorOf(() => create(heavy, { text: "rate 7" }, { keepRate: true }));
  if (!/^buzz:rate_limited:You're going fast\. Try again in \d+ minutes\.$/.test(msg ?? "")) throw new Error(msg);
  const fresh = await user("Wilhelmina Starling", { uni: TXST, ageDays: 0 });
  await create(fresh, { text: "new account one" }, { keepRate: true });
  await create(fresh, { text: "new account two" }, { keepRate: true });
  await mustFail(() => create(fresh, { text: "new account three" }, { keepRate: true }), "rate_limited", "a new account's third thread");
  await T.clearRates(fresh);
  for (let i = 0; i < 10; i++) await reply(fresh, first.id, `new reply ${i}`, { keepRate: true });
  await mustFail(() => reply(fresh, first.id, "eleventh", { keepRate: true }), "rate_limited", "a new account's 11th reply");
  await T.clearRates(fresh);
  for (let i = 0; i < 60; i++) await vote(fresh, first.id, i % 2 ? 0 : 1);
  await mustFail(() => vote(fresh, first.id, 1), "rate_limited", "a new account's 61st vote");
});

// ---- 14. small campuses, meta -------------------------------------------------------------------------------------------
await expectOk("small campuses: never named next to a Global buzz below min_campus_named; the note shows on small campus feeds; meta names your campus", async () => {
  const g = await create(OP, { text: "small campus naming check", scope: "global" });
  if ((await thread(VIEW, g.id)).root.campusShortName !== null) throw new Error("a small campus was named");
  let meta = await call(VIEW, "buzz_v2_meta", ["campus"]);
  if (meta.smallCampusNote !== true || !same(meta.campus, { name: "Texas State University", shortName: "Texas State" })) throw new Error(JSON.stringify(meta));
  if ((await call(VIEW, "buzz_v2_meta", ["global"])).smallCampusNote !== false) throw new Error("note on Global");
  if ((await thread(VIEW, first.id)).smallCampusNote !== true) throw new Error("thread note on your small campus");
  if ((await thread(FAR, first.id)).smallCampusNote !== false) throw new Error("thread note on someone else's campus");
  await db.exec("update public.buzz_secrets set min_campus_named = 3");
  if ((await thread(VIEW, g.id)).root.campusShortName !== "Texas State") throw new Error("a big campus is named");
  if ((await thread(VIEW, first.id)).root.campusShortName !== null) throw new Error("named on a campus buzz");
  meta = await call(VIEW, "buzz_v2_meta", ["campus"]);
  if (meta.smallCampusNote !== false) throw new Error("note on a big campus");
  if ((await call(NOUNI, "buzz_v2_meta", ["campus"])).campus !== null) throw new Error("campus without a university");
  await db.exec("update public.buzz_secrets set min_campus_named = 50");
});

// ---- 15. old builds, account deletion -----------------------------------------------------------------------------------
await expectOk("old app builds: every old Buzz function answers update_required (and signed-out callers cannot call them at all)", async () => {
  for (const sql of ["select * from public.buzz_feed()", `select * from public.buzz_get('${first.id}')`, `select * from public.buzz_comments_list('${first.id}')`,
    "select public.buzz_create('rant', 'An old build title')", `select public.buzz_reply('${first.id}', 'hello')`, `select * from public.buzz_vote('${first.id}', 1)`,
    `select * from public.buzz_comment_vote('${r1.id}', 1)`, `select public.buzz_delete('${first.id}')`, `select public.buzz_delete_comment('${r1.id}')`,
    `select public.buzz_mute(p_post_id => '${first.id}')`, `select public.buzz_unmute('${first.id}')`]) {
    await mustFail(() => as(VIEW, () => db.query(sql)), "update_required", sql);
    await mustDeny(() => asAnon(() => db.query(sql)), `anon ${sql}`);
  }
});
await expectOk("account deletion: threads and replies stay, detached, with the same aliases and OP badges; nothing points at the account", async () => {
  const leaver = await user("Ambrose Quenby", { uni: TXST });
  const t = await create(leaver, { text: "a thread whose author leaves" });
  await reply(leaver, t.id, "the author's own reply");
  await reply(R1, t.id, "someone else's reply");
  const elsewhere = await reply(leaver, first.id, "the leaver in another thread");
  const before = JSON.stringify(await thread(VIEW, t.id));
  const beforeElse = JSON.stringify((await replies(VIEW, first.id)).items.find((r) => r.id === elsewhere.id));
  await db.query("delete from auth.users where id = $1", [leaver]);
  if (JSON.stringify(await thread(VIEW, t.id)) !== before) throw new Error("the thread changed when its author left");
  if (JSON.stringify((await replies(VIEW, first.id)).items.find((r) => r.id === elsewhere.id)) !== beforeElse) throw new Error("a reply changed when its author left");
  const rows = (await db.query("select author_id, alias from public.buzz_posts where id = $1 union all select author_id, alias from public.buzz_comments where post_id = $1 or id = $2", [t.id, elsewhere.id])).rows;
  if (rows.some((r) => r.author_id === leaver) || !rows.some((r) => /^detached:[0-9a-f]{64}$/.test(r.alias))) throw new Error(JSON.stringify(rows));
});

// ---- 16. the firewall over everything served --------------------------------------------------------------------------
await expectOk("firewall: no forbidden key, no test user's id / name / username / email, minute-floored times, in EVERY response served above", async () => {
  // and a last sweep of every read for several viewers, every sort x scope x window, with and without search
  for (const who of [OP, R1, VIEW, FAR, NOUNI]) {
    for (const scope of ["campus", "global"]) for (const sort of ["hot", "new", "top"]) for (const window of sort === "top" ? ["day", "week", "all"] : ["day"]) {
      await feed(who, { scope, sort, window });
      await feed(who, { scope, sort, window, q: "thread reply" });
    }
    for (const s of ["campus", "global"]) await call(who, "buzz_v2_meta", [s]);
    await call(who, "buzz_v2_mine", ["threads", 0, 50]);
    await call(who, "buzz_v2_mine", ["replies", 0, 50]);
    await call(who, "buzz_v2_karma");
    await call(who, "buzz_v2_gate");
    await call(who, "buzz_v2_posting_status");
    await thread(who, root.id);
    await replies(who, root.id, 1, 2);
  }
  if (T.served.length < 250) throw new Error(`only ${T.served.length} responses`);
  for (const [label, body] of T.served) await firewall(T, label, body, { allow: label === "buzz_v2_meta" ? ["$.campus.name"] : [] });
  // the notifications Buzz wrote: no actor, only {target_type, target_id, anonymous}, minute times, no identity
  const rows = (await db.query("select * from public.notifications where type in ('buzz_reply', 'buzz_milestone', 'buzz_poll_closed')")).rows;
  if (rows.length < 10) throw new Error("not enough notifications");
  for (const n of rows) {
    if (n.actor_id !== null || !same(Object.keys(n.data).sort(), ["anonymous", "target_id", "target_type"]) || n.data.anonymous !== true) throw new Error(JSON.stringify(n));
    if (+n.created_at % MIN !== 0 || +n.visible_at % MIN !== 0) throw new Error("notification time");
    await firewall(T, "notification", { title: n.title, body: n.body, data: n.data, link: n.link });
  }
});

// =============================================================================
// World 2: data the old functions wrote, converted by migration 42
// =============================================================================
const W = harness(await boot());
{
  const { db: d } = W;
  for (const f of OLD) await d.exec(read(`migrations/${f}`)); // the old functions are back (old builds wrote these)
  await d.exec("update public.buzz_secrets set thread_jitter_seconds = 0, reply_jitter_seconds = 0, min_campus_size = 1");
  const TX = await W.uniId("Texas State University");
  const A = await W.user("Oswin Marchetti", { uni: TX, gate: false });
  const B = await W.user("Philippa Dunmore", { uni: TX, gate: false });
  const C = await W.user("Caspian Wrexley", { uni: TX, gate: false });
  const D = await W.user("Isadora Penhaligon", { uni: TX, gate: false });
  const old = (uid, sql, args = []) => W.as(uid, () => W.val(d.query(sql, args)));
  const tCampus = await old(A, "select public.buzz_create(p_topic => 'advice', p_title => 'Old campus thread title', p_body => 'old campus body', p_university_id => $1)", [TX]);
  const tGlobal = await old(A, "select public.buzz_create(p_topic => 'rant', p_title => 'Old untagged thread')");
  const tLeft = await old(D, "select public.buzz_create(p_topic => 'other', p_title => 'Thread whose author leaves')");
  const o1 = await old(B, "select public.buzz_reply($1, 'OLD-REPLY-ONE about the fees', null)", [tCampus]);
  const o2 = await old(A, "select public.buzz_reply($1, 'old reply two', $2)", [tCampus, o1]);
  const o3 = await old(C, "select public.buzz_reply($1, 'OLD-REPLY-THREE deep down', $2)", [tCampus, o2]);
  const oD = await old(D, "select public.buzz_reply($1, 'the leaver answers their own thread', null)", [tLeft]);
  const oB = await old(B, "select public.buzz_reply($1, 'someone else in the leaver thread', null)", [tLeft]);
  for (const [uid, v] of [[B, 1], [C, 1], [D, -1]]) await old(uid, "select * from public.buzz_vote($1, $2)", [tCampus, v]);
  for (const uid of [A, C]) await old(uid, "select * from public.buzz_comment_vote($1, 1)", [o1]);
  await old(B, "select public.buzz_mute(p_post_id => $1)", [tGlobal]); // the old "hide this thread"
  await old(C, "select public.buzz_mute(p_comment_id => $1)", [o1]); // the old "hide this person in this thread"
  await d.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'buzz', $2, 'harassment'), ($3, 'buzz_comment', $4, 'harassment')", [C, tGlobal, A, o3]);
  // an account deleted before v2 existed: its rows detached with their old alias
  await d.exec("alter table public.buzz_posts disable trigger buzz_posts_freeze_alias; alter table public.buzz_comments disable trigger buzz_comments_freeze_alias");
  await d.query("delete from auth.users where id = $1", [D]);
  await d.exec("alter table public.buzz_posts enable trigger buzz_posts_freeze_alias; alter table public.buzz_comments enable trigger buzz_comments_freeze_alias");
  const oldNotes = (await d.query("select * from public.notifications where type = 'comment' and data ->> 'target_type' = 'buzz'")).rows;

  await d.exec(read(V2));
  for (const uid of [A, B, C]) await W.as(uid, () => d.query("select public.buzz_v2_accept_gate($1)", [VERSION]));

  await expectOk("conversion: old threads keep their words; no campus -> Global, a campus -> Campus; all active; counts from the votes (old votes eligible)", async () => {
    const rows = (await d.query("select id, scope, status, title, body, upvotes, downvotes, score, eligible_votes, eligible_score, alias from public.buzz_posts")).rows;
    const by = new Map(rows.map((r) => [r.id, r]));
    if (by.get(tCampus).scope !== "campus" || by.get(tGlobal).scope !== "global" || by.get(tLeft).scope !== "global") throw new Error(JSON.stringify(rows.map((r) => [r.title, r.scope])));
    if (rows.some((r) => r.status !== "active")) throw new Error("status");
    const c = by.get(tCampus); // D's -1 left with D's account
    if (!(c.upvotes === 2 && c.downvotes === 0 && c.score === 2 && c.eligible_votes === 2 && c.eligible_score === 2)) throw new Error(JSON.stringify(c));
    if (!/^Student \d{5}$/.test(by.get(tLeft).alias)) throw new Error("a pre-v2 detached row keeps its old key");
    const r = (await d.query("select id, depth, upvotes, eligible_votes, score, status from public.buzz_comments")).rows;
    const rb = new Map(r.map((x) => [x.id, x]));
    if (rb.get(o1).depth !== 1 || rb.get(o2).depth !== 2 || rb.get(o3).depth !== 3) throw new Error("depth");
    if (rb.get(o1).upvotes !== 2 || rb.get(o1).eligible_votes !== 2 || rb.get(o1).score !== 2) throw new Error("reply counts");
    const votes = (await d.query("select eligible from public.buzz_votes union all select eligible from public.buzz_comment_votes")).rows;
    if (!votes.length || votes.some((v) => v.eligible !== true)) throw new Error("old votes eligible");
  });
  await expectOk("conversion: the old thread hide became a hidden thread; the old hide of a replier stays a hide of that anon in that thread", async () => {
    const hidden = (await d.query("select user_id, thread_id from public.buzz_hidden_threads")).rows;
    if (!same(hidden, [{ user_id: B, thread_id: tGlobal }])) throw new Error(JSON.stringify(hidden));
    const mutes = (await d.query("select user_id, post_id, muted_id, legacy from public.buzz_mutes")).rows;
    if (!same(mutes, [{ user_id: C, post_id: tCampus, muted_id: B, legacy: false }])) throw new Error(JSON.stringify(mutes));
    if ((await W.ids(B, { scope: "global", sort: "new" })).includes(tGlobal)) throw new Error("hidden thread in the feed");
    if (!(await W.replies(C, tCampus)).items.find((x) => x.id === o1).collapsed) throw new Error("hidden anon not collapsed");
  });
  await expectOk("conversion: reports on replies are 'buzz_reply' reports (no 'buzz_comment' left, nor allowed); the reporter no longer sees what they reported", async () => {
    const reps = (await d.query("select target_type, target_id from public.reports order by target_type")).rows;
    if (!same(reps, [{ target_type: "buzz", target_id: tGlobal }, { target_type: "buzz_reply", target_id: o3 }])) throw new Error(JSON.stringify(reps));
    const msg = await errorOf(() => d.query("insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'buzz_comment', $2, 'other')", [B, o2]));
    if (!/reports_target_type_check/.test(msg ?? "")) throw new Error(`buzz_comment still allowed: ${msg}`);
    if ((await W.ids(C, { scope: "global", sort: "new" })).includes(tGlobal)) throw new Error("reported thread in the reporter's feed");
    if ((await W.replies(A, tCampus)).items.some((x) => x.id === o3)) throw new Error("reported reply in the reporter's thread");
  });
  await expectOk("conversion: the old reply notifications quoted the reply; now they are anonymous buzz_reply notices quoting only the recipient's thread", async () => {
    if (oldNotes.length !== 2 || !oldNotes.some((n) => /OLD-REPLY-ONE/.test(n.body))) throw new Error(`setup ${JSON.stringify(oldNotes.map((n) => n.body))}`);
    const rows = (await d.query("select * from public.notifications where id = any($1::uuid[])", [oldNotes.map((n) => n.id)])).rows;
    for (const n of rows) {
      if (!(n.type === "buzz_reply" && n.title === "Someone replied to your buzz" && n.body === "Old campus thread title" && n.actor_id === null)) throw new Error(JSON.stringify(n));
      if (!same(n.data, { target_type: "buzz", target_id: tCampus, anonymous: true }) || +n.created_at % MIN !== 0) throw new Error(JSON.stringify(n));
    }
  });
  await expectOk("conversion: read through v2 the old threads have per-thread aliases; a pre-v2 detached author keeps one alias and the OP badge in their thread", async () => {
    const t = await W.thread(B, tLeft);
    const items = t.replies.items;
    const mine = items.find((x) => x.id === oD);
    const other = items.find((x) => x.id === oB);
    if (!(mine.isOp && same(mine.alias, t.root.alias) && !other.isOp && !same(other.alias, t.root.alias))) throw new Error(JSON.stringify({ root: t.root.alias, mine, other }));
    const campus = await W.thread(B, tCampus);
    if (!(campus.root.title === "Old campus thread title" && campus.root.text === "old campus body" && campus.root.scope === "campus")) throw new Error(JSON.stringify(campus.root));
    const shaped = campus.replies.items;
    if (!(shaped.find((x) => x.id === o2).depth === 2 && shaped.find((x) => x.id === o3).depth === 2 && same(shaped.find((x) => x.id === o3).replyingTo, shaped.find((x) => x.id === o2).alias))) throw new Error("old tree shape");
    if (!shaped.find((x) => x.id === o2).isOp) throw new Error("OP badge on an old reply");
    for (const body of [t, campus, await W.feed(B, { scope: "global" }), await W.feed(B, { scope: "campus" })]) await firewall(W, "converted", body);
  });
  await expectOk("conversion: running migration 42 again changes nothing (same rows, same answers), and the old builds get update_required", async () => {
    const state = async () => JSON.stringify([
      (await d.query("select id, scope, status, upvotes, downvotes, score, eligible_votes, eligible_score, alias from public.buzz_posts order by id")).rows,
      (await d.query("select id, status, depth, score, alias from public.buzz_comments order by id")).rows,
      (await d.query("select * from public.buzz_hidden_threads order by user_id")).rows,
      (await d.query("select user_id, post_id, muted_id, legacy from public.buzz_mutes order by user_id")).rows,
      (await d.query("select id, type, title, body, data from public.notifications order by id")).rows,
      (await d.query("select target_type, target_id from public.reports order by target_id")).rows,
      await W.thread(B, tCampus), await W.thread(C, tLeft), await W.feed(A, { scope: "global", sort: "new" }),
    ]);
    const before = await state();
    await d.exec(read(V2));
    if ((await state()) !== before) throw new Error("a second run changed something");
  });
  // (The old migrations themselves cannot run again over v2 data: migration 11's report check predates 'buzz_reply'.
  // home-feed.test.mjs re-runs them on a fresh database and then this one.)
  await expectOk("after the old migrations ran again (old builds' functions live) migration 42 put v2 back in charge: stubs, the v2 reply trigger, no old internals", async () => {
    await mustFail(() => W.as(A, () => d.query("select * from public.buzz_feed()")), "update_required", "old feed");
    await mustFail(() => W.as(A, () => d.query("select public.buzz_create('rant', 'still on an old build')")), "update_required", "old create");
    await mustFail(() => W.as(A, () => d.query("select public.buzz_reply($1, 'old reply')", [tCampus])), "update_required", "old reply");
    const trig = (await d.query("select tgname, tgfoid::regproc::text as fn from pg_trigger where tgrelid = 'public.buzz_comments'::regclass and not tgisinternal order by tgname")).rows;
    if (!trig.some((t) => t.tgname === "buzz_comments_notify" && t.fn === "buzz_v2_notify_reply") || trig.some((t) => t.fn === "buzz_notify_reply")) throw new Error(JSON.stringify(trig));
    if ((await d.query("select 1 from pg_proc where proname in ('buzz_alias', 'buzz_hidden', 'buzz_can_see', 'buzz_reply_count', 'buzz_notify_reply')")).rows.length) throw new Error("old internals back");
    for (const fn of ["buzz_feed", "buzz_get", "buzz_comments_list", "buzz_create", "buzz_reply", "buzz_vote", "buzz_comment_vote", "buzz_delete", "buzz_delete_comment", "buzz_mute", "buzz_unmute"]) {
      const g = await one(d.query("select bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon, bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as auth from pg_proc p where p.proname = $1", [fn]));
      if (g.anon || !g.auth) throw new Error(`${fn} grants ${JSON.stringify(g)}`);
    }
  });
}

done("BUZZ-V2");

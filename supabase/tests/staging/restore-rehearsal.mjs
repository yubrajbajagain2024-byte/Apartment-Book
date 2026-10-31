// The backup and restore tools (scripts/backup.mjs --full, scripts/restore.mjs) rehearsed on the staging project with its
// own data and a throwaway account, through the real stack (the Management API, Auth, the REST API, Storage):
//   1. a full backup of staging as it is (A);
//   2. a student with a password, a photo in their posts folder and a post showing it; a full backup (B);
//   3. the student's account deleted (their post and photo go with it);
//   4. restore B: the student signs in with the old password, their post and photo are back, Storage's record is right;
//   5. restore A: staging as it was, the student gone.
// Never runs against production: it refuses production's ref and any project not named as staging, and so do the scripts.
//
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> node supabase/tests/staging/restore-rehearsal.mjs
//
// The two backups it makes stay in BACKUP_DIR (default ~/CampConnect-backups) for a look; delete them afterwards.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This rehearsal replaces a project's data twice: it never runs against production.");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(os.homedir(), "CampConnect-backups");

const mgmt = async (method, route, body) => {
  const r = await fetch(`https://api.supabase.com${route}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${route} -> ${r.status}: ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
};
const project = await mgmt("GET", `/v1/projects/${REF}`);
if (!/staging/i.test(project.name)) throw new Error(`Refusing: project "${project.name}" is not named as a staging project.`);
const sql = (q) => mgmt("POST", `/v1/projects/${REF}/database/query`, { query: q });
const val = async (q) => { const r = (await sql(q))[0]; return r ? r[Object.keys(r)[0]] : undefined; };
const keys = await mgmt("GET", `/v1/projects/${REF}/api-keys?reveal=true`);
const URL_ = `https://${REF}.supabase.co`;
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
/** Runs one of the scripts against staging and prints what it said. */
const script = (file, args) => {
  try {
    const out = execFileSync("node", [`scripts/${file}`, ...args], { cwd: REPO, env: { ...process.env, SUPABASE_PROJECT_REF: REF, BACKUP_DIR }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(out.trim().split("\n").map((l) => "    " + l).join("\n"));
    return out;
  } catch (e) {
    throw new Error(`${file} ${args[0]}: ${String(e.stderr || e.stdout || e.message).trim().split("\n").filter(Boolean).at(-1)}`);
  }
};

let passes = 0, failures = 0;
const ok = (n) => { passes++; console.log(`  ✓ ${n}`); };
const fail = (n, e) => { failures++; console.log(`  ✗ ${n}: ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); };
const check = async (n, fn) => { try { await fn(); ok(n); } catch (e) { fail(n, e); } };
const expect = (c, m) => { if (!c) throw new Error(m); };
const must = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code ?? ""} ${error.message}`); return data; };

const stamp = Date.now().toString(36);
const day = new Date().toISOString().slice(0, 10);
const A = path.join(BACKUP_DIR, `${day}-stg-before-${stamp}`);
const B = path.join(BACKUP_DIR, `${day}-stg-probe-${stamp}`);
console.log(`Staging project ${project.name} (${REF}): backup and restore rehearsal (run ${stamp})`);
await check("1. a full backup of staging as it is (A)", () => script("backup.mjs", [`stg-before-${stamp}`, "--full"]));

const email = `st-restore-${stamp}@txstate.edu`;
const password = `Rs-${stamp}-${Math.random().toString(36).slice(2, 10)}!`;
let user, post, photoPath, photoUrl;
await check("2. a student with a password, a photo in their posts folder and a post showing it; a full backup (B)", async () => {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "St Restore" } });
  if (error) throw new Error(error.message);
  user = data.user.id;
  const txstate = await val("select id from public.universities where email_domain = 'txstate.edu'");
  await sql(`update public.profiles set university_id = '${txstate}' where id = '${user}'`);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(s.error.message);
  photoPath = `posts/${user}/restore-${stamp}.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const up = await c.storage.from("uploads").upload(photoPath, png, { contentType: "image/png" });
  if (up.error) throw new Error(up.error.message);
  photoUrl = c.storage.from("uploads").getPublicUrl(photoPath).data.publicUrl;
  post = await must(c.from("feed_posts").insert({ author_id: user, kind: "post", body: `restore rehearsal ${stamp}`, university_id: txstate, images: [photoUrl], image_meta: [{ url: photoUrl, width: 1, height: 1, blur: null }] }).select("id").single());
  script("backup.mjs", [`stg-probe-${stamp}`, "--full"]);
  const m = JSON.parse(fs.readFileSync(path.join(B, "manifest.json"), "utf8"));
  expect(m.full && m.files >= 1 && fs.existsSync(path.join(B, "files/uploads", photoPath)), "B lacks the photo file");
  expect(JSON.parse(fs.readFileSync(path.join(B, "auth/users.json"), "utf8")).some((u) => u.id === user && u.encrypted_password), "B lacks the account's password hash");
});
await check("3. the account deleted: the post and its photo go with it", async () => {
  const { error } = await admin.auth.admin.deleteUser(user);
  if (error) throw new Error(error.message);
  expect((await val(`select count(*)::int from public.feed_posts where id = '${post.id}'`)) === 0, "the post stayed");
  for (let i = 0; i < 20 && (await val(`select count(*)::int from storage.objects where name = '${photoPath}'`)) === 1; i++) await new Promise((r) => setTimeout(r, 1000));
  if ((await val(`select count(*)::int from storage.objects where name = '${photoPath}'`)) === 1) await admin.storage.from("uploads").remove([photoPath]);
  const c = createClient(URL_, ANON, opts);
  expect((await c.auth.signInWithPassword({ email, password })).error, "the deleted account still signs in");
});
await check("4. restore B: the student signs in with the old password; the post and the photo are back; Storage's record is right", async () => {
  script("restore.mjs", [B, "--yes"]);
  const c = createClient(URL_, ANON, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`sign-in: ${s.error.message}`);
  const mine = await must(c.from("feed_posts").select("id, images").eq("id", post.id).single());
  expect(mine.images[0] === photoUrl, JSON.stringify(mine));
  expect((await fetch(photoUrl)).status === 200, "the photo does not load");
  const o = (await sql(`select owner::text as owner, metadata ->> 'mimetype' as mime from storage.objects where name = '${photoPath}'`))[0];
  expect(o && o.owner === user && o.mime === "image/png", `object ${JSON.stringify(o)}`);
});
await check("5. restore A: staging as it was, the student gone", async () => {
  script("restore.mjs", [A, "--yes"]);
  const c = createClient(URL_, ANON, opts);
  expect((await c.auth.signInWithPassword({ email, password })).error, "the account is back after restoring A");
  expect((await val(`select count(*)::int from storage.objects where name = '${photoPath}'`)) === 0, "the photo is back after restoring A");
});
console.log(`${failures ? "✗" : "✓"} restore rehearsal: ${passes} passed, ${failures} failed (backups ${A} and ${B})`);
process.exit(failures ? 1 : 0);

// The business portal's Inbox in a browser, with a student writing through the real API at the same time: a new
// message reaches the team on any page (a toast, the Inbox's badge, the tab's title, a desktop alert once turned on),
// the inbox lists it (unread, needing a reply, what it is about) with working filters and search, the chat shows the
// inquiry's context, messages arrive in an open chat as they are sent, a reply sends at once and reaches the student,
// and a business never writes first: a student's empty inquiry is neither listed nor writable. Never talks to production.
// Usage: the site pointed at staging, the release rehearsal's `seed`, `apply` and `check` steps run, then:
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> BASE=http://localhost:3060 PLAYWRIGHT_CHANNEL=chrome node apps/web/e2e/business-inbox.mjs [screenshots]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3060";
const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This test writes messages: it never runs against production.");
const SHOTS = process.argv[2] ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(new URL("../../../supabase/tests/staging/.rehearsal.json", import.meta.url), "utf8"));
const A = state.accounts, I = state.ids, run = state.run;

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const ANON = keys.find((k) => k.name === "anon").api_key;
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const URL_ = `https://${REF}.supabase.co`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
async function as(u) {
  const c = createClient(URL_, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(error.message);
  return c;
}
const must = async (p) => {
  const { data, error } = await p;
  if (error) throw new Error(`${error.code ?? ""} ${error.message}`);
  return data;
};

let failures = 0;
let production = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m, e) => {
  failures++;
  console.log(`  ✗ ${m}: ${String(e?.message ?? e).split("\n")[0].slice(0, 300)}`);
};
const step = async (name, fn) => {
  try {
    await fn();
    ok(name);
  } catch (e) {
    bad(name, e);
  }
};
const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};

const ben = await as(A.ben);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(["notifications"], { origin: new URL(BASE).origin });
// Desktop alerts are recorded instead of shown, so the test can read them.
await ctx.addInitScript(() => {
  window.__alerts = [];
  window.Notification = class {
    static permission = "granted";
    static requestPermission = async () => "granted";
    constructor(title, options) {
      window.__alerts.push({ title, body: options?.body ?? "" });
    }
    close() {}
  };
});
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
page.on("request", (r) => {
  if (r.url().includes(PRODUCTION)) production++;
});
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
await page.goto(`${BASE}/business/login`);
await page.fill("#email", A.owner.email);
await page.fill("#password", A.owner.password);
await page.locator("button[type=submit]").first().click();
await page.waitForURL((u) => !u.pathname.endsWith("/login"));
const sidebar = page.locator("aside[aria-label='Portal']");

await step("the Inbox sits right below Overview", async () => {
  await sidebar.waitFor();
  const main = (await sidebar.locator("nav[aria-label='Sections'] > ul a").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
  expect(main[0] === "Overview" && main[1] === "Inbox", JSON.stringify(main));
});

await step("desktop alerts turn on in Settings › Account", async () => {
  await page.goto(`${BASE}/business/settings/account`);
  const toggle = page.getByTestId("message-alerts");
  await toggle.waitFor();
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await page.waitForFunction(() => document.querySelector("[data-testid='message-alerts']")?.getAttribute("aria-checked") === "true");
});

const text1 = `Is the pool heated? (${run} ${Date.now().toString(36)})`;
await step("a student's message reaches the team on another page: a toast with Reply, the Inbox's badge, the tab's title, a desktop alert", async () => {
  await page.goto(`${BASE}/business`);
  await page.getByTestId("at-a-glance").waitFor();
  await page.waitForTimeout(2500); // the live channel joins
  const badgeBefore = Number((await sidebar.getByRole("link", { name: /^Inbox/ }).innerText()).replace(/\D+/g, "") || 0);
  await must(ben.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.ben.id, content: text1 }));
  const toast = page.getByTestId("message-toast").filter({ hasText: text1 });
  await toast.waitFor({ timeout: 20000 });
  expect((await toast.innerText()).includes("Rh Ben"), "the toast does not name the student");
  await shot("toast");
  await page.waitForFunction(() => /^\(\d+\+?\) /.test(document.title), null, { timeout: 15000 });
  await page.waitForFunction((before) => Number((document.querySelector("aside[aria-label='Portal'] nav a[href$='/inbox']")?.textContent ?? "").replace(/\D+/g, "") || 0) > before, badgeBefore, { timeout: 15000 });
  const alerts = await page.evaluate(() => window.__alerts);
  expect(alerts.some((a) => a.title.startsWith("Rh Ben") && a.body.includes("pool heated")), JSON.stringify(alerts));
});

await step("Reply in the toast opens the chat, with what the student asked about at the top", async () => {
  await page.getByTestId("message-toast").filter({ hasText: text1 }).getByRole("button", { name: "Reply" }).click();
  await page.waitForURL(new RegExp(`/business/inbox/${I.inquiry}$`));
  const about = page.getByTestId("inquiry-about");
  await about.waitFor();
  const t = await about.innerText();
  expect(/Asked about/.test(t) && /Listing/.test(t) && /Rh two-bed/.test(t) && /\$1,200\/mo/.test(t), `context: ${t}`);
  await page.getByText(text1).first().waitFor();
});

await step("a message sent while the chat is open appears at once, without a toast", async () => {
  const text2 = `And is parking included? (${Date.now().toString(36)})`;
  await page.waitForTimeout(1500);
  await must(ben.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.ben.id, content: text2 }));
  await page.getByText(text2).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  expect(!(await page.getByTestId("message-toast").filter({ hasText: text2 }).count()), "a toast for the chat already open");
  await shot("chat");
});

const reply = `Yes, heated all year, and parking is included. (${Date.now().toString(36)})`;
await step("the owner's reply shows at once and reaches the student", async () => {
  const box = page.getByRole("textbox").last();
  await box.fill(reply);
  await box.press("Enter");
  await page.getByText(reply).first().waitFor({ timeout: 5000 });
  let seen = false;
  for (let i = 0; i < 20 && !seen; i++) {
    seen = (await must(ben.from("messages").select("id").eq("conversation_id", I.inquiry).eq("content", reply))).length === 1;
    if (!seen) await new Promise((r) => setTimeout(r, 500));
  }
  expect(seen, "the student never received the reply");
});

let empty;
await step("the inbox: rows with the last sender, a Listings filter, search, and no empty inquiry", async () => {
  const dee = A[Object.keys(A).find((k) => k.startsWith("inq"))];
  // A student who opened an inquiry and has not written: never listed, never writable.
  const fresh = await as(A.cam);
  empty = await must(fresh.rpc("start_business_inquiry", { p_target_type: "business", p_target_id: I.business }));
  await page.goto(`${BASE}/business/inbox`);
  const list = page.getByTestId("inquiry-list");
  await list.waitFor();
  await list.getByText("Rh Ben").first().waitFor();
  const names = await list.getByTestId("inquiry").allInnerTexts();
  expect(names.some((n) => n.includes("Rh Ben") && n.includes("You:")), `Ben's row: ${names.join(" | ")}`);
  expect(!names.some((n) => n.includes("Rh Cam")), "a student's empty inquiry is listed");
  await list.getByRole("button", { name: /^Listings/ }).click();
  expect((await list.getByTestId("inquiry").allInnerTexts()).every((n) => /Listing/.test(n)), "Listings shows other kinds");
  await list.getByRole("button", { name: /^All/ }).click();
  if (dee) {
    await list.getByRole("searchbox", { name: "Search inquiries" }).fill("Dee");
    const found = await list.getByTestId("inquiry").allInnerTexts();
    expect(found.length > 0 && found.every((n) => n.includes("Rh Dee")), `search: ${found.join(" | ")}`);
    await list.getByRole("searchbox", { name: "Search inquiries" }).fill("");
  }
  await shot("inbox");
});

await step("the business cannot write first, even knowing the empty inquiry's address", async () => {
  const owner = await as(A.owner);
  let refused = false;
  try {
    await must(owner.from("messages").insert({ conversation_id: empty, sender_id: A.owner.id, content: "Hi! Need help?" }));
  } catch (e) {
    refused = /only reply|row-level/i.test(e.message);
  }
  expect(refused, "the business wrote first");
  const r = await page.goto(`${BASE}/business/inbox/${empty}`);
  expect(r?.status() === 404 || (await page.getByText(/not found|404/i).count()) > 0, `the empty inquiry opened: HTTP ${r?.status()}`);
});

await step("an editor can reply too (authorized staff), in real time", async () => {
  const staff = await as(A.staff);
  const text = `Lee here: tours run daily. (${Date.now().toString(36)})`;
  await page.goto(`${BASE}/business/inbox/${I.inquiry}`);
  await page.getByTestId("inquiry-about").waitFor();
  await page.waitForTimeout(1500);
  await must(staff.from("messages").insert({ conversation_id: I.inquiry, sender_id: A.staff.id, content: text }));
  await page.getByText(text).first().waitFor({ timeout: 20000 });
});

// The empty inquiry goes; the messages stay with the rehearsal's other data until its cleanup.
if (empty) await admin.from("conversations").delete().eq("id", empty);
await browser.close();
console.log(`  ${production === 0 ? "✓" : "✗"} requests to production: ${production}`);
console.log(`${failures || production ? "✗" : "✓"} business inbox: ${failures ? `${failures} failed` : "all passed"}`);
process.exit(failures || production ? 1 : 0);

// The business's public profile and its hours in a browser: the business's name and photo at the top of the portal's
// sidebar open a preview of the profile as students see it; Settings › Business profile sets the hours (a day open 24
// hours, a named holiday closed) and the website, and they save as the database keeps them; the preview and the student
// page show whether the business is open now in its own time zone, with today's special hours, the week and the
// holidays; the Website button opens the business's site in a new tab; signed-out visitors see the same; a business
// without hours shows none; and the API cannot store malformed hours or let an editor change them. Never talks to
// production. Usage: the site pointed at staging, the release rehearsal's `seed` and `apply` steps run (migration 57
// included), then:
//   SUPABASE_ACCESS_TOKEN=… STAGING_SUPABASE_REF=<ref> BASE=http://localhost:3060 PLAYWRIGHT_CHANNEL=chrome node apps/web/e2e/business-profile.mjs [screenshots]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3060";
const PRODUCTION = "dskbzoqreandwwpxiplh";
const REF = process.env.STAGING_SUPABASE_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) throw new Error("Set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN");
if (REF === PRODUCTION) throw new Error("This test changes a business's profile: it never runs against production.");
const SHOTS = process.argv[2] ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(new URL("../../../supabase/tests/staging/.rehearsal.json", import.meta.url), "utf8"));
const A = state.accounts, I = state.ids;

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const ANON = keys.find((k) => k.name === "anon").api_key;
const URL_ = `https://${REF}.supabase.co`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
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
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}: ${String(e?.message ?? e).split("\n")[0].slice(0, 300)}`);
  }
};
const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};

// Today and tomorrow where the business is (Central Time, the hours' default).
const chicago = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const today = chicago(new Date());
const inDays = (n) => chicago(new Date(Date.now() + n * 864e5));
const nine = [{ open: "09:00", close: "17:00" }];
const everyDay = (ranges) => ({ mon: ranges, tue: ranges, wed: ranges, thu: ranges, fri: ranges, sat: ranges, sun: ranges });
const WEBSITE = "https://riverrock-staging.example/";

const owner = await as(A.owner);
const staff = await as(A.staff);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const watch = (page) => {
  page.setDefaultTimeout(45000);
  page.on("request", (r) => {
    if (r.url().includes(PRODUCTION)) production++;
  });
  return page;
};
const signIn = async (page, path, u) => {
  await page.goto(BASE + path);
  await page.fill("#email", u.email);
  await page.fill("#password", u.password);
  await page.locator("button[type=submit]").first().click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
};

const portal = watch(await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage());
await signIn(portal, "/business/login", A.owner);

await step("the business's name and photo at the top of the sidebar open the profile as students see it", async () => {
  const link = portal.locator("aside[aria-label='Portal'] [data-testid='profile-preview-link']");
  expect((await link.innerText()).includes("View public profile"), await link.innerText());
  await link.click();
  await portal.waitForURL(/\/business\/preview$/);
  await portal.getByTestId("profile-preview").getByTestId("business-profile").waitFor();
  expect((await link.getAttribute("aria-current")) === "page", "the header is not marked as the page you are on");
  const name = await portal.getByTestId("profile-preview").locator("h1").innerText();
  expect(name.startsWith("River Rock"), name);
});

await step("Settings › Business profile: hours on, Monday open 24 hours, a named holiday closed, the website; saved as sent", async () => {
  await portal.goto(`${BASE}/business/profile`);
  const editor = portal.getByTestId("hours-editor");
  await editor.waitFor();
  if ((await portal.getByTestId("hours-enabled").getAttribute("aria-checked")) !== "true") await portal.getByTestId("hours-enabled").click();
  await editor.getByTestId("hours-mon").getByRole("button", { name: "Open 24 hours" }).click();
  await portal.getByTestId("hours-add-special").click();
  const special = editor.getByTestId("hours-special").last();
  await special.getByLabel("Date").fill(inDays(20));
  await special.getByLabel("Name of the day").fill("Founders Day");
  await portal.fill("#website", WEBSITE);
  if (SHOTS) await editor.screenshot({ path: `${SHOTS}/hours-editor.png` });
  await portal.getByRole("button", { name: "Save profile" }).click();
  await portal.getByText("Saved.").waitFor();
  const row = await must(owner.from("businesses").select("hours, website").eq("id", I.business).single());
  expect(row.website === WEBSITE, `website: ${row.website}`);
  expect(JSON.stringify(row.hours.week.mon) === JSON.stringify([{ open: "00:00", close: "24:00" }]), `mon: ${JSON.stringify(row.hours.week.mon)}`);
  expect(JSON.stringify(row.hours.week.tue) === JSON.stringify(nine) && row.hours.week.sun.length === 0, `week: ${JSON.stringify(row.hours.week)}`);
  expect(row.hours.timezone === "America/Chicago", row.hours.timezone);
  expect(row.hours.special.some((s) => s.date === inDays(20) && s.label === "Founders Day" && s.closed === true), JSON.stringify(row.hours.special));
});

await step("the preview shows the hours and a Website button, with the student site's look", async () => {
  await portal.goto(`${BASE}/business/preview`);
  const frame = portal.getByTestId("profile-preview");
  await frame.getByTestId("business-hours").waitFor();
  expect((await frame.getByTestId("business-website").getAttribute("href")) === WEBSITE, "the Website button points elsewhere");
  // The student site's white panels and greys, even in a dark portal.
  const bg = await frame.getByTestId("business-profile").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(/255, 255, 255|^rgb\(255 255 255/.test(bg), `panel: ${bg}`);
  await frame.getByTestId("business-hours").locator("summary").click();
  await frame.getByText("Founders Day").waitFor();
  if (SHOTS) await portal.screenshot({ path: `${SHOTS}/preview.png`, fullPage: true });
});

const student = watch(await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage());
await signIn(student, "/login", A.ben);
const profileStatus = async (page) => {
  await page.goto(`${BASE}/businesses/${I.business}`);
  await page.getByTestId("business-hours").waitFor();
  return (await page.getByTestId("business-hours").locator("summary").innerText()).replace(/\s+/g, " ").trim();
};

await step("a student sees it open now when today has special hours around the clock, with today's name", async () => {
  await must(owner.from("businesses").update({ hours: { timezone: "America/Chicago", week: everyDay(nine), special: [{ date: today, label: "Open house", closed: false, hours: [{ open: "00:00", close: "24:00" }] }] } }).eq("id", I.business).select("id"));
  const text = await profileStatus(student);
  expect(text.startsWith("Open 24 hours") && text.includes("Open house"), text);
});

await step("…and closed, opening tomorrow at 9, when today is a closed holiday; the week and the holidays open below", async () => {
  await must(owner.from("businesses").update({ hours: { timezone: "America/Chicago", week: everyDay(nine), special: [{ date: today, label: "Inventory day", closed: true, hours: [] }, { date: inDays(5), label: "Staff party", closed: false, hours: [{ open: "12:00", close: "15:00" }] }] } }).eq("id", I.business).select("id"));
  const text = await profileStatus(student);
  expect(/^Closed · Opens tomorrow 9 AM/.test(text) && text.includes("Inventory day"), text);
  const panel = student.getByTestId("business-hours");
  await panel.locator("summary").click();
  expect((await panel.locator("dt").count()) === 7, "the week is not seven days");
  const holidays = await panel.innerText();
  expect(holidays.includes("Holiday hours") && holidays.includes("Staff party") && holidays.includes("12 PM – 3 PM") && holidays.includes("Times in Central Time"), holidays);
  if (SHOTS) await student.screenshot({ path: `${SHOTS}/student.png` });
});

await step("the Website button opens the business's own site in a new tab, without telling it where the student came from", async () => {
  const button = student.getByTestId("business-website");
  expect((await button.getAttribute("href")) === WEBSITE, "href");
  expect((await button.getAttribute("target")) === "_blank", "not a new tab");
  const rel = (await button.getAttribute("rel")) ?? "";
  expect(rel.includes("noopener") && rel.includes("noreferrer"), rel);
});

await step("signed out, the profile shows the same hours", async () => {
  const visitor = watch(await (await browser.newContext()).newPage());
  const text = await profileStatus(visitor);
  expect(text.startsWith("Closed"), text);
  await visitor.context().close();
});

await step("the database refuses malformed hours, and an editor cannot change them", async () => {
  const { error } = await owner.from("businesses").update({ hours: { timezone: "Europe/London", week: everyDay(nine), special: [] } }).eq("id", I.business);
  expect(error && /businesses_hours_check/.test(error.message), `malformed: ${error?.message ?? "accepted"}`);
  const changed = await must(staff.from("businesses").update({ hours: null }).eq("id", I.business).select("id"));
  expect(changed.length === 0, "an editor changed the hours");
});

await step("a business without hours shows none", async () => {
  await must(owner.from("businesses").update({ hours: null, website: null }).eq("id", I.business).select("id"));
  await student.goto(`${BASE}/businesses/${I.business}`);
  await student.getByTestId("business-profile").waitFor();
  expect((await student.getByTestId("business-hours").count()) === 0, "hours still shown");
  expect((await student.getByTestId("business-website").count()) === 0, "a Website button without a website");
});

await browser.close();
console.log(`  ${production === 0 ? "✓" : "✗"} requests to production: ${production}`);
console.log(`${failures || production ? "✗" : "✓"} business profile: ${failures ? `${failures} failed` : "all passed"}`);
process.exit(failures || production ? 1 : 0);

// How fast the business portal feels, measured in a real browser on a desktop and on a phone: the time from a click in
// the sidebar to the new page's heading, whether a loading skeleton was ever shown on the way, how many requests each
// page makes to Supabase, a filter switch that must cost no request at all, the Inbox opening a chat, the drawer on a
// phone, and the dark theme without a light flash. Never talks to production.
//
// Usage: a PRODUCTION build pointed at staging (prefetching only runs in production builds):
//   npm run build -w web && npm run start -w web -- -p 3060     (with staging's URL and keys in the environment)
// after the release rehearsal's `seed`, `apply` and `check` steps (supabase/tests/staging/release-rehearsal.mjs), then:
//   BASE=http://localhost:3060 PLAYWRIGHT_CHANNEL=chrome node apps/web/e2e/business-performance.mjs [screenshot folder]
// Prints a table per device and ends with a non-zero code on an error screen or a filter that made a request; the
// times are reported, with "slow" beside any navigation over SLOW_MS, not failed, so a slow machine does not fail it.
import fs from "node:fs";
import { chromium, devices } from "playwright";

const BASE = process.env.BASE || "http://localhost:3060";
const PRODUCTION = "dskbzoqreandwwpxiplh";
const SLOW_MS = Number(process.env.SLOW_MS || 600);
const SHOTS = process.argv[2] ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(new URL("../../../supabase/tests/staging/.rehearsal.json", import.meta.url), "utf8"));
const A = state.accounts;
const SECTIONS = ["Overview", "Inbox", "Advertisements", "Products & Services", "Analytics", "Billing", "Settings"];
const HEADINGS = { Overview: /./, Inbox: /^Inbox/, Advertisements: "Advertisements", "Products & Services": "Products & Services", Analytics: "Analytics", Billing: "Billing", Settings: "Settings" };

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
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });

/** A signed-in page that counts its own requests: to Supabase (data) and to the site (RSC payloads, actions). */
async function signedIn(user, options) {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const counts = { supabase: 0, site: 0 };
  page.on("request", (r) => {
    const url = r.url();
    if (url.includes(PRODUCTION)) production++;
    if (/supabase\.(co|in)\//.test(url)) counts.supabase++;
    else if (url.startsWith(BASE) && !/\/_next\/(static|image)\//.test(url)) counts.site++;
  });
  await page.goto(`${BASE}/business/login`);
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.locator("button[type=submit]").first().click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"));
  return { ctx, page, counts };
}
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};
const noErrorScreen = async (page) => expect(!(await page.getByText(/Something went wrong|Application error/).count()), "an error screen");

/** Arms a watcher for any loading state ([aria-busy="true"]) becoming visible; `skeletonShown()` reads it. */
async function watchSkeleton(page) {
  await page.evaluate(() => {
    window.__skeleton = false;
    const seen = () => {
      for (const el of document.querySelectorAll('[aria-busy="true"]')) {
        const style = getComputedStyle(el);
        if (style.opacity !== "0" && style.display !== "none") window.__skeleton = true;
      }
    };
    const mo = new MutationObserver(seen);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "aria-busy"] });
    const tick = setInterval(seen, 16);
    window.__stopSkeleton = () => {
      mo.disconnect();
      clearInterval(tick);
    };
  });
}
const skeletonShown = (page) =>
  page.evaluate(() => {
    window.__stopSkeleton?.();
    return window.__skeleton === true;
  });

/** Clicks a sidebar (or drawer) link and measures until the page's heading is on screen. */
async function navigate(page, nav, label, counts) {
  const before = { ...counts };
  await watchSkeleton(page);
  const t0 = Date.now();
  await nav.getByRole("link", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  const heading = HEADINGS[label];
  await page.getByRole("heading", { level: 1, name: heading }).first().waitFor();
  const ms = Date.now() - t0;
  const skeleton = await skeletonShown(page);
  await noErrorScreen(page);
  return { label, ms, skeleton, supabase: counts.supabase - before.supabase, site: counts.site - before.site };
}

function table(rows) {
  const w = Math.max(...rows.map((r) => r.label.length));
  console.log(`    ${"page".padEnd(w)}  click→heading  skeleton  requests (site / supabase)`);
  for (const r of rows) console.log(`    ${r.label.padEnd(w)}  ${String(r.ms).padStart(6)} ms${r.ms > SLOW_MS ? " slow" : "     "}  ${r.skeleton ? "shown " : "none  "}    ${r.site} / ${r.supabase}`);
  console.log(`    median ${median(rows.map((r) => r.ms))} ms, slowest ${Math.max(...rows.map((r) => r.ms))} ms, skeletons on ${rows.filter((r) => r.skeleton).length} of ${rows.length}`);
}

// --- The owner on a desktop ----------------------------------------------------------------------------------------------------
{
  const { ctx, page, counts } = await signedIn(A.owner, { viewport: { width: 1440, height: 900 } });
  const sidebar = page.locator("aside[aria-label='Portal']");

  await step("desktop: the first page loads without an error", async () => {
    await page.getByTestId("at-a-glance").waitFor();
    const timing = await page.evaluate(() => {
      const [n] = performance.getEntriesByType("navigation");
      return n ? { ttfb: Math.round(n.responseStart), dom: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null;
    });
    console.log(`    first load: TTFB ${timing?.ttfb} ms, DOMContentLoaded ${timing?.dom} ms, load ${timing?.load} ms`);
    await shot(page, "desktop-overview");
  });

  await step("desktop: a cold pass through every section, then a warm pass after hovering each link first", async () => {
    const cold = [];
    for (const label of SECTIONS.slice(1)) cold.push(await navigate(page, sidebar, label, counts));
    cold.push(await navigate(page, sidebar, "Overview", counts));
    console.log("  cold (nothing prefetched beyond what came into view):");
    table(cold);
    // Intent: the pointer rests on each link, which prefetches the page in full; then the clicks should land on ready pages.
    for (const label of SECTIONS) {
      await sidebar.getByRole("link", { name: new RegExp(`^${label.replace("&", "&")}`) }).hover();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1500);
    const warm = [];
    for (const label of SECTIONS.slice(1)) warm.push(await navigate(page, sidebar, label, counts));
    warm.push(await navigate(page, sidebar, "Overview", counts));
    console.log("  warm (after intent prefetch):");
    table(warm);
    expect(warm.every((r) => r.ms < 10000), "a navigation hung");
  });

  await step("desktop: switching an ads filter costs no request and no loading state", async () => {
    await sidebar.getByRole("link", { name: /^Advertisements/ }).click();
    await page.getByRole("heading", { level: 1, name: "Advertisements" }).waitFor();
    const nav = page.getByRole("navigation", { name: "Filter ads" });
    if ((await nav.count()) === 0) {
      console.log("    (no ads on this business: the filter row is not shown)");
      return;
    }
    const before = { ...counts };
    await watchSkeleton(page);
    const t0 = Date.now();
    await nav.getByRole("link", { name: /^Running/ }).click();
    await page.waitForURL(/status=running/);
    const ms = Date.now() - t0;
    const skeleton = await skeletonShown(page);
    await page.waitForTimeout(300);
    console.log(`    filter: ${ms} ms, requests ${counts.site - before.site} site / ${counts.supabase - before.supabase} supabase, skeleton ${skeleton ? "shown" : "none"}`);
    expect(counts.site - before.site === 0, "the filter made a request to the site");
    expect(!skeleton, "the filter showed a loading state");
    expect((await nav.locator("a[aria-current='page']").innerText()).startsWith("Running"), "Running is not the active filter");
    await nav.getByRole("link", { name: /^All/ }).click();
    await page.waitForURL((u) => !u.search.includes("status="));
  });

  await step("desktop: the Inbox opens a chat", async () => {
    await sidebar.getByRole("link", { name: /^Inbox/ }).click();
    await page.getByTestId("inquiry-list").waitFor();
    const first = page.getByTestId("inquiry").first();
    if ((await first.count()) === 0) {
      console.log("    (no inquiries on this business)");
      return;
    }
    await first.hover();
    await page.waitForTimeout(400);
    await watchSkeleton(page);
    const t0 = Date.now();
    await first.click();
    await page.getByRole("textbox", { name: "Message" }).waitFor();
    const ms = Date.now() - t0;
    console.log(`    chat open: ${ms} ms, skeleton ${(await skeletonShown(page)) ? "shown" : "none"}`);
    await noErrorScreen(page);
    await shot(page, "desktop-inbox");
  });

  await step("desktop: the dark theme paints the window's background dark too", async () => {
    await sidebar.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("radio", { name: "Dark" }).click();
    await page.waitForTimeout(200);
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(/rgb\(0, 0, 0\)/.test(bodyBg), `body background in dark mode: ${bodyBg}`);
    await shot(page, "desktop-dark");
    await page.getByRole("radio", { name: "System" }).click();
  });

  await ctx.close();
}

// --- The owner on a phone --------------------------------------------------------------------------------------------------------
{
  const { ctx, page, counts } = await signedIn(A.owner, { ...devices["iPhone 13"] });

  await step("phone: the first page loads", async () => {
    await page.getByTestId("at-a-glance").waitFor();
    const timing = await page.evaluate(() => {
      const [n] = performance.getEntriesByType("navigation");
      return n ? { ttfb: Math.round(n.responseStart), dom: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null;
    });
    console.log(`    first load: TTFB ${timing?.ttfb} ms, DOMContentLoaded ${timing?.dom} ms, load ${timing?.load} ms`);
    await shot(page, "phone-overview");
  });

  await step("phone: every section from the drawer, measured from the tap", async () => {
    const rows = [];
    for (const label of [...SECTIONS.slice(1), "Overview"]) {
      await page.getByRole("button", { name: "Open the menu" }).tap();
      const drawer = page.locator("#portal-drawer");
      await drawer.waitFor();
      rows.push(await navigate(page, drawer, label, counts));
      await page.waitForTimeout(150);
    }
    table(rows);
    await shot(page, "phone-billing");
  });

  await ctx.close();
}

await browser.close();
if (production > 0) {
  console.log(`\n  ✗ ${production} request(s) went to production`);
  failures++;
}
console.log(failures ? `\n${failures} failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);

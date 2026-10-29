// The business portal's sidebar in a browser: its sections in their order (Overview, Inbox, Advertisements, Products &
// Services, Analytics, Billing, then Settings apart at the bottom), the active mark on each page, every section's page
// doing its job (Overview's figures, Products' type filter, Billing's totals, CSV and receipt, Settings' pages), the
// drawer on a phone, and an editor without Billing. Never talks to production.
// Usage: the site pointed at staging (npm run dev -w web -- -p 3060 with that project's URL and keys), the release
// rehearsal's `seed`, `apply` and `check` steps run (supabase/tests/staging/release-rehearsal.mjs), then:
//   BASE=http://localhost:3060 PLAYWRIGHT_CHANNEL=chrome node apps/web/e2e/business-sidebar.mjs [screenshot folder]
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3060";
const PRODUCTION = "dskbzoqreandwwpxiplh";
const SHOTS = process.argv[2] ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(new URL("../../../supabase/tests/staging/.rehearsal.json", import.meta.url), "utf8"));
const A = state.accounts;
const MAIN = ["Overview", "Inbox", "Advertisements", "Products & Services", "Analytics", "Billing"];

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

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
async function signedIn(user, viewport) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.on("request", (r) => {
    if (r.url().includes(PRODUCTION)) production++;
  });
  await page.goto(`${BASE}/business/login`);
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.locator("button[type=submit]").first().click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"));
  return { ctx, page };
}
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};
const noErrorScreen = async (page) => expect(!(await page.getByText(/Something went wrong|Application error/).count()), "an error screen");
// The address changes before the new page has rendered (and the dev server compiles a page on its first visit): wait for it.
const heading = (page, name) => page.getByRole("heading", { level: 1, name }).waitFor();

// --- The owner on a wide screen ----------------------------------------------------------------------------------------------
{
  const { ctx, page } = await signedIn(A.owner, { width: 1440, height: 900 });
  const sidebar = page.locator("aside[aria-label='Portal']");

  await step("the sidebar lists the sections in order, and Settings apart below them", async () => {
    await sidebar.waitFor();
    const main = (await sidebar.locator("nav[aria-label='Sections'] > ul a").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
    expect(JSON.stringify(main) === JSON.stringify(MAIN), `sections: ${JSON.stringify(main)}`);
    const settings = sidebar.locator("a", { hasText: "Settings" });
    expect((await settings.count()) === 1, "no Settings");
    const navBox = await sidebar.locator("nav[aria-label='Sections']").boundingBox();
    const setBox = await settings.boundingBox();
    expect(setBox.y > navBox.y + navBox.height - 1, "Settings is not below the sections");
    expect(setBox.y > 900 / 2, "Settings is not at the bottom");
    await shot(page, "desktop-overview");
  });

  await step("Overview: the business at a glance (active ads, spending, student inquiries), the last 30 days, campaigns and inquiries", async () => {
    await page.goto(`${BASE}/business`);
    await page.getByTestId("at-a-glance").waitFor();
    await noErrorScreen(page);
    await shot(page, "desktop-overview");
    const glance = await page.getByTestId("at-a-glance").innerText();
    for (const t of ["Active ads", "Spent this month", "Student inquiries"]) expect(glance.includes(t), `no ${t}: ${glance}`);
    expect(await page.getByText("Last 30 days").count(), "no last 30 days");
    expect((await sidebar.locator("a[aria-current='page']").innerText()).includes("Overview"), "Overview not marked");
  });

  for (const [label, path, check] of [
    ["Advertisements", "/business/ads", async () => {
      await heading(page, "Advertisements");
      expect(await page.getByText(/Rh ad /).count(), "the approved ad is not listed");
    }],
    ["Inbox", "/business/inbox", async () => await page.getByTestId("inquiry-list").getByText(/Rh Ben|Rh Dee/).first().waitFor()],
    ["Products & Services", "/business/deals", async () => {
      await heading(page, "Products & Services");
      await page.getByRole("navigation", { name: "Filter by type" }).getByRole("link", { name: /Special offers/ }).click();
      await page.waitForURL(/kind=offers/);
      await page.getByText("Rh move-in special").first().waitFor();
      await page.getByRole("navigation", { name: "Filter by type" }).getByRole("link", { name: /Events/ }).click();
      await page.waitForURL(/kind=events/);
      expect(!(await page.getByText("Rh move-in special").count()), "the offer is listed under Events");
      await page.getByRole("navigation", { name: "Products & Services" }).getByRole("link", { name: "Listings" }).click();
      await page.waitForURL(/\/business\/listings/);
      await page.getByText(/Rh two-bed/).first().waitFor();
      expect((await sidebar.locator("a[aria-current='page']").innerText()).includes("Products & Services"), "Listings is not under Products & Services");
    }],
    ["Analytics", "/business/analytics", async () => await page.getByRole("heading", { level: 1 }).waitFor()],
    ["Billing", "/business/billing", async () => {
      await heading(page, "Billing");
      const totals = await page.getByTestId("billing-totals").innerText();
      expect(/This month/.test(totals) && /\$/.test(totals), `totals: ${totals}`);
      expect((await page.getByTestId("payments").locator("li").count()) >= 1, "no payments");
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
      const csv = fs.readFileSync(await download.path(), "utf8");
      expect(csv.startsWith("Recorded,Reference,Paid for,From,To,Amount,Currency,Status") && csv.includes("RH-"), `csv: ${csv.slice(0, 120)}`);
      await page.getByTestId("payments").getByRole("link", { name: "Receipt" }).first().click();
      await page.waitForURL(/\/business\/billing\/[0-9a-f-]{36}$/);
      const receipt = await page.getByTestId("receipt").innerText();
      expect(/Receipt/.test(receipt) && /Invoice or receipt number/.test(receipt) && /RH-/.test(receipt), `receipt: ${receipt.slice(0, 200)}`);
      expect((await sidebar.locator("a[aria-current='page']").innerText()).includes("Billing"), "the receipt is not under Billing");
      await shot(page, "desktop-receipt");
    }],
  ]) {
    await step(`${label}: the sidebar opens it, marks it, and it works`, async () => {
      await page.goto(`${BASE}/business`);
      await sidebar.getByRole("link", { name: new RegExp(`^${label.replace("&", "&")}`) }).click();
      await page.waitForURL((u) => u.pathname === path || u.pathname.startsWith(`${path}/`));
      const active = await sidebar.locator("a[aria-current='page']").innerText();
      expect(active.includes(label), `marked: ${active}`);
      await check();
      await noErrorScreen(page);
      if (label === "Billing") return;
      await shot(page, `desktop-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`);
    });
  }

  await step("Settings: profile, team, verification and account, each a working page under Settings", async () => {
    await page.goto(`${BASE}/business`);
    await sidebar.getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/business\/settings$/);
    await page.getByTestId("settings").waitFor();
    expect((await page.getByTestId("settings").locator("a").count()) === 5, "the hub does not list five pages");
    await shot(page, "desktop-settings");
    for (const [tab, url, marker] of [
      ["Business profile", /\/business\/profile$/, "Business profile"],
      ["Team", /\/business\/team$/, "Team"],
      ["Verification", /\/business\/settings\/verification$/, "Verified Partner"],
      ["Account", /\/business\/settings\/account$/, "Account and preferences"],
    ]) {
      await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: tab, exact: true }).click();
      await page.waitForURL(url);
      await page.getByRole("heading", { name: marker }).first().waitFor();
      await noErrorScreen(page);
      expect((await sidebar.locator("a[aria-current='page']").innerText()).includes("Settings"), `${tab} is not under Settings`);
    }
    await page.goto(`${BASE}/business/settings/verification`);
    await page.getByTestId("checklist").waitFor();
    const checklist = await page.getByTestId("checklist").locator("li").count();
    expect(checklist === 6, `checklist: ${checklist}`);
  });

  await step("the account menu keeps the appearance switch and Log out", async () => {
    await sidebar.getByLabel("Account menu").click();
    expect(await sidebar.getByRole("radiogroup", { name: "Appearance" }).count(), "no appearance");
    expect(await sidebar.getByRole("button", { name: "Log out" }).count(), "no Log out");
    await sidebar.getByRole("radio", { name: "Dark" }).click();
    await page.waitForTimeout(800); // the colours ease over
    await shot(page, "desktop-dark");
    await sidebar.getByRole("radio", { name: "Light" }).click();
  });
  await ctx.close();
}

// --- The owner on a phone ------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await signedIn(A.owner, { width: 390, height: 844 });
  await step("on a phone the sidebar is a drawer: the menu button opens it, a section closes it, Escape closes it", async () => {
    await page.goto(`${BASE}/business`);
    expect(!(await page.locator("aside[aria-label='Portal']").isVisible()), "the wide sidebar shows on a phone");
    await page.getByRole("button", { name: "Open the menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Portal menu" });
    await drawer.waitFor();
    const main = (await drawer.locator("nav[aria-label='Sections'] > ul a").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
    expect(JSON.stringify(main) === JSON.stringify(MAIN), `drawer: ${JSON.stringify(main)}`);
    await shot(page, "phone-drawer");
    await drawer.getByRole("link", { name: "Billing" }).click();
    await page.waitForURL(/\/business\/billing$/);
    await drawer.waitFor({ state: "detached" });
    await shot(page, "phone-billing");
    await page.getByRole("button", { name: "Open the menu" }).click();
    await drawer.waitFor();
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached" });
  });
  await step("on a phone the inbox fills the screen under the top bar", async () => {
    await page.goto(`${BASE}/business/inbox`);
    await page.getByText(/Rh Ben|Rh Dee/).first().waitFor();
    await noErrorScreen(page);
    await shot(page, "phone-inbox");
  });
  await ctx.close();
}

// --- An editor: no Billing -------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await signedIn(A.staff, { width: 1280, height: 860 });
  await step("an editor's sidebar has every section but Billing, and Billing's address leads back to Overview", async () => {
    const sidebar = page.locator("aside[aria-label='Portal']");
    await sidebar.waitFor();
    const main = (await sidebar.locator("nav[aria-label='Sections'] > ul a").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
    expect(JSON.stringify(main) === JSON.stringify(MAIN.filter((s) => s !== "Billing")), `editor: ${JSON.stringify(main)}`);
    await page.goto(`${BASE}/business/billing`);
    await page.waitForURL((u) => u.pathname === "/business" || u.pathname === "/business/");
  });
  await ctx.close();
}

await browser.close();
console.log(`  ${production === 0 ? "✓" : "✗"} requests to production: ${production}`);
console.log(`${failures || production ? "✗" : "✓"} business sidebar: ${failures ? `${failures} failed` : "all passed"}`);
process.exit(failures || production ? 1 : 0);

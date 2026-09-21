// Browser check of the website's Home (Reels | Buzz | Posts), signed out and signed in.
// Usage: start the site (npm run dev -w web -- -p 3060), seed test data (node apps/mobile/e2e/sim-seed.mjs),
// then: BASE=http://localhost:3060 node apps/web/e2e/home-feed.mjs      (reads apps/mobile/e2e/.sim-state.json)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3060";
const state = JSON.parse(fs.readFileSync(new URL("../../mobile/e2e/.sim-state.json", import.meta.url), "utf8"));
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url)); // fileURLToPath: the repo path has a space in it fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0; const errors = [];
const ok = (m) => console.log(`  ✓ ${m}`); const bad = (m, e) => { failures++; console.log(`  ✗ ${m}: ${(e?.message ?? String(e)).split("\n").slice(0, 3).join(" // ").slice(0, 400)}`); };
const step = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };
const browser = await chromium.launch();
async function newPage(viewport) { const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 }); const page = await ctx.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); }); return page; }
try {
  const D = await newPage({ width: 1280, height: 900 }); const M = await newPage({ width: 390, height: 844 });
  await step("signed out: Home lands on Posts with Reels | Buzz | Posts on top, in that order", async () => {
    await D.goto(BASE + "/"); await D.waitForLoadState("domcontentloaded");
    const tabs = await D.locator("nav[aria-label='Home sections'] a").allInnerTexts();
    const order = tabs.map((t) => t.trim()).filter(Boolean); if (order.join("|") !== "Reels|Buzz|Posts") throw new Error("tabs: " + order.join("|"));
    const current = await D.locator("nav[aria-label='Home sections'] [aria-current='page']").filter({ hasText: "Posts" }).count(); if (!current) throw new Error("Posts is not the active tab");
    await D.getByText("First week back on campus").first().waitFor();
    await D.screenshot({ path: SHOTS + "web-01-posts.png" });
  });
  await step("navigation: Home, Roommates, Marketplace, Messages, Apartments; the apartments feed lives at /apartments", async () => {
    const nav = (await D.locator("header nav[aria-label='Main'] a").allInnerTexts()).map((t) => t.trim().split("\n")[0]).filter(Boolean);
    for (const want of ["Home", "Roommates", "Marketplace", "Messages", "Apartments"]) if (!nav.includes(want)) throw new Error(`missing ${want} in ${nav.join(",")}`);
    if (nav.indexOf("Home") > nav.indexOf("Roommates") || nav.indexOf("Messages") > nav.indexOf("Apartments")) throw new Error("order: " + nav.join(","));
    await D.goto(BASE + "/apartments?university=all"); await D.getByText("Sunny 2-bed near Sewell Park").first().waitFor();
  });
  await step("Buzz tab: anonymous thread with an alias, no author name, no profile link, no Message button", async () => {
    await D.goto(BASE + "/?tab=buzz&sort=new"); const card = D.locator("article, [data-testid='buzz-card']").filter({ hasText: "Landlord wants to keep my whole deposit" }).first(); await card.waitFor();
    const text = await card.innerText(); if (!/Student \d{5}/.test(text)) throw new Error("no alias: " + text.slice(0, 120));
    if (text.includes(state.other.name)) throw new Error("author name shown");
    if (await card.locator("a[href^='/profile/']").count()) throw new Error("profile link on a Buzz card");
    if (await card.getByRole("button", { name: "Message" }).count()) throw new Error("Message button on a Buzz card");
    const html = await D.content(); if (html.includes(state.other.id)) throw new Error("the author's user id is in the page HTML");
    await D.screenshot({ path: SHOTS + "web-02-buzz.png" });
  });
  await step("Reels tab: the seeded reel plays in a vertical feed", async () => {
    await D.goto(BASE + "/?tab=reels&university=all"); await D.getByText("Quick tour of my new place near Sewell Park").first().waitFor();
    await D.locator("video").first().waitFor({ state: "attached" }); await D.waitForTimeout(2500);
    await D.screenshot({ path: SHOTS + "web-03-reels.png" });
  });
  await step("phone: bottom bar is Home, Roommates, Marketplace, Messages, Apartments", async () => {
    await M.goto(BASE + "/"); await M.getByText("First week back on campus").first().waitFor();
    const items = (await M.locator("nav[aria-label='Main'] a").filter({ visible: true }).allInnerTexts()).map((t) => t.trim().split("\n").pop());
    for (const want of ["Home", "Roommates", "Marketplace", "Messages", "Apartments"]) if (!items.includes(want)) throw new Error(`missing ${want} in ${items.join(",")}`);
    if (items.includes("Profile")) throw new Error("Profile is still in the bottom bar");
    await M.screenshot({ path: SHOTS + "web-04-phone-posts.png" });
  });
  await step("signed in: like a post, open the Buzz thread, reply anonymously, vote", async () => {
    await D.goto(BASE + "/login"); await D.fill("#email", state.me.email); await D.fill("#password", state.password); await D.getByRole("button", { name: "Log in" }).click(); await D.waitForURL((u) => !u.pathname.startsWith("/login"));
    await D.goto(BASE + "/?tab=buzz&sort=new"); await D.getByText("Landlord wants to keep my whole deposit").first().click();
    await D.waitForURL(/\/buzz\/[0-9a-f-]{36}/); await D.waitForLoadState("networkidle"); // hydrated before typing
    const box = D.getByTestId("buzz-reply-input"); const stamp = Date.now(); await box.fill(`Small claims court worked for my roommate (web ${stamp})`);
    await D.locator("form").filter({ has: box }).getByRole("button", { name: "Reply" }).click();
    await D.getByText(/Small claims court worked for my roommate/).first().waitFor();
    // What another viewer receives must not contain either participant's id or name.
    await M.goto(D.url()); await M.getByText(/Small claims court worked for my roommate/).first().waitFor();
    const theirs = await M.content();
    for (const [who, u] of [["replier", state.me], ["thread author", state.other]]) if (theirs.includes(u.id) || theirs.includes(u.name)) throw new Error(`the ${who}'s identity is in the HTML other people receive`);
    const aliases = [...new Set(theirs.match(/Student \d{5}/g) ?? [])]; if (aliases.length < 2) throw new Error("expected two different aliases (author and replier), got " + aliases.join(","));
    await D.screenshot({ path: SHOTS + "web-05-buzz-thread.png" });
  });
  await step("create pages render: /posts/new, /reels/new, /buzz/new (with the anonymity notice)", async () => {
    for (const p of ["/posts/new", "/reels/new", "/buzz/new"]) { const r = await D.goto(BASE + p); if (!r || r.status() >= 400) throw new Error(`${p} -> ${r?.status()}`); }
    await D.getByText(/anonymous/i).first().waitFor(); await D.screenshot({ path: SHOTS + "web-06-buzz-new.png" });
  });
  await step("no browser errors", async () => { const real = errors.filter((e) => !/favicon|DevTools|Failed to load resource.*(mux|picsum)|net::ERR_ABORTED/i.test(e)); if (real.length) throw new Error(real.slice(0, 4).join(" | ")); });
} finally { await browser.close(); console.log(failures ? `\n${failures} WEB CHECK(S) FAILED` : "\nALL WEB HOME-FEED CHECKS PASSED"); process.exit(failures ? 1 : 0); }

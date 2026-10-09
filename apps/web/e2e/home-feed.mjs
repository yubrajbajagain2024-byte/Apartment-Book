// Browser check of the website's navigation (desktop tabs Home | Housing | Marketplace | Messages next to the search box, phone bottom bar Home | Housing | Marketplace | Profile),
// Home (For you | Buzz | Posts | Reels), Housing (Apartments | Roommates) and following (the Follow button on a profile, the follower list, Home → Posts → Following),
// signed out and signed in, on a desktop and a phone viewport.
// Usage: start the site (npm run dev -w web -- -p 3060), seed test data (SUPABASE_ACCESS_TOKEN=... node apps/mobile/e2e/sim-seed.mjs),
// then: BASE=http://localhost:3060 node apps/web/e2e/home-feed.mjs      (reads apps/mobile/e2e/.sim-state.json; Chromium only: the phone swipes go through a CDP session)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3060";
const state = JSON.parse(fs.readFileSync(new URL("../../mobile/e2e/.sim-state.json", import.meta.url), "utf8"));
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url)); fs.mkdirSync(SHOTS, { recursive: true }); // fileURLToPath: the repo path has a space in it
let failures = 0; const errors = [];
const ok = (m) => console.log(`  ✓ ${m}`); const bad = (m, e) => { failures++; console.log(`  ✗ ${m}: ${(e?.message ?? String(e)).split("\n").slice(0, 3).join(" // ").slice(0, 400)}`); };
const step = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };
// PLAYWRIGHT_CHANNEL=chrome uses the installed Google Chrome when Playwright's own Chromium was never downloaded.
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
async function newPage(viewport) { const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 }); const page = await ctx.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); }); return page; }
/** Playwright's touchscreen can only tap, so a flick goes through the Chrome DevTools protocol: a few touch moves spread over ~150 ms, like a thumb. */
async function swipe(page, from, to, moves = 6) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
  await touch("touchStart", from.x, from.y);
  for (let i = 1; i <= moves; i++) { await touch("touchMove", from.x + ((to.x - from.x) * i) / moves, from.y + ((to.y - from.y) * i) / moves); await page.waitForTimeout(25); }
  await touch("touchEnd", to.x, to.y);
  await cdp.detach();
}
try {
  const D = await newPage({ width: 1280, height: 900 }); const M = await newPage({ width: 390, height: 844 });
  await step("signed out: \"/\" lands on For you with For you | Buzz | Posts | Reels on top, in that order; the feed blends a post, a Buzz thread and a reel", async () => {
    await D.goto(BASE + "/"); await D.waitForLoadState("domcontentloaded");
    const tabs = await D.locator("nav[aria-label='Home sections'] a").allInnerTexts();
    const order = tabs.map((t) => t.trim()).filter(Boolean); if (order.join("|") !== "For you|Buzz|Posts|Reels") throw new Error("tabs: " + order.join("|"));
    if (!(await D.locator("nav[aria-label='Home sections'] [data-testid='home-tab-foryou'][aria-current='page']").count())) throw new Error("For you is not the active tab");
    // The landing tab keeps the clean address; Posts moved to ?tab=posts (homeSectionHref in the shared package).
    const hrefs = await D.locator("nav[aria-label='Home sections'] a").evaluateAll((links) => links.map((a) => a.getAttribute("href"))); if (hrefs.join(" ") !== "/ /?tab=buzz /?tab=posts /?tab=reels") throw new Error("tab links: " + hrefs.join(" "));
    const feed = D.getByTestId("for-you-feed"); await feed.waitFor();
    await feed.locator("[data-testid='insta-post']").filter({ hasText: "First week back on campus" }).first().waitFor();
    await feed.locator("[data-testid='for-you-buzz'] [data-testid='buzz-card']").filter({ hasText: "Landlord wants to keep my whole deposit" }).first().waitFor();
    await D.screenshot({ path: SHOTS + "web-00-for-you.png" });
    // A reel in For you is an insta-post with a video where the photos would be.
    const reel = feed.locator("[data-testid='insta-post']").filter({ hasText: "Quick tour of my new place near Sewell Park" }).first(); await reel.waitFor();
    await reel.scrollIntoViewIfNeeded(); await reel.locator("video").first().waitFor({ state: "attached" });
  });
  await step("Posts tab (/?tab=posts) looks like Instagram: no composer box, heart / comment / share / bookmark, Liked by, caption with hashtags, newest comment, age", async () => {
    await D.goto(BASE + "/?tab=posts"); await D.waitForLoadState("domcontentloaded");
    if (!(await D.locator("nav[aria-label='Home sections'] [data-testid='home-tab-posts'][aria-current='page']").count())) throw new Error("Posts is not the active tab");
    await D.getByText("First week back on campus").first().waitFor(); await D.screenshot({ path: SHOTS + "web-01-posts.png" });
    if (await D.locator("[data-testid='post-composer'], [data-testid='fb-post']").count()) throw new Error("the Facebook composer or card is still on the Posts tab");
    const post = D.locator("[data-testid='insta-post']").filter({ hasText: "First week back on campus" }).first(); await post.waitFor();
    for (const name of ["Like", "Comment", "Share", "Save"]) if (!(await post.getByLabel(name, { exact: true }).count())) throw new Error(`no ${name} button`);
    const liked = (await post.getByTestId("liked-by").innerText()).replace(/\s+/g, " "); if (!/Liked by UI Leo/.test(liked)) throw new Error("liked-by line: " + liked);
    await post.getByText("View all 2 comments").waitFor(); await post.getByText("Saturday morning works for me").waitFor();
    const caption = (await post.getByTestId("insta-caption").innerText()).replace(/\s+/g, " "); if (!caption.startsWith("UI Maya First week back")) throw new Error("caption: " + caption);
    const carousel = D.locator("[data-testid='insta-post']").filter({ hasText: "Move-in day at the new place" }).first();
    await carousel.getByLabel("1 of 3").waitFor();
    const tag = carousel.locator("span", { hasText: /^#movein$/ }).first(); const color = await tag.evaluate((el) => getComputedStyle(el).color); if (color !== "rgb(0, 55, 107)") throw new Error("hashtag colour " + color);
    const words = D.locator("[data-testid='insta-post']").filter({ hasText: "rec center is open during fall break" }).first(); await words.getByTestId("insta-text").waitFor();
    await carousel.scrollIntoViewIfNeeded(); await D.screenshot({ path: SHOTS + "web-01b-posts-instagram.png" });
    // Phone: the photo touches both edges of the screen.
    await M.goto(BASE + "/?tab=posts"); const phonePost = M.locator("[data-testid='insta-post']").filter({ hasText: "Move-in day at the new place" }).first(); await phonePost.waitFor();
    const frame = await phonePost.locator("img").nth(1).boundingBox(); const box = await phonePost.boundingBox();
    if (!box || Math.round(box.x) !== 0 || Math.round(box.width) !== 390) throw new Error("post is not edge to edge: " + JSON.stringify(box));
    if (!frame || frame.width < 389) throw new Error("photo is not edge to edge: " + JSON.stringify(frame));
    await phonePost.scrollIntoViewIfNeeded(); await M.screenshot({ path: SHOTS + "web-04b-phone-posts-instagram.png" });
  });
  await step("Search tab: /search lists people to follow before anything is typed; searching a name puts the account first with a Follow button", async () => {
    await D.goto(BASE + "/search"); await D.locator("[data-testid='search-people'] [data-testid='person-row']").first().waitFor();
    await D.goto(BASE + "/search?q=" + encodeURIComponent(state.other.name)); const row = D.locator("[data-testid='search-people'] [data-testid='person-row']").filter({ hasText: state.other.name }).first(); await row.waitFor();
    if (!(await row.locator("[data-testid='follow-button']").count())) throw new Error("no Follow button on the search result");
    if (!(await row.locator(`a[href='/profile/${state.other.id}']`).count())) throw new Error("the result does not link to the profile");
    await D.screenshot({ path: SHOTS + "web-10-search-people.png" });
  });
  await step("navigation: Home, Housing, Marketplace, Messages next to the header search box; Housing opens on /apartments with an Apartments | Roommates bar, Roommates leads to /roommates", async () => {
    const nav = (await D.locator("header nav[aria-label='Main'] a").allInnerTexts()).map((t) => t.trim().split("\n")[0]).filter(Boolean);
    if (nav.join("|") !== "Home|Housing|Marketplace|Messages") throw new Error("main tabs (Search left the bar for the header box, Profile is the phone bar's fourth tab): " + nav.join("|"));
    await D.goto(BASE + "/apartments?university=all"); await D.getByText("Sunny 2-bed near Sewell Park").first().waitFor();
    // The Housing main tab links to /apartments and stays lit on both halves; the sticky bar under the navbar picks the half.
    const housingLit = () => D.locator("header nav[aria-label='Main'] a[aria-current='page']").filter({ hasText: "Housing" }).count();
    if (!(await housingLit())) throw new Error("Housing is not the active main tab on /apartments");
    const sections = (await D.locator("nav[aria-label='Housing sections'] a").allInnerTexts()).map((t) => t.trim()).filter(Boolean); if (sections.join("|") !== "Apartments|Roommates") throw new Error("housing sections: " + sections.join("|"));
    if (!(await D.locator("nav[aria-label='Housing sections'] [data-testid='housing-tab-apartments'][aria-current='page']").count())) throw new Error("Apartments is not the active half");
    await D.getByTestId("housing-tab-roommates").click(); await D.waitForURL(/\/roommates/);
    await D.locator("nav[aria-label='Housing sections'] [data-testid='housing-tab-roommates'][aria-current='page']").waitFor();
    if (!(await housingLit())) throw new Error("Housing is not the active main tab on /roommates");
    await D.getByText("Room in a quiet 3-bed house").first().waitFor(); await D.screenshot({ path: SHOTS + "web-08-housing-roommates.png" });
  });
  await step("Buzz tab: Reddit-style row (topic, age, vote / replies / share pills), no author name, no profile link, no Message button", async () => {
    await D.goto(BASE + "/?tab=buzz&sort=new"); const card = D.locator("[data-testid='buzz-card']").filter({ hasText: "Landlord wants to keep my whole deposit" }).first(); await card.waitFor();
    // Like Reddit's feed, a row shows the topic and a short age ("6d"); the alias only appears inside the thread.
    const text = await card.innerText(); if (!/(^|\s)(now|\d+(m|h|d|mo|y))(\s|$)/.test(text)) throw new Error("no short age: " + text.slice(0, 120));
    for (const [what, sel] of [["vote pill", "[data-testid='buzz-vote']"], ["replies pill", "[data-testid='buzz-replies-link']"], ["share pill", "button[aria-label='Share']"]]) if (!(await card.locator(sel).count())) throw new Error(`no ${what} on the row`);
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
  await step("signed out: Maya's profile shows her follower count and a Follow button that leads to /login", async () => {
    await D.goto(BASE + "/profile/" + state.other.id); const counts = D.getByTestId("follow-counts"); await counts.waitFor();
    const text = (await counts.innerText()).replace(/\s+/g, " "); if (!text.includes("1 follower")) throw new Error("counts (Leo follows her from the seed): " + text);
    const button = D.getByTestId("follow-button"); if (!(await button.count())) throw new Error("no Follow button for a signed-out visitor");
    await button.click(); await D.waitForURL(/\/login/);
  });
  await step("phone: bottom bar is Home, Housing, Marketplace, Profile like the app (Profile links to /profile/me; Search is the header box, Messages a header icon once signed in)", async () => {
    await M.goto(BASE + "/?tab=posts"); await M.getByText("First week back on campus").first().waitFor();
    const bar = M.locator("nav[aria-label='Main'] a").filter({ visible: true }); const items = (await bar.allInnerTexts()).map((t) => t.trim().split("\n").pop()).filter(Boolean);
    if (items.join("|") !== "Home|Housing|Marketplace|Profile") throw new Error("bottom bar: " + items.join("|"));
    if (!items.includes("Profile")) throw new Error("Profile is missing from the bottom bar");
    if (!(await bar.filter({ hasText: "Profile" }).and(M.locator("a[href='/profile/me']")).count())) throw new Error("the Profile tab does not link to /profile/me");
    await M.screenshot({ path: SHOTS + "web-04-phone-posts.png" });
  });
  await step("phone: swiping left on For you slides to Buzz", async () => {
    await M.goto(BASE + "/"); await M.getByTestId("for-you-feed").waitFor();
    // Start the flick on the Buzz row: a photo carousel keeps horizontal swipes for itself, a text row hands them to the section body.
    const row = M.locator("[data-testid='for-you-buzz']").first(); await row.waitFor(); await row.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    const box = await row.boundingBox(); const y = box ? Math.round(box.y + box.height / 2) : 520;
    await swipe(M, { x: 300, y }, { x: 80, y });
    await M.waitForURL(/tab=buzz/); await M.getByTestId("buzz-feed").waitFor();
    await M.screenshot({ path: SHOTS + "web-04c-phone-buzz-after-swipe.png" });
  });
  await step("phone: swiping left on Apartments slides to Roommates", async () => {
    await M.goto(BASE + "/apartments?university=all"); await M.locator("nav[aria-label='Housing sections']").waitFor();
    // Start the flick on the heading: the photo rail, the map and a multi-photo carousel keep horizontal swipes for themselves.
    const h1 = M.locator("h1").first(); await h1.waitFor(); await h1.scrollIntoViewIfNeeded();
    const box = await h1.boundingBox(); const y = box ? Math.round(box.y + box.height / 2) : 200;
    await swipe(M, { x: 320, y }, { x: 60, y });
    await M.waitForURL(/\/roommates/); await M.locator("nav[aria-label='Housing sections'] [data-testid='housing-tab-roommates'][aria-current='page']").waitFor();
    await M.screenshot({ path: SHOTS + "web-04d-phone-housing-swipe.png" });
  });
  await step("signed in: like a post, open the Buzz thread, reply anonymously, vote", async () => {
    await D.goto(BASE + "/login"); await D.fill("#email", state.me.email); await D.fill("#password", state.password); await D.getByRole("button", { name: "Log in" }).click(); await D.waitForURL((u) => !u.pathname.startsWith("/login"));
    await D.goto(BASE + "/?tab=buzz&sort=new"); await D.getByText("Landlord wants to keep my whole deposit").first().click();
    await D.waitForURL(/\/buzz\/[0-9a-f-]{36}/); await D.waitForLoadState("networkidle"); // hydrated before typing
    const box = D.getByTestId("buzz-reply-input"); const stamp = Date.now(); await box.fill(`Small claims court worked for my roommate (web ${stamp})`);
    await D.locator("form").filter({ has: box }).getByRole("button", { name: "Reply" }).click();
    await D.locator("[data-testid='buzz-reply']").filter({ hasText: String(stamp) }).first().waitFor();
    // What another viewer receives must not contain either participant's id or name.
    await M.goto(D.url()); await M.locator("[data-testid='buzz-reply']").filter({ hasText: String(stamp) }).first().waitFor();
    const theirs = await M.content();
    for (const [who, u] of [["replier", state.me], ["thread author", state.other]]) if (theirs.includes(u.id) || theirs.includes(u.name)) throw new Error(`the ${who}'s identity is in the HTML other people receive`);
    const aliases = [...new Set(theirs.match(/Student \d{5}/g) ?? [])]; if (aliases.length < 2) throw new Error("expected two different aliases (author and replier), got " + aliases.join(","));
    // Votes on replies: the score moves by one and the arrow stays pressed.
    const mine = D.locator("[data-testid='buzz-reply']").filter({ hasText: String(stamp) }).first(); await mine.getByRole("button", { name: "Upvote" }).click();
    await mine.locator("button[aria-label='Upvote'][aria-pressed='true']").waitFor();
    await D.screenshot({ path: SHOTS + "web-05-buzz-thread.png" });
  });
  await step("signed in: heart a post and the count goes up, the comment icon opens the thread under the post, the bookmark saves it", async () => {
    await D.goto(BASE + "/?tab=posts"); await D.waitForLoadState("networkidle");
    const post = D.locator("[data-testid='insta-post']").filter({ hasText: "First week back on campus" }).first(); await post.waitFor();
    await post.getByLabel("Like", { exact: true }).click(); await post.getByLabel("Unlike", { exact: true }).waitFor();
    const liked = (await post.getByTestId("liked-by").innerText()).replace(/\s+/g, " "); if (!/Liked by UI Leo and 1 other/.test(liked)) throw new Error("liked-by after my like: " + liked);
    await post.getByLabel("Comment", { exact: true }).click(); await post.getByTestId("comments").waitFor(); await post.getByText("Bring snacks and I will book a room.").waitFor();
    await post.getByLabel("Save", { exact: true }).click(); await post.getByLabel("Unsave", { exact: true }).waitFor();
    await D.screenshot({ path: SHOTS + "web-07-post-liked.png" });
    await post.getByLabel("Unsave", { exact: true }).click(); await post.getByLabel("Save", { exact: true }).waitFor();
    await post.getByLabel("Unlike", { exact: true }).click(); await post.getByLabel("Like", { exact: true }).waitFor();
  });
  await step("signed in: follow Maya from her profile, the counts and the list update, the Posts Following filter shows her post, unfollow", async () => {
    const profile = BASE + "/profile/" + state.other.id; const counts = () => D.getByTestId("follow-counts"); const button = () => D.getByTestId("follow-button");
    await D.goto(profile); await D.waitForLoadState("networkidle"); // hydrated before clicking
    const before = (await counts().innerText()).replace(/\s+/g, " "); if (!before.includes("1 follower")) throw new Error("counts before (Leo follows her from the seed): " + before);
    const label = (await button().innerText()).trim(); if (!/^Follow( back)?$/.test(label)) throw new Error("button before: " + label);
    await button().click(); await D.locator("[data-testid='follow-button'][aria-pressed='true']").filter({ hasText: /^Following$/ }).waitFor();
    await counts().filter({ hasText: "2 followers" }).waitFor();
    // Home → Posts → Following keeps only posts by the people I follow: Maya's post is there, Leo's is not, and the switch marks Following.
    await D.goto(BASE + "/?tab=posts&feed=following"); await D.getByText("First week back on campus").first().waitFor();
    const sw = D.getByTestId("posts-feed-switch"); const options = (await sw.locator("a").allInnerTexts()).map((t) => t.trim()).filter(Boolean); if (options.join("|") !== "Everyone|Following") throw new Error("feed switch: " + options.join("|"));
    const active = (await sw.locator("[aria-current='page'], [aria-selected='true'], [aria-pressed='true']").allInnerTexts()).map((t) => t.trim()); if (active.join("|") !== "Following") throw new Error("active feed: " + active.join("|"));
    if (await D.locator("[data-testid='insta-post']").filter({ hasText: "Move-in day at the new place" }).count()) throw new Error("Leo's post is in the Following feed, but I do not follow him");
    await D.screenshot({ path: SHOTS + "web-09b-posts-following.png" });
    // Her followers list has a row for me (and one for Leo).
    await D.goto(profile + "/followers"); await D.waitForLoadState("networkidle"); /* streamed in: wait until the hidden copy has been swapped into place */ const list = D.getByTestId("follow-list"); await list.waitFor();
    await list.locator("[data-testid='follow-row']").filter({ hasText: state.me.name }).first().waitFor();
    if (!(await list.locator("[data-testid='follow-row']").filter({ hasText: state.extra[0].name }).count())) throw new Error("Leo's row is missing from the followers list");
    // Back on the profile, the button reads Following; one more click unfollows, so the check can run again and again.
    await D.goto(profile); await D.waitForLoadState("networkidle"); await D.locator("[data-testid='follow-button'][aria-pressed='true']").waitFor(); await D.screenshot({ path: SHOTS + "web-09-follow.png" });
    await button().click(); await button().filter({ hasText: /^Follow( back)?$/ }).waitFor();
    await counts().filter({ hasText: "1 follower" }).waitFor();
  });
  await step("create pages render: /posts/new, /reels/new, /buzz/new (with the anonymity notice)", async () => {
    for (const p of ["/posts/new", "/reels/new", "/buzz/new"]) { const r = await D.goto(BASE + p); if (!r || r.status() >= 400) throw new Error(`${p} -> ${r?.status()}`); }
    await D.getByText(/anonymous/i).first().waitFor(); await D.screenshot({ path: SHOTS + "web-06-buzz-new.png" });
  });
  await step("no browser errors", async () => { const real = errors.filter((e) => !/favicon|DevTools|Failed to load resource.*(mux|picsum)|net::ERR_ABORTED/i.test(e)); if (real.length) throw new Error(real.slice(0, 4).join(" | ")); });
} finally { await browser.close(); console.log(failures ? `\n${failures} WEB CHECK(S) FAILED` : "\nALL WEB HOME-FEED CHECKS PASSED"); process.exit(failures ? 1 : 0); }

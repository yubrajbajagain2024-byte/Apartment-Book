// Browser check of the website's navigation (desktop tabs Home | Housing | Messages | Marketplace next to the search box, phone bottom bar Home | Housing | Messages | Marketplace | Profile),
// Home (For you | Buzz | Posts | Reels), Housing (Apartments | Roommates), following (the Follow button on a profile, the follower list, Home → Posts → Following), the TikTok-style comment thread under a post (heart, reply, the "N comments" header, delete from the comment's options menu)
// and sharing a post with a friend (the Share dialog offers the people you follow who follow you back; Send leaves the post as a card in your chat with them),
// and the TikTok-style profile page (Following · Followers · Likes, @username, the Posts | Classes | Reels | Saved | Liked tabs, the grid, the classes card, a locked Saved tab, your own Saved setting),
// signed out and signed in, on a desktop and a phone viewport.
// Usage: start the site (npm run dev -w web -- -p 3060), seed test data (SUPABASE_ACCESS_TOKEN=... node apps/mobile/e2e/sim-seed.mjs),
// then: BASE=http://localhost:3060 node apps/web/e2e/home-feed.mjs      (reads apps/mobile/e2e/.sim-state.json; Chromium only: the phone swipes go through a CDP session)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
// The profile page's wording comes from the shared package (Node 22.18+ loads its TypeScript directly, as npm run test:shared does).
import { lockedSectionMessage, ownSectionNote } from "../../../packages/shared/src/profile.ts";
const BASE = process.env.BASE || "http://localhost:3060";
const state = JSON.parse(fs.readFileSync(new URL("../../mobile/e2e/.sim-state.json", import.meta.url), "utf8"));
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url)); fs.mkdirSync(SHOTS, { recursive: true }); // fileURLToPath: the repo path has a space in it
// Screenshots keep caret: "initial". By default Playwright styles every input to hide the caret, and on a page that is still
// hydrating React reports that inline style as a hydration mismatch, which fails "no browser errors" for nothing.
let failures = 0; const errors = [];
const ok = (m) => console.log(`  ✓ ${m}`); const bad = (m, e) => { failures++; console.log(`  ✗ ${m}: ${(e?.message ?? String(e)).split("\n").slice(0, 3).join(" // ").slice(0, 400)}`); };
const step = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };
/** The numbers under a profile's name, TikTok style: "0 Following 1 Follower 3 Likes" (one Follower or Like, otherwise Followers and Likes). */
async function profileCounts(page) {
  const text = (await page.getByTestId("follow-counts").innerText()).replace(/\s+/g, " ").trim();
  const m = /^(\S+) Following (\S+) (Followers?) (\S+) (Likes?)$/.exec(text); if (!m) throw new Error("follow-counts reads: " + text);
  for (const [n, word] of [[m[2], m[3]], [m[4], m[5]]]) if ((n === "1") !== !word.endsWith("s")) throw new Error(`"${n} ${word}" in the counts: ${text}`);
  return { text, followers: `${m[2]} ${m[3]}`, likes: Number(m[4]) };
}
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
    await D.screenshot({ caret: "initial", path: SHOTS + "web-00-for-you.png" });
    // A reel in For you is an insta-post with a video where the photos would be.
    const reel = feed.locator("[data-testid='insta-post']").filter({ hasText: "Quick tour of my new place near Sewell Park" }).first(); await reel.waitFor();
    await reel.scrollIntoViewIfNeeded(); await reel.locator("video").first().waitFor({ state: "attached" });
  });
  await step("Posts tab (/?tab=posts) looks like Instagram: no composer box, carousel dots on their own row above heart / comment / share / bookmark, Liked by, caption with hashtags, newest comment, age", async () => {
    await D.goto(BASE + "/?tab=posts"); await D.waitForLoadState("domcontentloaded");
    if (!(await D.locator("nav[aria-label='Home sections'] [data-testid='home-tab-posts'][aria-current='page']").count())) throw new Error("Posts is not the active tab");
    await D.getByText("First week back on campus").first().waitFor(); await D.screenshot({ caret: "initial", path: SHOTS + "web-01-posts.png" });
    if (await D.locator("[data-testid='post-composer'], [data-testid='fb-post']").count()) throw new Error("the Facebook composer or card is still on the Posts tab");
    const post = D.locator("[data-testid='insta-post']").filter({ hasText: "First week back on campus" }).first(); await post.waitFor();
    for (const name of ["Like", "Comment", "Share", "Save"]) if (!(await post.getByLabel(name, { exact: true }).count())) throw new Error(`no ${name} button`);
    const liked = (await post.getByTestId("liked-by").innerText()).replace(/\s+/g, " "); if (!/Liked by UI Leo/.test(liked)) throw new Error("liked-by line: " + liked);
    await post.getByText("View all 2 comments").waitFor(); await post.getByText("Saturday morning works for me").waitFor();
    const caption = (await post.getByTestId("insta-caption").innerText()).replace(/\s+/g, " "); if (!caption.startsWith("UI Maya First week back")) throw new Error("caption: " + caption);
    const carousel = D.locator("[data-testid='insta-post']").filter({ hasText: "Move-in day at the new place" }).first();
    await carousel.getByLabel("1 of 3").waitFor();
    // Instagram puts the carousel dots on their own centred row between the photo and the action row, so the dots end above the heart.
    const dots = await carousel.getByLabel("1 of 3").boundingBox(); const heart = await carousel.getByLabel("Like", { exact: true }).boundingBox();
    if (!dots || !heart || dots.y + dots.height > heart.y) throw new Error("the carousel dots are not above the Like button: " + JSON.stringify({ dots, heart }));
    const tag = carousel.locator("span", { hasText: /^#movein$/ }).first(); const color = await tag.evaluate((el) => getComputedStyle(el).color); if (color !== "rgb(0, 55, 107)") throw new Error("hashtag colour " + color);
    const words = D.locator("[data-testid='insta-post']").filter({ hasText: "rec center is open during fall break" }).first(); await words.getByTestId("insta-text").waitFor();
    await carousel.scrollIntoViewIfNeeded(); await D.screenshot({ caret: "initial", path: SHOTS + "web-01b-posts-instagram.png" });
    // Phone: the photo touches both edges of the screen.
    await M.goto(BASE + "/?tab=posts"); const phonePost = M.locator("[data-testid='insta-post']").filter({ hasText: "Move-in day at the new place" }).first(); await phonePost.waitFor();
    const frame = await phonePost.locator("img").nth(1).boundingBox(); const box = await phonePost.boundingBox();
    if (!box || Math.round(box.x) !== 0 || Math.round(box.width) !== 390) throw new Error("post is not edge to edge: " + JSON.stringify(box));
    if (!frame || frame.width < 389) throw new Error("photo is not edge to edge: " + JSON.stringify(frame));
    await phonePost.scrollIntoViewIfNeeded(); await M.screenshot({ caret: "initial", path: SHOTS + "web-04b-phone-posts-instagram.png" });
  });
  await step("Search tab: /search lists people to follow before anything is typed; searching a name puts the account first with a Follow button", async () => {
    await D.goto(BASE + "/search"); await D.locator("[data-testid='search-people'] [data-testid='person-row']").first().waitFor();
    await D.goto(BASE + "/search?q=" + encodeURIComponent(state.other.name)); const row = D.locator("[data-testid='search-people'] [data-testid='person-row']").filter({ hasText: state.other.name }).first(); await row.waitFor();
    if (!(await row.locator("[data-testid='follow-button']").count())) throw new Error("no Follow button on the search result");
    if (!(await row.locator(`a[href='/profile/${state.other.id}']`).count())) throw new Error("the result does not link to the profile");
    await D.screenshot({ caret: "initial", path: SHOTS + "web-10-search-people.png" });
  });
  await step("navigation: Home, Housing, Messages, Marketplace next to the header search box; Housing opens on /apartments with an Apartments | Roommates bar, Roommates leads to /roommates", async () => {
    const nav = (await D.locator("header nav[aria-label='Main'] a").allInnerTexts()).map((t) => t.trim().split("\n")[0]).filter(Boolean);
    if (nav.join("|") !== "Home|Housing|Messages|Marketplace") throw new Error("main tabs (Messages sits after Housing; Search is the header box): " + nav.join("|"));
    await D.goto(BASE + "/apartments?university=all"); await D.getByText("Sunny 2-bed near Sewell Park").first().waitFor();
    // The Housing main tab links to /apartments and stays lit on both halves; the sticky bar under the navbar picks the half.
    const housingLit = () => D.locator("header nav[aria-label='Main'] a[aria-current='page']").filter({ hasText: "Housing" }).count();
    if (!(await housingLit())) throw new Error("Housing is not the active main tab on /apartments");
    const sections = (await D.locator("nav[aria-label='Housing sections'] a").allInnerTexts()).map((t) => t.trim()).filter(Boolean); if (sections.join("|") !== "Apartments|Roommates") throw new Error("housing sections: " + sections.join("|"));
    if (!(await D.locator("nav[aria-label='Housing sections'] [data-testid='housing-tab-apartments'][aria-current='page']").count())) throw new Error("Apartments is not the active half");
    await D.getByTestId("housing-tab-roommates").click(); await D.waitForURL(/\/roommates/);
    await D.locator("nav[aria-label='Housing sections'] [data-testid='housing-tab-roommates'][aria-current='page']").waitFor();
    if (!(await housingLit())) throw new Error("Housing is not the active main tab on /roommates");
    await D.getByText("Room in a quiet 3-bed house").first().waitFor(); await D.screenshot({ caret: "initial", path: SHOTS + "web-08-housing-roommates.png" });
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
    await D.screenshot({ caret: "initial", path: SHOTS + "web-02-buzz.png" });
  });
  await step("Reels tab: the seeded reel plays in a vertical feed", async () => {
    await D.goto(BASE + "/?tab=reels&university=all"); await D.getByText("Quick tour of my new place near Sewell Park").first().waitFor();
    await D.locator("video").first().waitFor({ state: "attached" }); await D.waitForTimeout(2500);
    await D.screenshot({ caret: "initial", path: SHOTS + "web-03-reels.png" });
  });
  await step("signed out: Maya's profile shows Following · Followers · Likes (1 Follower: Leo follows her from the seed; at least 1 Like: he likes her first post) and a Follow button that leads to /login", async () => {
    await D.goto(BASE + "/profile/" + state.other.id); await D.getByTestId("follow-counts").waitFor();
    const counts = await profileCounts(D); if (counts.followers !== "1 Follower" || !(counts.likes >= 1)) throw new Error("counts: " + counts.text);
    const button = D.getByTestId("follow-button"); if (!(await button.count())) throw new Error("no Follow button for a signed-out visitor");
    await button.click(); await D.waitForURL(/\/login/);
  });
  await step("signed out: Maya's profile page, TikTok style: an @username, the tabs Posts | Classes | Reels | Saved | Liked with Posts open on a grid of her posts, her listings, the \"Classes this semester\" card with CS 3358 (the seed lets everyone see her classes) and a locked Saved tab (only she can see it, the default)", async () => {
    await D.goto(BASE + "/profile/" + state.other.id); await D.getByTestId("profile").waitFor();
    const handle = (await D.getByTestId("profile-username").innerText()).trim(); if (!/^@[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/.test(handle)) throw new Error("username: " + handle);
    const tabs = await D.locator("[data-testid='profile-tabs'] [role='tab']").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    if (tabs.join(" ") !== "profile-tab-posts profile-tab-classes profile-tab-reels profile-tab-saved profile-tab-liked") throw new Error("tabs: " + tabs.join(" "));
    if ((await D.getByTestId("profile-tab-posts").getAttribute("aria-selected")) !== "true") throw new Error("Posts is not the open tab");
    await D.locator("[data-testid='profile-grid'] [data-testid='profile-tile']").first().waitFor();
    await D.locator("[data-testid='profile-listings'] [data-testid='profile-listing']").filter({ hasText: "Sunny 2-bed near Sewell Park" }).first().waitFor();
    const card = (await D.getByTestId("profile-classes-card").innerText()).replace(/\s+/g, " ");
    if (!card.includes("Classes this semester") || !/(^|\s)CS 3358(\s|$)/.test(card)) throw new Error("classes card: " + card);
    if (!(await D.locator("[data-testid='profile-tab-saved'] [data-testid='profile-tab-lock']").count())) throw new Error("no lock on the Saved tab, which she keeps to herself");
    await D.screenshot({ caret: "initial", path: SHOTS + "web-14-profile.png" });
    // The Saved tab itself: the lock and lockedSectionMessage's words ("Only UI can see their saved posts"), never the list.
    await D.getByTestId("profile-tab-saved").click(); await D.waitForURL(/[?&]tab=saved/);
    const locked = D.getByTestId("profile-locked"); await locked.waitFor();
    const said = (await locked.innerText()).replace(/\s+/g, " ").trim(); const want = lockedSectionMessage("saved", "private", state.other.name.split(/\s+/)[0]);
    if (said !== want) throw new Error(`the locked Saved tab says "${said}", wanted "${want}"`);
    if (await D.getByTestId("profile-grid").count()) throw new Error("a visitor sees the Saved grid");
  });
  await step("phone: bottom bar is Home, Housing, Messages, Marketplace, Profile like the app (Profile links to /profile/me; Search is the header magnifier)", async () => {
    await M.goto(BASE + "/?tab=posts"); await M.getByText("First week back on campus").first().waitFor();
    const bar = M.locator("nav[aria-label='Main'] a").filter({ visible: true }); const items = (await bar.allInnerTexts()).map((t) => t.trim().split("\n").pop()).filter(Boolean);
    if (items.join("|") !== "Home|Housing|Messages|Marketplace|Profile") throw new Error("bottom bar: " + items.join("|"));
    if (!items.includes("Profile")) throw new Error("Profile is missing from the bottom bar");
    if (!(await bar.filter({ hasText: "Profile" }).and(M.locator("a[href='/profile/me']")).count())) throw new Error("the Profile tab does not link to /profile/me");
    await M.screenshot({ caret: "initial", path: SHOTS + "web-04-phone-posts.png" });
  });
  await step("phone: swiping left on For you slides to Buzz", async () => {
    await M.goto(BASE + "/"); await M.getByTestId("for-you-feed").waitFor();
    // Start the flick on the Buzz row: a photo carousel keeps horizontal swipes for itself, a text row hands them to the section body.
    const row = M.locator("[data-testid='for-you-buzz']").first(); await row.waitFor(); await row.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    const box = await row.boundingBox(); const y = box ? Math.round(box.y + box.height / 2) : 520;
    await swipe(M, { x: 300, y }, { x: 80, y });
    await M.waitForURL(/tab=buzz/); await M.getByTestId("buzz-feed").waitFor();
    await M.screenshot({ caret: "initial", path: SHOTS + "web-04c-phone-buzz-after-swipe.png" });
  });
  await step("phone: swiping left on Apartments slides to Roommates", async () => {
    await M.goto(BASE + "/apartments?university=all"); await M.locator("nav[aria-label='Housing sections']").waitFor();
    // Start the flick on the heading: the photo rail, the map and a multi-photo carousel keep horizontal swipes for themselves.
    const h1 = M.locator("h1").first(); await h1.waitFor(); await h1.scrollIntoViewIfNeeded();
    const box = await h1.boundingBox(); const y = box ? Math.round(box.y + box.height / 2) : 200;
    await swipe(M, { x: 320, y }, { x: 60, y });
    await M.waitForURL(/\/roommates/); await M.locator("nav[aria-label='Housing sections'] [data-testid='housing-tab-roommates'][aria-current='page']").waitFor();
    await M.screenshot({ caret: "initial", path: SHOTS + "web-04d-phone-housing-swipe.png" });
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
    await D.screenshot({ caret: "initial", path: SHOTS + "web-05-buzz-thread.png" });
  });
  await step("signed in: heart a post and the count goes up, the comment icon opens the TikTok-style thread under the post (heart a comment and clear it, reply to it, the \"N comments\" header and its sort menu, delete the reply from its options menu), the bookmark saves it, Share sends it to a friend (Leo) and it lands as a card in our chat", async () => {
    await D.goto(BASE + "/?tab=posts"); await D.waitForLoadState("networkidle");
    const post = D.locator("[data-testid='insta-post']").filter({ hasText: "First week back on campus" }).first(); await post.waitFor();
    await post.getByLabel("Like", { exact: true }).click(); await post.getByLabel("Unlike", { exact: true }).waitFor();
    const liked = (await post.getByTestId("liked-by").innerText()).replace(/\s+/g, " "); if (!/Liked by UI Leo and 1 other/.test(liked)) throw new Error("liked-by after my like: " + liked);
    await post.getByLabel("Comment", { exact: true }).click(); await post.getByTestId("comments").waitFor(); await post.getByText("Bring snacks and I will book a room.").waitFor();
    // Comment threads, TikTok style: Maya's comment is a top-level row (data-depth 0) with a heart, its count and a thumbs-down; the post is hers, so her name carries the "Author" tag (Leo's does not).
    const thread = post.getByTestId("comments"); const row = thread.locator("[data-testid='comment-row'][data-depth='0']").filter({ hasText: "Bring snacks and I will book a room." }).first(); await row.waitFor();
    if (!(await row.getByText("Author", { exact: true }).count())) throw new Error("no Author tag on the post owner's comment");
    if (await thread.locator("[data-testid='comment-row']").filter({ hasText: "Saturday morning works for me" }).getByText("Author", { exact: true }).count()) throw new Error("Author tag on Leo's comment");
    // Only hearts are counted: the number beside the heart reads "1" after a like (labelled "1 like") and nothing at all once it is cleared; the thumbs-down never shows a count.
    // A vote left by a run that stopped halfway is cleared first, so the check can run again and again.
    const like = row.getByLabel("Like comment", { exact: true }).first(); const pressed = (v) => row.locator(`[aria-label='Like comment'][aria-pressed='${v}']`).first().waitFor();
    const likes = row.locator("[data-testid='comment-likes']").first(); const likesRead = async (want) => { let got = ""; for (let i = 0; i < 40; i++) { got = (await likes.innerText()).trim(); if (got === want) return; await D.waitForTimeout(250); } throw new Error(`comment-likes reads "${got}", wanted "${want}"`); };
    if (!(await row.getByLabel("Dislike comment", { exact: true }).count())) throw new Error("no Dislike comment button on the comment");
    if ((await like.getAttribute("aria-pressed")) === "true") { await like.click(); await pressed("false"); }
    await like.click(); await pressed("true"); await likesRead("1"); const label = await likes.getAttribute("aria-label"); if (label !== "1 like") throw new Error("likes label: " + label);
    await like.click(); await pressed("false"); await likesRead("");
    // Reply: the chip names the author, the pill asks for a reply, and the answer lands under her comment one level deep.
    await row.getByRole("button", { name: "Reply", exact: true }).first().click(); await thread.getByTestId("reply-to").filter({ hasText: "UI Maya" }).waitFor();
    if (!(await thread.getByRole("button", { name: "Cancel reply" }).count())) throw new Error("no Cancel reply button on the Replying to chip");
    const box = thread.getByLabel("Write a comment", { exact: true }); const hint = await box.getAttribute("placeholder"); if (!/^Add a reply/.test(hint ?? "")) throw new Error("placeholder while replying: " + hint);
    const stamp = Date.now(); await box.fill(`Count me in (web ${stamp})`); await thread.getByLabel("Post comment", { exact: true }).click();
    // Replies fold behind "View 1 reply" like TikTok; a reply you post opens its thread, but unfold it if the line shows up before the row does.
    const reply = thread.locator("[data-testid='comment-row'][data-depth='1']").filter({ hasText: String(stamp) }).first(); const unfold = thread.getByRole("button", { name: /^View \d+ repl(y|ies)$/ }).first();
    for (let i = 0; i < 40 && !(await reply.isVisible()); i++) { if (await unfold.isVisible()) await unfold.click(); else await D.waitForTimeout(500); }
    await reply.waitFor(); await reply.scrollIntoViewIfNeeded();
    if (!(await thread.getByRole("button", { name: "Hide replies", exact: true }).count())) throw new Error("no Hide replies line under the open thread");
    // Posting expands the card's thread, which then shows the TikTok-style header: a bold "N comments" (replies included) with the Sort comments button offering Top (selected) and Newest. Skipped when the card shows no header.
    const heading = thread.getByText(/^(\d+ comments|1 comment|No comments yet)$/).first(); const headerCount = async () => { const text = (await heading.innerText()).trim(); if (!/^\d+ comments$/.test(text)) throw new Error("thread header: " + text); return Number(text.split(" ")[0]); };
    const before = (await heading.count()) ? await headerCount() : null;
    if (before !== null) {
      await thread.getByLabel("Sort comments", { exact: true }).click(); const sortMenu = D.getByRole("menu", { name: "Sort comments" }); await sortMenu.waitFor();
      const top = sortMenu.getByRole("menuitemradio", { name: "Top", exact: true }); if (!(await top.count()) || !(await sortMenu.getByRole("menuitemradio", { name: "Newest", exact: true }).count())) throw new Error("the sort menu does not offer Top and Newest");
      if ((await top.getAttribute("aria-checked")) !== "true") throw new Error("Top is not the selected sort");
      await top.click(); await sortMenu.waitFor({ state: "detached" });
    }
    await D.screenshot({ caret: "initial", path: SHOTS + "web-11-comment-thread.png" });
    // Delete the reply from its options menu (the "…" on the row; a long press or a right-click opens the same menu) and confirm "Delete this comment?", so the seed stays as it was.
    await reply.getByLabel("Comment options", { exact: true }).first().click(); const menu = D.getByRole("menu", { name: "Comment options" }); await menu.waitFor();
    await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const confirm = D.getByRole("dialog", { name: "Comment options" }).getByRole("group", { name: "Delete this comment?" }); await confirm.waitFor(); await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await reply.waitFor({ state: "detached" });
    if (before !== null) { let after = await headerCount(); for (let i = 0; i < 40 && after !== before - 1; i++) { await D.waitForTimeout(250); after = await headerCount(); } if (after !== before - 1) throw new Error(`header after the delete: ${after} comments, expected ${before - 1}`); }
    await post.getByLabel("Save", { exact: true }).click(); await post.getByLabel("Unsave", { exact: true }).waitFor();
    await D.screenshot({ caret: "initial", path: SHOTS + "web-07-post-liked.png" });
    await post.getByLabel("Unsave", { exact: true }).click(); await post.getByLabel("Save", { exact: true }).waitFor();
    await post.getByLabel("Unlike", { exact: true }).click(); await post.getByLabel("Like", { exact: true }).waitFor();
    // Share, like Instagram: the paper plane opens a "Share" dialog with my friends, the people I follow who follow me back (Leo, from the seed; not Maya).
    // Send stays disabled until someone is picked; Leo's tile is a button named after him and reads pressed once picked; Send turns into "Sent", then the dialog closes.
    const leoName = state.extra[0].name;
    await post.getByLabel("Share", { exact: true }).click(); const dialog = D.getByRole("dialog", { name: "Share" }); await dialog.waitFor();
    const leo = dialog.getByRole("button", { name: leoName, exact: true }); await leo.waitFor();
    if (await dialog.getByRole("button", { name: state.other.name, exact: true }).count()) throw new Error("Maya is offered, but she and I do not follow each other");
    if (!(await dialog.getByRole("button", { name: "Send", exact: true }).isDisabled())) throw new Error("Send is enabled before anyone is picked");
    await leo.click(); await dialog.locator(`button[aria-pressed='true'][aria-label='${leoName}']`).waitFor();
    const note = `Look at this (web ${Date.now()})`; await dialog.getByLabel("Write a message", { exact: true }).fill(note);
    await D.screenshot({ caret: "initial", path: SHOTS + "web-12-share-dialog.png" });
    await dialog.getByRole("button", { name: "Send", exact: true }).click(); await dialog.getByRole("button", { name: "Sent", exact: true }).waitFor(); await dialog.waitFor({ state: "detached" });
    // Our chat (Messages → Leo): one message holds the post as a card that links to it ("View post: …", the author, the picture) and my note under it.
    await D.goto(BASE + "/messages"); await D.locator("a[href^='/messages/']").filter({ hasText: leoName }).first().click(); await D.waitForURL(/\/messages\/[0-9a-f-]{36}/);
    const message = D.locator("ol > li").filter({ has: D.locator(`[data-testid='shared-post'][href='/posts/${state.postId}']`) }).filter({ hasText: note }).last(); await message.waitFor();
    const card = message.getByTestId("shared-post"); const cardLabel = (await card.getAttribute("aria-label")) ?? "";
    if (!cardLabel.startsWith("View post: First week back on campus")) throw new Error("card label: " + cardLabel);
    const cardText = (await card.innerText()).replace(/\s+/g, " "); if (!cardText.includes(state.other.name) || !cardText.includes("View post")) throw new Error("card text: " + cardText);
    if (!(await card.locator("img").count())) throw new Error("the card has no picture");
    await message.scrollIntoViewIfNeeded(); await D.screenshot({ caret: "initial", path: SHOTS + "web-13-shared-post-chat.png" });
  });
  await step("signed in: Posts → Following holds Leo's post (we follow each other from the seed) and none of Maya's; follow Maya from her profile, the counts and the list update, her post joins Following, unfollow", async () => {
    const profile = BASE + "/profile/" + state.other.id; const button = () => D.getByTestId("follow-button");
    // The Followers number under her name links to the list and reads "1 Follower" or "2 Followers".
    const followers = (text) => D.getByTestId("follow-counts").locator(`a[href='/profile/${state.other.id}/followers']`).filter({ hasText: text });
    // Home → Posts → Following keeps only posts by the people I follow. The seed makes Leo and me friends, so before I follow Maya it shows his post and none of hers.
    const followingPost = (text) => D.locator("[data-testid='insta-post']").filter({ hasText: text });
    await D.goto(BASE + "/?tab=posts&feed=following"); await followingPost("Move-in day at the new place").first().waitFor();
    if (await followingPost("First week back on campus").count()) throw new Error("Maya's post is in the Following feed, but I do not follow her yet");
    await D.goto(profile); await D.waitForLoadState("networkidle"); // hydrated before clicking
    const before = await profileCounts(D); if (before.followers !== "1 Follower") throw new Error("counts before (Leo follows her from the seed): " + before.text);
    const label = (await button().innerText()).trim(); if (!/^Follow( back)?$/.test(label)) throw new Error("button before: " + label);
    await button().click(); await D.locator("[data-testid='follow-button'][aria-pressed='true']").filter({ hasText: /^Following$/ }).waitFor();
    await followers(/^2 Followers$/).waitFor();
    // Now Following shows her post next to Leo's, and the switch marks Following.
    await D.goto(BASE + "/?tab=posts&feed=following"); await D.getByText("First week back on campus").first().waitFor();
    const sw = D.getByTestId("posts-feed-switch"); const options = (await sw.locator("a").allInnerTexts()).map((t) => t.trim()).filter(Boolean); if (options.join("|") !== "Everyone|Following") throw new Error("feed switch: " + options.join("|"));
    const active = (await sw.locator("[aria-current='page'], [aria-selected='true'], [aria-pressed='true']").allInnerTexts()).map((t) => t.trim()); if (active.join("|") !== "Following") throw new Error("active feed: " + active.join("|"));
    if (!(await followingPost("Move-in day at the new place").count())) throw new Error("Leo's post left the Following feed, but I still follow him");
    await D.screenshot({ caret: "initial", path: SHOTS + "web-09b-posts-following.png" });
    // Her followers list has a row for me (and one for Leo).
    await D.goto(profile + "/followers"); await D.waitForLoadState("networkidle"); /* streamed in: wait until the hidden copy has been swapped into place */ const list = D.getByTestId("follow-list"); await list.waitFor();
    await list.locator("[data-testid='follow-row']").filter({ hasText: state.me.name }).first().waitFor();
    if (!(await list.locator("[data-testid='follow-row']").filter({ hasText: state.extra[0].name }).count())) throw new Error("Leo's row is missing from the followers list");
    // Back on the profile, the button reads Following; one more click unfollows, so the check can run again and again.
    await D.goto(profile); await D.waitForLoadState("networkidle"); await D.locator("[data-testid='follow-button'][aria-pressed='true']").waitFor(); await D.screenshot({ caret: "initial", path: SHOTS + "web-09-follow.png" });
    await button().click(); await button().filter({ hasText: /^Follow( back)?$/ }).waitFor();
    await followers(/^1 Follower$/).waitFor();
  });
  await step("signed in: /profile/me is my own profile (Edit profile, Share profile, Find friends, no Follow button); \"Who can see your saved posts\" → Everyone opens my Saved tab to a signed-out visitor, and Only me locks it again", async () => {
    await D.goto(BASE + "/profile/me?tab=saved"); await D.waitForURL(new RegExp(`/profile/${state.me.id}\\?tab=saved$`)); await D.waitForLoadState("networkidle"); // hydrated before clicking
    const mine = D.getByTestId("profile");
    if (!(await mine.getByRole("link", { name: "Edit profile", exact: true }).count())) throw new Error("no Edit profile on my own profile");
    if (!(await mine.getByRole("button", { name: "Share profile", exact: true }).count()) || !(await mine.getByRole("link", { name: "Find friends", exact: true }).count())) throw new Error("no Share profile or Find friends on my own profile");
    if (await mine.getByTestId("follow-button").count()) throw new Error("a Follow button on my own profile");
    // The owner's line above the tab: who can see it, and Change, a menu of Everyone / Friends / Only me. Once saved, the page comes
    // back from the server, and the Saved tab's lock (shown while not everyone can see it) goes or returns with the setting.
    const line = D.getByTestId("profile-visibility-saved"); const tabLock = D.locator("[data-testid='profile-tab-saved'] [data-testid='profile-tab-lock']");
    const pick = async (option, value, shot) => {
      await line.getByRole("button", { name: /who can see your saved posts/i }).click();
      const menu = D.getByRole("menu", { name: "Who can see your saved posts" }); await menu.waitFor();
      if (shot) await D.screenshot({ caret: "initial", path: SHOTS + shot });
      await menu.getByRole("menuitemradio", { name: new RegExp(`^${option}`) }).click(); await menu.waitFor({ state: "detached" });
      const lockWanted = value !== "public";
      for (let i = 0; ((await tabLock.count()) > 0) !== lockWanted; i++) {
        if (await line.getByRole("alert").count()) throw new Error(`${option}: ${await line.getByRole("alert").innerText()}`);
        if (i >= 60) throw new Error(`${option}: the Saved tab's lock did not ${lockWanted ? "come back" : "go away"}`);
        await D.waitForTimeout(500);
      }
      await D.reload({ waitUntil: "networkidle" }); await line.getByText(ownSectionNote("saved", value), { exact: true }).waitFor(); // saved, not only shown
    };
    // What a signed-out visitor gets on my Saved tab (I saved nothing, or the earlier steps unsaved it): the empty tab, or the lock with lockedSectionMessage's words.
    const visitorSees = async (value) => {
      await M.goto(BASE + `/profile/${state.me.id}?tab=saved`); await M.getByTestId("profile").waitFor(); const locked = M.getByTestId("profile-locked");
      if (value === "public") { await M.locator("[data-testid='profile-empty'], [data-testid='profile-grid']").first().waitFor(); if (await locked.count()) throw new Error("a visitor still meets the lock after Everyone"); return; }
      await locked.waitFor(); const said = (await locked.innerText()).replace(/\s+/g, " ").trim(); const want = lockedSectionMessage("saved", value, state.me.name.split(/\s+/)[0]);
      if (said !== want) throw new Error(`a visitor reads "${said}", wanted "${want}"`);
    };
    await pick("Everyone", "public", "web-15-profile-saved-setting.png"); await visitorSees("public");
    await pick("Only me", "private"); await visitorSees("private");
  });
  await step("create pages render: /posts/new, /reels/new, /buzz/new (with the anonymity notice)", async () => {
    for (const p of ["/posts/new", "/reels/new", "/buzz/new"]) { const r = await D.goto(BASE + p); if (!r || r.status() >= 400) throw new Error(`${p} -> ${r?.status()}`); }
    await D.getByText(/anonymous/i).first().waitFor(); await D.screenshot({ caret: "initial", path: SHOTS + "web-06-buzz-new.png" });
  });
  await step("no browser errors", async () => { const real = errors.filter((e) => !/favicon|DevTools|Failed to load resource.*(mux|picsum)|net::ERR_ABORTED/i.test(e)); if (real.length) throw new Error(real.slice(0, 4).join(" | ")); });
} finally { await browser.close(); console.log(failures ? `\n${failures} WEB CHECK(S) FAILED` : "\nALL WEB HOME-FEED CHECKS PASSED"); process.exit(failures ? 1 : 0); }

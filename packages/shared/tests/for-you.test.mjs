// Unit tests for the pure parts of Home → For you. Run: npm run test:shared   (Node 22.18+ loads the .ts files directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import { blendForYou } from "../src/for-you.ts";
import { DEFAULT_HOME_SECTION, DEFAULT_HOUSING_SECTION, FOR_YOU_PAGE, HOME_SECTIONS, HOME_TABS, HOUSING_SECTIONS, homeSectionHref, housingSectionHref } from "../src/constants.ts";

const post = (id, kind = "post") => ({ id, kind, body: id, author: { id: "u", full_name: "U", avatar_url: null }, university: null });
const shape = (items) => items.map((p) => (p.kind === "reel" ? "R" : "P")).join("");

test("Home's sections are For you | Buzz | Posts | Reels, its tabs For you | Buzz | Reels, and it lands on For you", () => {
  assert.deepEqual(HOME_SECTIONS.map((s) => s.label), ["Orbit", "Buzz", "Posts", "Reels"]);
  assert.deepEqual(HOME_TABS.map((s) => s.label), ["Orbit", "Buzz", "Reels"]);
  // Posts keeps its address without a tab; Reels has its tab and its address.
  assert.equal(homeSectionHref("posts"), "/?tab=posts");
  assert.equal(homeSectionHref("reels"), "/?tab=reels");
  assert.equal(DEFAULT_HOME_SECTION, "foryou");
  assert.equal(HOME_SECTIONS[0].value, DEFAULT_HOME_SECTION);
});

test("For you asks for posts and reels only: Buzz has no share of the page", () => {
  assert.deepEqual(Object.keys(FOR_YOU_PAGE), ["posts", "reels"]);
});

test("a full page spreads the reels between the posts, in a fixed pattern", () => {
  const items = blendForYou({ posts: [1, 2, 3, 4, 5, 6].map((n) => post(`p${n}`)), reels: ["r1", "r2"].map((id) => post(id, "reel")) }, FOR_YOU_PAGE);
  assert.equal(items.length, 8);
  assert.equal(shape(items), "PPRPPPRP");
  // Nothing is reordered inside a kind.
  assert.deepEqual(items.filter((p) => p.kind === "post").map((p) => p.id), ["p1", "p2", "p3", "p4", "p5", "p6"]);
  assert.deepEqual(items.filter((p) => p.kind === "reel").map((p) => p.id), ["r1", "r2"]);
});

test("a kind that runs short is skipped and the other fills the page", () => {
  assert.equal(shape(blendForYou({ posts: [post("p1"), post("p2")], reels: [] }, FOR_YOU_PAGE)), "PP");
  assert.equal(shape(blendForYou({ posts: [], reels: ["r1", "r2", "r3", "r4"].map((id) => post(id, "reel")) }, FOR_YOU_PAGE)), "RRRR");
  assert.equal(shape(blendForYou({ posts: [post("p1")], reels: [post("r1", "reel")] }, FOR_YOU_PAGE)), "PR");
  assert.deepEqual(blendForYou({ posts: [], reels: [] }, FOR_YOU_PAGE), []);
});

test("the same row is never shown twice on one page", () => {
  const items = blendForYou({ posts: [post("p1"), post("p1")], reels: [post("p1", "reel")] }, FOR_YOU_PAGE);
  assert.deepEqual(items.map((p) => p.id), ["p1"]);
});

test("a zero or negative quota cannot break the schedule", () => {
  assert.equal(shape(blendForYou({ posts: [post("p1")], reels: [post("r1", "reel")] }, { posts: 0, reels: -1 })), "PR");
});

test("homeSectionHref keeps the landing tab at / and carries extra parameters", () => {
  assert.equal(homeSectionHref("foryou"), "/");
  assert.equal(homeSectionHref("posts"), "/?tab=posts");
  assert.equal(homeSectionHref("foryou", { university: "all" }), "/?university=all");
  assert.equal(homeSectionHref("buzz", { sort: "new", topic: undefined, q: "" }), "/?tab=buzz&sort=new");
});

test("the Housing tab is Apartments | Roommates, lands on Apartments and keeps the old addresses", () => {
  assert.deepEqual(HOUSING_SECTIONS.map((s) => s.label), ["Housing", "Roommate", "Marketplace"]);
  assert.equal(DEFAULT_HOUSING_SECTION, HOUSING_SECTIONS[0].value);
  assert.equal(housingSectionHref("apartments"), "/apartments");
  assert.equal(housingSectionHref("marketplace"), "/marketplace");
  assert.equal(housingSectionHref("roommates", { university: "all", q: "" }), "/roommates?university=all");
});

test("threadComments puts replies under their comment, oldest first, with depth, reply counts and my vote", async () => {
  const { threadComments, COMMENT_MAX_DEPTH } = await import("../src/queries/engagement.ts");
  const c = (id, created_at, parent_id = null, likes = 0) => ({ id, created_at, parent_id, body: id, score: likes, likes, target_type: "post", target_id: "p", user_id: "u", author: { id: "u", full_name: "U", avatar_url: null } });
  const rows = threadComments([c("b", "2"), c("a", "1"), c("a1", "3", "a"), c("a1x", "5", "a1"), c("a2", "4", "a"), c("orphan", "6", "missing")], { a: 1, b: -1 });
  assert.deepEqual(rows.map((r) => r.id), ["a", "a1", "a1x", "a2", "b", "orphan"]);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 2, 1, 0, 0]);
  assert.equal(rows[0].replyCount, 3);
  assert.equal(rows[0].myVote, 1); assert.equal(rows[4].myVote, -1); assert.equal(rows[1].myVote, 0);
  assert.equal(COMMENT_MAX_DEPTH, 3);
});

test("threadComments sorts top-level comments by hearts (Top) or by age (Newest) while replies stay oldest first", async () => {
  const { threadComments, COMMENT_SORTS } = await import("../src/queries/engagement.ts");
  const c = (id, created_at, parent_id = null, likes = 0) => ({ id, created_at, parent_id, body: id, score: likes, likes, target_type: "post", target_id: "p", user_id: "u", author: { id: "u", full_name: "U", avatar_url: null } });
  const rows = [c("old", "1"), c("loved", "2", null, 5), c("new", "3"), c("r2", "5", "loved"), c("r1", "4", "loved")];
  assert.deepEqual(threadComments(rows).map((r) => r.id), ["loved", "r1", "r2", "old", "new"], "Top is the default: hearts first, then oldest");
  assert.deepEqual(threadComments(rows, {}, { sort: "new" }).map((r) => r.id), ["new", "loved", "r1", "r2", "old"], "Newest keeps the replies in reading order");
  assert.deepEqual(COMMENT_SORTS.map((s) => s.value), ["top", "new"]);
});

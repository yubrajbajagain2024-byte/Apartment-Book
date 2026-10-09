// Unit tests for the pure parts of Home → For you. Run: npm run test:shared   (Node 22.18+ loads the .ts files directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import { blendForYou, forYouKey } from "../src/for-you.ts";
import { DEFAULT_HOME_SECTION, DEFAULT_HOUSING_SECTION, FOR_YOU_PAGE, HOME_SECTIONS, HOUSING_SECTIONS, homeSectionHref, housingSectionHref } from "../src/constants.ts";

const post = (id, kind = "post") => ({ id, kind, body: id, author: { id: "u", full_name: "U", avatar_url: null }, university: null });
const buzz = (id) => ({ id, topic: "advice", title: id, body: "", score: 0, commentCount: 0, createdAt: "", myVote: 0, isMine: false, alias: "Student 1" });
const shape = (items) => items.map((i) => (i.type === "buzz" ? "B" : i.post.kind === "reel" ? "R" : "P")).join("");

test("the Home tabs are For you | Buzz | Posts | Reels and land on For you", () => {
  assert.deepEqual(HOME_SECTIONS.map((s) => s.label), ["For you", "Buzz", "Posts", "Reels"]);
  assert.equal(DEFAULT_HOME_SECTION, "foryou");
  assert.equal(HOME_SECTIONS[0].value, DEFAULT_HOME_SECTION);
});

test("a full page spreads Buzz and reels between the posts, in a fixed pattern", () => {
  const items = blendForYou({ posts: [1, 2, 3, 4, 5, 6].map((n) => post(`p${n}`)), buzz: ["b1", "b2", "b3"].map(buzz), reels: ["r1", "r2"].map((id) => post(id, "reel")) }, FOR_YOU_PAGE);
  assert.equal(items.length, 11);
  assert.equal(shape(items), "PBPRPBPPRBP");
  // Nothing is reordered inside a kind.
  assert.deepEqual(items.filter((i) => i.type === "post" && i.post.kind === "post").map((i) => i.post.id), ["p1", "p2", "p3", "p4", "p5", "p6"]);
  assert.deepEqual(items.filter((i) => i.type === "buzz").map((i) => i.post.id), ["b1", "b2", "b3"]);
  assert.deepEqual(items.filter((i) => i.post.kind === "reel").map((i) => i.post.id), ["r1", "r2"]);
});

test("a kind that runs short is skipped and the others fill the page", () => {
  assert.equal(shape(blendForYou({ posts: [post("p1"), post("p2")], buzz: [], reels: [] }, FOR_YOU_PAGE)), "PP");
  assert.equal(shape(blendForYou({ posts: [], buzz: ["b1", "b2", "b3", "b4"].map(buzz), reels: [] }, FOR_YOU_PAGE)), "BBBB");
  assert.equal(shape(blendForYou({ posts: [post("p1")], buzz: [buzz("b1")], reels: [post("r1", "reel")] }, FOR_YOU_PAGE)), "PBR");
  assert.deepEqual(blendForYou({ posts: [], buzz: [], reels: [] }, FOR_YOU_PAGE), []);
});

test("the same row is never shown twice on one page", () => {
  const items = blendForYou({ posts: [post("p1"), post("p1")], buzz: [buzz("b1"), buzz("b1")], reels: [] }, FOR_YOU_PAGE);
  assert.deepEqual(items.map(forYouKey), ["post:p1", "buzz:b1"]);
});

test("keys tell a post and a Buzz thread apart even with the same id", () => {
  assert.notEqual(forYouKey({ type: "post", post: post("x") }), forYouKey({ type: "buzz", post: buzz("x") }));
});

test("a zero or negative quota cannot break the schedule", () => {
  assert.equal(shape(blendForYou({ posts: [post("p1")], buzz: [buzz("b1")], reels: [] }, { posts: 0, buzz: -1, reels: 0 })), "PB");
});

test("homeSectionHref keeps the landing tab at / and carries extra parameters", () => {
  assert.equal(homeSectionHref("foryou"), "/");
  assert.equal(homeSectionHref("posts"), "/?tab=posts");
  assert.equal(homeSectionHref("foryou", { university: "all" }), "/?university=all");
  assert.equal(homeSectionHref("buzz", { sort: "new", topic: undefined, q: "" }), "/?tab=buzz&sort=new");
});

test("the Housing tab is Apartments | Roommates, lands on Apartments and keeps the old addresses", () => {
  assert.deepEqual(HOUSING_SECTIONS.map((s) => s.label), ["Apartments", "Roommates"]);
  assert.equal(DEFAULT_HOUSING_SECTION, HOUSING_SECTIONS[0].value);
  assert.equal(housingSectionHref("apartments"), "/apartments");
  assert.equal(housingSectionHref("roommates", { university: "all", q: "" }), "/roommates?university=all");
});

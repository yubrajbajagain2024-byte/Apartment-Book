// Unit tests for the pure Buzz v2 helpers. Run: npm run test:shared   (Node 22.18+ loads the .ts files directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BuzzError, buildBuzzReplyForest, buildBuzzReplyTree, buzzErrorMessage, buzzFeedMedia, buzzHeadline, buzzPlaceholder, buzzPollCaption,
  buzzPollTimeLeft, buzzReplyForestOrder, buzzReplyPath, buzzSearchTerms, buzzThreadRows, contentBlockedDetails, findBuzzReplyNode, isBuzzError, nextBuzzVote,
  toBuzzError,
} from "../src/buzz/helpers.ts";

const alias = { emoji: "☄️", label: "Anon Comet", color: "#7C9BFF" };
const reply = (id, parentId, depth, extra = {}) => ({
  kind: "reply", id, threadId: "t", parentId, depth, alias, isOp: false, isMine: false, text: id, score: 0, myVote: 0,
  collapsed: false, status: "active", supportLink: false, createdAt: 0, replyingTo: null, ...extra,
});

test("the reply tree nests depth-2 replies under their depth-1 parent, oldest first, and keeps orphans", () => {
  const tree = buildBuzzReplyTree("t", [reply("a", "t", 1), reply("b", "a", 2), reply("c", "t", 1), reply("d", "a", 2), reply("e", "zz", 2)]);
  assert.deepEqual(tree.map((n) => [n.reply.id, n.children.map((c) => c.id)]), [["a", ["b", "d"]], ["c", []], ["e", []]]);
});

// A reply that knows the reply it answers (databases with 20261108000000_buzz_reply_tree.sql).
const nested = (id, treeParentId, extra = {}) => reply(id, treeParentId === "t" ? "t" : "x", treeParentId === "t" ? 1 : 2, { treeParentId, ...extra });
const shape = (forest) => forest.map((n) => (n.children.length ? [n.reply.id, shape(n.children)] : n.reply.id));

test("the forest nests replies at any depth under the reply they answer, and counts what is under each", () => {
  const forest = buildBuzzReplyForest("t", [nested("a", "t"), nested("b", "a"), nested("c", "b"), nested("d", "c"), nested("e", "t"), nested("f", "a")], "old");
  assert.deepEqual(shape(forest), [["a", [["b", [["c", ["d"]]]], "f"]], "e"]);
  assert.equal(forest[0].descendants, 4);
  assert.equal(findBuzzReplyNode(forest, "c")?.descendants, 1);
});

test("without treeParentId the forest is the server's two levels; a missing parent or a later one hangs from the thread", () => {
  const two = buildBuzzReplyForest("t", [reply("a", "t", 1), reply("b", "a", 2), reply("c", "a", 2, { replyingTo: alias })], "old");
  assert.deepEqual(shape(two), [["a", ["b", "c"]]]);
  // "y" answers "z", listed after it: a reply only hangs from one before it, so nothing can loop.
  const odd = buildBuzzReplyForest("t", [nested("a", "t"), nested("x", "gone"), nested("y", "z"), nested("z", "y"), nested("a", "t")], "old");
  assert.deepEqual(shape(odd), ["a", "x", ["y", ["z"]]]);
});

test("best puts the higher score first, then the busier branch, then the older; new and old order by time", () => {
  const items = [
    nested("a", "t", { score: 2, createdAt: 1 }),
    nested("b", "t", { score: 5, createdAt: 2 }),
    nested("c", "t", { score: 2, createdAt: 3 }),
    nested("c1", "c", { score: 0, createdAt: 4 }),
    nested("d", "t", { score: 2, createdAt: 5 }),
    nested("b1", "b", { score: 1, createdAt: 6 }),
    nested("b2", "b", { score: 3, createdAt: 7 }),
  ];
  assert.deepEqual(shape(buildBuzzReplyForest("t", items, "best")), [["b", ["b2", "b1"]], ["c", ["c1"]], "a", "d"]);
  assert.deepEqual(shape(buildBuzzReplyForest("t", items, "new")), ["d", ["c", ["c1"]], ["b", ["b2", "b1"]], "a"]);
  assert.deepEqual(shape(buildBuzzReplyForest("t", items, "old")), ["a", ["b", ["b1", "b2"]], ["c", ["c1"]], "d"]);
});

test("keep holds the order a reader already sees; new replies follow the ones already placed", () => {
  const first = buildBuzzReplyForest("t", [nested("a", "t", { score: 1 }), nested("b", "t", { score: 4 })], "best");
  assert.deepEqual(shape(first), ["b", "a"]);
  const keep = buzzReplyForestOrder(first);
  // "a" overtook "b" and "c" arrived with the most votes: still b, a, then c until the reader reloads.
  const later = buildBuzzReplyForest("t", [nested("a", "t", { score: 9 }), nested("b", "t", { score: 4 }), nested("c", "t", { score: 20 })], "best", keep);
  assert.deepEqual(shape(later), ["b", "a", "c"]);
  assert.deepEqual([...buzzReplyForestOrder(later).keys()], ["b", "a", "c"]);
});

test("rows draw thread lines: a tee while more replies follow, an end on the last, a line passing an open branch", () => {
  const forest = buildBuzzReplyForest("t", [nested("a", "t"), nested("b", "a"), nested("c", "b"), nested("d", "a"), nested("e", "t")], "old");
  const rows = buzzThreadRows(forest, { shown: () => 9 });
  assert.deepEqual(rows.map((r) => [r.id, r.depth, r.rails.join(" "), r.railIds.join(" "), r.stem]), [
    ["a", 0, "", "", true],
    ["b", 1, "tee", "a", true],
    ["c", 2, "pass end", "a b", false],
    ["d", 1, "end", "a", false],
    ["e", 0, "", "", false],
  ]);
});

test("rows fold long reply lists behind 'N more replies' (counting everything under them) until opened", () => {
  const items = [nested("a", "t"), ...["b", "c", "d", "e"].map((id) => nested(id, "a")), nested("e1", "e"), nested("e2", "e1")];
  const forest = buildBuzzReplyForest("t", items, "old");
  const folded = buzzThreadRows(forest, { shown: () => 2 });
  assert.deepEqual(folded.map((r) => [r.key, r.rails.join(" ")]), [["a", ""], ["b", "tee"], ["c", "tee"], ["more:a", "end"]]);
  assert.equal(folded[3].count, 4);
  const open = buzzThreadRows(forest, { shown: () => 2, expanded: new Set(["a"]) });
  assert.deepEqual(open.map((r) => r.key), ["a", "b", "c", "d", "e", "e1", "e2"]);
});

test("a collapsed reply is one row that says how many it hides; past the deepest level, 'Continue this thread'; focus shows one branch", () => {
  const items = [nested("a", "t"), nested("b", "a"), nested("c", "b"), nested("d", "c"), nested("e", "t")];
  const forest = buildBuzzReplyForest("t", items, "old");
  const collapsed = buzzThreadRows(forest, { collapsed: new Set(["b"]) });
  assert.deepEqual(collapsed.map((r) => [r.key, r.kind === "reply" ? r.collapsed : null, r.kind === "reply" ? r.hidden : null]), [["a", false, 0], ["b", true, 2], ["e", false, 0]]);
  const deep = buzzThreadRows(forest, { maxDepth: 1 });
  assert.deepEqual(deep.map((r) => [r.key, r.depth, r.rails.join(" ")]), [["a", 0, ""], ["b", 1, "end"], ["continue:b", 2, "none end"], ["e", 0, ""]]);
  assert.equal(deep[2].count, 2);
  const focus = buzzThreadRows(forest, { focusId: "b" });
  assert.deepEqual(focus.map((r) => [r.key, r.depth]), [["b", 0], ["c", 1], ["d", 2]]);
});

test("the path down to a reply: every reply above it, then itself; nothing for one that is not there", () => {
  const forest = buildBuzzReplyForest("t", [nested("a", "t"), nested("b", "a"), nested("c", "b"), nested("d", "t")], "old");
  assert.deepEqual(buzzReplyPath(forest, "c").map((n) => n.reply.id), ["a", "b", "c"]);
  assert.deepEqual(buzzReplyPath(forest, "d").map((n) => n.reply.id), ["d"]);
  assert.deepEqual(buzzReplyPath(forest, "zz"), []);
});

test("poll captions: hidden results, open with votes, closed", () => {
  const now = Date.UTC(2026, 9, 21, 12);
  assert.equal(buzzPollTimeLeft(now + 5 * 3_600_000 - 1, now), "5h left");
  assert.equal(buzzPollTimeLeft(now + 49 * 3_600_000, now), "3d left");
  assert.equal(buzzPollTimeLeft(now - 1, now), "closed");
  assert.equal(buzzPollCaption({ closed: false, resultsVisible: false, totalVotes: null, closesAt: now + 2 * 86_400_000 }, now), "Vote to see results · 2d left");
  assert.equal(buzzPollCaption({ closed: false, resultsVisible: true, totalVotes: 1, closesAt: now + 3_600_000 }, now), "1 vote · 1h left");
  assert.equal(buzzPollCaption({ closed: true, resultsVisible: true, totalVotes: 12, closesAt: now - 1 }, now), "Poll closed · 12 votes");
});

test("placeholders only when the words are withheld", () => {
  assert.equal(buzzPlaceholder({ text: "", status: "removed" }), "[removed by moderators]");
  assert.equal(buzzPlaceholder({ text: "", status: "deleted" }), "[deleted]");
  assert.equal(buzzPlaceholder({ text: "hello", status: "hidden" }), null);
});

test("headline prefers the title, squashes whitespace and clips", () => {
  assert.equal(buzzHeadline({ title: "  ", text: "a\n\nb" }), "a b");
  assert.equal(buzzHeadline({ title: "Parking", text: "body" }), "Parking");
  assert.equal(buzzHeadline({ title: "", text: "x".repeat(200) }, 10), "xxxxxxxxx…");
});

test("votes: tap again to undo, switch moves the score by two", () => {
  assert.deepEqual(nextBuzzVote({ myVote: 0, score: 4 }, 1), { value: 1, score: 5 });
  assert.deepEqual(nextBuzzVote({ myVote: 1, score: 5 }, 1), { value: 0, score: 4 });
  assert.deepEqual(nextBuzzVote({ myVote: 1, score: 5 }, -1), { value: -1, score: 3 });
});

test("media becomes the feed viewers' shape; videos play from Mux", () => {
  const out = buzzFeedMedia([
    { type: "image", url: "https://x/buzz/anon/ab.jpg", width: 4, height: 3, blur: null },
    { type: "video", playbackId: "pb123456", posterUrl: null, width: 720, height: 1280, durationSeconds: 12 },
  ]);
  assert.equal(out[0].type, "photo");
  assert.equal(out[1].type, "video");
  assert.equal(out[1].playbackUrl, "https://stream.mux.com/pb123456.m3u8");
});

test("search terms: lower-cased words of 2+ characters, unique, at most 6", () => {
  assert.deepEqual(buzzSearchTerms("Parking  at the LIBRARY, a b"), ["parking", "at", "the", "library"]);
  assert.deepEqual(buzzSearchTerms("100%_\\"), ["100"]);
  assert.equal(buzzSearchTerms("one two three four five six seven").length, 6);
  assert.deepEqual(buzzSearchTerms(""), []);
});

test("database errors become BuzzErrors with the right code and status", () => {
  const nf = toBuzzError({ message: "buzz:not_found:That buzz isn't available." });
  assert.ok(isBuzzError(nf, "not_found"));
  assert.equal(nf.status, 404);
  assert.equal(nf.message, "That buzz isn't available.");
  assert.equal(toBuzzError({ message: "buzz:buzz_gate_required:" }).status, 403);
  assert.equal(toBuzzError({ message: "buzz:rate_limited:Slow down" }).status, 429);
  assert.equal(toBuzzError({ message: "JWT expired" }).code, "unauthenticated");
  const missing = toBuzzError({ message: "Could not find the function public.buzz_v2_gate without parameters in the schema cache" });
  assert.equal(missing.code, "unavailable");
  assert.equal(missing.status, 503);
  assert.ok(!/schema cache/.test(missing.message));
  // CampConnect Admin's suspension trigger, on a vote.
  const suspended = toBuzzError({ message: "Your account is suspended", hint: "ACCOUNT_SUSPENDED" });
  assert.equal(suspended.code, "suspended");
  assert.equal(suspended.status, 403);
  assert.equal(toBuzzError({ message: "x", hint: "ACCOUNT_SUSPENDED" }).code, "suspended");
  assert.equal(buzzErrorMessage(new Error("boom")), "boom");
  const blocked = new BuzzError("content_blocked", "Not posted", 422, { messageId: "m", title: "t", category: "hate", guidelineAnchor: "hate", support: null });
  assert.equal(contentBlockedDetails(blocked).category, "hate");
  assert.equal(contentBlockedDetails(nf), null);
});

test("buzzCategory names a category the list has, and ignores none or one it does not know", async () => {
  const { BUZZ_CATEGORIES, buzzCategory } = await import("../src/buzz/constants.ts");
  assert.equal(buzzCategory("hot_take")?.label, "Hot takes");
  assert.equal(buzzCategory("classes")?.emoji, "📚");
  for (const none of [null, undefined, "", "gossip", "Hot_take"]) assert.equal(buzzCategory(none), null, String(none));
  assert.equal(new Set(BUZZ_CATEGORIES.map((c) => c.value)).size, BUZZ_CATEGORIES.length, "each value once");
});

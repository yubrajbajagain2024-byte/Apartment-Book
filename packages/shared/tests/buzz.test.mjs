// Unit tests for the pure Buzz v2 helpers. Run: npm run test:shared   (Node 22.18+ loads the .ts files directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BuzzError, buildBuzzReplyTree, buzzErrorMessage, buzzFeedMedia, buzzHeadline, buzzPlaceholder, buzzPollCaption, buzzPollTimeLeft,
  buzzSearchTerms, contentBlockedDetails, isBuzzError, nextBuzzVote, toBuzzError,
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
  assert.equal(buzzErrorMessage(new Error("boom")), "boom");
  const blocked = new BuzzError("content_blocked", "Not posted", 422, { messageId: "m", title: "t", category: "hate", guidelineAnchor: "hate", support: null });
  assert.equal(contentBlockedDetails(blocked).category, "hate");
  assert.equal(contentBlockedDetails(nf), null);
});

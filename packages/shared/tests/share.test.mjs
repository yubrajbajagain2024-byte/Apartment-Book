import { test } from "node:test";
import assert from "node:assert/strict";

const author = { id: "u1", full_name: "Maya Patel", avatar_url: null, university: null };
const post = (extra = {}) => ({ id: "6d074520-5a10-43ee-903a-35779a1a1fcc", author_id: "u1", university_id: null, kind: "post", body: "  Study group at Alkek?  ", images: ["https://img/1.jpg"], image_meta: [], videos: [], has_video: false, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", author, university: null, ...extra });

test("sharedPostOf accepts a stored snapshot and rejects anything malformed", async () => {
  const { sharedPostOf } = await import("../src/share.ts");
  assert.equal(sharedPostOf(null), null);
  assert.equal(sharedPostOf("x"), null);
  assert.equal(sharedPostOf({ kind: "post" }), null, "no target");
  assert.equal(sharedPostOf({ target_type: "buzz", target_id: "1", path: "/x" }), null, "unknown target type");
  const id = "6d074520-5a10-43ee-903a-35779a1a1fcc";
  const ok = sharedPostOf({ target_type: "post", target_id: id, path: `/posts/${id}`, kind: "weird", author: { name: "Maya" } });
  assert.deepEqual(ok, { target_type: "post", target_id: id, kind: "post", path: `/posts/${id}`, title: null, caption: null, image_url: null, author: { id: "", name: "Maya", avatar_url: null } });
});

test("sharedPostOf never trusts the stored link or pictures: the path is rebuilt, ids must be UUIDs, pictures must be https", async () => {
  const { sharedPostOf, sharedPostPath } = await import("../src/share.ts");
  const id = "6d074520-5a10-43ee-903a-35779a1a1fcc";
  const forged = sharedPostOf({ target_type: "post", target_id: id, path: "https://evil.example/login", kind: "post", image_url: "javascript:alert(1)", author: { name: "Apartment Book", avatar_url: "http://tracker.example/a.png" } });
  assert.equal(forged.path, `/posts/${id}`, "an outside link is replaced by the post's own path");
  assert.equal(forged.image_url, null, "javascript: picture dropped");
  assert.equal(forged.author.avatar_url, null, "plain-http avatar dropped");
  assert.equal(sharedPostOf({ target_type: "post", target_id: "../../admin", path: "/posts/x" }), null, "an id that is not a UUID is refused");
  assert.equal(sharedPostOf({ target_type: "item", target_id: id, kind: "reel", path: "/x" }).kind, "listing", "a listing stays a listing");
  assert.equal(sharedPostOf({ target_type: "apartment", target_id: id, path: "/x", image_url: "https://img.example/a.jpg" }).image_url, "https://img.example/a.jpg");
  assert.equal(sharedPostPath({ target_type: "item", target_id: id }), `/marketplace/${id}`);
});

test("sharedPostFromFeedPost snapshots a post or reel with its first frame, trimmed caption and author", async () => {
  const { sharedPostFromFeedPost, sharedPostPreview, sharedPostLabel } = await import("../src/share.ts");
  const p = sharedPostFromFeedPost(post());
  assert.equal(p.kind, "post"); assert.equal(p.path, "/posts/6d074520-5a10-43ee-903a-35779a1a1fcc"); assert.equal(p.image_url, "https://img/1.jpg"); assert.equal(p.caption, "Study group at Alkek?"); assert.equal(p.author.name, "Maya Patel");
  const r = sharedPostFromFeedPost(post({ kind: "reel", body: "", images: [], has_video: true }), [{ type: "video", playbackUrl: "https://stream/pb.m3u8", poster: "https://poster/1.jpg", width: 1080, height: 1920, durationSeconds: 5 }]);
  assert.equal(r.kind, "reel"); assert.equal(r.caption, null); assert.equal(r.image_url, "https://poster/1.jpg");
  assert.equal(sharedPostPreview(r), "Sent a reel"); assert.equal(sharedPostLabel(r), "View reel"); assert.equal(sharedPostPreview(p), "Sent a post");
});

test("sharedPostFromReel and sharedPostFromListing point at the listing when the reel is a video tour", async () => {
  const { sharedPostFromReel, sharedPostFromListing, sharedPostLabel } = await import("../src/share.ts");
  const reel = { sourceType: "apartment", sourceId: "a1a1a1a1-0000-4000-8000-000000000001", author: { id: "u2", name: "Leo", avatarUrl: null, verified: false }, title: "Sunny 2-bed near campus", caption: "", video: { media_id: "m", playback_id: "pb", poster_url: null, width: null, height: null, duration: null }, createdAt: "", likes: 0, comments: 0, likedByMe: false, savedByMe: false };
  const s = sharedPostFromReel(reel);
  assert.deepEqual([s.kind, s.target_type, s.path, s.title, s.caption, s.image_url], ["listing", "apartment", "/apartments/a1a1a1a1-0000-4000-8000-000000000001", "Sunny 2-bed near campus", null, null]);
  assert.equal(sharedPostLabel(s), "View listing");
  const item = sharedPostFromListing({ targetType: "item", targetId: "b2b2b2b2-0000-4000-8000-000000000002", title: "Desk lamp", imageUrl: "https://img/lamp.jpg", author: { id: "u3", name: "Sam", avatar_url: null } });
  assert.equal(item.path, "/marketplace/b2b2b2b2-0000-4000-8000-000000000002"); assert.equal(item.kind, "listing");
  const posted = sharedPostFromReel({ ...reel, sourceType: "post", sourceId: "c3c3c3c3-0000-4000-8000-000000000003", title: null, caption: "tour" });
  assert.deepEqual([posted.kind, posted.path, posted.caption], ["reel", "/posts/c3c3c3c3-0000-4000-8000-000000000003", "tour"]);
});

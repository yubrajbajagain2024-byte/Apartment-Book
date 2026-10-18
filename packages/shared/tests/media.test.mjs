// Unit tests for the reel the Reels viewer is handed when a reel is tapped in a feed (src/media.ts). Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// media.ts imports its siblings (constants, utils) the way the bundlers resolve them, without an extension; Node loads
// the .ts files directly, so this hook adds the extension for the files under src/. Registered before the import below.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) return next(specifier + ".ts", context);
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);
const { reelFromFeedPost } = await import("../src/media.ts");

const video = { media_id: "m1", playback_id: "pb1", poster_url: null, width: 1080, height: 1920, duration_seconds: 9 };
const author = { id: "u1", full_name: "Yubraj Bajagain", avatar_url: null, university: { email_domain: "txstate.edu" } };
const reelPost = { id: "r1", kind: "reel", body: "Road trip", videos: [video], images: [], image_meta: [], created_at: "2026-10-17T00:00:00Z", author, university: null };
const none = { likes: 0, comments: 0, likedByMe: false };

test("a reel row becomes the viewer's reel, with the row's counts and the viewer's own like and save", () => {
  assert.deepEqual(reelFromFeedPost(reelPost, { likes: 2, comments: 0, likedByMe: true }, false), {
    sourceType: "post",
    sourceId: "r1",
    author: { id: "u1", name: "Yubraj Bajagain", avatarUrl: null, verified: true },
    title: null,
    caption: "Road trip",
    video,
    createdAt: "2026-10-17T00:00:00Z",
    likes: 2,
    comments: 0,
    likedByMe: true,
    savedByMe: false,
  });
});

test("a plain post, or a reel whose video is not ready, gives nothing", () => {
  assert.equal(reelFromFeedPost({ ...reelPost, kind: "post" }, none, false), null);
  assert.equal(reelFromFeedPost({ ...reelPost, videos: [] }, none, false), null);
  assert.equal(reelFromFeedPost({ ...reelPost, videos: null }, none, false), null);
  // Half-written video rows (no media id) are dropped like everywhere else.
  assert.equal(reelFromFeedPost({ ...reelPost, videos: [{ playback_id: "pb1" }] }, none, false), null);
});

test("an author without a university email is not verified; the save flag is the viewer's", () => {
  const reel = reelFromFeedPost({ ...reelPost, body: "", author: { ...author, university: null } }, { likes: 0, comments: 1, likedByMe: false }, true);
  assert.equal(reel.author.verified, false);
  assert.equal(reel.caption, "");
  assert.equal(reel.comments, 1);
  assert.equal(reel.savedByMe, true);
});

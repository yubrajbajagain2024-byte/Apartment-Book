// Unit tests for the Discover tab (src/discover.ts, src/queries/discover.ts): topics, the grid's mosaic, and the reads,
// including their fallbacks on a database without migration 44. Run: npm run test:shared
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The sources import their siblings without an extension, as the bundlers resolve them; this hook adds it (as in media.test.mjs).
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const bare = !/\\\\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && bare && context.parentURL?.includes("/packages/shared/src/")) {
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
      return next(specifier, context);
    }
  `)}`,
  import.meta.url,
);
const { DISCOVER_PAGE, discoverMosaic, normalizeTopic, topicCount } = await import("../src/discover.ts");
const { getTopic, listDiscoverAccounts, listDiscoverTiles, listTopicTiles, listTrendingTopics, searchPostTiles, searchTopics } = await import("../src/queries/discover.ts");

const MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };

/** A client answering from fixed tables and rpc answers, recording what it was asked. */
function fakeClient({ tables = {}, rpc = {} } = {}) {
  const calls = [];
  const from = (table) => {
    const state = { table, filters: [] };
    const chain = {
      select: () => chain,
      eq: (c, v) => (state.filters.push(["eq", c, v]), chain),
      in: (c, v) => (state.filters.push(["in", c, v]), chain),
      ilike: (c, v) => (state.filters.push(["ilike", c, v]), chain),
      or: () => chain,
      not: () => chain,
      order: () => chain,
      limit: (n) => ((state.limit = n), chain),
      range: (a, b) => ((state.range = [a, b]), chain),
      then: (resolve, reject) => {
        calls.push(state);
        let rows = tables[table] ?? [];
        for (const [op, c, v] of state.filters) {
          if (op === "eq") rows = rows.filter((r) => r[c] === v);
          if (op === "in") rows = rows.filter((r) => v.includes(r[c]));
          if (op === "ilike") rows = rows.filter((r) => r[c].toLowerCase().includes(v.replaceAll("%", "").toLowerCase()));
        }
        if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
        if (state.limit) rows = rows.slice(0, state.limit);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  const answer = async (name, args) => {
    calls.push({ rpc: name, args });
    const r = rpc[name];
    return typeof r === "function" ? r(args) : (r ?? { data: [], error: null });
  };
  return { calls, from, rpc: answer, rpcs: () => calls.filter((c) => c.rpc).map((c) => c.rpc) };
}

const post = (id, body = `Post ${id}`, extra = {}) => ({ id, kind: "post", body, images: [`https://example.com/${id}.jpg`], image_meta: [], videos: [], pinned_at: null, created_at: "2026-10-26T00:00:00Z", ...extra });
const tile = (n, isVideo = false) => ({ key: `post:t${n}`, type: isVideo ? "reel" : "post", id: `t${n}`, href: `/posts/t${n}`, imageUrl: null, text: null, isVideo, multiPhoto: false, pinned: false, views: 0 });
const tiles = (n, videos = []) => Array.from({ length: n }, (_, i) => tile(i, videos.includes(i)));

test("a topic is the tag without # and lowercased, or nothing", () => {
  assert.equal(normalizeTopic("#Finals"), "finals");
  assert.equal(normalizeTopic("  ##Move_In "), "move_in");
  assert.equal(normalizeTopic("café"), "café");
  assert.equal(normalizeTopic("#"), null);
  assert.equal(normalizeTopic("two words"), null);
  assert.equal(normalizeTopic("x".repeat(61)), null);
  assert.equal(topicCount(1), "1 post");
  assert.equal(topicCount(0), "0 posts");
  assert.equal(topicCount(1234), "1.2k posts");
});

test("the mosaic: a feature block (the first video tall) then a row of three, the tall side alternating", () => {
  const blocks = discoverMosaic(tiles(16, [2, 9]));
  assert.deepEqual(blocks.map((b) => b.kind), ["feature", "row", "feature", "row"]);
  assert.equal(blocks[0].tall.id, "t2");
  assert.deepEqual(blocks[0].squares.map((t) => t.id), ["t0", "t1", "t3", "t4"]);
  assert.deepEqual(blocks[1].tiles.map((t) => t.id), ["t5", "t6", "t7"]);
  assert.equal(blocks[2].tall.id, "t9");
  assert.deepEqual([blocks[0].side, blocks[2].side], ["left", "right"]);
});

test("the mosaic: without a video the first tile is tall; fewer than five left go in rows", () => {
  const seven = discoverMosaic(tiles(7));
  assert.deepEqual(seven.map((b) => b.kind), ["feature", "row"]);
  assert.equal(seven[0].tall.id, "t0");
  assert.deepEqual(seven[1].tiles.map((t) => t.id), ["t5", "t6"]);
  assert.deepEqual(discoverMosaic(tiles(4)).map((b) => (b.kind === "row" ? b.tiles.length : 5)), [3, 1]);
  assert.deepEqual(discoverMosaic([]), []);
});

test("the mosaic: a whole page never reflows when the next page arrives", () => {
  const all = tiles(DISCOVER_PAGE.tiles * 2, [3, 11, 30]);
  const first = discoverMosaic(all.slice(0, DISCOVER_PAGE.tiles));
  assert.deepEqual(discoverMosaic(all).slice(0, first.length), first);
});

test("the grid keeps the database's order, drops what the reader cannot see, and shows no pins", async () => {
  const supabase = fakeClient({
    tables: { feed_posts: [post("p1", "First", { pinned_at: "2026-10-01T00:00:00Z" }), post("p3", "Third")] },
    rpc: {
      discover_feed: { data: [{ post_id: "p3", kind: "post" }, { post_id: "p1", kind: "post" }, { post_id: "gone", kind: "post" }], error: null },
      post_view_counts: { data: [{ target_id: "p1", views: 7 }], error: null },
    },
  });
  const page = await listDiscoverTiles(supabase);
  assert.deepEqual(page.tiles.map((t) => t.id), ["p3", "p1"]);
  assert.deepEqual(page.tiles.map((t) => t.pinned), [false, false]);
  assert.equal(page.tiles[1].views, 7);
  assert.equal(page.next, null);
});

test("a full page of the ranking pages on by offset", async () => {
  const rows = Array.from({ length: DISCOVER_PAGE.tiles }, (_, i) => ({ post_id: `p${i}`, kind: "post" }));
  const supabase = fakeClient({ tables: { feed_posts: rows.map((r) => post(r.post_id)) }, rpc: { discover_feed: { data: rows, error: null } } });
  const page = await listDiscoverTiles(supabase, { universityId: "u1" });
  assert.equal(page.next, DISCOVER_PAGE.tiles);
  assert.deepEqual(supabase.calls.find((c) => c.rpc === "discover_feed").args, { p_university_id: "u1", p_limit: DISCOVER_PAGE.tiles, p_offset: 0 });
});

test("before migration 44 the grid is the newest posts and reels, and keeps paging that way", async () => {
  const supabase = fakeClient({ tables: { feed_posts: Array.from({ length: 30 }, (_, i) => post(`n${i}`)) }, rpc: { discover_feed: MISSING } });
  const first = await listDiscoverTiles(supabase);
  assert.equal(first.tiles.length, DISCOVER_PAGE.tiles);
  assert.equal(first.next, `newest:${DISCOVER_PAGE.tiles}`);
  const asked = supabase.rpcs().filter((n) => n === "discover_feed").length;
  const second = await listDiscoverTiles(supabase, { cursor: first.next });
  assert.equal(second.tiles.length, 6);
  assert.equal(second.next, null);
  assert.equal(supabase.rpcs().filter((n) => n === "discover_feed").length, asked, "the second page asked the ranking again");
});

test("an empty ranking (nothing in 90 days) shows the newest instead", async () => {
  const supabase = fakeClient({ tables: { feed_posts: [post("old1"), post("old2")] }, rpc: { discover_feed: { data: [], error: null } } });
  const page = await listDiscoverTiles(supabase);
  assert.deepEqual(page.tiles.map((t) => t.id), ["old1", "old2"]);
});

test("accounts: the ranking's people with their university, or before migration 44 the newest people", async () => {
  const ranked = fakeClient({ rpc: { discover_accounts: { data: [{ id: "a1", full_name: "Cy Chen", avatar_url: null, email_domain: "utexas.edu", university_name: "UT Austin", followers: 3 }], error: null } } });
  assert.deepEqual(await listDiscoverAccounts(ranked), [{ id: "a1", full_name: "Cy Chen", avatar_url: null, university: { email_domain: "utexas.edu" }, universityName: "UT Austin", followers: 3 }]);
  const older = fakeClient({ tables: { profiles: [{ id: "me", full_name: "Me", avatar_url: null, university: null }, { id: "p2", full_name: "Pat", avatar_url: null, university: null }] }, rpc: { discover_accounts: MISSING } });
  assert.deepEqual((await listDiscoverAccounts(older, { viewerId: "me" })).map((a) => [a.id, a.followers]), [["p2", null]]);
});

test("topics: none before migration 44, and an empty search asks nothing", async () => {
  assert.deepEqual(await listTrendingTopics(fakeClient({ rpc: { discover_topics: MISSING } })), []);
  assert.deepEqual(await searchTopics(fakeClient({ rpc: { discover_search_topics: MISSING } }), "fin"), []);
  const quiet = fakeClient();
  assert.deepEqual(await searchTopics(quiet, " # "), []);
  assert.deepEqual(await searchPostTiles(quiet, "   "), { tiles: [], next: null });
  assert.equal(quiet.calls.length, 0);
});

test("a topic page before migration 44 keeps only posts that really carry the tag", async () => {
  const supabase = fakeClient({
    tables: { feed_posts: [post("f1", "Studying for #Finals"), post("f2", "#finalsweek prep"), post("f3", "finals tomorrow")] },
    rpc: { discover_topic_posts: MISSING, discover_topic: MISSING },
  });
  assert.deepEqual((await listTopicTiles(supabase, "#finals")).tiles.map((t) => t.id), ["f1"]);
  assert.deepEqual(await getTopic(supabase, "Finals"), { tag: "finals", posts: 1 });
  assert.equal(await getTopic(supabase, "not a tag"), null);
});

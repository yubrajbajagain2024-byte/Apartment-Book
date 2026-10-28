// Unit tests for UniBuzz Business v2 (src/business.ts, src/schemas, src/queries/business.ts): team roles as the
// database decides them, an ad's status over time, where ads go in a feed (one per 9 at most), where an ad's button
// leads, placements, media, money, and the forms' schemas. Run: npm run test:shared
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

const biz = await import("../src/business.ts");
const { ADS_EVERY } = await import("../src/constants.ts");

test("teamRoleAllows: the same table as business_role_allows() in migration 49", () => {
  const caps = ["view", "analytics", "publish", "reply", "manage_team", "edit_profile", "manage_ads"];
  const table = { owner: "1111111", admin: "1111111", editor: "1111000", analyst: "1100000" };
  for (const [role, want] of Object.entries(table)) {
    assert.equal(caps.map((c) => (biz.teamRoleAllows(role, c) ? "1" : "0")).join(""), want, role);
  }
  assert.equal(biz.teamRoleOf("staff"), "editor", "v1's staff read as editors");
  assert.equal(biz.teamRoleOf(undefined), "editor");
});

test("assignableRoles and canManageMember: only the owner touches admins; nobody touches the owner", () => {
  assert.deepEqual(biz.assignableRoles("owner"), ["admin", "editor", "analyst"]);
  assert.deepEqual(biz.assignableRoles("admin"), ["editor", "analyst"]);
  assert.deepEqual(biz.assignableRoles("editor"), []);
  assert.equal(biz.canManageMember("owner", "admin"), true);
  assert.equal(biz.canManageMember("admin", "admin"), false);
  assert.equal(biz.canManageMember("admin", "analyst"), true);
  assert.equal(biz.canManageMember("owner", "owner"), false);
  assert.equal(biz.canManageMember("editor", "analyst"), false);
});

test("adDisplayStatus: scheduled becomes active at its start; everything running ends at its end date, sweep or not", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const at = (h) => new Date(now + h * 3600_000).toISOString();
  assert.equal(biz.adDisplayStatus({ status: "scheduled", starts_at: at(1), ends_at: at(48) }, now), "scheduled");
  assert.equal(biz.adDisplayStatus({ status: "scheduled", starts_at: at(-1), ends_at: at(48) }, now), "active");
  assert.equal(biz.adDisplayStatus({ status: "active", starts_at: at(-48), ends_at: at(-1) }, now), "completed");
  assert.equal(biz.adDisplayStatus({ status: "paused", starts_at: at(-48), ends_at: at(-1) }, now), "completed");
  assert.equal(biz.adDisplayStatus({ status: "pending_review", starts_at: at(-48), ends_at: at(-1) }, now), "pending_review");
  assert.equal(biz.adDisplayStatus({ status: "draft", starts_at: null, ends_at: null }, now), "draft");
  assert.equal(biz.adIsEditable({ status: "rejected" }), true);
  assert.equal(biz.adIsEditable({ status: "active" }), false);
});

test("adSlotsAfter: after every 9th organic row, counted over the whole feed so pages agree", () => {
  assert.equal(ADS_EVERY, 9);
  assert.deepEqual(biz.adSlotsAfter(0, 8, 9), []);
  assert.deepEqual(biz.adSlotsAfter(0, 9, 9), [8]);
  assert.deepEqual(biz.adSlotsAfter(8, 8, 9), [8]);
  assert.deepEqual(biz.adSlotsAfter(16, 8, 9), [17]);
  assert.deepEqual(biz.adSlotsAfter(0, 30, 9), [8, 17, 26]);
  assert.equal(biz.adSlotCount(30, 9), 3);
  assert.equal(biz.adSlotCount(8, 9), 0);
});

const ad = (id, promoted = null) => ({ id, business_id: "b", cta: "learn_more", cta_url: "https://x.example", promoted });
const posts = (count) => Array.from({ length: count }, (_, i) => ({ id: `p${i}` }));

test("interleaveAds: at most one ad per 9 organic rows, never first, never two in a row, never twice", () => {
  const rows = biz.interleaveAds(posts(30), [ad("a1"), ad("a2"), ad("a1"), ad("a3"), ad("a4")], 9);
  const kinds = rows.map((r) => (r.kind === "ad" ? r.ad.id : "·")).join("");
  // 9 posts, ad, 9 posts, ad, 9 posts, ad, 3 posts: the repeated a1 is skipped.
  assert.equal(kinds, "·········a1·········a2·········a3···");
  for (let i = 1; i < rows.length; i++) assert.ok(!(rows[i].kind === "ad" && rows[i - 1].kind === "ad"));
  const organic = rows.filter((r) => r.kind === "item").length;
  const ads = rows.filter((r) => r.kind === "ad").length;
  assert.ok(ads <= Math.floor(organic / 9));
});

test("interleaveAds: an ad promoting a listing already in the feed gives its slot to the next ad; no ads, no slots", () => {
  const rows = biz.interleaveAds(posts(18), [ad("a1", { type: "apartment", id: "p3" }), ad("a2")], 9);
  assert.deepEqual(rows.filter((r) => r.kind === "ad").map((r) => r.ad.id), ["a2"]);
  assert.equal(biz.interleaveAds(posts(18), [], 9).length, 18);
  assert.equal(biz.interleaveAds(posts(5), [ad("a1")], 9).filter((r) => r.kind === "ad").length, 0);
});

test("adDestination: links, listings, posts, a chat the student starts, or the profile", () => {
  const listing = { type: "apartment", id: "apt" };
  const post = { type: "deal", id: "deal" };
  assert.deepEqual(biz.adDestination({ id: "a", business_id: "b", cta: "order_now", cta_url: "https://x.example/order", promoted: null }), { kind: "url", url: "https://x.example/order" });
  assert.deepEqual(biz.adDestination({ id: "a", business_id: "b", cta: "view_listing", cta_url: null, promoted: listing }), { kind: "listing", id: "apt" });
  assert.deepEqual(biz.adDestination({ id: "a", business_id: "b", cta: "get_offer", cta_url: null, promoted: post }), { kind: "post", id: "deal", businessId: "b" });
  assert.deepEqual(biz.adDestination({ id: "a", business_id: "b", cta: "message", cta_url: "https://x.example", promoted: null }), { kind: "message", adId: "a" });
  assert.deepEqual(biz.adDestination({ id: "a", business_id: "b", cta: "visit_profile", cta_url: "https://x.example", promoted: null }), { kind: "profile", businessId: "b" });
  assert.deepEqual(biz.adDestination({ id: "a", business_id: "b", cta: "learn_more", cta_url: null, promoted: null }), { kind: "profile", businessId: "b" });
});

test("placements: housing ads only in Housing, every other ad in For You and Reels", () => {
  assert.equal(biz.isHousingAd("housing", false), true);
  assert.equal(biz.isHousingAd("food", true), true);
  assert.equal(biz.isHousingAd("food", false), false);
  assert.deepEqual(biz.placementsFor(true), ["housing"]);
  assert.deepEqual(biz.placementsFor(false), ["for_you", "reels"]);
});

test("media: unknown items dropped; the cover is the first photo or the video's poster; vertical means taller than wide", () => {
  const items = biz.mediaItems([{ type: "image", url: "https://a/1.jpg" }, { type: "gif" }, null, { type: "video", media_id: "m", poster_url: "https://p.jpg", width: 1080, height: 1920 }]);
  assert.equal(items.length, 2);
  assert.equal(biz.mediaCover(items), "https://a/1.jpg");
  assert.equal(biz.mediaCover([items[1]]), "https://p.jpg");
  assert.equal(biz.mediaItems("nope").length, 0);
  assert.equal(biz.isVerticalVideo({ width: 1080, height: 1920 }), true);
  assert.equal(biz.isVerticalVideo({ width: 1920, height: 1080 }), false);
  assert.equal(biz.isVerticalVideo({ width: null, height: 1920 }), false);
});

test("money and rates", () => {
  assert.equal(biz.formatCents(5000), "$50");
  assert.equal(biz.formatCents(1250), "$12.50");
  assert.equal(biz.clickRate(0, 0), "–");
  assert.equal(biz.clickRate(3, 125), "2.4%");
  assert.equal(biz.clickRate(30, 100), "30%");
});

test("adDraftSchema: a draft may be unfinished; money, placements and the promoted item are read from the form", async () => {
  const { adDraftSchema } = await import("../src/schemas/index.ts");
  const parsed = adDraftSchema.parse({
    name: "Latte week",
    placements: "reels",
    universityIds: "11111111-1111-4111-8111-111111111111",
    media: JSON.stringify([{ type: "video", media_id: "22222222-2222-4222-8222-222222222222" }]),
    budget: "$1,250.50",
    promoted: "deal:33333333-3333-4333-8333-333333333333",
    startsAt: "2026-11-10T15:00:00.000Z",
    endsAt: "",
  });
  assert.deepEqual(parsed.placements, ["reels"]);
  assert.equal(parsed.budget, 125050);
  assert.equal(parsed.endsAt, undefined);
  assert.equal(parsed.objective, "awareness");
  assert.equal(adDraftSchema.safeParse({ name: "x" }).success, false, "a name of two characters at least");
  assert.equal(adDraftSchema.safeParse({ name: "Ok", startsAt: "2026-11-10T15:00:00Z", endsAt: "2026-11-09T15:00:00Z" }).success, false, "the end after the start");
  assert.equal(adDraftSchema.safeParse({ name: "Ok", ctaUrl: "http://plain.example" }).success, false, "links are https");
});

test("businessMediaSchema: photos or one video, never both; ten at most", async () => {
  const { businessMediaSchema } = await import("../src/schemas/index.ts");
  const v = (i) => ({ type: "video", media_id: `2222222${i}-2222-4222-8222-222222222222` });
  const p = (i) => ({ type: "image", url: `https://x.example/${i}.jpg` });
  assert.equal(businessMediaSchema.safeParse(JSON.stringify([p(1), p(2)])).success, true);
  assert.equal(businessMediaSchema.safeParse([v(1), v(2)]).success, false);
  assert.equal(businessMediaSchema.safeParse([v(1), p(1)]).success, false);
  assert.equal(businessMediaSchema.safeParse(Array.from({ length: 11 }, (_, i) => p(i))).success, false);
  assert.deepEqual(businessMediaSchema.parse(""), []);
});

test("dealSchema: v1's deal still parses; an event needs its date; prices are cents", async () => {
  const { dealSchema } = await import("../src/schemas/index.ts");
  const v1 = dealSchema.parse({ title: "Taco Tuesday", universityIds: [] });
  assert.equal(v1.kind, "deal");
  assert.equal(dealSchema.safeParse({ title: "Open mic", kind: "event", universityIds: [] }).success, false);
  const event = dealSchema.parse({ title: "Open mic", kind: "event", eventAt: "2026-11-14T01:00:00.000Z", price: "5", universityIds: [] });
  assert.equal(event.price, 500);
});

test("adApprovalSchema and businessInviteSchema", async () => {
  const { adApprovalSchema, businessInviteSchema } = await import("../src/schemas/index.ts");
  const ok = adApprovalSchema.parse({ amount: "50", paymentReference: "INV-1", fairHousingChecked: "on" });
  assert.equal(ok.amount, 5000);
  assert.equal(ok.currency, "USD");
  assert.equal(ok.fairHousingChecked, true);
  assert.equal(adApprovalSchema.safeParse({ amount: "0", paymentReference: "INV-1" }).success, false);
  assert.equal(adApprovalSchema.safeParse({ amount: "10", paymentReference: "" }).success, false);
  assert.equal(businessInviteSchema.parse({ email: "A@B.example" }).role, "editor");
  assert.equal(businessInviteSchema.safeParse({ email: "a@b.example", role: "owner" }).success, false);
});

test("listFeedAds: rows read into shapes; an error (no migration 50, signed out) is no ads, not a broken feed", async () => {
  const { listFeedAds } = await import("../src/queries/business.ts");
  const row = { id: "a", business_id: "b", cta: "learn_more", media: [{ type: "image", url: "https://u/1.jpg" }, { bogus: true }], promoted: { type: "deal", id: "d", media: [{ type: "image", url: "https://u/2.jpg" }] } };
  const ok = { rpc: async (fn, args) => ({ data: fn === "ads_for_feed" && args.p_limit === 2 ? [row] : [], error: null }) };
  const [ad] = await listFeedAds(ok, "for_you", 2);
  assert.equal(ad.media.length, 1);
  assert.equal(ad.promoted.media[0].url, "https://u/2.jpg");
  const broken = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) };
  assert.deepEqual(await listFeedAds(broken, "reels", 3), []);
  assert.deepEqual(await listFeedAds(ok, "reels", 0), []);
});

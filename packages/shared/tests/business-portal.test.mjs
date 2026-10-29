// Unit tests for the business portal's sidebar and Billing (src/business.ts, src/queries/business.ts): which sections a
// member sees and in what order, who sees Billing, how a payment stands, what a business has paid, the CSV of its
// payments and what each payment paid for. Run: npm run test:shared
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
const { paymentSubject } = await import("../src/queries/business.ts");

test("portalSectionsFor: the sidebar's order (the inbox right after Overview), everything for an approved owner", () => {
  assert.deepEqual(biz.PORTAL_SECTIONS, ["overview", "inbox", "ads", "products", "analytics", "billing"]);
  assert.deepEqual(biz.portalSectionsFor({ role: "owner", standing: "approved" }), { main: ["overview", "inbox", "ads", "products", "analytics", "billing"], settings: true });
});

test("portalSectionsFor: roles keep the order and lose only what they cannot use", () => {
  assert.deepEqual(biz.portalSectionsFor({ role: "admin", standing: "approved" }).main, ["overview", "inbox", "ads", "products", "analytics", "billing"]);
  assert.deepEqual(biz.portalSectionsFor({ role: "editor", standing: "approved" }).main, ["overview", "inbox", "ads", "products", "analytics"]);
  assert.deepEqual(biz.portalSectionsFor({ role: "analyst", standing: "approved" }).main, ["overview", "ads", "products", "analytics", "billing"]);
});

test("portalSectionsFor: pending has no inbox; rejected keeps the front page and Settings; suspended nothing", () => {
  assert.deepEqual(biz.portalSectionsFor({ role: "owner", standing: "pending" }), { main: ["overview", "ads", "products", "analytics", "billing"], settings: true });
  assert.deepEqual(biz.portalSectionsFor({ role: "owner", standing: "rejected" }), { main: ["overview"], settings: true });
  assert.deepEqual(biz.portalSectionsFor({ role: "owner", standing: "suspended" }), { main: [], settings: false });
});

test("canSeeBilling: owners, admins and analysts; never an editor", () => {
  assert.deepEqual(["owner", "admin", "editor", "analyst"].map(biz.canSeeBilling), [true, true, false, true]);
});

const NOW = Date.parse("2026-10-28T12:00:00Z");
const day = (d) => new Date(NOW + d * 864e5).toISOString();

test("paymentStanding: running, scheduled, ended, cancelled", () => {
  assert.equal(biz.paymentStanding({ status: "active", starts_at: day(-1), ends_at: day(5) }, NOW), "active");
  assert.equal(biz.paymentStanding({ status: "active", starts_at: day(2), ends_at: day(5) }, NOW), "upcoming");
  assert.equal(biz.paymentStanding({ status: "active", starts_at: day(-9), ends_at: day(-1) }, NOW), "ended");
  assert.equal(biz.paymentStanding({ status: "cancelled", starts_at: day(-1), ends_at: day(5) }, NOW), "cancelled");
  assert.equal(biz.paymentStandingLabel("upcoming"), "Scheduled");
});

test("paymentTotals: by when the team recorded it, per currency, cancelled ones left out", () => {
  const p = (cents, created, extra = {}) => ({ status: "active", amount_cents: cents, currency: "USD", created_at: day(created), starts_at: day(-1), ends_at: day(5), ...extra });
  const t = biz.paymentTotals(
    [p(5000, -1), p(2500, -20), p(1000, -40, { ends_at: day(-30) }), p(9900, -2, { status: "cancelled" }), p(3000, -3, { currency: "EUR" })],
    NOW,
  );
  assert.deepEqual(t.thisMonth, { USD: 7500, EUR: 3000 });
  assert.deepEqual(t.last30, { USD: 7500, EUR: 3000 });
  assert.deepEqual(t.allTime, { USD: 8500, EUR: 3000 });
  assert.equal(t.running, 3);
  assert.equal(biz.formatMoneyByCurrency({ USD: 7500, EUR: 3000 }), "$75 + €30");
  assert.equal(biz.formatMoneyByCurrency({}), "$0");
});

test("paymentTotals: the month is the calendar month of now (UTC)", () => {
  const t = biz.paymentTotals([{ status: "active", amount_cents: 100, currency: "USD", created_at: "2026-09-30T23:59:00Z", starts_at: day(-1), ends_at: day(1) }], NOW);
  assert.deepEqual(t.thisMonth, {});
  assert.deepEqual(t.last30, { USD: 100 });
});

test("paymentsCsv: a header, one row each, quoting, and no formula a spreadsheet would run", () => {
  const csv = biz.paymentsCsv([
    { recorded_at: "2026-10-01T10:00:00Z", reference: "INV-1", paid_for: "Ad: Fall, \"move-in\" week", starts_at: "2026-10-02T00:00:00Z", ends_at: "2026-10-09T00:00:00Z", amount_cents: 12550, currency: "USD", status: "Ended" },
    { recorded_at: "2026-10-03T10:00:00Z", reference: "=HYPERLINK(\"x\")", paid_for: "@evil", starts_at: "2026-10-03T00:00:00Z", ends_at: "2026-10-10T00:00:00Z", amount_cents: 500, currency: "EUR", status: "Running" },
  ]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "Recorded,Reference,Paid for,From,To,Amount,Currency,Status");
  assert.equal(lines[1], '2026-10-01,INV-1,"Ad: Fall, ""move-in"" week",2026-10-02,2026-10-09,125.50,USD,Ended');
  assert.equal(lines[2], `2026-10-03,"'=HYPERLINK(""x"")",'@evil,2026-10-03,2026-10-10,5.00,EUR,Running`);
  assert.ok(csv.endsWith("\r\n"));
});

test("paymentSubject: the ad, else v1's listing or post, else removed", () => {
  assert.equal(paymentSubject({ ad: { id: "a", name: "Pool week", status: "active" }, apartment: { id: "x", title: "Two-bed" }, deal: null }), "Ad: Pool week");
  assert.equal(paymentSubject({ ad: null, apartment: { id: "x", title: "Two-bed" }, deal: null }), "Listing: Two-bed");
  assert.equal(paymentSubject({ ad: null, apartment: null, deal: { id: "d", title: "Latte week" } }), "Post: Latte week");
  assert.equal(paymentSubject({ ad: null, apartment: null, deal: null }), "Removed ad or listing");
});

test("businessProfileChecklist: six things, each done or not", () => {
  const empty = { logo_url: null, description: "Short", website: null, address: null, city: null, contact_email: null, phone: null, university_ids: [] };
  assert.deepEqual(biz.businessProfileChecklist(empty).map((c) => c.done), [false, false, false, false, false, false]);
  const full = { logo_url: "https://x/l.png", description: "A".repeat(40), website: "https://x", address: null, city: "San Marcos", contact_email: null, phone: "512", university_ids: ["u"] };
  assert.deepEqual(biz.businessProfileChecklist(full).map((c) => c.key), ["logo", "description", "website", "place", "contact", "campuses"]);
  assert.ok(biz.businessProfileChecklist(full).every((c) => c.done));
});

test("inquiryKindOf: listings, posts, ads and the profile; other chats have none", () => {
  assert.deepEqual(["apartment", "deal", "ad", "business", "roommate", null].map(biz.inquiryKindOf), ["listing", "post", "ad", "profile", null, null]);
  assert.deepEqual(["listing", "post", "ad", "profile"].map(biz.inquiryKindLabel), ["Listing", "Post", "Ad", "Your profile"]);
});

test("inquiryNeedsReply: the student wrote last", () => {
  const team = new Set(["owner", "editor"]);
  assert.equal(biz.inquiryNeedsReply("student", team), true);
  assert.equal(biz.inquiryNeedsReply("editor", team), false);
  assert.equal(biz.inquiryNeedsReply(null, team), false);
});

test("inquiryMatches: the inbox's filters and search", () => {
  assert.deepEqual(biz.INQUIRY_FILTERS.map((f) => f.value), ["all", "unread", "needs_reply", "listing", "post", "ad", "profile"]);
  const i = { unreadCount: 2, needsReply: true, kind: "listing", text: "Maya Lopez Is the two-bed still free? Two-bed near campus" };
  const read = { ...i, unreadCount: 0, needsReply: false, kind: "ad" };
  assert.deepEqual(biz.INQUIRY_FILTERS.map((f) => biz.inquiryMatches(i, f.value)), [true, true, true, true, false, false, false]);
  assert.deepEqual(biz.INQUIRY_FILTERS.map((f) => biz.inquiryMatches(read, f.value)), [true, false, false, false, false, true, false]);
  assert.equal(biz.inquiryMatches(i, "all", "  maya "), true);
  assert.equal(biz.inquiryMatches(i, "all", "two-BED"), true);
  assert.equal(biz.inquiryMatches(i, "all", "studio"), false);
  assert.equal(biz.inquiryMatches(i, "ad", "maya"), false);
});

test("inquiryMessagePreview: the words, shortened, or what the message carries", () => {
  assert.equal(biz.inquiryMessagePreview({ content: "  Is it\n still free? " }), "Is it still free?");
  assert.equal(biz.inquiryMessagePreview({ content: "x".repeat(200) }).length, 120);
  assert.equal(biz.inquiryMessagePreview({ content: "", attachments: [{ kind: "file" }] }), "Sent an attachment");
  assert.equal(biz.inquiryMessagePreview({ content: "", attachments: [], image_url: "https://x/p.jpg" }), "Sent a photo");
  assert.equal(biz.inquiryMessagePreview({ content: "", shared_post: { id: "p" } }), "Shared a post");
  assert.equal(biz.inquiryMessagePreview({}), "Sent a message");
});

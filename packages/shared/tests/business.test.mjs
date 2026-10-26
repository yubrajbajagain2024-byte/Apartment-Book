import { test } from "node:test";
import assert from "node:assert/strict";

test("roleOf: a missing or unknown role is a student; isBusinessRole and canUsePortal follow the role", async () => {
  const { roleOf, isBusinessRole, canUsePortal } = await import("../src/business.ts");
  assert.equal(roleOf(null), "student");
  assert.equal(roleOf({}), "student");
  assert.equal(roleOf({ role: "superuser" }), "student");
  assert.equal(roleOf({ role: "business_staff" }), "business_staff");
  assert.equal(isBusinessRole("business_owner"), true);
  assert.equal(isBusinessRole("business_staff"), true);
  assert.equal(isBusinessRole("admin"), false);
  assert.equal(isBusinessRole("student"), false);
  assert.equal(canUsePortal("admin"), true);
  assert.equal(canUsePortal("student"), false);
});

test("businessLabel: Sponsored only with a paid promotion, Verified Partner only when verified, plain Business otherwise", async () => {
  const { businessLabel, isPlainBusinessLabel } = await import("../src/business.ts");
  assert.equal(businessLabel({ verified_partner: false }, false), "Business");
  assert.equal(businessLabel({ verified_partner: false }), "Business");
  assert.equal(businessLabel({ verified_partner: true }, false), "Verified Partner");
  assert.equal(businessLabel({ verified_partner: false }, true), "Sponsored");
  assert.equal(businessLabel({ verified_partner: true }, true), "Sponsored · Verified Partner");
  assert.equal(businessLabel(null, true), null);
  assert.equal(businessLabel(undefined), null);
  assert.equal(isPlainBusinessLabel("Business"), true);
  assert.equal(isPlainBusinessLabel("Sponsored"), false);
});

test("standingOf: pending unless the business says approved, rejected or suspended", async () => {
  const { standingOf } = await import("../src/business.ts");
  assert.equal(standingOf({ status: "approved" }), "approved");
  assert.equal(standingOf({ status: "suspended" }), "suspended");
  assert.equal(standingOf({ status: "rejected" }), "rejected");
  assert.equal(standingOf({ status: "pending" }), "pending");
  assert.equal(standingOf({ status: "weird" }), "pending");
  assert.equal(standingOf(null), "pending");
});

test("deals: live only while active, started and not over; campus targeting with every campus when none is named", async () => {
  const { dealIsLive, dealTargets, dealStatusLabel } = await import("../src/business.ts");
  const now = Date.parse("2026-11-01T12:00:00Z");
  const base = { status: "active", starts_at: "2026-10-01T00:00:00Z", ends_at: null, university_ids: [] };
  assert.equal(dealIsLive(base, now), true);
  assert.equal(dealIsLive({ ...base, status: "paused" }, now), false);
  assert.equal(dealIsLive({ ...base, starts_at: "2026-12-01T00:00:00Z" }, now), false);
  assert.equal(dealIsLive({ ...base, ends_at: "2026-10-31T00:00:00Z" }, now), false);
  assert.equal(dealStatusLabel(base, now), "Live");
  assert.equal(dealStatusLabel({ ...base, starts_at: "2026-12-01T00:00:00Z" }, now), "Scheduled");
  assert.equal(dealStatusLabel({ ...base, ends_at: "2026-10-31T00:00:00Z" }, now), "Ended");
  assert.equal(dealStatusLabel({ ...base, status: "archived" }, now), "Archived");
  assert.equal(dealTargets(base, "u1"), true);
  assert.equal(dealTargets(base, null), true);
  assert.equal(dealTargets({ university_ids: ["u1"] }, "u1"), true);
  assert.equal(dealTargets({ university_ids: ["u1"] }, "u2"), false);
  assert.equal(dealTargets({ university_ids: ["u1"] }, null), false);
});

test("the business inbox titles a chat after the student and leaves the team out of the other side", async () => {
  const { businessConversations, businessInboxView } = await import("../src/business.ts");
  const biz = { id: "b1", name: "River Rock", logo_url: null, verified_partner: true };
  const members = [
    { id: "owner", full_name: "Rita Rock", avatar_url: null },
    { id: "staff", full_name: "Lee Leasing", avatar_url: null },
    { id: "ben", full_name: "Ben Brooks", avatar_url: "b.png" },
  ];
  const chat = { id: "c1", type: "direct", name: "River Rock", createdBy: "ben", lastMessageAt: null, lastMessagePreview: null, members, otherMembers: members.filter((m) => m.id !== "staff"), memberStatus: {}, unreadCount: 2, courseGroup: null, business: biz, title: "River Rock" };
  const team = new Set(["owner", "staff"]);
  const view = businessInboxView(chat, team);
  assert.equal(view.title, "Ben Brooks");
  assert.deepEqual(view.otherMembers.map((m) => m.id), ["ben"]);
  assert.equal(view.business, null);
  assert.equal(view.unreadCount, 2);
  const other = { ...chat, id: "c2", business: { ...biz, id: "b2" } };
  const plain = { ...chat, id: "c3", business: null };
  assert.deepEqual(businessConversations([chat, other, plain], "b1", team).map((c) => c.id), ["c1"]);
});

test("listingPoster: a business listing shows the business; a student's shows the student", async () => {
  const { listingPoster } = await import("../src/business.ts");
  const owner = { id: "o", full_name: "Rita Rock", avatar_url: "r.png" };
  assert.deepEqual(listingPoster(owner, null), { id: "o", name: "Rita Rock", avatarUrl: "r.png", business: null });
  const biz = { id: "b", name: "River Rock", logo_url: "logo.png", verified_partner: false };
  assert.deepEqual(listingPoster(owner, biz), { id: "o", name: "River Rock", avatarUrl: "logo.png", business: biz });
});

test("conversationTitle: a named direct chat (a business inquiry) keeps its name", async () => {
  const { conversationTitle } = await import("../src/utils.ts");
  assert.equal(conversationTitle("direct", "River Rock", [{ full_name: "Rita Rock" }]), "River Rock");
  assert.equal(conversationTitle("direct", null, [{ full_name: "Rita Rock" }]), "Rita Rock");
  assert.equal(conversationTitle("group", null, []), "Group chat");
});

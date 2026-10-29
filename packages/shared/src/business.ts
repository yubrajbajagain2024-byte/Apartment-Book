import type { Json } from "./types/database";
import type { Ad, AdPlacement, BusinessCapability, BusinessMediaItem, BusinessSummary, BusinessTeamRole, ConversationSummary, Deal, FeedAd, ProfileSummary } from "./types/models";

/** profiles.role (migration 39). Everyone before it is a student. */
export const USER_ROLES = ["student", "business_owner", "business_staff", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** The role of a profile row, 'student' for a row from before migration 39 or an unknown value. */
export function roleOf(profile: { role?: string | null } | null | undefined): UserRole {
  const role = profile?.role;
  return role && (USER_ROLES as readonly string[]).includes(role) ? (role as UserRole) : "student";
}

/** A business account: the owner or staff of a business. Kept out of the student social side. */
export function isBusinessRole(role: string | null | undefined): boolean {
  return role === "business_owner" || role === "business_staff";
}

/** Who may sign in to the business portal: business accounts and admins (who review businesses there). */
export function canUsePortal(role: string | null | undefined): boolean {
  return isBusinessRole(role) || role === "admin";
}

/**
 * The line under a business's name on its listings and deals: "Sponsored" only while a paid promotion runs on that
 * listing or deal, "Verified Partner" only for a business an admin verified, both when both hold, and a plain
 * "Business" otherwise (so a business is never mistaken for a student). Null for a student's own listing.
 */
export function businessLabel(business: { verified_partner: boolean } | null | undefined, sponsored?: boolean | null): string | null {
  if (!business) return null;
  const parts: string[] = [];
  if (sponsored) parts.push("Sponsored");
  if (business.verified_partner) parts.push("Verified Partner");
  return parts.length > 0 ? parts.join(" · ") : "Business";
}

/** Whether a label is the plain "Business" (drawn in grey rather than in the brand colour). */
export function isPlainBusinessLabel(label: string | null | undefined): boolean {
  return label === "Business";
}

/** What a business's team may open in the portal, by its standing. */
export type BusinessStanding = "pending" | "approved" | "rejected" | "suspended";
export function standingOf(business: { status: string } | null | undefined): BusinessStanding {
  const s = business?.status;
  return s === "approved" || s === "rejected" || s === "suspended" ? s : "pending";
}

/** A deal students can act on now: live, started, not over. (The database hides the rest from them anyway.) */
export function dealIsLive(deal: Pick<Deal, "status" | "starts_at" | "ends_at">, now: number = Date.now()): boolean {
  if (deal.status !== "active") return false;
  if (new Date(deal.starts_at).getTime() > now) return false;
  return deal.ends_at === null || new Date(deal.ends_at).getTime() > now;
}

/** Whether a deal is for this campus: every campus when it names none. */
export function dealTargets(deal: Pick<Deal, "university_ids">, universityId: string | null | undefined): boolean {
  return deal.university_ids.length === 0 || (Boolean(universityId) && deal.university_ids.includes(universityId as string));
}

/** "20% off · ends Dec 1" style line under a deal's title. */
export function dealSubtitle(deal: Pick<Deal, "discount_label" | "ends_at">, formatDate: (iso: string) => string): string {
  const parts: string[] = [];
  if (deal.discount_label) parts.push(deal.discount_label);
  if (deal.ends_at) parts.push(`ends ${formatDate(deal.ends_at)}`);
  return parts.join(" · ");
}

/**
 * An inquiry chat as the business's inbox shows it: titled after the student (the chat itself is named after the
 * business, for the student's inbox), with the team left out of "the other side". `teamIds` are the business's
 * members; the viewer is one of them.
 */
export function businessInboxView(conversation: ConversationSummary, teamIds: ReadonlySet<string>): ConversationSummary {
  const students: ProfileSummary[] = conversation.members.filter((m) => !teamIds.has(m.id));
  const title = students.length > 0 ? students.map((s) => s.full_name).join(", ") : "Deleted user";
  return { ...conversation, otherMembers: students, title, business: null };
}

/** The chats of this business, from everything the viewer is in (a business account is in nothing else). */
export function businessConversations(conversations: ConversationSummary[], businessId: string, teamIds: ReadonlySet<string>): ConversationSummary[] {
  return conversations.filter((c) => c.business?.id === businessId).map((c) => businessInboxView(c, teamIds));
}

/** What a listing's poster line shows for a business listing: the business, not the person who posted it. */
export function listingPoster(
  owner: ProfileSummary,
  business: BusinessSummary | null | undefined,
): { id: string; name: string; avatarUrl: string | null; business: BusinessSummary | null } {
  if (business) return { id: owner.id, name: business.name, avatarUrl: business.logo_url, business };
  return { id: owner.id, name: owner.full_name, avatarUrl: owner.avatar_url, business: null };
}

/** The chat message a student starts an inquiry with. */
export function inquiryPrefill(businessName: string, title: string): string {
  return `Hi ${businessName}! I'm interested in "${title}". Is it still available?`;
}

/** What the portal's deal list says about a deal: Live, Scheduled, Ended, Paused or Archived. */
export function dealStatusLabel(deal: Pick<Deal, "status" | "starts_at" | "ends_at">, now: number = Date.now()): "Live" | "Scheduled" | "Ended" | "Paused" | "Archived" {
  if (deal.status === "paused") return "Paused";
  if (deal.status === "archived") return "Archived";
  if (new Date(deal.starts_at).getTime() > now) return "Scheduled";
  return dealIsLive(deal, now) ? "Live" : "Ended";
}

// --- UniBuzz Business v2: the team -------------------------------------------------------------------------------

/** A team role as stored; v1's "staff" (and anything unknown) reads as an editor, what staff could do. */
export function teamRoleOf(role: string | null | undefined): BusinessTeamRole {
  return role === "owner" || role === "admin" || role === "analyst" ? role : "editor";
}

/**
 * What a role may do, whatever the business's standing: the same table as business_role_allows() in migration 49. The
 * portal uses it to show only what will work; the database decides every request on its own.
 */
export function teamRoleAllows(role: string | null | undefined, capability: BusinessCapability): boolean {
  const r = teamRoleOf(role);
  switch (capability) {
    case "view":
    case "analytics":
      return true;
    case "publish":
    case "reply":
      return r !== "analyst";
    case "manage_team":
    case "edit_profile":
    case "manage_ads":
      return r === "owner" || r === "admin";
  }
}

/** Which roles a member may hand out: the owner makes admins, editors and analysts; an admin, editors and analysts. */
export function assignableRoles(myRole: string | null | undefined): BusinessTeamRole[] {
  const r = teamRoleOf(myRole);
  if (r === "owner") return ["admin", "editor", "analyst"];
  if (r === "admin") return ["editor", "analyst"];
  return [];
}

/** May `myRole` change or remove someone who is `theirRole`? Never the owner; only the owner touches admins. */
export function canManageMember(myRole: string | null | undefined, theirRole: string | null | undefined): boolean {
  const me = teamRoleOf(myRole);
  const them = teamRoleOf(theirRole);
  if (them === "owner" || !teamRoleAllows(me, "manage_team")) return false;
  return them !== "admin" || me === "owner";
}

// --- The portal's sidebar -----------------------------------------------------------------------------------------

/** The portal's sections, top to bottom; Settings sits apart at the bottom of the sidebar. The inbox comes right after
 * Overview: students waiting for an answer come first. */
export const PORTAL_SECTIONS = ["overview", "inbox", "ads", "products", "analytics", "billing"] as const;
export type PortalSection = (typeof PORTAL_SECTIONS)[number];

/**
 * Who sees Billing: the owner and admins, who decide ad spend, and analysts, who read the numbers. Editors draft ads
 * but never pay for them. (Every member can read the business's payments in the database; this keeps the portal lean.)
 */
export function canSeeBilling(role: string | null | undefined): boolean {
  return teamRoleAllows(role, "manage_ads") || teamRoleOf(role) === "analyst";
}

/**
 * The sections a member's sidebar shows, in PORTAL_SECTIONS's order, and whether Settings is there: everything their
 * role allows once the business is approved; while it is pending, all but the inbox (students write only to an
 * approved business); when it is rejected, the front page and Settings (to fix the profile); when suspended, nothing.
 */
export function portalSectionsFor(business: { role: string | null | undefined; standing: BusinessStanding }): { main: PortalSection[]; settings: boolean } {
  if (business.standing === "suspended") return { main: [], settings: false };
  if (business.standing === "rejected") return { main: ["overview"], settings: true };
  const main = PORTAL_SECTIONS.filter((s) => {
    if (s === "inbox") return business.standing === "approved" && teamRoleAllows(business.role, "reply");
    if (s === "billing") return canSeeBilling(business.role);
    return true;
  });
  return { main, settings: true };
}

/**
 * What a complete business profile has, as Settings › Verification lists it: the UniBuzz team reads the profile first
 * when it reviews a business and when it decides on Verified Partner.
 */
export function businessProfileChecklist(b: {
  logo_url: string | null;
  description: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  contact_email: string | null;
  phone: string | null;
  university_ids: string[];
}): { key: string; label: string; done: boolean }[] {
  return [
    { key: "logo", label: "A logo", done: Boolean(b.logo_url) },
    { key: "description", label: "A description of at least 40 characters", done: (b.description ?? "").trim().length >= 40 },
    { key: "website", label: "A website", done: Boolean(b.website) },
    { key: "place", label: "Where you are: an address or a city", done: Boolean(b.address || b.city) },
    { key: "contact", label: "A way to reach you: an email or a phone number", done: Boolean(b.contact_email || b.phone) },
    { key: "campuses", label: "The campuses you serve", done: b.university_ids.length > 0 },
  ];
}

// --- The inbox --------------------------------------------------------------------------------------------------------

/** What a student opened an inquiry from (conversations.inquiry_target_type): a listing, a post, an ad or the profile. */
export type InquiryKind = "listing" | "post" | "ad" | "profile";
export function inquiryKindOf(targetType: string | null | undefined): InquiryKind | null {
  switch (targetType) {
    case "apartment":
      return "listing";
    case "deal":
      return "post";
    case "ad":
      return "ad";
    case "business":
      return "profile";
    default:
      return null;
  }
}
export function inquiryKindLabel(kind: InquiryKind): string {
  return { listing: "Listing", post: "Post", ad: "Ad", profile: "Your profile" }[kind];
}

/**
 * Waiting for the business: the student wrote last. A chat appears in the inbox only once the student has written
 * (migration 56), so there is always a student message somewhere in it.
 */
export function inquiryNeedsReply(lastSenderId: string | null | undefined, teamIds: ReadonlySet<string>): boolean {
  return Boolean(lastSenderId) && !teamIds.has(lastSenderId as string);
}

/** A new message as an alert shows it: its words, or what it carries. */
export function inquiryMessagePreview(m: { content?: string | null; image_url?: string | null; attachments?: unknown; shared_post?: unknown }): string {
  const text = (m.content ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  if (Array.isArray(m.attachments) && m.attachments.length) return "Sent an attachment";
  if (m.image_url) return "Sent a photo";
  if (m.shared_post) return "Shared a post";
  return "Sent a message";
}

/** The inbox's filters, in the order the inbox shows them. */
export const INQUIRY_FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "needs_reply", label: "Needs reply" },
  { value: "listing", label: "Listings" },
  { value: "post", label: "Posts" },
  { value: "ad", label: "Ads" },
  { value: "profile", label: "Profile" },
] as const;
export type InquiryFilter = (typeof INQUIRY_FILTERS)[number]["value"];

/** Whether an inquiry shows under a filter and a search (the student's name, the message, or what it is about). */
export function inquiryMatches(
  inquiry: { unreadCount: number; needsReply: boolean; kind: InquiryKind | null; text: string },
  filter: InquiryFilter,
  query = "",
): boolean {
  const q = query.trim().toLowerCase();
  if (q && !inquiry.text.toLowerCase().includes(q)) return false;
  if (filter === "all") return true;
  if (filter === "unread") return inquiry.unreadCount > 0;
  if (filter === "needs_reply") return inquiry.needsReply;
  return inquiry.kind === filter;
}

// --- Billing --------------------------------------------------------------------------------------------------------

/** How a payment stands: running now, not started, over, or cancelled by the UniBuzz team. */
export type PaymentStanding = "active" | "upcoming" | "ended" | "cancelled";
export function paymentStanding(p: { status: string; starts_at: string; ends_at: string }, now: number = Date.now()): PaymentStanding {
  if (p.status === "cancelled") return "cancelled";
  if (new Date(p.ends_at).getTime() <= now) return "ended";
  return new Date(p.starts_at).getTime() > now ? "upcoming" : "active";
}

export function paymentStandingLabel(s: PaymentStanding): string {
  return { active: "Running", upcoming: "Scheduled", ended: "Ended", cancelled: "Cancelled" }[s];
}

/** Money by currency (a business may have paid in more than one), as "$120 + €40". */
export type MoneyByCurrency = Record<string, number>;
export function formatMoneyByCurrency(totals: MoneyByCurrency): string {
  const parts = Object.entries(totals).filter(([, cents]) => cents > 0).map(([currency, cents]) => formatCents(cents, currency));
  return parts.length ? parts.join(" + ") : formatCents(0);
}

/**
 * What a business has paid, counting payments by when the UniBuzz team recorded them; cancelled ones count in none
 * of the totals. `thisMonth` is the calendar month of `now` (UTC), `last30` the 30 days up to it.
 */
export function paymentTotals(payments: { status: string; amount_cents: number; currency: string; created_at: string; starts_at: string; ends_at: string }[], now: number = Date.now()): {
  thisMonth: MoneyByCurrency;
  last30: MoneyByCurrency;
  allTime: MoneyByCurrency;
  running: number;
} {
  const out = { thisMonth: {} as MoneyByCurrency, last30: {} as MoneyByCurrency, allTime: {} as MoneyByCurrency, running: 0 };
  const d = new Date(now);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const add = (into: MoneyByCurrency, currency: string, cents: number) => {
    into[currency] = (into[currency] ?? 0) + cents;
  };
  for (const p of payments) {
    if (p.status === "cancelled") continue;
    const at = new Date(p.created_at).getTime();
    add(out.allTime, p.currency, p.amount_cents);
    if (at >= monthStart && at <= now) add(out.thisMonth, p.currency, p.amount_cents);
    if (at > now - 30 * 864e5 && at <= now) add(out.last30, p.currency, p.amount_cents);
    if (paymentStanding(p, now) === "active") out.running += 1;
  }
  return out;
}

/**
 * A CSV of payments for a spreadsheet: one row each, the amount in the currency's units. A cell that a spreadsheet
 * would run as a formula (starting with =, +, -, @ or a tab) is written as text, since ad and listing names are the
 * business's own words.
 */
export function paymentsCsv(rows: { recorded_at: string; reference: string; paid_for: string; starts_at: string; ends_at: string; amount_cents: number; currency: string; status: string }[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const day = (iso: string) => iso.slice(0, 10);
  const lines = [["Recorded", "Reference", "Paid for", "From", "To", "Amount", "Currency", "Status"].join(",")];
  for (const r of rows) {
    lines.push([day(r.recorded_at), r.reference, r.paid_for, day(r.starts_at), day(r.ends_at), (r.amount_cents / 100).toFixed(2), r.currency, r.status].map((v) => cell(String(v))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// --- UniBuzz Business v2: ads ------------------------------------------------------------------------------------

/** An ad's status as it stands now, whether or not the database's sweep has run since its dates came (ad_effective_status()). */
export function adDisplayStatus(ad: Pick<Ad, "status" | "starts_at" | "ends_at">, now: number = Date.now()): Ad["status"] {
  const ends = ad.ends_at ? new Date(ad.ends_at).getTime() : null;
  const starts = ad.starts_at ? new Date(ad.starts_at).getTime() : null;
  if ((ad.status === "scheduled" || ad.status === "active" || ad.status === "paused") && ends !== null && ends <= now) return "completed";
  if (ad.status === "scheduled" && starts !== null && starts <= now) return "active";
  return ad.status;
}

/** Whether the team may still change an ad's content: drafts and rejected ads only (an approved ad is copied instead). */
export function adIsEditable(ad: Pick<Ad, "status">): boolean {
  return ad.status === "draft" || ad.status === "rejected";
}

/**
 * Where an ad may run: a housing ad (a housing business's, or one promoting a listing) only in Housing; any other in
 * For You and Reels. The database applies the same rule to every write.
 */
export function placementsFor(isHousing: boolean): AdPlacement[] {
  return isHousing ? ["housing"] : ["for_you", "reels"];
}

/** A housing ad: from a business in the housing category, or promoting one of its listings. */
export function isHousingAd(businessCategory: string | null | undefined, promotesListing: boolean): boolean {
  return promotesListing || businessCategory === "housing";
}

/** The media list of a post or an ad, as stored (jsonb), with anything unrecognisable left out. */
export function mediaItems(media: Json | null | undefined): BusinessMediaItem[] {
  if (!Array.isArray(media)) return [];
  return media.filter((m): m is BusinessMediaItem => {
    if (!m || typeof m !== "object" || Array.isArray(m)) return false;
    const item = m as Record<string, unknown>;
    return (item.type === "image" && typeof item.url === "string") || (item.type === "video" && typeof item.media_id === "string");
  });
}

/** The picture that stands for a post or an ad in a grid: its first photo, or its video's poster. */
export function mediaCover(media: BusinessMediaItem[]): string | null {
  for (const m of media) {
    if (m.type === "image") return m.url;
    if (m.poster_url) return m.poster_url;
  }
  return null;
}

/** Whether a video is vertical (taller than wide), as Reels needs; unknown sizes are not. */
export function isVerticalVideo(item: { width?: number | null; height?: number | null }): boolean {
  return typeof item.width === "number" && typeof item.height === "number" && item.height > item.width;
}

/**
 * The organic positions after which an ad goes, for the rows numbered `start` to `start + count - 1` of a feed (0-based,
 * counted over the whole feed so pages agree): after the every-th row, the 2×every-th, and so on. At most one ad per
 * `every` organic rows, never two in a row, never before the first `every`.
 */
export function adSlotsAfter(start: number, count: number, every: number): number[] {
  const out: number[] = [];
  if (every < 1) return out;
  for (let i = Math.max(0, start); i < start + count; i++) if ((i + 1) % every === 0) out.push(i);
  return out;
}

export type FeedRow<T> = { kind: "item"; item: T; index: number } | { kind: "ad"; ad: FeedAd; slot: number };

/**
 * A feed's rows with its ads between them: ad k after organic row (k + 1) × every − 1, while there are ads. The ads
 * keep their order (the database's rotation); an ad whose promoted listing or post is already in the feed, or which
 * already ran, is skipped for the next one, so a student never meets the same thing twice in a row.
 */
export function interleaveAds<T extends { id: string }>(items: T[], ads: FeedAd[], every: number): FeedRow<T>[] {
  const rows: FeedRow<T>[] = [];
  const present = new Set(items.map((i) => i.id));
  const queue = ads.filter((a, i) => ads.findIndex((b) => b.id === a.id) === i && !(a.promoted && present.has(a.promoted.id)));
  let slot = 0;
  items.forEach((item, index) => {
    rows.push({ kind: "item", item, index });
    if (every >= 1 && (index + 1) % every === 0 && slot < queue.length) {
      rows.push({ kind: "ad", ad: queue[slot], slot });
      slot += 1;
    }
  });
  return rows;
}

/** How many ads a feed of `count` organic rows has room for. */
export function adSlotCount(count: number, every: number): number {
  return every >= 1 ? Math.floor(Math.max(0, count) / every) : 0;
}

export type AdDestination =
  | { kind: "url"; url: string }
  | { kind: "listing"; id: string }
  | { kind: "post"; id: string; businessId: string }
  | { kind: "message"; adId: string }
  | { kind: "profile"; businessId: string };

/**
 * Where an ad's button leads: its link for the link buttons; the listing or the post it promotes for "View listing"
 * and "Get offer" (or the link when it has one); a chat with the business for "Send message" (started by the student,
 * so the business never writes first); the business's profile for "Visit profile" and whenever nothing else fits.
 */
export function adDestination(ad: Pick<FeedAd, "id" | "business_id" | "cta" | "cta_url" | "promoted">): AdDestination {
  if (ad.cta === "message") return { kind: "message", adId: ad.id };
  if (ad.cta === "view_listing" && ad.promoted?.type === "apartment") return { kind: "listing", id: ad.promoted.id };
  if (ad.cta_url && ad.cta !== "visit_profile") return { kind: "url", url: ad.cta_url };
  if (ad.cta === "get_offer" && ad.promoted?.type === "deal") return { kind: "post", id: ad.promoted.id, businessId: ad.business_id };
  if (ad.promoted?.type === "apartment") return { kind: "listing", id: ad.promoted.id };
  return { kind: "profile", businessId: ad.business_id };
}

/** "$12.50" style money from cents. */
export function formatCents(cents: number | null | undefined, currency = "USD"): string {
  const amount = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Clicks as a share of impressions, "2.4%", or "–" before anyone has seen it. */
export function clickRate(clicks: number, impressions: number): string {
  if (!impressions) return "–";
  const rate = (clicks / impressions) * 100;
  return `${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)}%`;
}

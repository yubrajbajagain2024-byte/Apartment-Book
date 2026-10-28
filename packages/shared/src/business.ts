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

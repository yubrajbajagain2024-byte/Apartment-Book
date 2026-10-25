import type { BusinessSummary, ConversationSummary, Deal, ProfileSummary } from "./types/models";

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

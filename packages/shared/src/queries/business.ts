import type { BusinessProfileInput, DealInput } from "../schemas";
import type {
  AdminBusinessRow,
  AdminPromotionRow,
  Business,
  BusinessDealStats,
  BusinessDecision,
  BusinessInvite,
  BusinessListingStats,
  BusinessMemberWithProfile,
  BusinessOverview,
  Client,
  Deal,
  DealWithBusiness,
  InquiryTargetType,
  MyBusiness,
  PostTargetType,
  PromotionTarget,
} from "../types/models";
import { roleOf, type UserRole } from "../business";
import { getOrCreateDirectConversation } from "./messages";
import { isMissingInDatabase, isMissingRelation } from "./profile-page";

export const BUSINESS_SUMMARY_SELECT = "id, name, logo_url, verified_partner";
const DEAL_SELECT = `*, business:businesses!deals_business_id_fkey(${BUSINESS_SUMMARY_SELECT}), sponsored:deal_sponsored`;

/** The signed-in person's role; 'student' on a database before migration 39. */
export async function getMyRole(supabase: Client): Promise<UserRole> {
  const { data, error } = await supabase.rpc("my_role");
  if (error) {
    if (isMissingInDatabase(error)) return "student";
    throw error;
  }
  return roleOf({ role: data });
}

/**
 * The business the signed-in person belongs to (every column, the review and the contact address included, whatever its
 * standing), with their place on the team; null for a student or an account on no team. `my_business()` because
 * students may not read some of those columns.
 */
export async function getMyBusiness(supabase: Client): Promise<MyBusiness | null> {
  const { data, error } = await supabase.rpc("my_business");
  if (error) {
    if (isMissingInDatabase(error)) return null;
    throw error;
  }
  const row = data as { role?: string; business?: Business } | null;
  if (!row || !row.business) return null;
  return { business: row.business, role: row.role === "owner" ? "owner" : "staff" };
}

/** The owner edits the business profile. Status and the Verified Partner mark are the admin's (the database keeps them). */
export async function updateBusiness(supabase: Client, id: string, input: BusinessProfileInput): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({
      name: input.name,
      category: input.category,
      description: input.description ?? "",
      website: input.website ?? null,
      phone: input.phone ?? null,
      contact_email: input.contactEmail ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      logo_url: input.logoUrl ?? null,
      university_ids: input.universityIds,
    })
    .eq("id", id);
  if (error) throw error;
}

// --- Deals -----------------------------------------------------------------------------------------------------

function dealRow(input: DealInput) {
  return {
    title: input.title,
    description: input.description ?? "",
    discount_label: input.discountLabel ?? null,
    code: input.code ?? null,
    link_url: input.linkUrl ?? null,
    image_url: input.imageUrl ?? null,
    university_ids: input.universityIds,
    ...(input.startsAt ? { starts_at: new Date(`${input.startsAt}T00:00:00`).toISOString() } : {}),
    ends_at: input.endsAt ? new Date(`${input.endsAt}T23:59:59`).toISOString() : null,
    status: input.status,
  };
}

/** Every deal of the business, newest first, whatever its status (the team's list). */
export async function listBusinessDeals(supabase: Client, businessId: string): Promise<Deal[]> {
  const { data, error } = await supabase.from("deals").select("*").eq("business_id", businessId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getDeal(supabase: Client, id: string): Promise<DealWithBusiness | null> {
  const { data, error } = await supabase.from("deals").select(DEAL_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as DealWithBusiness | null;
}

export async function createDeal(supabase: Client, businessId: string, userId: string, input: DealInput): Promise<Deal> {
  const { data, error } = await supabase
    .from("deals")
    .insert({ ...dealRow(input), business_id: businessId, created_by: userId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateDeal(supabase: Client, id: string, input: DealInput): Promise<Deal> {
  const { data, error } = await supabase.from("deals").update(dealRow(input)).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

export async function setDealStatus(supabase: Client, id: string, status: "active" | "paused" | "archived"): Promise<void> {
  const { error } = await supabase.from("deals").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteDeal(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("deals").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Student deals: the live ones of approved businesses, for this campus (deals that name no campus are for everyone),
 * newest first. Empty on a database before migration 39.
 */
export async function listDeals(supabase: Client, opts: { universityId?: string | null; limit?: number } = {}): Promise<DealWithBusiness[]> {
  let query = supabase.from("deals").select(DEAL_SELECT).order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.universityId) query = query.or(`university_ids.eq.{},university_ids.cs.{${opts.universityId}}`);
  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data as unknown as DealWithBusiness[]).filter((d) => d.business !== null);
}

// --- The team ---------------------------------------------------------------------------------------------------

export async function listTeam(supabase: Client, businessId: string): Promise<BusinessMemberWithProfile[]> {
  const { data, error } = await supabase
    .from("business_members")
    .select("*, profile:profiles!business_members_user_id_fkey(id, full_name, avatar_url)")
    .eq("business_id", businessId)
    .order("created_at");
  if (error) throw error;
  return data as BusinessMemberWithProfile[];
}

/** Invites still waiting to be used. */
export async function listInvites(supabase: Client, businessId: string): Promise<BusinessInvite[]> {
  const { data, error } = await supabase
    .from("business_invites")
    .select("*")
    .eq("business_id", businessId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createInvite(supabase: Client, email: string): Promise<BusinessInvite> {
  const { data, error } = await supabase.rpc("business_invite_create", { p_email: email });
  if (error) throw error;
  return data;
}

export async function revokeInvite(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.rpc("business_invite_revoke", { p_id: id });
  if (error) throw error;
}

export async function removeMember(supabase: Client, userId: string): Promise<void> {
  const { error } = await supabase.rpc("business_member_remove", { p_user: userId });
  if (error) throw error;
}

/** What the join page shows before anyone signs in; null for a token nobody issued. */
export async function lookupInvite(supabase: Client, token: string): Promise<{ businessName: string; email: string; valid: boolean } | null> {
  const { data, error } = await supabase.rpc("business_invite_lookup", { p_token: token });
  if (error) throw error;
  const row = data?.[0];
  return row ? { businessName: row.business_name, email: row.email, valid: row.valid } : null;
}

// --- Numbers ----------------------------------------------------------------------------------------------------

export async function getBusinessListingStats(supabase: Client, businessId: string): Promise<BusinessListingStats[]> {
  const { data, error } = await supabase.rpc("business_listing_stats", { p_business: businessId });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, views: Number(r.views), views_7d: Number(r.views_7d), saves: Number(r.saves), contacts: Number(r.contacts), inquiries: Number(r.inquiries) }));
}

export async function getBusinessDealStats(supabase: Client, businessId: string): Promise<BusinessDealStats[]> {
  const { data, error } = await supabase.rpc("business_deal_stats", { p_business: businessId });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, views: Number(r.views), views_7d: Number(r.views_7d), inquiries: Number(r.inquiries) }));
}

export async function getBusinessOverview(supabase: Client, businessId: string): Promise<BusinessOverview> {
  const { data, error } = await supabase.rpc("business_overview", { p_business: businessId });
  if (error) throw error;
  const r = data?.[0];
  return {
    active_listings: Number(r?.active_listings ?? 0),
    active_deals: Number(r?.active_deals ?? 0),
    views_30d: Number(r?.views_30d ?? 0),
    inquiries: Number(r?.inquiries ?? 0),
    inquiries_30d: Number(r?.inquiries_30d ?? 0),
    team: Number(r?.team ?? 0),
  };
}

// --- Admin ------------------------------------------------------------------------------------------------------

export async function adminListBusinesses(supabase: Client, status?: string | null): Promise<AdminBusinessRow[]> {
  const { data, error } = await supabase.rpc("admin_list_businesses", { p_status: status ?? null });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, members: Number(r.members), listings: Number(r.listings), deals: Number(r.deals), active_promotions: Number(r.active_promotions) }));
}

/** Approve, reject, suspend or send back to review. Approval never verifies: that is adminSetVerified(). */
export async function adminReviewBusiness(supabase: Client, businessId: string, decision: BusinessDecision, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc("admin_review_business", { p_business: businessId, p_decision: decision, p_note: note ?? null });
  if (error) throw error;
}

/** Verified Partner, with what was checked (at least 10 characters), or the mark taken away. */
export async function adminSetVerified(supabase: Client, businessId: string, verified: boolean, evidence?: string | null): Promise<void> {
  const { error } = await supabase.rpc("admin_set_verified", { p_business: businessId, p_verified: verified, p_evidence: evidence ?? null });
  if (error) throw error;
}

export async function adminBusinessTargets(supabase: Client, businessId: string): Promise<PromotionTarget[]> {
  const { data, error } = await supabase.rpc("admin_business_targets", { p_business: businessId });
  if (error) throw error;
  return data ?? [];
}

export async function adminListPromotions(supabase: Client, businessId: string): Promise<AdminPromotionRow[]> {
  const { data, error } = await supabase.rpc("admin_list_promotions", { p_business: businessId });
  if (error) throw error;
  return data ?? [];
}

/** A paid promotion, recorded once paid: what, the period, the amount in cents and the invoice or receipt reference. */
export async function adminRecordPromotion(
  supabase: Client,
  input: { targetType: "apartment" | "deal"; targetId: string; startsAt: string; endsAt: string; amountCents: number; currency: string; paymentReference: string },
): Promise<string> {
  const { data, error } = await supabase.rpc("admin_record_promotion", {
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_payment_reference: input.paymentReference,
  });
  if (error) throw error;
  return data;
}

export async function adminCancelPromotion(supabase: Client, promotionId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_cancel_promotion", { p_id: promotionId });
  if (error) throw error;
}

// --- Inquiries ----------------------------------------------------------------------------------------------------

/** A student's chat with the business behind a listing or deal (one per student and business); its id. */
export async function startBusinessInquiry(supabase: Client, targetType: InquiryTargetType, targetId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_business_inquiry", { p_target_type: targetType, p_target_id: targetId });
  if (error) throw error;
  return data;
}

/**
 * The "Message" button on a listing: the business's inquiry chat for a listing posted from the portal (`businessId`
 * set), the plain direct chat with the poster for everything else. On a database before migration 39 the inquiry
 * function is missing, and the direct chat is what there is.
 */
export async function startListingConversation(
  supabase: Client,
  target: { targetType: PostTargetType | "deal"; targetId: string; posterId: string; businessId?: string | null },
): Promise<string> {
  if (target.businessId && (target.targetType === "apartment" || target.targetType === "deal")) {
    try {
      return await startBusinessInquiry(supabase, target.targetType, target.targetId);
    } catch (error) {
      if (!isMissingInDatabase(error)) throw error;
    }
  }
  return getOrCreateDirectConversation(supabase, target.posterId);
}

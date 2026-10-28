import type { AdApprovalInput, AdDraftInput, BusinessProfileInput, DealInput } from "../schemas";
import type {
  Ad,
  AdminAdRow,
  AdminBusinessRow,
  AdminPromotionRow,
  AdPlacement,
  BusinessAdStats,
  BusinessAnalyticsOverview,
  BusinessAuditRow,
  BusinessDailyStats,
  BusinessEventKind,
  BusinessEventPlacement,
  BusinessReportReason,
  BusinessReportRow,
  BusinessTeamRole,
  FeedAd,
  NotificationWithActor,
  PromotedSummary,
  SavedAd,
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
import { mediaItems, roleOf, teamRoleOf, type UserRole } from "../business";
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
  return { business: row.business, role: teamRoleOf(row.role) };
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
    // The media list wins (migration 50 keeps image_url as its first photo); v1's single picture otherwise.
    ...(input.media ? { media: input.media } : { image_url: input.imageUrl ?? null }),
    kind: input.kind,
    price_cents: input.price ?? null,
    event_at: input.kind === "event" ? (input.eventAt ?? null) : null,
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
  // Offers only (deals and promotions, migration 50's kinds); a business's other posts are on its profile. A database
  // before migration 50 has no kind: every row there is a deal.
  const run = (offersOnly: boolean) => {
    let query = supabase.from("deals").select(DEAL_SELECT).order("created_at", { ascending: false }).limit(opts.limit ?? 50);
    if (opts.universityId) query = query.or(`university_ids.eq.{},university_ids.cs.{${opts.universityId}}`);
    if (offersOnly) query = query.in("kind", ["deal", "promotion"]);
    return query;
  };
  let { data, error } = await run(true);
  if (error && error.code === "42703") ({ data, error } = await run(false));
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

/** The owner or an admin invites an address as an admin (the owner only), an editor or an analyst (migration 49). */
export async function createInvite(supabase: Client, email: string, role: Exclude<BusinessTeamRole, "owner"> = "editor"): Promise<BusinessInvite> {
  const { data, error } = await supabase.rpc("business_invite_create", { p_email: email, p_role: role });
  if (error) throw error;
  return data;
}

/** The owner or an admin changes a member's role; the database moves them in or out of the inquiry chats. */
export async function setMemberRole(supabase: Client, userId: string, role: Exclude<BusinessTeamRole, "owner">): Promise<void> {
  const { error } = await supabase.rpc("business_member_set_role", { p_user: userId, p_role: role });
  if (error) throw error;
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
export async function lookupInvite(supabase: Client, token: string): Promise<{ businessName: string; email: string; valid: boolean; role: BusinessTeamRole } | null> {
  const { data, error } = await supabase.rpc("business_invite_lookup", { p_token: token });
  if (error) throw error;
  const row = data?.[0];
  return row ? { businessName: row.business_name, email: row.email, valid: row.valid, role: teamRoleOf(row.role) } : null;
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

// --- UniBuzz Business v2: the public profile (migration 50) ---------------------------------------------------------

/** What students read of a business: approved ones only (row-level security), never the contact address or the review. */
export const PUBLIC_BUSINESS_SELECT = "id, name, category, description, website, phone, address, city, logo_url, university_ids, status, verified_partner, created_at";
export type PublicBusiness = Pick<Business, "id" | "name" | "category" | "description" | "website" | "phone" | "address" | "city" | "logo_url" | "university_ids" | "status" | "verified_partner" | "created_at">;

/** A business's public profile; null when it is not approved (or does not exist). */
export async function getPublicBusiness(supabase: Client, id: string): Promise<PublicBusiness | null> {
  const { data, error } = await supabase.from("businesses").select(PUBLIC_BUSINESS_SELECT).eq("id", id).eq("status", "approved").maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
  return data as PublicBusiness | null;
}

/** A business's live posts, newest first, as students see them (the database leaves out the rest). */
export async function listPublicBusinessPosts(supabase: Client, businessId: string, limit = 60): Promise<DealWithBusiness[]> {
  const { data, error } = await supabase.from("deals").select(DEAL_SELECT).eq("business_id", businessId).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return data as unknown as DealWithBusiness[];
}

// --- UniBuzz Business v2: ads, the team's side -----------------------------------------------------------------------

/** Every ad of the business, newest first, budgets included (the team only). */
export async function listAds(supabase: Client, businessId: string): Promise<Ad[]> {
  const { data, error } = await supabase.from("ads").select("*").eq("business_id", businessId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getAd(supabase: Client, id: string): Promise<Ad | null> {
  const { data, error } = await supabase.from("ads").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

function adRow(input: AdDraftInput) {
  const [promotedType, promotedId] = input.promoted ? input.promoted.split(":") : [null, null];
  return {
    name: input.name,
    objective: input.objective,
    placements: input.placements.length ? input.placements : ["for_you"],
    university_ids: input.universityIds,
    headline: input.headline ?? null,
    caption: input.caption ?? "",
    media: input.media,
    cta: input.cta,
    cta_url: input.ctaUrl ?? null,
    promoted_deal_id: promotedType === "deal" ? promotedId : null,
    promoted_apartment_id: promotedType === "apartment" ? promotedId : null,
    budget_cents: input.budget ?? 0,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
  };
}

/** A new draft (anyone who publishes); the database keeps it a draft whatever else is sent. */
export async function createAdDraft(supabase: Client, businessId: string, userId: string, input: AdDraftInput): Promise<Ad> {
  const { data, error } = await supabase.from("ads").insert({ ...adRow(input), business_id: businessId, created_by: userId }).select("*").single();
  if (error) throw error;
  return data;
}

/** Changes a draft or a rejected ad (the database refuses anything else). */
export async function updateAdDraft(supabase: Client, id: string, input: AdDraftInput): Promise<Ad> {
  const { data, error } = await supabase.from("ads").update(adRow(input)).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteAd(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("ads").delete().eq("id", id);
  if (error) throw error;
}

/** What still stops the ad from being submitted, in the words the portal shows; empty when it is ready. */
export async function getAdProblems(supabase: Client, id: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("ad_problems", { p_ad: id });
  if (error) throw error;
  return data ?? [];
}

type AdAction = "ad_submit" | "ad_withdraw" | "ad_pause" | "ad_resume" | "ad_end";
async function adAction(supabase: Client, fn: AdAction, id: string): Promise<Ad> {
  const { data, error } = await supabase.rpc(fn, { p_ad: id });
  if (error) throw error;
  return data;
}
/** To the UniBuzz team for review (the owner or an admin; 10 a day per business). */
export const submitAd = (supabase: Client, id: string) => adAction(supabase, "ad_submit", id);
/** Back from review to draft. */
export const withdrawAd = (supabase: Client, id: string) => adAction(supabase, "ad_withdraw", id);
export const pauseAd = (supabase: Client, id: string) => adAction(supabase, "ad_pause", id);
/** The owner or an admin; not an ad the UniBuzz team paused. */
export const resumeAd = (supabase: Client, id: string) => adAction(supabase, "ad_resume", id);
/** Stops it for good before its end date. */
export const endAd = (supabase: Client, id: string) => adAction(supabase, "ad_end", id);

/** A new draft with this ad's content and no dates: how an approved ad is changed. */
export async function duplicateAd(supabase: Client, id: string): Promise<string> {
  const { data, error } = await supabase.rpc("ad_duplicate", { p_ad: id });
  if (error) throw error;
  return data;
}

/** The Fair Housing screen's hits for some text ("Familial status: \"no kids\""), for the preview before submitting. */
export async function checkFairHousing(supabase: Client, text: string): Promise<string[]> {
  if (!text.trim()) return [];
  const { data, error } = await supabase.rpc("fair_housing_flags", { p_text: text });
  if (error) {
    if (isMissingInDatabase(error)) return [];
    throw error;
  }
  return data ?? [];
}

// --- UniBuzz Business v2: the numbers ------------------------------------------------------------------------------

const n = (v: unknown) => Number(v ?? 0);

/** Each ad's numbers over its life: impressions, reach, clicks, saves, profile visits, inquiries. Counts only, never who. */
export async function getAdStats(supabase: Client, businessId: string): Promise<BusinessAdStats[]> {
  const { data, error } = await supabase.rpc("business_ad_stats", { p_business: businessId });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, impressions: n(r.impressions), reach: n(r.reach), clicks: n(r.clicks), saves: n(r.saves), profile_visits: n(r.profile_visits), inquiries: n(r.inquiries) }));
}

/** Day by day over the last `days` (1-90) for the business, or for one ad. */
export async function getDailyStats(supabase: Client, businessId: string, opts: { days?: number; adId?: string | null } = {}): Promise<BusinessDailyStats[]> {
  const { data, error } = await supabase.rpc("business_daily_stats", { p_business: businessId, p_days: opts.days ?? 30, p_ad: opts.adId ?? null });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, day: String(r.day).slice(0, 10), impressions: n(r.impressions), reach: n(r.reach), clicks: n(r.clicks), saves: n(r.saves), profile_visits: n(r.profile_visits), inquiries: n(r.inquiries) }));
}

export async function getAnalyticsOverview(supabase: Client, businessId: string, days = 30): Promise<BusinessAnalyticsOverview> {
  const { data, error } = await supabase.rpc("business_analytics_overview", { p_business: businessId, p_days: days });
  if (error) throw error;
  const r = data?.[0];
  return {
    impressions: n(r?.impressions),
    reach: n(r?.reach),
    clicks: n(r?.clicks),
    saves: n(r?.saves),
    profile_visits: n(r?.profile_visits),
    inquiries: n(r?.inquiries),
    post_views: n(r?.post_views),
    active_ads: n(r?.active_ads),
    spend_cents: n(r?.spend_cents),
  };
}

/** The business's audit log (owners and admins), or every business's (the UniBuzz team, with `businessId` null). */
export async function getBusinessAudit(supabase: Client, businessId: string | null, opts: { limit?: number; before?: number | null } = {}): Promise<BusinessAuditRow[]> {
  const { data, error } = await supabase.rpc("business_audit", { p_business: businessId, p_limit: opts.limit ?? 50, p_before: opts.before ?? null });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, id: n(r.id) }));
}

/** The portal's notifications: reviews, roles and campaigns (types business and ad), newest first. */
export async function listPortalNotifications(supabase: Client, limit = 50): Promise<NotificationWithActor[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, user_id, actor_id, type, title, body, link, data, read_at, created_at")
    .in("type", ["business", "ad"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...(row as unknown as NotificationWithActor), actor: null }));
}

export async function countUnreadPortalNotifications(supabase: Client): Promise<number> {
  const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).in("type", ["business", "ad"]).is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

export async function markPortalNotificationsRead(supabase: Client): Promise<void> {
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("type", ["business", "ad"]).is("read_at", null);
  if (error) throw error;
}

// --- UniBuzz Business v2: the UniBuzz team's review -----------------------------------------------------------------

export async function adminListAds(supabase: Client, status?: string | null): Promise<AdminAdRow[]> {
  const { data, error } = await supabase.rpc("admin_list_ads", { p_status: status ?? null });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, paid_cents: n(r.paid_cents), open_reports: n(r.open_reports) }));
}

/** Approves an ad by recording its payment (amount and reference); housing ads need the Fair Housing check. */
export async function adminApproveAd(supabase: Client, id: string, input: AdApprovalInput): Promise<Ad> {
  const { data, error } = await supabase.rpc("admin_approve_ad", {
    p_ad: id,
    p_amount_cents: input.amount ?? 0,
    p_currency: input.currency,
    p_payment_reference: input.paymentReference,
    p_note: input.note ?? null,
    p_fair_housing_checked: input.fairHousingChecked,
  });
  if (error) throw error;
  return data;
}

export async function adminRejectAd(supabase: Client, id: string, reason: string): Promise<Ad> {
  const { data, error } = await supabase.rpc("admin_reject_ad", { p_ad: id, p_reason: reason });
  if (error) throw error;
  return data;
}

export async function adminPauseAd(supabase: Client, id: string, reason: string): Promise<Ad> {
  const { data, error } = await supabase.rpc("admin_pause_ad", { p_ad: id, p_reason: reason });
  if (error) throw error;
  return data;
}

export async function adminResumeAd(supabase: Client, id: string): Promise<Ad> {
  const { data, error } = await supabase.rpc("admin_resume_ad", { p_ad: id });
  if (error) throw error;
  return data;
}

export async function adminListBusinessReports(supabase: Client, status: "open" | "actioned" | "dismissed" | null = "open"): Promise<BusinessReportRow[]> {
  const { data, error } = await supabase.rpc("admin_list_business_reports", { p_status: status });
  if (error) throw error;
  return data ?? [];
}

export async function adminResolveBusinessReport(supabase: Client, id: string, status: "actioned" | "dismissed", note?: string | null): Promise<void> {
  const { error } = await supabase.rpc("admin_resolve_business_report", { p_report: id, p_status: status, p_note: note ?? null });
  if (error) throw error;
}

// --- UniBuzz Business v2: what students see -------------------------------------------------------------------------

/** An ads_for_feed() row with its media and promoted item read into shapes. */
function feedAd(row: Record<string, unknown>): FeedAd {
  const promoted = row.promoted as PromotedSummary | null;
  return {
    ...(row as unknown as FeedAd),
    media: mediaItems(row.media as never),
    promoted: promoted && promoted.type === "deal" ? { ...promoted, media: mediaItems(promoted.media as never) } : promoted,
  };
}

/**
 * The ads for `count` slots of one placement, continuing the campus's daily rotation at `offset` (the number of ads
 * the feed already shows). Signed-in students only: anyone else, or a database without migration 50, gets none, and
 * the feed carries on without them.
 */
export async function listFeedAds(supabase: Client, placement: AdPlacement, count: number, offset = 0): Promise<FeedAd[]> {
  if (count <= 0) return [];
  const { data, error } = await supabase.rpc("ads_for_feed", { p_placement: placement, p_limit: Math.min(count, 10), p_offset: offset });
  if (error) return [];
  return (data ?? []).map((row) => feedAd(row as Record<string, unknown>));
}

/**
 * One thing a student did with a business's ad, post or listing, or its profile. Counted once per person per hour or
 * day by the database, and never shown to the business as anything but a number; failures are ignored (it is a count,
 * not something the student is waiting for).
 */
export async function recordBusinessEvent(
  supabase: Client,
  event: BusinessEventKind,
  target: { businessId?: string | null; adId?: string | null; dealId?: string | null; apartmentId?: string | null; placement?: BusinessEventPlacement | null },
): Promise<void> {
  await Promise.resolve(
    supabase.rpc("record_business_event", {
      p_event: event,
      p_business: target.businessId ?? null,
      p_ad: target.adId ?? null,
      p_deal: target.dealId ?? null,
      p_apartment: target.apartmentId ?? null,
      p_placement: target.placement ?? null,
    }),
  ).catch(() => {});
}

export async function hideAd(supabase: Client, adId: string): Promise<void> {
  const { error } = await supabase.rpc("hide_ad", { p_ad: adId });
  if (error) throw error;
}

export async function saveAd(supabase: Client, adId: string, saved = true): Promise<void> {
  const { error } = await supabase.rpc("save_ad", { p_ad: adId, p_saved: saved });
  if (error) throw error;
}

/** The ads the signed-in student saved, while they can still be shown. */
export async function listSavedAds(supabase: Client): Promise<SavedAd[]> {
  const { data, error } = await supabase.rpc("my_saved_ads");
  if (error) {
    if (isMissingInDatabase(error)) return [];
    throw error;
  }
  return data ?? [];
}

/** Block or unblock a business: its ads and posts disappear for the student, and it cannot be messaged. */
export async function setBusinessBlocked(supabase: Client, businessId: string, blocked: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_business_blocked", { p_business: businessId, p_blocked: blocked });
  if (error) throw error;
}

export async function isBusinessBlocked(supabase: Client, businessId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("business_blocked_by_me", { p_business: businessId });
  if (error) return false;
  return Boolean(data);
}

/** A student's report of an ad, a post or a business to the UniBuzz team (20 a day). Reporting an ad also hides it. */
export async function reportBusiness(
  supabase: Client,
  target: { businessId?: string | null; adId?: string | null; dealId?: string | null },
  reason: BusinessReportReason,
  details?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("report_business", {
    p_business: target.businessId ?? null,
    p_reason: reason,
    p_details: details ?? null,
    p_ad: target.adId ?? null,
    p_deal: target.dealId ?? null,
  });
  if (error) throw error;
}

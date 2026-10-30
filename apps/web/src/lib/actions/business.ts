"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  adApprovalSchema,
  adDraftSchema,
  adReasonSchema,
  adminApproveAd,
  adminPauseAd,
  adminRejectAd,
  adminResolveBusinessReport,
  adminResumeAd,
  adminCancelPromotion,
  adminRecordPromotion,
  adminReviewBusiness,
  adminSetVerified,
  apartmentSchema,
  businessInviteSchema,
  businessJoinSchema,
  businessProfileSchema,
  businessSignUpSchema,
  canUsePortal,
  createAdDraft,
  createApartment,
  createDeal,
  createInvite,
  deleteAd,
  duplicateAd,
  endAd,
  getAd,
  isVerticalVideo,
  markPortalNotificationsRead,
  mediaItems,
  pauseAd,
  pruneSpecialHours,
  resumeAd,
  setMemberRole,
  submitAd,
  updateAdDraft,
  withdrawAd,
  type BusinessMediaInput,
  type BusinessTeamRole,
  dealSchema,
  deleteApartment,
  deleteDeal,
  flattenZodError,
  getApartment,
  getDeal,
  getMyRole,
  lookupInvite,
  removeMember,
  revokeInvite,
  setApartmentStatus,
  setDealStatus,
  signInSchema,
  updateApartment,
  updateBusiness,
  updateDeal,
  type BusinessDecision,
  type ListingStatus,
} from "@apartment-book/shared";
import { portalCallbackUrl, portalPath, requireAdmin, requireBusiness, requireCapability } from "@/lib/business/portal";
import { getAsset } from "@/lib/mux";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessSiteUrl, getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject, safeNextPath } from "@/lib/utils";
import { formValues, type FormState } from "./types";

/** What the portal's pages revalidate after a change: every page under /business (the portal's host serves those). */
const PORTAL_ROOT = "/business";

/**
 * A post's or an ad's media from the portal's media field: its photos (the image uploader's JSON meta, in order) or its
 * one video (the video uploader's JSON, once ready), whichever the field's switch says. The database checks the rest.
 */
function mediaFromForm(formData: FormData): BusinessMediaInput {
  const json = (v: FormDataEntryValue) => {
    try {
      return JSON.parse(String(v)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  if (formData.get("mediaMode") === "video") {
    const video = formData.getAll("mediaVideo").map(json).find((v) => v && typeof v.media_id === "string");
    return video ? [{ type: "video", media_id: String(video.media_id) }] : [];
  }
  return formData
    .getAll("mediaPhotoMeta")
    .map(json)
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p.url === "string"))
    .map((p) => ({ type: "image" as const, url: String(p.url), width: typeof p.width === "number" ? p.width : null, height: typeof p.height === "number" ? p.height : null }));
}

function stringValues(formData: FormData, keys: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) values[key] = String(formData.get(key) ?? "");
  return values;
}

// --- Accounts ---------------------------------------------------------------------------------------------------

/** A business signs up: any email address, a pending business, and a confirmation email that returns to the portal. */
export async function businessSignUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = stringValues(formData, ["fullName", "email", "businessName", "category", "website", "phone", "city", "universityId"]);
  const parsed = businessSignUpSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        account_type: "business",
        business_name: parsed.data.businessName,
        business_category: parsed.data.category,
        business_website: parsed.data.website ?? "",
        business_phone: parsed.data.phone ?? "",
        business_city: parsed.data.city ?? "",
        business_university_id: parsed.data.universityId ?? "",
      },
      emailRedirectTo: portalCallbackUrl("/"),
    },
  });
  if (error) return { error: error.message, values };
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: "An account with this email already exists. Try logging in instead.", values };
  }
  if (data.session) redirect(await portalPath("/"));
  return { success: `We sent a confirmation link to ${parsed.data.email}. Open it to activate your account; your business is then reviewed by the UniBuzz team.` };
}

/** Someone invited to a team signs up from the invite link: the address is the invite's, the account joins that team. */
export async function businessJoinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = stringValues(formData, ["fullName"]);
  const parsed = businessJoinSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values };
  }
  const supabase = await createClient();
  const invite = await lookupInvite(supabase, parsed.data.token).catch(() => null);
  if (!invite || !invite.valid) return { error: "This invite link is no longer valid. Ask the business owner for a new one.", values };
  const { data, error } = await supabase.auth.signUp({
    email: invite.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, account_type: "business", business_invite: parsed.data.token },
      emailRedirectTo: portalCallbackUrl("/"),
    },
  });
  if (error) return { error: error.message, values };
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: "An account with this email already exists. Try logging in instead.", values };
  }
  if (data.session) redirect(await portalPath("/"));
  return { success: `We sent a confirmation link to ${invite.email}. Open it to join ${invite.businessName}.` };
}

/** The portal's own login: business accounts and admins only; a student is told where to go. */
export async function businessSignInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = stringValues(formData, ["email"]);
  const parsed = signInSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return { error: error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message, values };
  const role = await getMyRole(supabase).catch(() => "student" as const);
  if (!canUsePortal(role)) {
    await supabase.auth.signOut();
    return { error: `This is the business portal. Students sign in to UniBuzz at ${getSiteUrl()} or in the app.`, values };
  }
  redirect(await portalPath(safeNextPath(String(formData.get("next") ?? ""), "/")));
}

export async function businessSignOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(await portalPath("/login"));
}

// --- The business profile ----------------------------------------------------------------------------------------

export async function updateBusinessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { membership } = await requireCapability("edit_profile", "/profile");
  const parsed = businessProfileSchema.safeParse(formToObject(formData, ["universityIds"]));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  // Special hours for dates already gone are dropped as the profile is saved.
  const input = parsed.data.hours ? { ...parsed.data, hours: pruneSpecialHours(parsed.data.hours, new Date()) } : parsed.data;
  try {
    await updateBusiness(await createClient(), membership.business.id, input);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return { success: "Saved." };
}

// --- Listings ---------------------------------------------------------------------------------------------------

const LISTING_ARRAYS = ["amenities", "images", "imageMeta", "videos"];

export async function createBusinessListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { membership } = await requireCapability("reply", "/listings/new");
  if (membership.business.status !== "approved") return { error: "Your business is not approved yet. Listings can be posted once it is.", values: formValues(formData) };
  const parsed = apartmentSchema.safeParse(formToObject(formData, LISTING_ARRAYS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    // Owned by the business's owner, whoever on the team posts it (the database requires it).
    await createApartment(await createClient(), membership.business.owner_id, parsed.data, { businessId: membership.business.id });
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/apartments");
  revalidatePath("/");
  revalidatePath(PORTAL_ROOT, "layout");
  redirect(await portalPath("/listings?posted=1"));
}

export async function updateBusinessListingAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { membership } = await requireCapability("reply", `/listings/${id}/edit`);
  const parsed = apartmentSchema.safeParse(formToObject(formData, LISTING_ARRAYS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    const supabase = await createClient();
    const existing = await getApartment(supabase, id);
    if (!existing || existing.business_id !== membership.business.id) return { error: "That listing is not your business's." };
    await updateApartment(supabase, id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/apartments");
  revalidatePath(`/apartments/${id}`);
  revalidatePath(PORTAL_ROOT, "layout");
  redirect(await portalPath("/listings"));
}

export async function setBusinessListingStatusAction(id: string, status: ListingStatus): Promise<{ error?: string }> {
  const { membership } = await requireCapability("reply", "/listings");
  try {
    const supabase = await createClient();
    const existing = await getApartment(supabase, id);
    if (!existing || existing.business_id !== membership.business.id) return { error: "That listing is not your business's." };
    await setApartmentStatus(supabase, id, status);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/apartments");
  revalidatePath(`/apartments/${id}`);
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

export async function deleteBusinessListingAction(id: string): Promise<{ error?: string }> {
  const { membership } = await requireCapability("reply", "/listings");
  try {
    const supabase = await createClient();
    const existing = await getApartment(supabase, id);
    if (!existing || existing.business_id !== membership.business.id) return { error: "That listing is not your business's." };
    await deleteApartment(supabase, id);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/apartments");
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

// --- Deals ------------------------------------------------------------------------------------------------------

export async function createDealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, membership } = await requireCapability("publish", "/deals/new");
  const parsed = dealSchema.safeParse({ ...formToObject(formData, ["universityIds"]), media: mediaFromForm(formData) });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await createDeal(await createClient(), membership.business.id, user.id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/deals");
  revalidatePath(PORTAL_ROOT, "layout");
  redirect(await portalPath("/deals"));
}

export async function updateDealAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { membership } = await requireCapability("publish", `/deals/${id}/edit`);
  const parsed = dealSchema.safeParse({ ...formToObject(formData, ["universityIds"]), media: mediaFromForm(formData) });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    const supabase = await createClient();
    const existing = await getDeal(supabase, id);
    if (!existing || existing.business_id !== membership.business.id) return { error: "That deal is not your business's." };
    await updateDeal(supabase, id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/deals");
  revalidatePath(PORTAL_ROOT, "layout");
  redirect(await portalPath("/deals"));
}

export async function setDealStatusAction(id: string, status: "active" | "paused" | "archived"): Promise<{ error?: string }> {
  const { membership } = await requireCapability("publish", "/deals");
  try {
    const supabase = await createClient();
    const existing = await getDeal(supabase, id);
    if (!existing || existing.business_id !== membership.business.id) return { error: "That deal is not your business's." };
    await setDealStatus(supabase, id, status);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/deals");
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

export async function deleteDealAction(id: string): Promise<{ error?: string }> {
  const { membership } = await requireCapability("publish", "/deals");
  try {
    const supabase = await createClient();
    const existing = await getDeal(supabase, id);
    if (!existing || existing.business_id !== membership.business.id) return { error: "That deal is not your business's." };
    await deleteDeal(supabase, id);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/deals");
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

// --- The team ---------------------------------------------------------------------------------------------------

/** The owner invites an address; the page shows the join link to pass on. */
export async function createInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability("manage_team", "/team");
  const values = stringValues(formData, ["email", "role"]);
  const parsed = businessInviteSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values };
  }
  try {
    const invite = await createInvite(await createClient(), parsed.data.email, parsed.data.role);
    revalidatePath(PORTAL_ROOT, "layout");
    return { success: `Invite ready for ${invite.email}.`, values: { link: `${getBusinessSiteUrl()}/join/${invite.token}` } };
  } catch (error) {
    return { error: errorMessage(error), values };
  }
}

export async function revokeInviteAction(id: string): Promise<{ error?: string }> {
  await requireCapability("manage_team", "/team");
  try {
    await revokeInvite(await createClient(), id);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

export async function removeMemberAction(userId: string): Promise<{ error?: string }> {
  await requireCapability("manage_team", "/team");
  try {
    await removeMember(await createClient(), userId);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

// --- Admin ------------------------------------------------------------------------------------------------------

function revalidateEverywhere() {
  revalidatePath(PORTAL_ROOT, "layout");
  revalidatePath("/apartments");
  revalidatePath("/deals");
}

/** Approve, reject, suspend or send back to review, with an optional note the business sees. */
export async function adminReviewAction(businessId: string, decision: BusinessDecision, note?: string): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await adminReviewBusiness(await createClient(), businessId, decision, note?.trim() || null);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidateEverywhere();
  return {};
}

/** Verified Partner with what was checked, or the mark taken away. */
export async function adminVerifyAction(businessId: string, verified: boolean, evidence?: string): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await adminSetVerified(await createClient(), businessId, verified, evidence?.trim() || null);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidateEverywhere();
  return {};
}

/** Record a paid promotion of one listing or deal: the period, the amount paid and the payment's reference. */
export async function adminRecordPromotionAction(input: {
  target: string;
  startsOn: string;
  endsOn: string;
  amount: string;
  currency: string;
  paymentReference: string;
}): Promise<{ error?: string }> {
  await requireAdmin();
  const [targetType, targetId] = input.target.split(":");
  const amountCents = Math.round(Number(input.amount) * 100);
  if ((targetType !== "apartment" && targetType !== "deal") || !targetId) return { error: "Choose a listing or a deal." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn <= input.startsOn) return { error: "Choose a start and a later end date." };
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { error: "Enter the amount paid." };
  try {
    await adminRecordPromotion(await createClient(), {
      targetType,
      targetId,
      startsAt: new Date(`${input.startsOn}T00:00:00`).toISOString(),
      endsAt: new Date(`${input.endsOn}T23:59:59`).toISOString(),
      amountCents,
      currency: input.currency.trim().toUpperCase() || "USD",
      paymentReference: input.paymentReference.trim(),
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidateEverywhere();
  return {};
}

export async function adminCancelPromotionAction(promotionId: string): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await adminCancelPromotion(await createClient(), promotionId);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidateEverywhere();
  return {};
}

/** The owner or an admin changes someone's role (the database refuses what their own role does not allow). */
export async function setMemberRoleAction(userId: string, role: Exclude<BusinessTeamRole, "owner">): Promise<{ error?: string }> {
  await requireCapability("manage_team", "/team");
  try {
    await setMemberRole(await createClient(), userId, role);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

// --- Ads (migration 50) -------------------------------------------------------------------------------------------

const AD_ARRAYS = ["placements", "universityIds"];

function adValues(formData: FormData): Record<string, string> {
  return formValues(formData);
}

/** A new ad draft (anyone who publishes); its page says what still stops it from being submitted. */
export async function createAdAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, membership } = await requireCapability("publish", "/ads/new");
  const parsed = adDraftSchema.safeParse({ ...formToObject(formData, AD_ARRAYS), media: mediaFromForm(formData) });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: adValues(formData) };
  }
  let id: string;
  try {
    id = (await createAdDraft(await createClient(), membership.business.id, user.id, parsed.data)).id;
  } catch (error) {
    return { error: errorMessage(error), values: adValues(formData) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  redirect(await portalPath(`/ads/${id}?saved=1`));
}

/** Changes a draft or a rejected ad (the database refuses any other). */
export async function updateAdAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { membership } = await requireCapability("publish", `/ads/${id}/edit`);
  const parsed = adDraftSchema.safeParse({ ...formToObject(formData, AD_ARRAYS), media: mediaFromForm(formData) });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: adValues(formData) };
  }
  try {
    const supabase = await createClient();
    const existing = await getAd(supabase, id);
    if (!existing || existing.business_id !== membership.business.id) return { error: "That ad is not your business's." };
    await updateAdDraft(supabase, id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: adValues(formData) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  redirect(await portalPath(`/ads/${id}?saved=1`));
}

export type AdCommand = "submit" | "withdraw" | "pause" | "resume" | "end" | "duplicate" | "delete";

/**
 * Moves an ad along (the database decides who may: anyone who publishes drafts, withdraws and pauses; the owner and
 * admins submit, resume and end). A copy opens in the editor; a deleted draft goes back to the list.
 */
const AD_COMMANDS: readonly AdCommand[] = ["submit", "withdraw", "pause", "resume", "end", "duplicate", "delete"];

export async function adCommandAction(id: string, command: AdCommand): Promise<{ error?: string }> {
  if (!AD_COMMANDS.includes(command)) return { error: "Unknown action." };
  const { membership } = await requireCapability("publish", `/ads/${id}`);
  const supabase = await createClient();
  let next: string | null = null;
  try {
    const existing = await getAd(supabase, id);
    if (!existing || existing.business_id !== membership.business.id) return { error: "That ad is not your business's." };
    if (command === "submit") await submitAd(supabase, id);
    else if (command === "withdraw") await withdrawAd(supabase, id);
    else if (command === "pause") await pauseAd(supabase, id);
    else if (command === "resume") await resumeAd(supabase, id);
    else if (command === "end") await endAd(supabase, id);
    else if (command === "duplicate") next = `/ads/${await duplicateAd(supabase, id)}/edit`;
    else if (command === "delete") {
      await deleteAd(supabase, id);
      next = "/ads";
    }
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  if (next) redirect(await portalPath(next));
  return {};
}

/** The bell: everything the portal told this person counts as seen once they open the list. */
export async function markPortalNotificationsReadAction(): Promise<void> {
  await requireBusiness("/notifications", ["pending", "approved", "rejected"]);
  await markPortalNotificationsRead(await createClient()).catch(() => {});
  revalidatePath(PORTAL_ROOT, "layout");
}

// --- The UniBuzz team: ads and reports ------------------------------------------------------------------------------

/**
 * Before a Reels ad is approved, the video's size as the provider reports it: it must be taller than it is wide. Null
 * when it is, or when the provider cannot be asked (no credentials here: the reviewer looks at the video).
 */
async function reelsVideoProblem(adId: string): Promise<string | null> {
  const supabase = await createClient();
  const ad = await getAd(supabase, adId);
  if (!ad || !ad.placements.includes("reels")) return null;
  const video = mediaItems(ad.media).find((m) => m.type === "video");
  if (!video || video.type !== "video") return "Reels needs one vertical video.";
  // The media row is its uploader's alone to read (migration 11): the server's key reads it, after requireAdmin.
  const admin = createAdminClient();
  if (!admin) return null;
  const { data: media } = await admin.from("media").select("provider_asset_id").eq("id", video.media_id).maybeSingle();
  if (!media?.provider_asset_id) return null;
  try {
    const asset = await getAsset(media.provider_asset_id);
    const track = asset.tracks?.find((t) => t.type === "video");
    if (track && !isVerticalVideo({ width: track.max_width ?? null, height: track.max_height ?? null })) {
      return `The video is ${track.max_width}×${track.max_height}: Reels needs a vertical one. Reject the ad and ask for a vertical video.`;
    }
  } catch {
    return null;
  }
  return null;
}

/** Approves an ad by recording its payment; a housing ad also needs the reviewer's Fair Housing check. */
export async function approveAdAction(adId: string, input: Record<string, string | boolean | undefined>): Promise<{ error?: string }> {
  await requireAdmin("/admin/ads");
  const parsed = adApprovalSchema.safeParse(input);
  if (!parsed.success) return { error: Object.values(flattenZodError(parsed.error).fieldErrors).flat()[0] ?? "Check the payment details." };
  const problem = await reelsVideoProblem(adId);
  if (problem) return { error: problem };
  try {
    await adminApproveAd(await createClient(), adId, parsed.data);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

export async function rejectAdAction(adId: string, reason: string): Promise<{ error?: string }> {
  await requireAdmin("/admin/ads");
  const parsed = adReasonSchema.safeParse({ reason });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    await adminRejectAd(await createClient(), adId, parsed.data.reason);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

/** Pauses a running ad for a policy reason (only the UniBuzz team resumes it), or resumes one it paused. */
export async function adminPauseAdAction(adId: string, reason: string | null): Promise<{ error?: string }> {
  await requireAdmin("/admin/ads");
  try {
    const supabase = await createClient();
    if (reason === null) await adminResumeAd(supabase, adId);
    else {
      const parsed = adReasonSchema.safeParse({ reason });
      if (!parsed.success) return { error: parsed.error.issues[0]?.message };
      await adminPauseAd(supabase, adId, parsed.data.reason);
    }
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

export async function resolveReportAction(reportId: string, status: "actioned" | "dismissed", note?: string): Promise<{ error?: string }> {
  await requireAdmin("/admin/reports");
  try {
    await adminResolveBusinessReport(await createClient(), reportId, status, note?.trim() || null);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

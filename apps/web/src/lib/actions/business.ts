"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
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
  createApartment,
  createDeal,
  createInvite,
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
import { portalCallbackUrl, portalPath, requireAdmin, requireBusiness, requireBusinessOwner } from "@/lib/business/portal";
import { getBusinessSiteUrl, getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject, safeNextPath } from "@/lib/utils";
import { formValues, type FormState } from "./types";

/** What the portal's pages revalidate after a change: every page under /business (the portal's host serves those). */
const PORTAL_ROOT = "/business";

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
  return { success: `We sent a confirmation link to ${parsed.data.email}. Open it to activate your account; your business is then reviewed by the CampConnect team.` };
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
    return { error: `This is the business portal. Students sign in to CampConnect at ${getSiteUrl()} or in the app.`, values };
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
  const { membership } = await requireBusinessOwner("/profile", ["pending", "approved", "rejected"]);
  const parsed = businessProfileSchema.safeParse(formToObject(formData, ["universityIds"]));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await updateBusiness(await createClient(), membership.business.id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return { success: "Saved." };
}

// --- Listings ---------------------------------------------------------------------------------------------------

const LISTING_ARRAYS = ["amenities", "images", "imageMeta", "videos"];

export async function createBusinessListingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { membership } = await requireBusiness("/listings/new", ["approved"]);
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
  const { membership } = await requireBusiness(`/listings/${id}/edit`, ["approved"]);
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
  const { membership } = await requireBusiness("/listings", ["approved"]);
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
  const { membership } = await requireBusiness("/listings", ["approved"]);
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
  const { user, membership } = await requireBusiness("/deals/new");
  const parsed = dealSchema.safeParse(formToObject(formData, ["universityIds"]));
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
  const { membership } = await requireBusiness(`/deals/${id}/edit`);
  const parsed = dealSchema.safeParse(formToObject(formData, ["universityIds"]));
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
  const { membership } = await requireBusiness("/deals");
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
  const { membership } = await requireBusiness("/deals");
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
  await requireBusinessOwner("/team");
  const values = stringValues(formData, ["email"]);
  const parsed = businessInviteSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values };
  }
  try {
    const invite = await createInvite(await createClient(), parsed.data.email);
    revalidatePath(PORTAL_ROOT, "layout");
    return { success: `Invite ready for ${invite.email}.`, values: { link: `${getBusinessSiteUrl()}/join/${invite.token}` } };
  } catch (error) {
    return { error: errorMessage(error), values };
  }
}

export async function revokeInviteAction(id: string): Promise<{ error?: string }> {
  await requireBusinessOwner("/team");
  try {
    await revokeInvite(await createClient(), id);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(PORTAL_ROOT, "layout");
  return {};
}

export async function removeMemberAction(userId: string): Promise<{ error?: string }> {
  await requireBusinessOwner("/team");
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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { businessReportSchema, hideAd, reportBusiness, saveAd, setBusinessBlocked, startBusinessInquiry, type BusinessReportReason } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, safeNextPath } from "@/lib/utils";

/*
 * What a student does with a business's ad, post or profile. The database checks each (signed-in students only; a
 * business account can do none of it); what reaches the business is only ever counts.
 */

/** "Hide ad": it never shows to this student again. */
export async function hideAdAction(adId: string): Promise<{ error?: string }> {
  await requireUser("/");
  try {
    await hideAd(await createClient(), adId);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  return {};
}

export async function saveAdAction(adId: string, saved: boolean): Promise<{ error?: string }> {
  await requireUser("/");
  try {
    await saveAd(await createClient(), adId, saved);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/saved");
  return {};
}

/** A report to the UniBuzz team (never shown to the business); reporting an ad also hides it. */
export async function reportBusinessAction(
  target: { businessId?: string | null; adId?: string | null; dealId?: string | null },
  reason: BusinessReportReason,
  details?: string,
): Promise<{ error?: string }> {
  await requireUser("/");
  const parsed = businessReportSchema.safeParse({ reason, details });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a reason" };
  try {
    await reportBusiness(await createClient(), target, parsed.data.reason as BusinessReportReason, parsed.data.details ?? null);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  return {};
}

/** Block or unblock a business: its ads and posts disappear for the student, and it cannot be messaged. */
export async function setBusinessBlockedAction(businessId: string, blocked: boolean): Promise<{ error?: string }> {
  await requireUser(`/businesses/${businessId}`);
  try {
    await setBusinessBlocked(await createClient(), businessId, blocked);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(`/businesses/${businessId}`);
  revalidatePath("/");
  return {};
}

/**
 * "Message" on a business's profile or an ad: the student opens the chat (the business can only ever reply), and lands
 * in it. From an ad, the database also counts the ad's inquiry.
 */
export async function startBusinessChatAction(formData: FormData): Promise<void> {
  const targetType = formData.get("targetType") === "ad" ? "ad" : "business";
  const targetId = String(formData.get("targetId") ?? "");
  const back = safeNextPath(String(formData.get("back") ?? ""), "/");
  await requireUser(back);
  let conversationId: string;
  try {
    conversationId = await startBusinessInquiry(await createClient(), targetType, targetId);
  } catch (error) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect(`/messages/${conversationId}`);
}

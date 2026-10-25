"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import {
  deleteContentPermanently,
  deleteContentSchema,
  flattenZodError,
  hideContent,
  hideContentSchema,
  MODERATION_TARGET_TYPE_VALUES,
  reopenReport,
  resolveReport,
  resolveReportSchema,
  restoreContent,
  suspendUser,
  suspendUserSchema,
  unsuspendUser,
  type ModerationTargetType,
  type ReportDecision,
} from "@apartment-book/shared";
import { adminErrorMessage, requireStaffAction } from "@/lib/admin";
import { getServiceRoleKey } from "@/lib/env";
import { runMediaWorker } from "@/lib/media-worker";
import { createClient } from "@/lib/supabase/server";
import { formToObject, safeNextPath } from "@/lib/utils";
import { formValues, type FormState } from "./types";

/**
 * Moderation: suspensions, hiding/restoring/deleting content and the report queue.
 * Every action checks the caller here for a readable answer, then calls the shared
 * query whose RPC (migration 15) re-checks role, second factor and rank in SQL and
 * writes the audit row itself. Content changes also queue media jobs in the database;
 * the worker is kicked after the response so photos leave the public bucket at once.
 */

const uuid = z.uuid();
const targetType = z.enum(MODERATION_TARGET_TYPE_VALUES);
const optionalUuid = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), uuid.optional());

function target(formData: FormData): { type: ModerationTargetType; id: string } | null {
  const t = targetType.safeParse(formData.get("targetType"));
  const i = uuid.safeParse(formData.get("targetId"));
  return t.success && i.success ? { type: t.data, id: i.data } : null;
}

function reportIdFrom(formData: FormData): string | undefined {
  const parsed = optionalUuid.safeParse(formData.get("reportId") ?? undefined);
  return parsed.success ? parsed.data : undefined;
}

/** Run the media worker after the response went out, when the service role is configured. Best effort. */
function kickMediaWorker(): void {
  if (!getServiceRoleKey()) return;
  after(async () => {
    await runMediaWorker({ limit: 20, budgetMs: 25_000 }).catch(() => undefined);
  });
}

/** Close the report that led here with the decision that matches what was just done. A failure here must not hide the success. */
async function closeReport(reportId: string | undefined, decision: ReportDecision): Promise<string> {
  if (!reportId) return "";
  try {
    await resolveReport(await createClient(), reportId, decision, null);
    revalidatePath("/reports");
    revalidatePath(`/reports/${reportId}`);
    return " The report was resolved.";
  } catch (error) {
    return ` The report could not be resolved automatically (${adminErrorMessage(error)}); close it by hand.`;
  }
}

function revalidateContent(type: ModerationTargetType, id: string): void {
  revalidatePath("/");
  revalidatePath("/content");
  revalidatePath(`/content/${type}/${id}`);
  revalidatePath("/media");
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export async function suspendUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const gate = await requireStaffAction();
  if (gate.error) return { error: gate.error, values: formValues(formData) };
  const userId = uuid.safeParse(formData.get("userId"));
  if (!userId.success) return { error: "Unknown user.", values: formValues(formData) };
  const input = formToObject(formData);
  // "7 days" from the form becomes an instant here; a picked date arrives already converted by the browser.
  const days = Number(input.durationDays);
  if (Number.isInteger(days) && days > 0 && days <= 3650) input.expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const parsed = suspendUserSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await suspendUser(await createClient(), userId.data, { reason: parsed.data.reason, expiresAt: parsed.data.expiresAt ?? null, note: parsed.data.note ?? null });
  } catch (error) {
    return { error: adminErrorMessage(error), values: formValues(formData) };
  }
  const note = await closeReport(reportIdFrom(formData), "user_suspended");
  revalidatePath("/");
  revalidatePath("/users");
  revalidatePath(`/users/${userId.data}`);
  return { success: `Account suspended. Their current session can no longer post, message or upload, and their next sign-in is refused.${note}` };
}

export async function unsuspendUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const gate = await requireStaffAction();
  if (gate.error) return { error: gate.error, values: formValues(formData) };
  const userId = uuid.safeParse(formData.get("userId"));
  if (!userId.success) return { error: "Unknown user.", values: formValues(formData) };
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000) || null;
  try {
    await unsuspendUser(await createClient(), userId.data, note);
  } catch (error) {
    return { error: adminErrorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/");
  revalidatePath("/users");
  revalidatePath(`/users/${userId.data}`);
  return { success: "Suspension lifted. Their content is visible again and they can sign in." };
}

// ---------------------------------------------------------------------------
// Content: reversible hiding first, permanent deletion separately
// ---------------------------------------------------------------------------

export async function hideContentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const gate = await requireStaffAction();
  if (gate.error) return { error: gate.error, values: formValues(formData) };
  const t = target(formData);
  if (!t) return { error: "Unknown content.", values: formValues(formData) };
  const parsed = hideContentSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await hideContent(await createClient(), t.type, t.id, parsed.data.reason);
  } catch (error) {
    return { error: adminErrorMessage(error), values: formValues(formData) };
  }
  kickMediaWorker();
  const note = await closeReport(reportIdFrom(formData), "content_hidden");
  revalidateContent(t.type, t.id);
  return { success: `Hidden. It is gone from feeds, search and detail pages; the owner still sees it with your reason. Photos and videos are being moved out of reach.${note}` };
}

export async function restoreContentAction(type: string, id: string): Promise<{ error?: string }> {
  const gate = await requireStaffAction();
  if (gate.error) return { error: gate.error };
  const t = targetType.safeParse(type);
  const i = uuid.safeParse(id);
  if (!t.success || !i.success) return { error: "Unknown content." };
  try {
    await restoreContent(await createClient(), t.data, i.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  kickMediaWorker();
  revalidateContent(t.data, i.data);
  revalidatePath("/reports");
  return {};
}

export async function deleteContentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error, values: formValues(formData) };
  const t = target(formData);
  if (!t) return { error: "Unknown content.", values: formValues(formData) };
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") return { error: "Type DELETE to confirm. This cannot be undone.", values: formValues(formData) };
  const parsed = deleteContentSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await deleteContentPermanently(await createClient(), t.type, t.id, parsed.data.reason);
  } catch (error) {
    return { error: adminErrorMessage(error), values: formValues(formData) };
  }
  kickMediaWorker();
  const reportId = reportIdFrom(formData);
  await closeReport(reportId, "content_deleted");
  revalidateContent(t.type, t.id);
  revalidatePath("/reports");
  redirect(reportId ? `/reports/${reportId}?deleted=1` : safeNextPath(String(formData.get("returnTo") ?? ""), "/content?deleted=1"));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function resolveReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const gate = await requireStaffAction();
  if (gate.error) return { error: gate.error, values: formValues(formData) };
  const id = uuid.safeParse(formData.get("reportId"));
  if (!id.success) return { error: "Unknown report.", values: formValues(formData) };
  const parsed = resolveReportSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await resolveReport(await createClient(), id.data, parsed.data.decision, parsed.data.notes ?? null);
  } catch (error) {
    return { error: adminErrorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath(`/reports/${id.data}`);
  return { success: parsed.data.decision === "dismissed" ? "Report dismissed." : "Report resolved." };
}

export async function reopenReportAction(id: string): Promise<{ error?: string }> {
  const gate = await requireStaffAction();
  if (gate.error) return { error: gate.error };
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { error: "Unknown report." };
  try {
    await reopenReport(await createClient(), parsed.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath(`/reports/${parsed.data}`);
  return {};
}

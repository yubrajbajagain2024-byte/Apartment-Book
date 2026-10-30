"use server";

/**
 * The Business section's writes (migration 59, and Business v2's own review functions, which it reuses). Each one first
 * checks the rule for running businesses: an owner or admin of the staff (requireStaffAction), in a session signed in
 * with a second factor, with the UniBuzz admin role on the account. The database checks the caller again on every call
 * (console_*: ts_require_admin and the role; Business v2's: is_admin()) and writes the audit rows; these wrappers only
 * shape the input and the answer.
 */
import { revalidatePath } from "next/cache";
import {
  adApprovalSchema, adReasonSchema, adminApproveAd, adminPauseAd, adminRejectAd, adminResolveBusinessReport, adminResumeAd, adminReviewBusiness,
  adminSetVerified, flattenZodError, parseDollars, type BusinessDecision,
} from "@apartment-book/shared";
import { requireStaffAction } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";
import type { AdRate, ConsoleAd, ConsoleBusinessNote, ConsolePayment } from "./ops-types";
import { consoleRpc, toConsoleError, type ActionResult } from "./rpc";
import { hasBusinessRole } from "./server";

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
/** Text a form sent, or "" for anything else (an action is a public endpoint: its arguments are whatever was posted). */
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEMENTS = new Set(["for_you", "reels", "housing"]);

/** Why this session may not run businesses, or null when it may. */
async function refusal(): Promise<{ ok: false; code: string; error: string } | null> {
  const staff = await requireStaffAction({ minRole: "admin" });
  if (staff.error) return { ok: false, code: "forbidden", error: staff.error };
  if (!(await hasBusinessRole())) return { ok: false, code: "forbidden", error: "Business tools also need the UniBuzz admin role on your account." };
  return null;
}

/** This app's pages (the website and the portal render every request afresh; they need no revalidation from here). */
function revalidate() {
  revalidatePath("/", "layout");
}

/** A console_* function (errors 'ts:<code>:<message>'). */
async function consoleCall<T>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const refused = await refusal();
  if (refused) return refused;
  try {
    const data = await consoleRpc<T>(await createClient(), fn, args);
    revalidate();
    return { ok: true, data };
  } catch (e) {
    const err = toConsoleError(e);
    return { ok: false, code: err.code, error: err.message };
  }
}

/** One of Business v2's functions through its shared query (plain errors, in the portal's words). */
async function businessCall(work: () => Promise<unknown>): Promise<ActionResult<null>> {
  const refused = await refusal();
  if (refused) return refused;
  try {
    await work();
  } catch (e) {
    return { ok: false, code: "failed", error: errorMessage(e) };
  }
  revalidate();
  return { ok: true, data: null };
}

// --- Advertisers ------------------------------------------------------------------------------------------------------

/** Approve, reject, suspend or send back to review (Business v2's admin_review_business: approval needs a confirmed owner). */
export async function reviewBusinessAction(businessId: string, decision: BusinessDecision, note: string): Promise<ActionResult<null>> {
  const refused = await refusal();
  if (refused) return refused;
  if (!UUID.test(businessId) || !["approved", "rejected", "suspended", "pending"].includes(decision)) return { ok: false, code: "validation_failed", error: "Pick a decision." };
  return businessCall(async () => adminReviewBusiness(await createClient(), businessId, decision, str(note, 1000)?.trim() || null));
}

/** Verified Partner, with what was checked; or the mark taken away. */
export async function verifyBusinessAction(businessId: string, verified: boolean, evidence: string): Promise<ActionResult<null>> {
  const refused = await refusal();
  if (refused) return refused;
  if (!UUID.test(businessId)) return { ok: false, code: "validation_failed", error: "No such business." };
  return businessCall(async () => adminSetVerified(await createClient(), businessId, verified === true, str(evidence, 1000)?.trim() || null));
}

export async function addBusinessNoteAction(businessId: string, body: string): Promise<ActionResult<ConsoleBusinessNote[]>> {
  return consoleCall<ConsoleBusinessNote[]>("console_add_business_note", { p_business: str(businessId, 64), p_body: str(body, 2000) });
}

// --- Campaigns --------------------------------------------------------------------------------------------------------

export interface CreateAdInput {
  businessId: string;
  name: string;
  objective: string;
  placements: string[];
  universityIds: string[];
  headline: string;
  caption: string;
  cta: string;
  ctaUrl: string;
  /** "deal:<id>", "apartment:<id>" or "". */
  promoted: string;
  budget: string;
  startsAt: number | null;
  endsAt: number | null;
  note: string;
}

/** A draft prepared for the business (it adds photos if it likes, and submits it: the spend stays its decision). */
export async function createAdForBusinessAction(input: CreateAdInput): Promise<ActionResult<ConsoleAd>> {
  const refused = await refusal();
  if (refused) return refused;
  const budget = text(input?.budget);
  const budgetCents = budget ? parseDollars(budget) : 0;
  if (budgetCents === null) return { ok: false, code: "validation_failed", error: "Enter the budget in dollars, like 250 or 99.50." };
  const [kind, id] = text(input.promoted).split(":");
  return consoleCall<ConsoleAd>("console_create_ad", {
    p_business: str(input.businessId, 64),
    p_input: {
      name: str(input.name, 120),
      objective: str(input.objective, 20),
      placements: (Array.isArray(input.placements) ? input.placements : []).filter((p) => PLACEMENTS.has(p)),
      universityIds: (Array.isArray(input.universityIds) ? input.universityIds : []).filter((u) => typeof u === "string" && UUID.test(u)).slice(0, 50),
      headline: str(input.headline, 120),
      caption: str(input.caption, 2400),
      cta: str(input.cta, 30),
      ctaUrl: str(input.ctaUrl, 2000),
      promotedDealId: kind === "deal" && id && UUID.test(id) ? id : null,
      promotedApartmentId: kind === "apartment" && id && UUID.test(id) ? id : null,
      budgetCents,
      startsAt: ms(input.startsAt),
      endsAt: ms(input.endsAt),
      note: str(input.note, 1000),
    },
  });
}

/** Dates and budget of an ad in review, scheduled, running or paused, with the reason the business reads. */
export async function updateAdTermsAction(input: { adId: string; startsAt: number | null; endsAt: number | null; budget: string; reason: string }): Promise<ActionResult<ConsoleAd>> {
  const refused = await refusal();
  if (refused) return refused;
  const budget = text(input?.budget);
  const budgetCents = budget ? parseDollars(budget) : null;
  if (budget && budgetCents === null) return { ok: false, code: "validation_failed", error: "Enter the budget in dollars, like 250 or 99.50." };
  return consoleCall<ConsoleAd>("console_update_ad_terms", {
    p_ad: str(input.adId, 64),
    p_starts_at: ms(input.startsAt),
    p_ends_at: ms(input.endsAt),
    p_budget_cents: budgetCents,
    p_reason: str(input.reason, 1000),
  });
}

/**
 * Approves an ad by recording its payment (Business v2's admin_approve_ad). The admin app holds no service key for this,
 * so a Reels ad's video is not measured at the provider here (the portal's admin page does): the reviewer looks at it,
 * and the database approves no video ad without migration 55's guard.
 */
export async function approveConsoleAdAction(adId: string, input: { amount: string; currency: string; paymentReference: string; note: string; fairHousingChecked: boolean }): Promise<ActionResult<null>> {
  const refused = await refusal();
  if (refused) return refused;
  const parsed = adApprovalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "validation_failed", error: Object.values(flattenZodError(parsed.error).fieldErrors).flat()[0] ?? "Check the payment details." };
  return businessCall(async () => adminApproveAd(await createClient(), adId, parsed.data));
}

export async function rejectConsoleAdAction(adId: string, reason: string): Promise<ActionResult<null>> {
  const refused = await refusal();
  if (refused) return refused;
  const parsed = adReasonSchema.safeParse({ reason });
  if (!parsed.success) return { ok: false, code: "validation_failed", error: parsed.error.issues[0]?.message ?? "Say why." };
  return businessCall(async () => adminRejectAd(await createClient(), adId, parsed.data.reason));
}

/** Pauses a scheduled or running ad for a policy reason (only the UniBuzz team resumes it), or, with null, resumes it. */
export async function pauseConsoleAdAction(adId: string, reason: string | null): Promise<ActionResult<null>> {
  const refused = await refusal();
  if (refused) return refused;
  if (reason === null) return businessCall(async () => adminResumeAd(await createClient(), adId));
  const parsed = adReasonSchema.safeParse({ reason });
  if (!parsed.success) return { ok: false, code: "validation_failed", error: parsed.error.issues[0]?.message ?? "Say why." };
  return businessCall(async () => adminPauseAd(await createClient(), adId, parsed.data.reason));
}

// --- Payments and pricing ---------------------------------------------------------------------------------------------

/** A further payment for an approved ad; the note is for the team (its audit log), not the business. */
export async function recordAdPaymentAction(input: { adId: string; amount: string; currency: string; reference: string; note: string }): Promise<ActionResult<ConsoleAd>> {
  const refused = await refusal();
  if (refused) return refused;
  const amountCents = parseDollars(text(input?.amount));
  if (!amountCents) return { ok: false, code: "validation_failed", error: "Enter the amount received, like 250 or 99.50." };
  return consoleCall<ConsoleAd>("console_record_ad_payment", {
    p_ad: str(input.adId, 64),
    p_amount_cents: amountCents,
    p_currency: str(input.currency, 3) || "USD",
    p_reference: str(input.reference, 200),
    p_note: str(input.note, 1000),
  });
}

export async function voidPaymentAction(paymentId: string, reason: string): Promise<ActionResult<{ payment: ConsolePayment; adEnded: boolean }>> {
  return consoleCall("console_void_ad_payment", { p_payment: str(paymentId, 64), p_reason: str(reason, 900) });
}

/** A placement's daily rate per campus and its minimum, in dollars; an empty daily rate removes the price. */
export async function setAdRateAction(placement: string, daily: string, minimum: string): Promise<ActionResult<AdRate[]>> {
  const refused = await refusal();
  if (refused) return refused;
  if (!PLACEMENTS.has(placement)) return { ok: false, code: "validation_failed", error: "Pick a placement." };
  const dailyText = text(daily);
  const minimumText = text(minimum);
  const dailyCents = dailyText ? parseDollars(dailyText, 1_000_000) : null;
  if (dailyText && dailyCents === null) return { ok: false, code: "validation_failed", error: "Enter the daily rate in dollars (up to $10,000)." };
  const minimumCents = minimumText ? parseDollars(minimumText) : 0;
  if (minimumCents === null) return { ok: false, code: "validation_failed", error: "Enter the minimum in dollars (up to $100,000)." };
  return consoleCall<AdRate[]>("console_set_ad_rate", { p_placement: placement, p_daily_cents: dailyCents, p_minimum_cents: minimumCents });
}

// --- Students' reports ------------------------------------------------------------------------------------------------

export async function resolveBusinessReportAction(reportId: string, status: "actioned" | "dismissed", note: string): Promise<ActionResult<null>> {
  const refused = await refusal();
  if (refused) return refused;
  if (!UUID.test(reportId) || (status !== "actioned" && status !== "dismissed")) return { ok: false, code: "validation_failed", error: "Pick an outcome." };
  return businessCall(async () => adminResolveBusinessReport(await createClient(), reportId, status, str(note, 1000)?.trim() || null));
}

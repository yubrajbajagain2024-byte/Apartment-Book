"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  confirmTotpEnrollment,
  flattenZodError,
  getMfaStatus,
  removeMfaFactor,
  startTotpEnrollment,
  totpCodeSchema,
  verifyTotp,
  type FieldErrors,
  type TotpEnrollment,
} from "@apartment-book/shared";
import { adminErrorMessage, requireStaffAction } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject, safeNextPath } from "@/lib/utils";

/**
 * Two-factor authentication for staff (Supabase Auth TOTP). Enrolment and verification
 * happen at aal1 by design, so these actions gate with `mfa: false`; removing a verified
 * authenticator needs aal2 (a Supabase rule, and ours). After a code is verified the
 * session is re-issued with aal2 and `@supabase/ssr` writes the new cookies from here.
 * Turning an authenticator on or off reaches the audit log through a database trigger
 * on auth.mfa_factors (migration 14), so nothing in this file writes to the log.
 */

export type MfaFormState = {
  step: "idle" | "enrolling";
  /** Kept across a wrong code so the user does not have to scan a new QR code. */
  enrollment?: TotpEnrollment;
  error?: string;
  fieldErrors?: FieldErrors;
} | null;

const WRONG_ENROLLMENT_CODE = "That code did not work. Check the time on your phone and try again.";

/** Supabase rejects a wrong TOTP code with the `mfa_verification_failed` code ("Invalid TOTP code entered"). */
function isWrongCode(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && error.code === "mfa_verification_failed") return true;
  return /invalid (totp )?code/i.test(errorMessage(error, ""));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState always passes (state, formData)
export async function startEnrollmentAction(_prev: MfaFormState, _formData: FormData): Promise<MfaFormState> {
  const gate = await requireStaffAction({ mfa: false });
  if (gate.error) return { step: "idle", error: gate.error };
  try {
    const supabase = await createClient();
    // A session that has not passed the existing authenticator must not be able to add another one.
    const status = await getMfaStatus(supabase);
    if (status.enrolled && !status.verified) return { step: "idle", error: "Enter the code from your current authenticator first." };
    const enrollment = await startTotpEnrollment(supabase);
    return { step: "enrolling", enrollment };
  } catch (error) {
    return { step: "idle", error: adminErrorMessage(error) };
  }
}

export async function confirmEnrollmentAction(prev: MfaFormState, formData: FormData): Promise<MfaFormState> {
  // Whatever happens, keep the enrolment the user is looking at (the secret cannot be fetched
  // again), but not the previous error: a stale field error would hide the new message.
  const keep: NonNullable<MfaFormState> = { step: "enrolling", enrollment: prev?.enrollment };
  const gate = await requireStaffAction({ mfa: false });
  if (gate.error) return { ...keep, error: gate.error };
  const factorId = String(formData.get("factorId") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const parsed = totpCodeSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    const fieldErrors = flattenZodError(parsed.error).fieldErrors;
    return { ...keep, error: fieldErrors.code?.[0] ?? "Enter the 6-digit code from your authenticator app", fieldErrors };
  }
  try {
    const supabase = await createClient();
    // The id must name one of the user's own factors that still waits for its first code;
    // stepping up with an existing authenticator is verifyMfaAction's job, not an enrolment.
    const status = await getMfaStatus(supabase);
    if (!factorId || !status.factors.some((f) => f.id === factorId && f.status === "unverified")) {
      return { ...keep, error: "This setup has expired. Start again from the beginning." };
    }
    await confirmTotpEnrollment(supabase, factorId, parsed.data.code);
  } catch (error) {
    return { ...keep, error: isWrongCode(error) ? WRONG_ENROLLMENT_CODE : adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  redirect(next);
}

export async function verifyMfaAction(_prev: MfaFormState, formData: FormData): Promise<MfaFormState> {
  const gate = await requireStaffAction({ mfa: false });
  if (gate.error) return { step: "idle", error: gate.error };
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const parsed = totpCodeSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    const fieldErrors = flattenZodError(parsed.error).fieldErrors;
    return { step: "idle", error: fieldErrors.code?.[0] ?? "Enter the 6-digit code from your authenticator app", fieldErrors };
  }
  try {
    const supabase = await createClient();
    // Pick the authenticator server-side; a factor id from the browser is never trusted.
    const status = await getMfaStatus(supabase);
    const factor = status.factors.find((f) => f.status === "verified");
    if (!factor) return { step: "idle", error: "No authenticator is set up yet. Set one up first." };
    await verifyTotp(supabase, factor.id, parsed.data.code);
  } catch (error) {
    return { step: "idle", error: isWrongCode(error) ? "Incorrect code. Try again." : adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  redirect(next);
}

export async function removeFactorAction(factorId: string): Promise<{ error?: string }> {
  const gate = await requireStaffAction({ mfa: true });
  if (gate.error) return { error: gate.error };
  try {
    const supabase = await createClient();
    const status = await getMfaStatus(supabase);
    if (!factorId || !status.factors.some((f) => f.id === factorId)) return { error: "That authenticator is not on your account." };
    await removeMfaFactor(supabase, factorId);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  return {};
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { flattenZodError, getMfaStatus, type FieldErrors } from "@apartment-book/shared";
import { adminErrorMessage, requireStaffAction } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";

export type PasswordState = { error?: string; fieldErrors?: FieldErrors } | null;

const schema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters").max(72, "Use at most 72 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], error: "The two passwords are not the same" });

/**
 * Set the signed-in staff member's password. Staff only; a member with two-factor needs
 * this session to have passed it (as /password itself requires). A new member continues
 * to /security, where two-factor setup is mandatory before anything else works.
 */
export async function setPasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const gate = await requireStaffAction({ mfa: false });
  if (gate.error) return { error: gate.error };
  const supabase = await createClient();
  let enrolled: boolean;
  try {
    const status = await getMfaStatus(supabase);
    if (status.enrolled && !status.verified) return { error: "Enter your two-factor code on the Security page first." };
    enrolled = status.enrolled;
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  const parsed = schema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors };
  const user = await getCurrentUser();
  const local = (user?.email ?? "").split("@")[0].toLowerCase();
  if (local.length >= 4 && parsed.data.password.toLowerCase().includes(local)) {
    return { error: "Please fix the highlighted fields.", fieldErrors: { password: ["Do not use your email address in the password"] } };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const message = errorMessage(error);
    if (/reauthenticat/i.test(message)) return { error: "For security, Supabase asks for a fresh sign-in before changing the password. Ask for a new reset email and use it right away." };
    if (/weak|pwned|leaked|characters/i.test(message)) return { error: "Please fix the highlighted fields.", fieldErrors: { password: [message] } };
    return { error: message };
  }
  redirect(enrolled ? "/" : "/security?next=/");
}

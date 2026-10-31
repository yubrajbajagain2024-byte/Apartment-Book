"use server";

import { redirect } from "next/navigation";
import { flattenZodError, signInSchema, type FieldErrors } from "@apartment-book/shared";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject, safeNextPath } from "@/lib/utils";

export type AuthState = { error?: string; fieldErrors?: FieldErrors; values?: Record<string, string> } | null;

/**
 * Signing in only proves who you are. Whether you may use this app is decided afterwards
 * by the database (staff row + second factor); a student who signs in here lands on
 * /no-access. There is no sign-up: staff accounts are created on the website or by an
 * owner's invitation.
 */
export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const values = { email: String(formData.get("email") ?? "") };
  const parsed = signInSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    const friendly =
      error.message === "Invalid login credentials"
        ? "Incorrect email or password."
        : /banned/i.test(error.message)
          ? "This account is suspended."
          : error.message;
    return { error: friendly, values };
  }
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(errorMessage(error, "Google sign-in is not available."))}`);
  }
  redirect(data.url);
}

/** Ends this browser's admin session only: the same account's website and app sessions are separate and stay. */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

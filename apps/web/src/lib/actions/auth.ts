"use server";

import { redirect } from "next/navigation";
import { createSignUpSchema, flattenZodError, getAllowedEmailDomains, signInSchema, type FieldErrors } from "@apartment-book/shared";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject, safeNextPath } from "@/lib/utils";

export type AuthState = {
  error?: string;
  success?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
} | null;

function stringValues(formData: FormData, keys: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) values[key] = String(formData.get(key) ?? "");
  return values;
}

/** "Database error saving new user" is what Supabase returns when the email domain trigger rejects a sign-up. */
export async function friendlyAuthError(message: string): Promise<string> {
  if (/database error saving new user/i.test(message)) {
    return "Only verified university email addresses can join. Please use your @txstate.edu email.";
  }
  return message;
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const values = stringValues(formData, ["fullName", "email"]);
  const supabase = await createClient();
  const domains = await getAllowedEmailDomains(supabase).catch(() => [] as string[]);
  const parsed = createSignUpSchema(domains).safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values };
  }
  const next = safeNextPath(String(formData.get("next") ?? ""), "/settings/profile?welcome=1");
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { error: await friendlyAuthError(error.message), values };

  // When email confirmation is on, Supabase returns a user with no identities
  // for an address that is already registered.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: "An account with this email already exists. Try logging in instead.", values };
  }

  if (data.session) redirect(next);

  return {
    success: `We sent a confirmation link to ${parsed.data.email}. Open it to activate your account.`,
  };
}

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const values = stringValues(formData, ["email"]);
  const parsed = signInSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    const friendly =
      error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message;
    return { error: friendly, values };
  }

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const domains = await getAllowedEmailDomains(supabase).catch(() => [] as string[]);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
      // Ask Google to show only accounts from the university domain.
      queryParams: domains.length === 1 ? { hd: domains[0] } : undefined,
    },
  });
  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(errorMessage(error, "Google sign-in is not available."))}`);
  }
  redirect(data.url);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

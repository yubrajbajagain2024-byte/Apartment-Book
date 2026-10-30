import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { STAFF_ROLES, type Database, type AdminStaffRole } from "@apartment-book/shared";
import { getSiteUrl, getSupabaseEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import { errorMessage } from "@/lib/utils";

/**
 * Emails that let staff in: invitations (Supabase Auth's inviteUserByEmail, sent through
 * the project's SMTP settings) and password-reset links. Both land on this app's
 * /auth/confirm, never on the student website, and continue to /password and then
 * /security (mandatory two-factor). This module uses the service-role key for the
 * invitation only; it never runs the media worker (see mediaWorkerEnabled()).
 */

export type EmailSendResult = { status: "sent"; userId: string | null } | { status: "failed"; error: string } | { status: "not_configured" };

/** Where the link in the email leads. Built from this app's configured URL, never from request headers. */
export function staffLinkRedirect(next: "/password" = "/password"): string {
  return `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;
}

/** Plain-language reasons for what Supabase Auth answers when it cannot send. */
export function emailErrorMessage(error: unknown): string {
  const raw = errorMessage(error, "The email could not be sent.");
  if (/invalid api key|no api key|user not allowed|not_admin/i.test(raw)) {
    return "This app's Supabase key (SUPABASE_SERVICE_ROLE_KEY on the admin Vercel project) is wrong: Supabase refused it. Replace it with the service_role key from Supabase (Project Settings → API Keys) and redeploy (README: Invitation emails).";
  }
  if (/rate limit|too many/i.test(raw)) {
    return "Supabase's email limit was reached. Its built-in email service sends only a few emails per hour; set up custom SMTP in Supabase (Authentication → Emails) and try again later.";
  }
  if (/not authori[sz]ed|not part of|team member/i.test(raw)) {
    return "Supabase's built-in email service only delivers to members of your Supabase organization. Set up custom SMTP in Supabase (Authentication → Emails) to email anyone.";
  }
  if (/already (been )?registered|email_exists|already exists/i.test(raw)) {
    return "An account with this address already exists and is confirmed, so there is nothing to invite. Withdraw the invitation and add the person again: they join the team at once.";
  }
  if (/error sending|smtp|535|550|authentication failed|connection/i.test(raw)) {
    return `Supabase could not send the email. Check the SMTP settings in Supabase (Authentication → Emails). Details: ${raw}`;
  }
  return raw;
}

function roleLabel(role: AdminStaffRole): string {
  return STAFF_ROLES.find((r) => r.value === role)?.label ?? role;
}

/**
 * Ask Supabase Auth to send the invitation email. Supabase creates the invitee's account at
 * once (unconfirmed, no password); the link confirms the address. The account id comes back
 * so the database can bind the invitation to it (admin_invite_email_result).
 * not_configured: this deployment has no service-role key, so nothing was sent.
 */
export async function sendInvitationEmail(email: string, role: AdminStaffRole): Promise<EmailSendResult> {
  const admin = createServiceClient();
  if (!admin) return { status: "not_configured" };
  try {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: staffLinkRedirect("/password"),
      // Shown in the email template as {{ .Data.invited_as }}. Informational only: nothing trusts user metadata.
      data: { invited_as: roleLabel(role) },
    });
    if (error) return { status: "failed", error: emailErrorMessage(error) };
    return { status: "sent", userId: data.user?.id ?? null };
  } catch (error) {
    return { status: "failed", error: emailErrorMessage(error) };
  }
}

/**
 * Send a password-reset email to a team member (the caller's rank is checked by the action).
 * A separate client with the implicit flow: a PKCE link would only work in the browser that
 * asked for it (the admin's), not in the team member's.
 */
export async function sendPasswordResetEmail(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { url, anonKey } = getSupabaseEnv();
  const client = createSupabaseClient<Database>(url, anonKey, { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false } });
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: staffLinkRedirect("/password") });
    if (error) return { ok: false, error: emailErrorMessage(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: emailErrorMessage(error) };
  }
}

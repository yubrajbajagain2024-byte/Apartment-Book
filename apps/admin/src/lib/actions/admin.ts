"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addStaff,
  canChangeMember,
  flattenZodError,
  formatDate,
  listStaff,
  recordInviteEmail,
  removeStaff,
  resendStaffInvite,
  revokeStaffInvite,
  setStaffRole,
  staffAddSchema,
  STAFF_ROLES,
  STAFF_ROLE_VALUES,
  type StaffRole,
} from "@apartment-book/shared";
import { adminErrorMessage, requireStaffAction } from "@/lib/admin";
import { sendInvitationEmail, sendPasswordResetEmail } from "@/lib/invitations";
import { createClient } from "@/lib/supabase/server";
import { formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

/**
 * Team management. Every action first checks the caller here (admin or owner, with a
 * verified second factor), then calls the shared query whose RPC re-checks everything
 * in SQL. The checks here only give a readable answer sooner; the database decides.
 * Invitation emails are sent by Supabase Auth (lib/invitations.ts) and their outcome is
 * recorded in the database, which binds the invitation to the account the email created.
 */

const userIdSchema = z.uuid();
const roleSchema = z.enum(STAFF_ROLE_VALUES);
const emailSchema = staffAddSchema.shape.email;
const INVITE_DAYS = 7;

const label = (role: StaffRole) => STAFF_ROLES.find((r) => r.value === role)?.label ?? role;

type Delivery = { kind: "sent" } | { kind: "failed"; error: string } | { kind: "not_configured" } | { kind: "unrecorded"; error: string };

/** Send the invitation email and record the outcome in the database (as the calling admin). */
async function deliverInvitation(email: string, role: StaffRole): Promise<Delivery> {
  const supabase = await createClient();
  const result = await sendInvitationEmail(email, role);
  if (result.status === "not_configured") return { kind: "not_configured" };
  try {
    await recordInviteEmail(supabase, { email, ok: result.status === "sent", userId: result.status === "sent" ? result.userId : null, error: result.status === "failed" ? result.error : null });
  } catch (error) {
    if (result.status === "sent") return { kind: "unrecorded", error: adminErrorMessage(error) };
  }
  return result.status === "sent" ? { kind: "sent" } : { kind: "failed", error: result.error };
}

function deliveryMessage(email: string, role: StaffRole, delivery: Delivery): FormState {
  const until = formatDate(new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString());
  switch (delivery.kind) {
    case "sent":
      return {
        success: `Invitation email sent to ${email} for the ${label(role)} role. The link in it works for the time set in Supabase (one hour unless changed); the invitation stays open until ${until} and can be sent again. Opening the link confirms the address; then they choose a password and set up two-factor authentication before they can do anything.`,
      };
    case "failed":
      return { error: `The invitation for ${email} is saved, but the email was not sent. ${delivery.error} Use "Send again" under Pending invitations once that is fixed.` };
    case "not_configured":
      return {
        error: `The invitation for ${email} is saved, but no email was sent: this deployment cannot send email yet (SUPABASE_SERVICE_ROLE_KEY is not set on the admin app). Until it can, they join only by signing up with that address and confirming it.`,
      };
    case "unrecorded":
      return { error: `The invitation email to ${email} was sent, but its status could not be saved (${delivery.error}). Refresh the page; if it still says "not sent", use "Send again".` };
  }
}

export async function addStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error, values: formValues(formData) };
  const parsed = staffAddSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  const { email, role } = parsed.data;
  let result: "added" | "invited";
  try {
    result = await addStaff(await createClient(), parsed.data);
  } catch (error) {
    return { error: adminErrorMessage(error), values: formValues(formData) };
  }
  if (result === "added") {
    revalidatePath("/", "layout");
    return {
      success: `${email} already had a confirmed account and is now ${label(role)}. No email is needed: they sign in to this app with their usual password, and two-factor setup is required before they can do anything.`,
    };
  }
  const delivery = await deliverInvitation(email, role);
  revalidatePath("/", "layout");
  return deliveryMessage(email, role, delivery);
}

/** Renew a pending invitation for 7 more days and send its email again. */
export async function resendInviteAction(email: string): Promise<{ error?: string; success?: string }> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error };
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return { error: "No invitation for that address" };
  let role: StaffRole;
  try {
    role = await resendStaffInvite(await createClient(), parsedEmail.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  const delivery = await deliverInvitation(parsedEmail.data, role);
  revalidatePath("/", "layout");
  const message = deliveryMessage(parsedEmail.data, role, delivery);
  return message?.success ? { success: message.success } : { error: message?.error };
}

export async function setStaffRoleAction(userId: string, role: StaffRole): Promise<{ error?: string }> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error };
  const parsedId = userIdSchema.safeParse(userId);
  if (!parsedId.success) return { error: "Not a staff member" };
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { error: "Invalid role" };
  try {
    await setStaffRole(await createClient(), parsedId.data, parsedRole.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function removeStaffAction(userId: string): Promise<{ error?: string }> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error };
  const parsedId = userIdSchema.safeParse(userId);
  if (!parsedId.success) return { error: "Not a staff member" };
  try {
    await removeStaff(await createClient(), parsedId.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  return {};
}

/** Withdraw a pending invitation; the database also deletes the unused account its email created. */
export async function revokeInviteAction(email: string): Promise<{ error?: string; success?: string }> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (gate.error) return { error: gate.error };
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return { error: "No invitation for that address" };
  let accountRemoved: boolean;
  try {
    accountRemoved = await revokeStaffInvite(await createClient(), parsedEmail.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/", "layout");
  return {
    success: accountRemoved
      ? `Invitation for ${parsedEmail.data} withdrawn, and the unused account its email created was deleted: the link in that email no longer works.`
      : `Invitation for ${parsedEmail.data} withdrawn.`,
  };
}

/**
 * Email a password-reset link to a team member the caller may manage (owners: anyone else,
 * admins: moderators). For someone who lost their session before choosing a password, or
 * forgot it. The link leads to /password; a member with two-factor must enter a code first.
 */
export async function sendPasswordResetAction(userId: string): Promise<{ error?: string; success?: string }> {
  const gate = await requireStaffAction({ minRole: "admin" });
  if (!gate.access) return { error: gate.error };
  const parsedId = userIdSchema.safeParse(userId);
  if (!parsedId.success) return { error: "Not a staff member" };
  let member;
  try {
    member = (await listStaff(await createClient())).find((m) => m.userId === parsedId.data);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  if (!member || !member.email) return { error: "Not a staff member" };
  if (!canChangeMember(gate.access, member)) return { error: "Not allowed" };
  const sent = await sendPasswordResetEmail(member.email);
  if (!sent.ok) return { error: `The reset email was not sent. ${sent.error}` };
  return { success: `Password-reset email sent to ${member.email}. The link works for the time set in Supabase; it leads to this app's password page, and two-factor stays required.` };
}

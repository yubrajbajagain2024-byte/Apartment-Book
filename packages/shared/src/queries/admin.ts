import { STAFF_ROLE_VALUES, type AdminStaffRole } from "../constants";
import type { AuditEntry, Client, InviteEmailStatus, StaffAccess, StaffInvite, StaffMember } from "../types/models";
import { MODERATION_AUDIT_LABELS } from "./admin-moderation";

/**
 * Staff and team management for the admin app. Every function here calls a security-definer RPC
 * from migration 14 that re-checks, in SQL, that the caller is staff with a high
 * enough role and that the session passed two-factor authentication (aal2).
 * Nothing on the client is trusted; the pure helpers at the bottom only hide
 * actions the database would refuse anyway.
 */

/** The signed-in user's staff row, or null for ordinary users. Works before the second factor is verified. */
export async function getMyStaffAccess(supabase: Client): Promise<StaffAccess | null> {
  const { data, error } = await supabase.rpc("admin_me");
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { userId: row.user_id, role: row.role as AdminStaffRole, mfaVerified: row.mfa_verified, mfaEnrolled: row.mfa_enrolled, lastOwner: row.last_owner };
}

/** Everyone on the team, owners first (moderator+, aal2). For a moderator, mfaEnrolled is null on every row but their own. */
export async function listStaff(supabase: Client): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc("admin_staff_list");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    avatarUrl: r.avatar_url,
    role: r.role as AdminStaffRole,
    grantedBy: r.granted_by,
    grantedByName: r.granted_by_name,
    createdAt: r.created_at,
    mfaEnrolled: r.mfa_enrolled,
  }));
}

/** Invitations waiting for the address to confirm an account, with their email and expiry state (admin+, aal2; moderators get "Not allowed"). */
export async function listStaffInvites(supabase: Client): Promise<StaffInvite[]> {
  const { data, error } = await supabase.rpc("admin_invites_list");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    email: r.email,
    role: r.role as AdminStaffRole,
    invitedBy: r.invited_by,
    invitedByName: r.invited_by_name,
    createdAt: r.created_at,
    expiresAt: r.expires_at ?? null,
    expired: r.expired === true,
    emailStatus: (["not_sent", "sent", "failed"].includes(r.email_status) ? r.email_status : "not_sent") as InviteEmailStatus,
    emailSentAt: r.email_sent_at ?? null,
    emailAttempts: Number(r.email_attempts ?? 0),
    emailError: r.email_error ?? null,
    accountCreated: r.account_created === true,
  }));
}

/**
 * Record what happened to an invitation email (admin+, aal2; the same rank rule as withdrawing). When it was sent,
 * pass the id of the account Supabase created for the address: the database checks it belongs to this invitation
 * and from then on only that account can claim it.
 */
export async function recordInviteEmail(supabase: Client, input: { email: string; ok: boolean; userId?: string | null; error?: string | null }): Promise<void> {
  const { error } = await supabase.rpc("admin_invite_email_result", { p_email: input.email, p_ok: input.ok, p_user_id: input.userId ?? null, p_error: input.error ?? null });
  if (error) throw error;
}

/** Renew a pending invitation for another 7 days before its email is sent again (admin+, aal2). Returns its role. */
export async function resendStaffInvite(supabase: Client, email: string): Promise<AdminStaffRole> {
  const { data, error } = await supabase.rpc("admin_invite_resend", { p_email: email });
  if (error) throw error;
  return data as AdminStaffRole;
}

/**
 * Add someone by email (admin+, aal2; admins may only grant moderator). A confirmed
 * account joins at once ("added"); anyone else is invited and joins on confirmation ("invited").
 */
export async function addStaff(supabase: Client, input: { email: string; role: AdminStaffRole }): Promise<"added" | "invited"> {
  const { data, error } = await supabase.rpc("admin_staff_add", { p_email: input.email, p_role: input.role });
  if (error) throw error;
  return data === "added" ? "added" : "invited";
}

/** Change a member's role (admin+, aal2; nobody changes their own). */
export async function setStaffRole(supabase: Client, userId: string, role: AdminStaffRole): Promise<void> {
  const { error } = await supabase.rpc("admin_staff_set_role", { p_user_id: userId, p_role: role });
  if (error) throw error;
}

/** Take someone off the team (admin+, aal2; nobody removes themselves; the last owner is protected). */
export async function removeStaff(supabase: Client, userId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_staff_remove", { p_user_id: userId });
  if (error) throw error;
}

/** Withdraw a pending invitation (admin+, aal2). Returns whether the unused account its email created was deleted too. */
export async function revokeStaffInvite(supabase: Client, email: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_invite_revoke", { p_email: email });
  if (error) throw error;
  return data === true;
}

/** Audit entries, newest first. Pass the smallest id you have as `before` to load older rows (moderator+, aal2). */
export async function listAuditLog(supabase: Client, opts: { limit?: number; before?: number | null } = {}): Promise<AuditEntry[]> {
  const { data, error } = await supabase.rpc("admin_audit_list", { p_limit: opts.limit ?? 50, p_before: opts.before ?? null });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    actorName: r.actor_name,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details !== null && typeof r.details === "object" && !Array.isArray(r.details) ? (r.details as Record<string, unknown>) : {},
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Pure helpers mirroring the SQL rules so the UI can hide impossible actions.
// The database stays the authority: it re-checks every one of these.
// ---------------------------------------------------------------------------

/** Owners may grant any role; admins only moderator; moderators none. */
export function canAssignRole(caller: AdminStaffRole, target: AdminStaffRole): boolean {
  if (caller === "owner") return true;
  if (caller === "admin") return target === "moderator";
  return false;
}

/** The roles `caller` may pick when adding someone or changing a role, in rank order. */
export function assignableStaffRoles(caller: AdminStaffRole): AdminStaffRole[] {
  return STAFF_ROLE_VALUES.filter((role) => canAssignRole(caller, role));
}

/** Whether `caller` may change or remove `member`: never themselves; owners anyone else; admins only moderators. */
export function canChangeMember(caller: StaffAccess | { role: AdminStaffRole; userId: string }, member: { role: AdminStaffRole; userId: string }): boolean {
  if (caller.userId === member.userId) return false;
  if (caller.role === "owner") return true;
  if (caller.role === "admin") return member.role === "moderator";
  return false;
}

const AUDIT_ACTION_LABELS = new Map<string, string>([
  ["owner.bootstrap", "First owner set up"],
  ["invite.accepted", "Joined the team from an invitation"],
  ["invite.held", "Invitation held for review"],
  ["staff.add", "Added to the team"],
  ["staff.role", "Role changed"],
  ["staff.remove", "Removed from the team"],
  ["invite.create", "Invitation sent"],
  ["invite.revoke", "Invitation withdrawn"],
  ["invite.email_sent", "Invitation email sent"],
  ["invite.email_failed", "Invitation email failed"],
  ["invite.resend", "Invitation renewed"],
  ["invite.expired", "Expired invitation not accepted"],
  ["security.mfa_enrolled", "Two-factor authentication turned on"],
  ["security.mfa_removed", "Two-factor authentication turned off"],
  // Business (migration 62): the team's own records; the business's actions are in the Business section's audit log.
  ["business.note", "Note added to a business"],
  ["ad_rate.set", "Rate card changed"],
  ["ad.payment_recorded", "Further ad payment recorded"],
]);

/** Human label for an audit `action` (team, security and moderation actions); unknown actions come back unchanged. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS.get(action) ?? MODERATION_AUDIT_LABELS.get(action) ?? action;
}

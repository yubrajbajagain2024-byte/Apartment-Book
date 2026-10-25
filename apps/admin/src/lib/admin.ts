import { cache } from "react";
import { redirect } from "next/navigation";
import { getMyRestriction, getMyStaffAccess, STAFF_ROLE_RANK, type StaffAccess, type StaffRole } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";

/**
 * Access layer of the admin app. Every layout, page and server action goes through
 * here. The database stays the authority: the RPCs in migrations 14 to 16 re-check the
 * caller's role and two-factor status (JWT claim aal2) in SQL, so these helpers only
 * decide what to render and where to send people. The proxy (src/proxy.ts) adds a
 * first, cheap gate in front of everything: no session, no page; no aal2, /security.
 */

/** Staff row of the signed-in user, or null (not signed in / not staff / suspended). Cached per request. Errors propagate. */
export const getStaffAccess = cache(async (): Promise<StaffAccess | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const [access, restriction] = await Promise.all([getMyStaffAccess(supabase), getMyRestriction(supabase).catch(() => null)]);
  // A suspended staff member has no admin powers (every RPC refuses them).
  if (!access || restriction) return null;
  return access;
});

export type RequireStaffOptions = {
  /** Lowest role that may pass. Default "moderator", i.e. any staff member. */
  minRole?: StaffRole;
  /** Require a session that verified the second factor (aal2). Default true; only the Security page turns it off. */
  mfa?: boolean;
};

/** Whether `access` is at least `minRole` (owner > admin > moderator). */
export function hasRole(access: StaffAccess, minRole: StaffRole): boolean {
  return STAFF_ROLE_RANK[access.role] >= STAFF_ROLE_RANK[minRole];
}

/**
 * For pages and layouts. Signed out → login, coming back to `nextPath`; not staff →
 * /no-access (a clear answer: this app is for staff only); staff whose session has
 * not verified the second factor → /security; role too low → the overview with a note.
 * Database errors propagate so a broken connection never looks like "not staff".
 */
export async function requireStaff(nextPath: string, opts: RequireStaffOptions = {}): Promise<StaffAccess> {
  const { minRole = "moderator", mfa = true } = opts;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const access = await getStaffAccess();
  if (!access) redirect("/no-access");
  if (mfa && !access.mfaVerified) redirect(`/security?next=${encodeURIComponent(nextPath)}`);
  if (!hasRole(access, minRole)) redirect(`/?denied=${minRole}`);
  return access;
}

/** For server actions: the same checks as `requireStaff`, returned as an error instead of a redirect. */
export async function requireStaffAction(
  opts: RequireStaffOptions = {},
): Promise<{ access: StaffAccess; error?: undefined } | { access?: undefined; error: string }> {
  const { minRole = "moderator", mfa = true } = opts;
  const user = await getCurrentUser();
  if (!user) return { error: "Log in first." };
  let access: StaffAccess | null;
  try {
    access = await getStaffAccess();
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  if (!access) return { error: "Not allowed." };
  if (mfa && !access.mfaVerified) return { error: "Verify your two-factor code first." };
  if (!hasRole(access, minRole)) return { error: `You need the ${minRole} role for that.` };
  return { access };
}

/**
 * Human message for an error from the admin RPCs. The messages the migrations raise on
 * purpose ("Not allowed", "You cannot remove yourself", ...) are written for people and
 * pass through unchanged; the aal2 check gets the wording the Security page uses.
 */
export function adminErrorMessage(error: unknown): string {
  const message = errorMessage(error, "");
  if (message === "Two-factor authentication required") return "Verify your two-factor code first.";
  return errorMessage(error);
}

/**
 * Whether `me` may suspend or unsuspend `target`: never yourself, and a staff target
 * needs a strictly higher role. The same rule migration 15 applies in SQL.
 */
export function canModerateUser(me: StaffAccess, target: { userId: string; staffRole: StaffRole | null }): boolean {
  if (me.userId === target.userId) return false;
  if (!target.staffRole) return true;
  return STAFF_ROLE_RANK[me.role] > STAFF_ROLE_RANK[target.staffRole];
}

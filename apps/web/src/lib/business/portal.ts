import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { canUsePortal, getMyBusiness, isBusinessRole, roleOf, standingOf, teamRoleAllows, type BusinessCapability, type BusinessStanding, type MyBusiness, type ProfileWithUniversity, type UserRole } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { getBusinessHost, getBusinessSiteUrl, getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { joinPortal, PORTAL_PREFIX } from "./paths";

/** The prefix the portal's links need for this request: "" on the portal's own host, "/business" on the site. Set by the proxy. */
export const getPortalBase = cache(async (): Promise<string> => {
  const base = (await headers()).get("x-portal-base");
  return base === null ? PORTAL_PREFIX : base;
});

/** A portal path as this request should link to it. */
export async function portalPath(path: string): Promise<string> {
  return joinPortal(await getPortalBase(), path);
}

/**
 * Where Supabase sends people after an email link for a portal sign-up: the portal's own host when it has one,
 * otherwise the site's callback with the portal page as the next step.
 */
export function portalCallbackUrl(nextPortalPath = "/"): string {
  if (getBusinessHost()) return `${getBusinessSiteUrl()}/auth/callback?next=${encodeURIComponent(nextPortalPath)}`;
  return `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(joinPortal(PORTAL_PREFIX, nextPortalPath))}`;
}

export type PortalSession = {
  user: User;
  profile: ProfileWithUniversity;
  role: UserRole;
  /** The business and the person's place on its team; null for an admin, or a business account no longer on a team. */
  membership: MyBusiness | null;
};

/** The signed-in person as the portal sees them, or null. Cached per request. */
export const getPortalSession = cache(async (): Promise<PortalSession | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const role = roleOf(profile);
  const membership = isBusinessRole(role) ? await getMyBusiness(await createClient()).catch(() => null) : null;
  return { user, profile, role, membership };
});

/** Signed in, whatever the role: the portal layout decides what a student or an unattached account sees. */
export async function requirePortalSession(nextPath = "/"): Promise<PortalSession> {
  const session = await getPortalSession();
  if (!session) redirect(await portalPath(`/login?next=${encodeURIComponent(nextPath)}`));
  return session;
}

/**
 * A member of a business (owner or staff) whose business's standing allows this page: by default pending (drafting) or
 * approved. Anyone else is sent to the portal's front page, which says where they stand. The database enforces the
 * same standings on every request; this only keeps the pages honest.
 */
export async function requireBusiness(nextPath = "/", allowed: BusinessStanding[] = ["pending", "approved"]): Promise<PortalSession & { membership: MyBusiness }> {
  const session = await requirePortalSession(nextPath);
  if (!session.membership || !canUsePortal(session.role)) redirect(await portalPath("/"));
  if (!allowed.includes(standingOf(session.membership.business))) redirect(await portalPath("/"));
  return session as PortalSession & { membership: MyBusiness };
}

/** The standings in which a capability works (as business_can() in migration 49 has them). */
function standingsFor(capability: BusinessCapability): BusinessStanding[] {
  if (capability === "reply" || capability === "manage_ads") return ["approved"];
  if (capability === "edit_profile") return ["pending", "approved", "rejected"];
  return ["pending", "approved"];
}

/**
 * A member whose role and the business's standing allow this (migration 49's table: an analyst only views and reads
 * the numbers, an editor publishes and replies, the owner and admins also run the team, the profile and ad spend).
 * Anyone else goes to the portal's front page. The database decides every request on its own; this keeps pages honest.
 */
export async function requireCapability(capability: BusinessCapability, nextPath = "/"): Promise<PortalSession & { membership: MyBusiness }> {
  const session = await requireBusiness(nextPath, standingsFor(capability));
  if (!teamRoleAllows(session.membership.role, capability)) redirect(await portalPath("/"));
  return session;
}

/** The business's owner: the profile and the team are theirs to manage. */
export async function requireBusinessOwner(nextPath = "/", allowed: BusinessStanding[] = ["pending", "approved"]): Promise<PortalSession & { membership: MyBusiness }> {
  const session = await requireBusiness(nextPath, allowed);
  if (session.membership.role !== "owner") redirect(await portalPath("/"));
  return session;
}

export async function requireAdmin(nextPath = "/admin"): Promise<PortalSession> {
  const session = await requirePortalSession(nextPath);
  if (session.role !== "admin") redirect(await portalPath("/"));
  return session;
}

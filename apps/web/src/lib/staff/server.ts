import "server-only";
import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getStaffRole, roleOf, type Client } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { staffRpc, toStaffError } from "./rpc";
import type {
  AdCounts, AdRate, AdsAnalytics, AnalyticsOverview, BusinessCounts, BusinessOpsOverview, ConsoleAd, ConsoleAdRow, ConsoleBusiness, ConsoleBusinessRow,
  ConsolePage, PaymentsPage, RevenueAnalytics,
} from "./ops-types";
import type {
  AuditRow, ModerationMetrics, QueueCounts, QueueView, RulePackState, StaffAppeal, StaffPage, StaffQueueItem, StaffQueueItemDetail, StaffRole,
  StaffUserDetail,
} from "./types";

export interface StaffViewer {
  id: string;
  role: StaffRole;
  name: string;
  username: string | null;
  supabase: Client;
}

/** Where staff confirm it's them with their authenticator app before the console opens. */
export const STAFF_TWO_FACTOR_PATH = "/two-factor";

/**
 * The signed-in staff member, or Next's notFound() for everyone else (signed out included): the console answers
 * "not found" like the database does, never "forbidden". Staff whose session has not passed two-factor sign-in (aal2)
 * go to STAFF_TWO_FACTOR_PATH first; the database checks the same (CampConnect Admin's rule). Cached per request.
 */
export const requireStaff = cache(async (): Promise<StaffViewer> => {
  const user = await getCurrentUser();
  if (!user) notFound();
  const supabase = await createClient();
  const role = await viewerRole();
  if (!role) notFound();
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel !== "aal2") redirect(STAFF_TWO_FACTOR_PATH);
  const profile = await getCurrentProfile();
  return { id: user.id, role, name: profile?.full_name || "Staff", username: profile?.username ?? null, supabase };
});

/** The caller's staff role, or null (signed out, or not staff). Cached per request. */
export const viewerRole = cache(async (): Promise<StaffRole | null> => {
  if (!(await getCurrentUser())) return null;
  const role = await getStaffRole(await createClient()).catch(() => null);
  return role === "moderator" || role === "admin" ? role : null;
});

/**
 * Page metadata that names the console only to staff: everyone else gets the plain not-found page, and its title must
 * not say "Trust & Safety" either (the console answers like a page that does not exist).
 */
export async function staffMetadata(title: string): Promise<Metadata> {
  const robots = { index: false, follow: false };
  return (await viewerRole()) ? { title, robots } : { robots };
}

/** A staff function's answer, with "not found" turned into Next's notFound() (an item you may not see does not exist). */
export async function staffFetch<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { supabase } = await requireStaff();
  try {
    return await staffRpc<T>(supabase, fn, args);
  } catch (e) {
    const code = toStaffError(e).code;
    if (code === "not_found") notFound();
    // The token still says aal2 but its factor is gone (deleted in the dashboard): set one up again.
    if (code === "mfa_required") redirect(STAFF_TWO_FACTOR_PATH);
    throw e;
  }
}

export interface QueueFilters {
  surface?: string;
  category?: string;
  source?: string;
  universityId?: string;
  q?: string;
}

export const fetchQueue = (view: QueueView, offset: number, limit: number, filters: QueueFilters) =>
  staffFetch<StaffPage<StaffQueueItem>>("console_queue", { p_view: view, p_limit: limit, p_offset: offset, p_filters: filters });
export const fetchQueueCounts = cache(() => staffFetch<QueueCounts>("console_queue_counts"));
export const fetchQueueItem = (id: string) => staffFetch<StaffQueueItemDetail>("console_queue_item", { p_id: id });
export const fetchAudit = (offset: number, limit: number, filters: Record<string, string | number>) =>
  staffFetch<StaffPage<AuditRow>>("console_audit", { p_limit: limit, p_offset: offset, p_filters: filters });
export const fetchUsers = (q: string, offset: number, limit: number) => staffFetch<StaffPage<StaffUserDetail>>("console_users", { p_q: q, p_limit: limit, p_offset: offset });
export const fetchUser = (id: string) => staffFetch<StaffUserDetail>("console_user", { p_id: id });
export const fetchAppeals = (view: string, offset: number, limit: number) => staffFetch<StaffPage<StaffAppeal>>("console_appeals", { p_view: view, p_limit: limit, p_offset: offset });
export const fetchMetrics = (from: number, to: number) => staffFetch<ModerationMetrics>("console_metrics", { p_from: from, p_to: to });
export const fetchRulePacks = () => staffFetch<RulePackState[]>("console_rule_packs");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Route params that cannot be an id are simply not found (the database would refuse the cast). */
export function requireUuid(id: string): string {
  if (!UUID.test(id)) notFound();
  return id;
}

// --- Analytics and Business (migration 59) ----------------------------------------------------------------------------

/** An admin of the staff (two-factor session included); moderators and everyone else get Next's notFound(). */
export async function requireStaffAdmin(): Promise<StaffViewer> {
  const me = await requireStaff();
  if (me.role !== "admin") notFound();
  return me;
}

/**
 * Whether this staff admin may run businesses and ads too: Business v2's review functions, which the Business section
 * reuses, also ask for the UniBuzz admin role on the account (profiles.role, granted by the database owner).
 */
export const hasBusinessRole = cache(async (): Promise<boolean> => roleOf(await getCurrentProfile()) === "admin");

/** A staff function's answer, or null where the database does not have the function yet (a migration not applied). */
export async function maybeDeployed<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (e) {
    if (toStaffError(e).code === "not_deployed") return null;
    throw e;
  }
}

export const fetchAnalyticsOverview = (days: number, universityId: string | null) =>
  staffFetch<AnalyticsOverview>("console_analytics_overview", { p_days: days, p_university: universityId });
export const fetchAdsAnalytics = (days: number, universityId: string | null) =>
  staffFetch<AdsAnalytics>("console_analytics_ads", { p_days: days, p_university: universityId });
export const fetchRevenueAnalytics = (days: number) => staffFetch<RevenueAnalytics>("console_analytics_revenue", { p_days: days });

export const fetchBusinessOpsOverview = cache(() => staffFetch<BusinessOpsOverview>("console_business_overview"));

/**
 * The Business tab's badge: ads in review, businesses whose owner confirmed and who wait for review, and open reports.
 * Null for anyone who cannot run businesses, or where migration 59 is not applied. It never ends the request (no
 * notFound() or redirect()): the tabs render whatever it says.
 */
export const fetchBusinessBadge = cache(async (): Promise<number | null> => {
  if ((await viewerRole()) !== "admin" || !(await hasBusinessRole())) return null;
  try {
    const o = await staffRpc<BusinessOpsOverview>(await createClient(), "console_business_overview");
    return o.ads.inReview + o.businesses.pendingConfirmed + o.reports.open;
  } catch {
    return null;
  }
});
export const fetchConsoleBusinesses = (q: string, status: string | null, offset: number, limit: number) =>
  staffFetch<ConsolePage<ConsoleBusinessRow, BusinessCounts>>("console_businesses", { p_q: q || null, p_status: status, p_limit: limit, p_offset: offset });
export const fetchConsoleBusiness = (id: string) => staffFetch<ConsoleBusiness>("console_business", { p_id: id });
export const fetchConsoleAds = (status: string, q: string, businessId: string | null, offset: number, limit: number) =>
  staffFetch<ConsolePage<ConsoleAdRow, AdCounts>>("console_ads", { p_status: status, p_q: q || null, p_business: businessId, p_limit: limit, p_offset: offset });
export const fetchConsoleAd = (id: string) => staffFetch<ConsoleAd>("console_ad", { p_id: id });
export const fetchConsolePayments = (days: number | null, status: string | null, q: string, offset: number, limit: number) =>
  staffFetch<PaymentsPage>("console_payments", { p_days: days, p_status: status, p_q: q || null, p_limit: limit, p_offset: offset });
export const fetchAdRates = () => staffFetch<AdRate[]>("console_ad_rates");

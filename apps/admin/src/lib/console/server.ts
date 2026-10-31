import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { roleOf, type Client, type StaffAccess } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AdCounts, AdRate, AdsAnalytics, AnalyticsOverview, BusinessCounts, BusinessOpsOverview, ConsoleAd, ConsoleAdRow, ConsoleBusiness, ConsoleBusinessRow,
  ConsolePage, PaymentsPage, RevenueAnalytics,
} from "./ops-types";
import { consoleRpc, toConsoleError } from "./rpc";

/**
 * Analytics and Business are for owners and admins of the staff in a session that passed two-factor sign-in (the
 * admin app's rule: requireStaff sends everyone else to log in, to /no-access, to /security or back to the overview).
 * Each console_* function checks the same in SQL (ts_require_admin, migration 41).
 */
export async function requireConsoleAdmin(nextPath: string): Promise<{ access: StaffAccess; supabase: Client }> {
  const access = await requireStaff(nextPath, { minRole: "admin" });
  return { access, supabase: await createClient() };
}

/**
 * Whether this admin may run businesses and ads too: Business v2's review functions, which the Business section
 * reuses, also ask for the UniBuzz admin role on the account (profiles.role, granted by the database owner).
 */
export const hasBusinessRole = cache(async (): Promise<boolean> => roleOf(await getCurrentProfile()) === "admin");

/** A console function's answer; "not found" becomes the not-found page, a missing second factor the Security page. */
export async function consoleFetch<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await consoleRpc<T>(await createClient(), fn, args);
  } catch (e) {
    const code = toConsoleError(e).code;
    if (code === "not_found") notFound();
    if (code === "mfa_required") redirect("/security");
    throw e;
  }
}

/** A console function's answer, or null where the database does not have it yet (migration 62 not applied). */
export async function maybeDeployed<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (e) {
    if (toConsoleError(e).code === "not_deployed") return null;
    throw e;
  }
}

export const fetchAnalyticsOverview = (days: number, universityId: string | null) =>
  consoleFetch<AnalyticsOverview>("console_analytics_overview", { p_days: days, p_university: universityId });
export const fetchAdsAnalytics = (days: number, universityId: string | null) =>
  consoleFetch<AdsAnalytics>("console_analytics_ads", { p_days: days, p_university: universityId });
export const fetchRevenueAnalytics = (days: number) => consoleFetch<RevenueAnalytics>("console_analytics_revenue", { p_days: days });

export const fetchBusinessOpsOverview = cache(() => consoleFetch<BusinessOpsOverview>("console_business_overview"));
export const fetchConsoleBusinesses = (q: string, status: string | null, offset: number, limit: number) =>
  consoleFetch<ConsolePage<ConsoleBusinessRow, BusinessCounts>>("console_businesses", { p_q: q || null, p_status: status, p_limit: limit, p_offset: offset });
export const fetchConsoleBusiness = (id: string) => consoleFetch<ConsoleBusiness>("console_business", { p_id: id });
export const fetchConsoleAds = (status: string, q: string, businessId: string | null, offset: number, limit: number) =>
  consoleFetch<ConsolePage<ConsoleAdRow, AdCounts>>("console_ads", { p_status: status, p_q: q || null, p_business: businessId, p_limit: limit, p_offset: offset });
export const fetchConsoleAd = (id: string) => consoleFetch<ConsoleAd>("console_ad", { p_id: id });
export const fetchConsolePayments = (days: number | null, status: string | null, q: string, offset: number, limit: number) =>
  consoleFetch<PaymentsPage>("console_payments", { p_days: days, p_status: status, p_q: q || null, p_limit: limit, p_offset: offset });
export const fetchAdRates = () => consoleFetch<AdRate[]>("console_ad_rates");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Route params that cannot be an id are simply not found. */
export function requireUuid(id: string): string {
  if (!UUID.test(id)) notFound();
  return id;
}

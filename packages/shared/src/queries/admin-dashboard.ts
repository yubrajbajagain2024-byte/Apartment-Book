import type { AdminStaffRole } from "../constants";
import type { AdminUserRow, Client, HiddenContentRow, ModerationTargetType, OverviewStats, ReportRow } from "../types/models";
import { mapReportRow } from "./admin-moderation";

/**
 * Read-only queries for the admin app's dashboard (migration 16). Every function
 * calls a security-definer RPC that re-checks, in SQL, that the caller is staff
 * (moderator or above) in a session that passed two-factor authentication.
 * Nothing here writes, and nothing here reveals a Buzz author.
 */

/**
 * True when the database does not have a function yet (PostgREST error PGRST202),
 * i.e. the migration behind it has not been applied. The admin app shows a setup
 * notice for that instead of an error page.
 */
export function isMissingFunctionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "PGRST202" || e.code === "42883") return true;
  return typeof e.message === "string" && /could not find the function|does not exist/i.test(e.message);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Counts for the overview page (moderator+, aal2). */
export async function getOverviewStats(supabase: Client): Promise<OverviewStats> {
  const { data, error } = await supabase.rpc("admin_overview_stats");
  if (error) throw error;
  const o = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    usersTotal: num(o.users_total),
    usersNew7d: num(o.users_new_7d),
    usersActive24h: num(o.users_active_24h),
    suspendedActive: num(o.suspended_active),
    reportsOpen: num(o.reports_open),
    reportsClosed7d: num(o.reports_closed_7d),
    hiddenContent: num(o.hidden_content),
    listingsTotal: num(o.listings_total),
    postsTotal: num(o.posts_total),
    buzzTotal: num(o.buzz_total),
    mediaPending: num(o.media_pending),
    mediaFailing: num(o.media_failing),
    staffTotal: num(o.staff_total),
  };
}

export type UsersFilter = "all" | "suspended" | "staff";

/** Browse people newest first (moderator+, aal2). Pass the oldest createdAt you have as `before` for older rows. Up to 200. */
export async function listUsers(supabase: Client, opts: { filter?: UsersFilter; limit?: number; before?: string | null } = {}): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc("admin_users_list", { p_filter: opts.filter ?? "all", p_limit: opts.limit ?? 50, p_before: opts.before ?? null });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    avatarUrl: r.avatar_url,
    universityName: r.university_name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    suspended: r.suspended,
    staffRole: r.staff_role as AdminStaffRole | null,
  }));
}

/** Hidden content, newest hide first (moderator+, aal2). `type` narrows to one kind; pass the oldest hiddenAt you have as `before`. Up to 200. */
export async function listHiddenContent(
  supabase: Client,
  opts: { type?: ModerationTargetType | null; limit?: number; before?: string | null } = {},
): Promise<HiddenContentRow[]> {
  const { data, error } = await supabase.rpc("admin_hidden_content_list", { p_type: opts.type ?? null, p_limit: opts.limit ?? 50, p_before: opts.before ?? null });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    targetType: r.target_type as ModerationTargetType,
    targetId: r.target_id,
    hiddenAt: r.hidden_at,
    hiddenReason: r.hidden_reason,
    title: r.title,
    preview: r.preview ?? "",
    authorId: r.author_id,
    authorName: r.author_name,
    createdAt: r.created_at,
  }));
}

/** One report for the review page (moderator+, aal2). Throws "Report not found". */
export async function getReport(supabase: Client, id: string): Promise<ReportRow> {
  const { data, error } = await supabase.rpc("admin_report_get", { p_id: id });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("Report not found");
  return mapReportRow(row);
}

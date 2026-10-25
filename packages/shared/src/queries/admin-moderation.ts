import type { StaffRole } from "../constants";
import type { Database } from "../types/database";
import type {
  AccountRestriction,
  Client,
  ContentSnapshot,
  MediaJob,
  MediaJobKind,
  MediaJobStats,
  ModerationTargetType,
  MyRestriction,
  ReportDecision,
  ReportRow,
  ReportStatus,
  UserDetail,
  UserRestriction,
  UserSearchResult,
} from "../types/models";

/**
 * Moderation for the admin app: suspensions, hiding and deleting
 * content, the report queue and the media clean-up queue. Every staff function
 * here calls a security-definer RPC from migration 15 that re-checks, in SQL,
 * that the caller is staff with a high enough role (moderator+ unless noted)
 * and that the session passed two-factor authentication (aal2). The database
 * writes every action to the audit log itself; nothing on the client is trusted.
 *
 * Two functions are for ordinary users (getMyRestriction, isSuspendedError) and
 * three are for the media worker, which runs with the service role.
 */

// ---------------------------------------------------------------------------
// Suspended accounts: what any signed-in user may know about their own
// ---------------------------------------------------------------------------

/** The signed-in user's own active suspension, or null. Any signed-in user; the apps show the "Your account is suspended" notice from it. */
export async function getMyRestriction(supabase: Client): Promise<MyRestriction | null> {
  const { data, error } = await supabase.rpc("my_restriction");
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { kind: row.kind, reason: row.reason, expiresAt: row.expires_at, createdAt: row.created_at };
}

/**
 * True when a write was refused because the account is suspended. The database
 * raises 'Your account is suspended' with hint ACCOUNT_SUSPENDED from every
 * insert and update trigger, so the apps can show the restriction notice instead
 * of a generic error. Works on the raw PostgREST error and on an Error wrapping it as `cause`.
 */
export function isSuspendedError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const e = current as { hint?: unknown; message?: unknown; cause?: unknown };
    if (e.hint === "ACCOUNT_SUSPENDED") return true;
    if (typeof e.message === "string" && e.message.includes("Your account is suspended")) return true;
    current = e.cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Suspensions (staff)
// ---------------------------------------------------------------------------

/**
 * Suspend someone (moderator+, aal2). A staff target needs a caller of a strictly
 * higher role, and nobody suspends themselves. `reason` (3 to 500 characters) is
 * shown to the person; `note` (up to 2,000) only to staff; `expiresAt` null means
 * until lifted. Suspending someone who already is updates the open suspension.
 * The person's current session loses every write at once and the next sign-in is
 * refused too. Returns the restriction id.
 */
export async function suspendUser(supabase: Client, userId: string, input: { reason: string; expiresAt?: string | null; note?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("admin_user_suspend", {
    p_user_id: userId,
    p_reason: input.reason,
    p_expires_at: input.expiresAt ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw error;
  return data;
}

/** Lift a suspension early (moderator+, aal2; the same rank rule as suspending). `note` (up to 2,000 characters) stays with the suspension, for staff. */
export async function unsuspendUser(supabase: Client, userId: string, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc("admin_user_unsuspend", { p_user_id: userId, p_note: note ?? null });
  if (error) throw error;
}

/** Suspensions, newest first (moderator+, aal2). Active ones only by default; `activeOnly: false` adds lifted and expired ones. Up to 200. */
export async function listRestrictions(supabase: Client, opts: { activeOnly?: boolean; limit?: number } = {}): Promise<AccountRestriction[]> {
  const { data, error } = await supabase.rpc("admin_restrictions_list", { p_active_only: opts.activeOnly ?? true, p_limit: opts.limit ?? 50 });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    kind: r.kind,
    reason: r.reason,
    internalNote: r.internal_note,
    expiresAt: r.expires_at,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    liftedAt: r.lifted_at,
    liftedByName: r.lifted_by_name,
    liftNote: r.lift_note,
    active: r.active,
  }));
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** Find people by name or email (moderator+, aal2). An exact email match comes first; an empty query returns no rows. Up to 50. */
export async function searchUsers(supabase: Client, q: string, limit = 20): Promise<UserSearchResult[]> {
  const { data, error } = await supabase.rpc("admin_user_search", { p_q: q, p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    avatarUrl: r.avatar_url,
    universityName: r.university_name,
    createdAt: r.created_at,
    suspended: r.suspended,
    staffRole: r.staff_role as StaffRole | null,
  }));
}

/** Everything on one person's admin page (moderator+, aal2): profile, counts, the active suspension and the full history. Throws "User not found". */
export async function getUserDetail(supabase: Client, userId: string): Promise<UserDetail> {
  const { data, error } = await supabase.rpc("admin_user_get", { p_user_id: userId });
  if (error) throw error;
  return mapUserDetail(data);
}

// ---------------------------------------------------------------------------
// Content: reversible hiding first, permanent deletion separately
// ---------------------------------------------------------------------------

/**
 * Hide content (moderator+, aal2). Reversible: the row stays, its owner still
 * sees it with the reason, everyone else stops seeing it, and its photos and
 * videos are queued for quarantine. `reason`: 3 to 500 characters.
 */
export async function hideContent(supabase: Client, targetType: ModerationTargetType, targetId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_content_hide", { p_target_type: targetType, p_target_id: targetId, p_reason: reason });
  if (error) throw error;
}

/** Undo a hide (moderator+, aal2) and queue the media back. Throws "Content is not hidden" otherwise. */
export async function restoreContent(supabase: Client, targetType: ModerationTargetType, targetId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_content_restore", { p_target_type: targetType, p_target_id: targetId });
  if (error) throw error;
}

/**
 * Delete content for good (admin+, aal2; moderators get "Not allowed"). The full
 * content goes into the audit log first; the row's cascades take comments, likes,
 * saves and votes, and its files and videos are queued for removal. `reason`: 3 to 500 characters.
 */
export async function deleteContentPermanently(supabase: Client, targetType: ModerationTargetType, targetId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_content_delete", { p_target_type: targetType, p_target_id: targetId, p_reason: reason });
  if (error) throw error;
}

/**
 * The content behind a report, for the review screen (moderator+, aal2). For Buzz
 * this reveals the author to staff on purpose, and every such look is logged as
 * content.view. Throws "Content not found".
 */
export async function getContentSnapshot(supabase: Client, targetType: ModerationTargetType, targetId: string): Promise<ContentSnapshot> {
  const { data, error } = await supabase.rpc("admin_content_get", { p_target_type: targetType, p_target_id: targetId });
  if (error) throw error;
  return mapContentSnapshot(data);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** The report queue, newest first (moderator+, aal2). `status` defaults to open; pass the oldest createdAt you have as `before` to load older rows. Up to 200. */
export async function listReports(supabase: Client, opts: { status?: ReportStatus | "all"; limit?: number; before?: string | null } = {}): Promise<ReportRow[]> {
  const { data, error } = await supabase.rpc("admin_reports_list", { p_status: opts.status ?? "open", p_limit: opts.limit ?? 50, p_before: opts.before ?? null });
  if (error) throw error;
  return (data ?? []).map(mapReportRow);
}

/** One row of admin_reports_list / admin_report_get as the apps use it. */
export function mapReportRow(r: Database["public"]["Functions"]["admin_reports_list"]["Returns"][number]): ReportRow {
  return {
    id: r.id,
    reporterId: r.reporter_id,
    reporterName: r.reporter_name,
    reporterEmail: r.reporter_email,
    targetType: r.target_type as ReportRow["targetType"],
    targetId: r.target_id,
    reason: r.reason,
    details: r.details,
    status: r.status as ReportStatus,
    decision: r.decision as ReportDecision | null,
    notes: r.notes,
    reviewedBy: r.reviewed_by,
    reviewerName: r.reviewer_name,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    targetPreview: r.target_preview ?? "",
    targetHidden: r.target_hidden,
    targetExists: r.target_exists,
    targetAuthorId: r.target_author_id,
  };
}

/** Close a report (moderator+, aal2) with what was done. "dismissed" sets its status to dismissed, every other decision to reviewed. `notes`: up to 2,000 characters, staff only. */
export async function resolveReport(supabase: Client, id: string, decision: ReportDecision, notes?: string | null): Promise<void> {
  const { error } = await supabase.rpc("admin_report_resolve", { p_id: id, p_decision: decision, p_notes: notes ?? null });
  if (error) throw error;
}

/** Put a report back in the open queue (moderator+, aal2), clearing its decision and notes. */
export async function reopenReport(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.rpc("admin_report_reopen", { p_id: id });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Media jobs: the clean-up queue
// ---------------------------------------------------------------------------

/** The media clean-up queue, newest first (moderator+, aal2). Pending jobs only by default; `pendingOnly: false` adds finished ones. Up to 200. */
export async function listMediaJobs(supabase: Client, opts: { pendingOnly?: boolean; limit?: number } = {}): Promise<MediaJob[]> {
  const { data, error } = await supabase.rpc("admin_media_jobs_list", { p_pending_only: opts.pendingOnly ?? true, p_limit: opts.limit ?? 50 });
  if (error) throw error;
  return (data ?? []).map(mapMediaJob);
}

/** Make a pending job due now and clear its last error (moderator+, aal2). Throws "Job not found" for a finished one. */
export async function retryMediaJob(supabase: Client, id: number): Promise<void> {
  const { error } = await supabase.rpc("admin_media_jobs_retry", { p_id: id });
  if (error) throw error;
}

/** Queue counts (moderator+, aal2): pending, failing (pending after three or more attempts) and done. */
export async function getMediaJobStats(supabase: Client): Promise<MediaJobStats> {
  const { data, error } = await supabase.rpc("admin_media_jobs_stats");
  if (error) throw error;
  const row = data?.[0];
  return { pending: Number(row?.pending ?? 0), failing: Number(row?.failing ?? 0), done: Number(row?.done ?? 0) };
}

/**
 * Claim due jobs for the media worker. SERVICE ROLE ONLY: the function is not
 * granted to users, so call it on the server with a service-role client.
 * Claiming bumps `attempts` and books the next try (10, 40, 90... minutes, capped
 * at six hours), so a job the worker never reports on simply comes back later.
 * The worker then calls completeMediaJob or failMediaJob for each one.
 */
export async function claimMediaJobs(supabase: Client, limit = 20): Promise<MediaJob[]> {
  const { data, error } = await supabase.rpc("media_jobs_claim", { p_limit: limit });
  if (error) throw error;
  return (data ?? []).map(mapMediaJob);
}

/** Mark a claimed job done (service role only). */
export async function completeMediaJob(supabase: Client, id: number): Promise<void> {
  const { error } = await supabase.rpc("media_jobs_done", { p_id: id });
  if (error) throw error;
}

/** Record why a claimed job failed (service role only); it is retried at its nextAttemptAt. The message is kept to 1,000 characters. */
export async function failMediaJob(supabase: Client, id: number, error: string): Promise<void> {
  const { error: rpcError } = await supabase.rpc("media_jobs_failed", { p_id: id, p_error: error });
  if (rpcError) throw rpcError;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Human labels for the audit actions migration 15 writes; check here before falling back to auditActionLabel(). */
export const MODERATION_AUDIT_LABELS: ReadonlyMap<string, string> = new Map<string, string>([
  ["user.suspend", "Account suspended"],
  ["user.unsuspend", "Suspension lifted"],
  ["content.hide", "Content hidden"],
  ["content.restore", "Content restored"],
  ["content.delete", "Content deleted permanently"],
  ["content.view", "Buzz author viewed"],
  ["report.resolve", "Report resolved"],
  ["report.reopen", "Report reopened"],
  ["media.retry", "Media job retried"],
]);

// ---------------------------------------------------------------------------
// Mapping the jsonb results (admin_user_get, admin_content_get) defensively
// ---------------------------------------------------------------------------

function asObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") return Number(v);
  return 0;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function mapUserRestriction(v: unknown): UserRestriction {
  const o = asObject(v);
  return {
    id: asString(o.id) ?? "",
    kind: asString(o.kind) ?? "suspension",
    reason: asString(o.reason) ?? "",
    internalNote: asString(o.internal_note),
    expiresAt: asString(o.expires_at),
    createdAt: asString(o.created_at) ?? "",
    createdBy: asString(o.created_by),
    createdByName: asString(o.created_by_name),
    liftedAt: asString(o.lifted_at),
    liftedBy: asString(o.lifted_by),
    liftedByName: asString(o.lifted_by_name),
    liftNote: asString(o.lift_note),
    active: o.active === true,
  };
}

function mapUserDetail(v: unknown): UserDetail {
  const o = asObject(v);
  const counts = asObject(o.counts);
  const active = o.active_restriction;
  return {
    userId: asString(o.user_id) ?? "",
    fullName: asString(o.full_name) ?? "",
    email: asString(o.email),
    avatarUrl: asString(o.avatar_url),
    bio: asString(o.bio),
    program: asString(o.program),
    university: asString(o.university),
    createdAt: asString(o.created_at) ?? "",
    lastSeenAt: asString(o.last_seen_at),
    staffRole: asString(o.staff_role) as StaffRole | null,
    bannedUntil: asString(o.banned_until),
    counts: {
      apartments: asNumber(counts.apartments),
      items: asNumber(counts.items),
      roommatePosts: asNumber(counts.roommate_posts),
      posts: asNumber(counts.posts),
      comments: asNumber(counts.comments),
      reportsFiled: asNumber(counts.reports_filed),
      reportsAgainst: asNumber(counts.reports_against),
    },
    activeRestriction: active !== null && typeof active === "object" ? mapUserRestriction(active) : null,
    restrictions: Array.isArray(o.restrictions) ? o.restrictions.map(mapUserRestriction) : [],
  };
}

function mapContentSnapshot(v: unknown): ContentSnapshot {
  const o = asObject(v);
  return {
    targetType: asString(o.target_type) as ModerationTargetType,
    targetId: asString(o.target_id) ?? "",
    authorId: asString(o.author_id),
    authorName: asString(o.author_name),
    authorEmail: asString(o.author_email),
    createdAt: asString(o.created_at) ?? "",
    hiddenAt: asString(o.hidden_at),
    hiddenReason: asString(o.hidden_reason),
    title: asString(o.title),
    body: asString(o.body) ?? "",
    images: asStringArray(o.images),
    videos: Array.isArray(o.videos) ? o.videos : [],
    extra: asObject(o.extra),
  };
}

function mapMediaJob(r: {
  id: number;
  kind: string;
  ref: string;
  target_type: string | null;
  target_id: string | null;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  claimed_at?: string | null;
  created_at: string;
  done_at: string | null;
}): MediaJob {
  return {
    id: Number(r.id),
    kind: r.kind as MediaJobKind,
    ref: r.ref,
    targetType: r.target_type,
    targetId: r.target_id,
    attempts: r.attempts,
    lastError: r.last_error,
    nextAttemptAt: r.next_attempt_at,
    claimedAt: r.claimed_at ?? null,
    createdAt: r.created_at,
    doneAt: r.done_at,
  };
}

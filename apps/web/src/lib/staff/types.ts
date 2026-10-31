/**
 * Payloads of the staff console's database functions (migration 20261103000000_trust_safety.sql, `console_*`), ported
 * from UniVerse's `shared/src/admin.ts`. They live in the website only: no staff payload type is bundled into the app.
 *
 * FIREWALL (UniVerse SPEC 4.2.14): a queue item has no author, reporter or user field of any kind, for any content
 * type. Buzz content is shown with a blind, bucketed author standing; only `UnmaskResponse` ever names a Buzz author,
 * and the console keeps it in component state for five minutes, never in a cache.
 */
import type { ModerationCategory, SanctionKind, SanctionScope, AppealStatus, StaffRole } from "@apartment-book/shared";

export type { StaffRole };

/** A page of a list; `nextOffset` is null at the end. */
export interface StaffPage<T> {
  items: T[];
  nextOffset: number | null;
}

export type QueueView = "priority" | "wellbeing" | "held" | "auto_hidden" | "reports" | "escalated" | "appeals" | "mine" | "closed";
export type QueueCounts = Record<QueueView, number>;
export type ModerationPriority = "p0" | "p1" | "p2" | "p3";
export type ModerationSeverity = "none" | "low" | "medium" | "high" | "critical";
export type ContentStatus = "active" | "held" | "hidden" | "removed" | "deleted";
export type QueueSource = "rule_flag" | "rule_block_escalation" | "ai_flag" | "user_report" | "community_score" | "appeal" | "system";
/** Content types: Buzz ('buzz', 'buzz_reply') is anonymous; the rest are public ('story' since migration 62). */
export type StaffEntityType = "buzz" | "buzz_reply" | "post" | "comment" | "apartment" | "item" | "roommate" | "profile" | "message" | "story";

export interface StaffQueueItem {
  id: string;
  entityType: StaffEntityType;
  /** null for a blocked write (it never became content; its text is the excerpt). */
  entityId: string | null;
  surface: string;
  /** Buzz content: shown blind. */
  anon: boolean;
  universityShortName: string;
  source: QueueSource;
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  priority: ModerationPriority;
  label: string | null;
  status: "open" | "claimed" | "escalated" | "closed";
  resolution: string | null;
  reportCount: number;
  appealId: string | null;
  /** ≤ 140 characters of the content (or the blocked text). */
  excerpt: string;
  contentStatus: ContentStatus | null;
  claimedByMe: boolean;
  claimedByOther: boolean;
  /** Epoch ms (Buzz items: cut to the minute). */
  slaDueAt: number;
  createdAt: number;
  closedAt: number | null;
}

/** A sanction as staff see it: no excerpt, no label; anon-origin rows are sealed and day-floored (admins only). */
export interface StaffSanctionRow {
  id: string;
  kind: SanctionKind | "removal";
  scope: SanctionScope;
  category: ModerationCategory | null;
  guidelineAnchor: string | null;
  startsAt: number;
  until: number | null;
  acknowledgedAt: number | null;
  liftedAt: number | null;
  /** A mute, suspension or ban holding the account right now. */
  inEffect: boolean;
  /** Not lifted, not over (and not a removal notice). */
  liftable: boolean;
  canAppeal: boolean;
  appealStatus: AppealStatus;
  appealDeadline: number | null;
  createdAt: number;
  origin: "public" | "anon";
}

export interface StaffUserSummary {
  id: string;
  fullName: string;
  username: string | null;
  avatarUrl: string | null;
}

/** Public content only. */
export interface StaffAuthorPanel {
  kind: "public";
  user: StaffUserSummary;
  accountAgeDays: number;
  strikePoints: number;
  sanctions: StaffSanctionRow[];
}

/** Buzz content (and anything without a known author): bucketed, no identifier of any kind. */
export interface StaffBlindAuthorPanel {
  kind: "blind";
  accountAge: "<24h" | "<7d" | "<30d" | "30d+";
  strikePoints: string;
  priorByCategory: Record<string, string>;
  sanction: SanctionKind | null;
  otherOpenItems: string;
}

export interface StaffMatchSignals {
  evasion?: boolean;
  invisibleChars?: number;
  homoglyphs?: number;
  urls?: number;
  mentions?: number;
  capsRatio?: number;
  hasFullName?: boolean;
}

export interface StaffQueueItemDetail extends StaffQueueItem {
  fields: { field: string; text: string; spans: [number, number][] }[];
  media: { url: string; kind: "image" | "video" }[];
  href: string | null;
  ruleHits: { ruleId: string; category: ModerationCategory | null; subcode: string | null; severity: ModerationSeverity | null }[];
  signals: StaffMatchSignals | null;
  aiVerdict: unknown;
  /** Buzz: the thread through the blind serializer ({ root, parents, siblings, … }). */
  context: unknown;
  reports: {
    id: string;
    reason: string;
    subReason: string | null;
    note: string | null;
    reporterTrust: "high" | "normal" | "low";
    /** Admins, public content only (audited). Never on Buzz. */
    reporter: StaffUserSummary | null;
    createdAt: number;
  }[];
  history: { action: string; actorRole: "moderator" | "admin" | "system"; actorName: string | null; note: string | null; createdAt: number }[];
  author: StaffAuthorPanel | StaffBlindAuthorPanel;
  suggestion: { action: StaffActionId; reason: string } | null;
  /** Buzz threads: whether replies are locked (when the thread context says). */
  locked: boolean | null;
  legalHold: boolean;
  /** Admins: the outside reference of an external escalation. */
  reference: string | null;
  canUnmask: boolean;
}

export type StaffActionId =
  | "approve" | "dismiss_reports" | "warn_only" | "remove" | "remove_and_warn" | "remove_and_mute_24h" | "remove_and_mute_72h"
  | "remove_and_mute_7d" | "lock_thread" | "unlock_thread" | "escalate" | "restore" | "suspend_7d" | "suspend_30d" | "ban"
  | "lift_sanction" | "escalate_external";

export type BulkActionId = Extract<StaffActionId, "approve" | "remove" | "dismiss_reports">;

export interface BulkActionResult {
  results: { id: string; ok: boolean; error?: string }[];
  batchId: string;
}

export type UnmaskReasonCode = "credible_threat" | "self_harm_emergency" | "child_safety" | "severe_repeat_harassment" | "legal_request" | "ban_evasion";

export interface UnmaskResponse {
  /** The buzz_unmask audit row. */
  auditId: string;
  /** Epoch ms: the console re-masks then. */
  expiresAt: number;
  user: { id: string; fullName: string; username: string | null; email: string | null; universityName: string | null; createdAt: number };
}

export interface AuditRow {
  id: string;
  actor: { id: string; displayName: string; role: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  queueId: string | null;
  batchId: string | null;
  reasonCode: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface StaffUserDetail {
  user: StaffUserSummary & { universityName: string | null; createdAt: number };
  /** Admins only. */
  email: string | null;
  role: "user" | StaffRole;
  /** As this viewer may see it (moderators: from public-origin sanctions only). */
  status: "active" | "suspended" | "banned";
  strikePoints: number;
  sanctions: StaffSanctionRow[];
  openQueueItems: number;
}

/** A raw anon-origin sanction id lifted: the answer names nobody. */
export interface BlindLiftResult {
  lifted: true;
  origin: "anon";
}

export interface StaffAppeal {
  id: string;
  sanction: StaffSanctionRow;
  contentExcerpt: string | null;
  contentLabel: string | null;
  text: string;
  status: Exclude<AppealStatus, "none">;
  createdAt: number;
  queueId: string | null;
  canReview: boolean;
}

export interface ModerationMetrics {
  range: { from: number; to: number };
  openByPriority: Record<ModerationPriority, number>;
  oldestOpenMin: number | null;
  timeToFirstAction: Record<ModerationPriority, { medianMin: number | null; p90Min: number | null; slaMin: number }>;
  rulePrecision: { ruleId: string; flagged: number; removed: number; approved: number }[];
  appealOverturnRate: number | null;
  autoHideReversalRate: { reports: number | null; score: number | null };
  activeSanctions: Record<SanctionKind, number>;
  unmasksByReason: Record<string, number>;
  wellbeingPerWeek: number;
  reportsInRange: number;
  moderatedWritesInRange: number;
  reportsPer1k: number;
  perDay: { day: string; actions: number; reports: number; opened: number }[];
}

export interface RulePackState {
  id: string;
  enabled: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

/**
 * The staff console's constants and copy, ported from UniVerse `shared/src/admin.ts` (+ UniBuzz's own limitations).
 * The database enforces the same rules (migration 20261103000000_trust_safety.sql: ts_action_def, console_unmask).
 */
import { BUZZ_REPORT_REASONS, MODERATION_CATEGORY_LABELS, type ModerationCategory } from "@apartment-book/shared";
import type { BulkActionId, ModerationPriority, QueueSource, QueueView, StaffActionId, UnmaskReasonCode } from "./types";

export const QUEUE_VIEWS: readonly { id: QueueView; label: string; adminOnly?: boolean }[] = [
  { id: "priority", label: "Priority" },
  { id: "wellbeing", label: "Wellbeing" },
  { id: "held", label: "Held" },
  { id: "auto_hidden", label: "Auto-hidden" },
  { id: "reports", label: "Reports" },
  { id: "escalated", label: "Escalated", adminOnly: true },
  { id: "appeals", label: "Appeals" },
  { id: "mine", label: "Mine" },
  { id: "closed", label: "Closed" },
];

export interface StaffActionDef {
  id: StaffActionId;
  label: string;
  /** The consequence, shown under the ladder. */
  detail: string;
  /** 'admin' = admins only (moderators are refused). */
  role: "mod" | "admin";
  /** A staff-only note of 10+ characters (a ban: 30+ and the typed word BAN). */
  needsNote: boolean;
  destructive?: boolean;
  /** Buzz threads only. */
  buzzThreadOnly?: boolean;
}

/** Ladder order (UniVerse safety 4.1 / 6.4). */
export const STAFF_ACTIONS: readonly StaffActionDef[] = [
  { id: "approve", label: "Approve", detail: "Content stays up and becomes immune to report-based auto-hide. Reports close as not violating.", role: "mod", needsNote: false },
  { id: "dismiss_reports", label: "Dismiss reports", detail: "Closes the reports without touching the content.", role: "mod", needsNote: false },
  { id: "warn_only", label: "Warn only", detail: "Content stays. The author must acknowledge a warning before their next post.", role: "mod", needsNote: true },
  { id: "remove", label: "Remove", detail: "Content is removed and a strike is recorded. Author and reporters are notified.", role: "mod", needsNote: true, destructive: true },
  { id: "remove_and_warn", label: "Remove + warn", detail: "Remove, strike, and a warning the author must acknowledge.", role: "mod", needsNote: true, destructive: true },
  { id: "remove_and_mute_24h", label: "Remove + mute 24h", detail: "Remove, strike, and a 24-hour mute of the author.", role: "mod", needsNote: true, destructive: true },
  { id: "remove_and_mute_72h", label: "Remove + mute 72h", detail: "Remove, strike, and a 72-hour mute of the author.", role: "mod", needsNote: true, destructive: true },
  { id: "remove_and_mute_7d", label: "Remove + mute 7d", detail: "Remove, strike, and a 7-day mute of the author.", role: "mod", needsNote: true, destructive: true },
  { id: "lock_thread", label: "Lock thread", detail: "No new replies on this Buzz thread. Content stays.", role: "mod", needsNote: true, buzzThreadOnly: true },
  { id: "unlock_thread", label: "Unlock thread", detail: "Replies open again on this Buzz thread.", role: "mod", needsNote: true, buzzThreadOnly: true },
  { id: "escalate", label: "Escalate to admin", detail: "Leaves the moderator queues. An admin decides.", role: "mod", needsNote: true },
  { id: "restore", label: "Restore", detail: "Reverses a removal: Buzz content back up, strike revoked, author notified. Deleted public content cannot come back.", role: "mod", needsNote: true },
  { id: "suspend_7d", label: "Suspend 7 days", detail: "The account cannot post, comment, list or message for 7 days. Content stays unless removed separately.", role: "admin", needsNote: true, destructive: true },
  { id: "suspend_30d", label: "Suspend 30 days", detail: "The account cannot post, comment, list or message for 30 days.", role: "admin", needsNote: true, destructive: true },
  { id: "ban", label: "Ban permanently", detail: "Permanent. The email can never register again. Type BAN to confirm.", role: "admin", needsNote: true, destructive: true },
  { id: "lift_sanction", label: "Lift sanction", detail: "Lifts the sanction tied to this item.", role: "admin", needsNote: true },
  { id: "escalate_external", label: "Escalate externally", detail: "Records that an outside authority was contacted; puts the content under legal hold.", role: "admin", needsNote: true },
];

export const BULK_ACTIONS: readonly { value: BulkActionId; label: string }[] = [
  { value: "approve", label: "Approve" },
  { value: "dismiss_reports", label: "Dismiss reports" },
  { value: "remove", label: "Remove" },
];

export const NOTE_MIN = 10;
export const BAN_NOTE_MIN = 30;

export const UNMASK_REASON_CODES: readonly UnmaskReasonCode[] = [
  "credible_threat", "self_harm_emergency", "child_safety", "severe_repeat_harassment", "legal_request", "ban_evasion",
];
export const UNMASK_REASON_LABELS: Record<UnmaskReasonCode, string> = {
  credible_threat: "Credible threat",
  self_harm_emergency: "Self-harm emergency",
  child_safety: "Child safety",
  severe_repeat_harassment: "Severe or repeated harassment",
  legal_request: "Valid legal request",
  ban_evasion: "Ban evasion",
};
export const UNMASK_REASON_MIN = 30;

export const CATEGORY_OPTIONS: readonly { value: ModerationCategory; label: string }[] = (Object.keys(MODERATION_CATEGORY_LABELS) as ModerationCategory[]).map((c) => ({
  value: c,
  label: MODERATION_CATEGORY_LABELS[c],
}));

export function categoryLabel(c: string | null | undefined): string {
  return c && c in MODERATION_CATEGORY_LABELS ? MODERATION_CATEGORY_LABELS[c as ModerationCategory] : "Uncategorised";
}

/** Report reasons: Buzz's (UniVerse's) and the older ones public content can still carry. */
const REASON_LABELS: Record<string, string> = {
  ...Object.fromEntries(BUZZ_REPORT_REASONS.map((r) => [r.id, r.label])),
  spam: "Spam or misleading",
  scam: "Scam or fraud",
  inappropriate: "Inappropriate content",
};
export function reasonLabel(r: string): string {
  return REASON_LABELS[r] ?? r;
}

export const SURFACE_LABEL: Record<string, string> = {
  buzz: "Buzz",
  buzz_reply: "Buzz reply",
  buzz_poll: "Buzz poll",
  post: "Post",
  comment: "Comment",
  apartment: "Apartment",
  item: "Marketplace",
  roommate: "Roommate post",
  profile: "Profile",
  message: "Message",
};
export function surfaceLabel(s: string): string {
  return SURFACE_LABEL[s] ?? s;
}

export const SOURCE_LABEL: Record<QueueSource, string> = {
  rule_flag: "Rule flag",
  rule_block_escalation: "Blocked + escalated",
  ai_flag: "AI flag",
  user_report: "Reports",
  community_score: "Community score",
  appeal: "Appeal",
  system: "System",
};

export const PRIORITY_LABEL: Record<ModerationPriority, string> = { p0: "P0", p1: "P1", p2: "P2", p3: "P3" };

export const STAFF_SANCTION_LABELS: Record<string, string> = {
  warning: "Warning",
  mute: "Mute",
  suspension: "Suspension",
  ban: "Ban",
  removal: "Removal",
};

/** Direct sanctions on a named account (always public-origin). Moderators may apply the first four. */
export const DIRECT_SANCTION_PRESETS: readonly { id: string; label: string; kind: "warning" | "mute" | "suspension" | "ban"; durationMs: number | null; adminOnly: boolean }[] = [
  { id: "warning", label: "Warning", kind: "warning", durationMs: null, adminOnly: false },
  { id: "mute_24h", label: "Mute 24h", kind: "mute", durationMs: 24 * 3_600_000, adminOnly: false },
  { id: "mute_72h", label: "Mute 72h", kind: "mute", durationMs: 72 * 3_600_000, adminOnly: false },
  { id: "mute_7d", label: "Mute 7 days", kind: "mute", durationMs: 7 * 86_400_000, adminOnly: false },
  { id: "suspend_7d", label: "Suspend 7 days", kind: "suspension", durationMs: 7 * 86_400_000, adminOnly: true },
  { id: "suspend_30d", label: "Suspend 30 days", kind: "suspension", durationMs: 30 * 86_400_000, adminOnly: true },
  { id: "ban", label: "Ban", kind: "ban", durationMs: null, adminOnly: true },
];

export const SCOPE_OPTIONS: readonly { value: "all" | "buzz_only" | "requests"; label: string }[] = [
  { value: "all", label: "Everything (no posting anywhere)" },
  { value: "buzz_only", label: "Buzz only" },
  { value: "requests", label: "Message requests only" },
];

export const AUDIT_ACTIONS: readonly string[] = [
  "approve", "remove", "remove_and_warn", "remove_and_mute_24h", "remove_and_mute_72h", "remove_and_mute_7d", "warn_only", "dismiss_reports",
  "lock_thread", "unlock_thread", "escalate", "escalate_external", "suspend_7d", "suspend_30d", "ban", "lift_sanction", "restore", "buzz_unmask",
  "buzz_unmask_subject", "sanction_apply", "sanction_lift", "sanction_reduce", "sanction_warning", "sanction_mute", "sanction_suspension", "sanction_ban",
  "strike_add", "strike_revoke", "appeal_create", "appeal_decide", "role_grant", "role_revoke", "rule_pack_toggle", "reporter_viewed", "dm_context_viewed",
];
export const AUDIT_TARGETS: readonly string[] = [
  "buzz", "buzz_reply", "post", "comment", "apartment", "item", "roommate", "profile", "message", "user", "appeal", "rule_pack", "queue",
];

export type LimitationId = "G1" | "G2" | "G3" | "G4" | "G5" | "A1" | "U1" | "U2";

/** UniVerse safety 8.3 (G1-G5), the single-admin ban (A1), and what this port does not do yet (U1-U2). */
export const LIMITATIONS: readonly { id: LimitationId; title: string; body: string }[] = [
  {
    id: "G1",
    title: "No automated image or video classification",
    body: "There is no vision component. Photos and videos are checked only by reports and human review.",
  },
  {
    id: "G2",
    title: "Video container metadata is not stripped by us",
    body: "Buzz photos are re-encoded on the device, so they carry no camera or location data. Videos go to Mux as recorded.",
  },
  {
    id: "G3",
    title: "The rule engine is English-first",
    body: "Other languages rely on reports and the optional second pass. Rule packs are structured so lists can be added without code changes.",
  },
  {
    id: "G4",
    title: "Writing style can still identify people",
    body: "Stylometry across Buzz threads cannot be technically prevented; the guidelines and the per-thread alias are the mitigation.",
  },
  {
    id: "G5",
    title: "Anonymity depends on server integrity",
    body: "Anyone with the database or the service key can read who wrote what; the author link is kept for safety by design. Admins who unmask can also correlate an anon-origin sanction with the account it restricts. Mitigation is operational: key management, least-privilege access and this audit log.",
  },
  {
    id: "A1",
    title: "Bans are confirmed by one admin",
    body: "There is no second-admin confirmation step. A ban needs the typed word BAN and a note of at least 30 characters, and goes to the append-only audit log.",
  },
  {
    id: "U1",
    title: "Public content hides only at 10 reports",
    body: "Posts, reels, comments and listings are hidden automatically once 10 different eligible people report them (CampConnect Admin's hidden state); Approve or Restore here brings them back. Below that, reaching the auto-hide threshold only raises the item to P1. Profiles and messages are never hidden, and removing anything deletes it (a profile loses its bio and photo), so it cannot be restored.",
  },
  {
    id: "U2",
    title: "Suspended and banned accounts can still sign in and read",
    body: "The database refuses their posts, comments, listings, Buzz and messages, and they can read their notice and appeal under Account status, but the apps do not yet show a full-screen suspension page or hide their profile.",
  },
];

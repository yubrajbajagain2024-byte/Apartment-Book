/**
 * `toModerationRecord` — what a write hands the database as `p_moderation` (UniBuzz `buzz_v2_create` / `buzz_v2_reply`
 * → `ts_apply_moderation`, or `ts_record_blocked` for a block). It replaces UniVerse's `commitModeration` /
 * `writeModerationRows`, which wrote `moderation_events` + `mod_queue` + `recent_text_hashes` from the server.
 *
 * Shape (Buzz v2 contract §5):
 *   { events: [{ field, surface, action, visibility, category, subcode, severity, ruleIds, matches, signals, textHash,
 *                engineVersion }],
 *     queue: null | { source, category, severity, priority, label, ruleIds, aiVerdict } }
 *
 * Event rows:
 *  - A persisted write gets ONE EVENT PER MODERATED FIELD, plain allows included: UniBuzz has no separate
 *    `recent_text_hashes` table — `ts_writer_context().recentHashes` is read back from these rows' `textHash`, which is
 *    how the duplicate detector (`spam.duplicate`) keeps working. (UniVerse wrote no event for a plain allow, but did
 *    record its hash.)
 *  - A blocked write gets an event for each field that matched something, with `textHash: ''`: like UniVerse, a blocked
 *    text never counts as "already posted", so fixing the post and sending it again is not refused as a duplicate.
 * Queue: `(flag && !privateFlag) || escalate` on a non-staff surface, as UniVerse's `commitModeration`; source
 * `rule_block_escalation` for an escalated block, else `rule_flag`.
 */
import type { WriteModeration } from './moderate';
import type { QueueEntry } from './queue';
import type {
  ModerationAction, ModerationCategory, ModerationField, ModerationMatch, ModerationResult, ModerationSeverity, ModerationSignals,
  ModerationSurface,
} from './types';
import { SURFACE_GROUP } from './types';

export interface ModerationEventRecord {
  field: ModerationField;
  surface: ModerationSurface;
  action: ModerationAction;
  visibility: 'visible' | 'held';
  category: ModerationCategory | null;
  subcode: string | null;
  severity: ModerationSeverity;
  ruleIds: string[];
  /** Staff-only (spans into the original text). */
  matches: Array<ModerationMatch & { field: ModerationField }>;
  signals: ModerationSignals;
  /** `textHash(text)` of a persisted field; '' for a blocked write (and when the engine failed closed). */
  textHash: string;
  engineVersion: string;
}

export interface ModerationRecord {
  events: ModerationEventRecord[];
  queue: QueueEntry | null;
}

function uniqueRuleIds(matches: readonly ModerationMatch[]): string[] {
  return [...new Set(matches.map((m) => m.ruleId))];
}

function isPlainAllow(r: ModerationResult): boolean {
  return r.action === 'allow' && !r.support && !r.escalate && r.matches.length === 0;
}

/** The queue entry a moderated write asks for, or null. */
export function queueEntryFor(write: WriteModeration): QueueEntry | null {
  const r = write.merged;
  const queues = (r.action === 'flag' && !r.privateFlag) || r.escalate;
  if (!queues || SURFACE_GROUP[write.surface] === 'staff') return null;
  return {
    source: r.action === 'block' ? 'rule_block_escalation' : 'rule_flag',
    category: r.category,
    severity: r.severity,
    priority: r.priority ?? (r.escalate ? 'p0' : 'p2'),
    label: write.fields.map((f) => f.label).find((l) => l) ?? (r.category === 'self_harm' ? 'wellbeing' : null),
    ruleIds: uniqueRuleIds(r.matches),
    aiVerdict: null,
  };
}

/** `p_moderation` for `buzz_v2_create` / `buzz_v2_reply` (persisted) or `ts_record_blocked` (merged action = block). */
export function toModerationRecord(write: WriteModeration): ModerationRecord {
  const blocked = write.merged.action === 'block';
  const events: ModerationEventRecord[] = write.fields
    .filter((f) => !blocked || !isPlainAllow(f.result))
    .map((f) => ({
      field: f.field,
      surface: f.surface,
      action: f.result.action,
      visibility: f.result.visibility,
      category: f.result.category,
      subcode: f.result.subcode,
      severity: f.result.severity,
      ruleIds: uniqueRuleIds(f.result.matches),
      matches: f.result.matches.map((m) => ({ ...m, field: f.field })),
      signals: f.result.signals,
      textHash: blocked ? '' : f.textHash,
      engineVersion: f.result.engine.version,
    }));
  return { events, queue: queueEntryFor(write) };
}

/**
 * Moderation queue entries — the pure half of UniVerse `server/src/lib/moderation/queue.ts`.
 *
 * In UniVerse this file upserted `mod_queue` rows in SQLite. In UniBuzz the queue lives in Postgres and the database
 * owns the upsert (`ts_enqueue`, called by `ts_apply_moderation` / `ts_record_blocked`): ONE open item per entity,
 * priority escalates and never drops, severity takes the higher one, category / label are filled when missing, rule
 * ids are merged, the first source is kept. This module keeps the entry shape the engine hands to the database and the
 * same merge rules, as pure code, for combining several contributions into one entry before it leaves the server.
 */
import { higherPriority, SEVERITY_RANK } from './policy';
import type { ModerationCategory, ModerationPriority, ModerationSeverity, SecondPassVerdict } from './types';

/** Every source a queue item can have. The engine itself produces the first three. */
export type QueueSource = 'rule_flag' | 'rule_block_escalation' | 'ai_flag' | 'user_report' | 'community_score' | 'appeal' | 'system';

/** The AI verdict stored on an `ai_flag` queue item (staff-only): the verdict + which classifier + the job nonce. */
export type QueueAiVerdict = SecondPassVerdict & { classifier: string; nonce: string };

/** `p_moderation.queue` — the queue item a write asks the database to create or merge into. */
export interface QueueEntry {
  source: Extract<QueueSource, 'rule_flag' | 'rule_block_escalation' | 'ai_flag'>;
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  priority: ModerationPriority;
  /** 'wellbeing' for self-harm ideation / concern (the P0 wellbeing view). */
  label: string | null;
  ruleIds: string[];
  aiVerdict: QueueAiVerdict | null;
}

/**
 * Merges `next` into `existing` the way UniVerse's `upsertQueueItem` merged into an open item: priority = the higher,
 * severity = the higher, category / label filled when missing, the newer AI verdict wins, rule ids merged (order kept),
 * source kept.
 */
export function mergeQueueEntries(existing: QueueEntry | null, next: QueueEntry | null): QueueEntry | null {
  if (!existing) return next;
  if (!next) return existing;
  const ruleIds = [...existing.ruleIds];
  for (const r of next.ruleIds) if (!ruleIds.includes(r)) ruleIds.push(r);
  return {
    source: existing.source,
    category: existing.category ?? next.category,
    severity: SEVERITY_RANK[next.severity] > SEVERITY_RANK[existing.severity] ? next.severity : existing.severity,
    priority: higherPriority(existing.priority, next.priority) ?? next.priority,
    label: existing.label ?? next.label,
    ruleIds,
    aiVerdict: next.aiVerdict ?? existing.aiVerdict,
  };
}

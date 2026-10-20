/**
 * The write-side wrappers of UniVerse `server/src/lib/moderation/index.ts` (`moderateText`, `moderateWrite`,
 * `mergeResults`, `toAuthorNotice`), without the database.
 *
 * UniVerse's `moderateWrite` loaded and recorded `recent_text_hashes`, wrote `moderation_events` / `mod_queue` and threw
 * a 422 itself. Here it is pure: the caller passes `ctx.recentHashes` (from `ts_writer_context`), gets the per-field
 * results + the merged one back, decides, and hands `toModerationRecord(...)` to the database, which stores events and
 * queue items in the same transaction as the write (or, for a block, `ts_record_blocked`).
 */
import { ENGINE_VERSION, evaluate, failClosedResult, hashFolded } from './engine';
import { log } from './logger';
import { normalize } from './normalize';
import { higherPriority, SEVERITY_RANK, strictness } from './policy';
import { packsFor } from './registry';
import type {
  AuthorNotice, ContentBlockedDetails, ModerationContext, ModerationField, ModerationPriority, ModerationResult, ModerationSurface,
} from './types';

/** One moderated field of a write, with what the database record needs. */
export interface FieldModeration {
  field: ModerationField;
  surface: ModerationSurface;
  /** The text as moderated (= as stored). */
  text: string;
  /** `textHash(text)`; '' when the engine failed closed. */
  textHash: string;
  /** Queue label ('wellbeing' for self-harm ideation / concern). */
  label: string | null;
  result: ModerationResult;
}

export interface WriteModeration {
  /** The surface of the write as a whole (e.g. 'buzz' even when some fields were moderated as 'buzz_poll'). */
  surface: ModerationSurface;
  /** Only the fields that had text, in input order. */
  fields: FieldModeration[];
  /** The strictest result (block > held > visible > allow; ties → higher severity). Decide and notify from this. */
  merged: ModerationResult;
}

export interface WriteField {
  text: string | null | undefined;
  /** Default 'body'. */
  field?: ModerationField;
  /** Default `ctx.surface` (poll options of a buzz are moderated as 'buzz_poll'). */
  surface?: ModerationSurface;
}

/* ───────────────────────────── single text ───────────────────────────── */

function evaluateField(text: unknown, ctx: ModerationContext): Omit<FieldModeration, 'field' | 'surface'> {
  const packs = packsFor(ctx.enabledRulePacks);
  const safeText = typeof text === 'string' ? text : '';
  try {
    const ev = evaluate(safeText, ctx, packs);
    return { text: safeText, textHash: ev.textHash, label: ev.label, result: ev.result };
  } catch (err) {
    log.error('moderation engine failed (fail-closed hold)', err);
    return { text: safeText, textHash: '', label: null, result: failClosedResult(packs.map((p) => p.id)) };
  }
}

/** Pure, sync, never throws (fail-closed hold on internal error). UniVerse's `moderateText`. */
export function moderate(text: string, ctx: ModerationContext): ModerationResult {
  return evaluateField(text, ctx).result;
}

/** Alias kept from UniVerse. */
export const moderateText = moderate;

/** sha256 of the folded text, first 32 hex chars — what `ctx.recentHashes` holds and the duplicate detector compares. */
export function textHash(text: string): string {
  return hashFolded(normalize(typeof text === 'string' ? text : '').folded.text);
}

/* ───────────────────────────── a whole write ───────────────────────────── */

/** Strictest of several results (block > flag held > flag visible > allow; ties → higher severity). Merges support / banner / escalate. */
export function mergeResults(results: ModerationResult[]): ModerationResult {
  const sorted = [...results].sort(
    (a, b) => strictness(b) - strictness(a) || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
  const top = sorted[0]!;
  if (results.length === 1) return top;
  const matches = results.flatMap((r) => r.matches).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return {
    ...top,
    matches,
    severity: matches[0]?.severity ?? 'none',
    escalate: results.some((r) => r.escalate),
    priority: results.reduce<ModerationPriority | null>((p, r) => higherPriority(p, r.priority), null),
    support: sorted.find((r) => r.support)?.support ?? null,
    recipientBanner: sorted.find((r) => r.recipientBanner)?.recipientBanner ?? null,
    signals: {
      evasion: results.some((r) => r.signals.evasion),
      invisibleChars: results.reduce((n, r) => n + r.signals.invisibleChars, 0),
      homoglyphs: results.reduce((n, r) => n + r.signals.homoglyphs, 0),
      urls: results.reduce((n, r) => n + r.signals.urls, 0),
      mentions: results.reduce((n, r) => n + r.signals.mentions, 0),
      capsRatio: Math.max(...results.map((r) => r.signals.capsRatio)),
      hasFullName: results.some((r) => r.signals.hasFullName),
    },
    engine: { ...top.engine, elapsedMs: results.reduce((n, r) => n + r.engine.elapsedMs, 0) },
  };
}

/**
 * Moderates every field of one write that has text (empty / whitespace-only fields are skipped) against the same
 * `ctx.recentHashes`, and merges them to the strictest result. Pure; never throws.
 */
export function moderateWrite(fields: readonly WriteField[], ctx: ModerationContext): WriteModeration {
  const present = fields.filter((f): f is WriteField & { text: string } => typeof f.text === 'string' && f.text.trim().length > 0);
  if (present.length === 0) {
    return { surface: ctx.surface, fields: [], merged: moderate('', { ...ctx, field: 'body' }) };
  }
  const out: FieldModeration[] = present.map((f) => {
    const field = f.field ?? 'body';
    const surface = f.surface ?? ctx.surface;
    return { field, surface, ...evaluateField(f.text, { ...ctx, surface, field }) };
  });
  return { surface: ctx.surface, fields: out, merged: mergeResults(out.map((f) => f.result)) };
}

/* ───────────────────────────── what the author may see ───────────────────────────── */

/** The ONLY moderation data a non-staff client may receive. */
export function toAuthorNotice(result: ModerationResult): AuthorNotice {
  return { status: result.persistStatus ?? 'active', userMessage: result.userMessage, support: result.support };
}

/** For writes without text. */
export const NO_NOTICE: AuthorNotice = { status: 'active', userMessage: null, support: null };

/** The 422 `content_blocked` message + details of a blocked result (UniVerse's `moderateWrite` throw, as data). */
export function contentBlocked(result: ModerationResult): { message: string; details: ContentBlockedDetails } {
  const msg = result.userMessage;
  return {
    message: msg?.body ?? 'This can’t be posted.',
    details: {
      messageId: msg?.id ?? 'M-GENERIC',
      title: msg?.title ?? 'This can’t be posted',
      category: result.category,
      guidelineAnchor: msg?.guidelineAnchor ?? null,
      support: result.support,
    },
  };
}

export { ENGINE_VERSION };

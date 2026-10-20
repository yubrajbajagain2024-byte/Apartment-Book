import "server-only";

import { RULE_PACK_IDS, type ModerationContext, type ModerationSurface } from "@apartment-book/moderation";
import { BuzzApiError, fromDbError, GENERIC_MESSAGE } from "./http";
import type { RpcClient } from "./types";

/**
 * `ts_writer_context(p_author)` (Trust & Safety migration, service role only): everything the engine needs to know
 * about the author, read in one call. Parsed defensively: a missing account age counts as a brand-new account (the
 * stricter new-account rules apply), missing strike points / recent hashes as none, a missing pack list as every pack,
 * and a missing posting status as allowed — `buzz_v2_create` / `buzz_v2_reply` re-check posting rights themselves.
 */

export interface PostingStatus {
  allowed: boolean;
  /** Epoch ms; null when open-ended or allowed. */
  mutedUntil: number | null;
  reason: "muted" | "suspended" | "banned" | "warning" | null;
  warningId: string | null;
  /** Epoch ms when polls unlock, null once unlocked (when the database sends it). */
  pollsUnlockAt: number | null;
  category: string | null;
}

export interface WriterContext {
  userId: string;
  universityId: string | null;
  countryCode: string | null;
  role: "user" | "moderator" | "admin";
  accountAgeMs: number;
  activeStrikePoints: number;
  /** Folded-text hashes of the author's writes in the last 10 minutes (the duplicate detector). */
  recentHashes: string[];
  posting: PostingStatus;
  /** null = every rule pack. */
  enabledRulePacks: string[] | null;
}

const POLL_MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Epoch ms from a number or an ISO timestamp. */
function epochMs(v: unknown): number | null {
  const n = num(v);
  if (n !== null) return n;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : null;
}

function parsePosting(v: unknown): PostingStatus {
  const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const reason = p.reason === "muted" || p.reason === "suspended" || p.reason === "banned" || p.reason === "warning" ? p.reason : null;
  return {
    // missing → allowed: the database refuses the write itself if the author may not post
    allowed: typeof p.allowed === "boolean" ? p.allowed : true,
    mutedUntil: epochMs(p.mutedUntil),
    reason,
    warningId: str(p.warningId),
    pollsUnlockAt: epochMs(p.pollsUnlockAt),
    category: str(p.category),
  };
}

/** The raw `ts_writer_context` JSON → a WriterContext (null when it is not an object at all). */
export function parseWriterContext(raw: unknown, userId: string): WriterContext | null {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  const role = c.role === "moderator" || c.role === "admin" ? c.role : "user";
  return {
    userId: str(c.userId) ?? userId,
    universityId: str(c.universityId),
    countryCode: str(c.countryCode),
    role,
    accountAgeMs: Math.max(0, num(c.accountAgeMs) ?? 0),
    activeStrikePoints: Math.max(0, num(c.activeStrikePoints) ?? 0),
    recentHashes: strings(c.recentHashes) ?? [],
    posting: parsePosting(c.posting),
    enabledRulePacks: strings(c.enabledRulePacks),
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function loadWriterContext(db: RpcClient, userId: string): Promise<WriterContext> {
  const { data, error } = await db.rpc("ts_writer_context", { p_author: userId });
  if (error) throw fromDbError(error);
  const ctx = parseWriterContext(data, userId);
  if (!ctx) throw new BuzzApiError(500, "unknown", GENERIC_MESSAGE);
  return ctx;
}

/**
 * The rule packs to run from `ts_writer_context().enabledRulePacks` (the staff console's toggles). A list naming no
 * pack this engine ships — empty, or ids it does not know — means the database's pack table is not set up, never
 * "moderate with no rules": every pack runs. Unknown ids are reported so the mismatch gets fixed.
 */
export function effectiveRulePacks(list: string[] | null): { packs: string[] | null; unknown: string[] } {
  if (!list) return { packs: null, unknown: [] };
  const known = list.filter((id) => RULE_PACK_IDS.includes(id));
  return { packs: known.length > 0 ? known : null, unknown: list.filter((id) => !RULE_PACK_IDS.includes(id)) };
}

/** The engine context for one write by this author. */
export function moderationContext(w: WriterContext, surface: ModerationSurface): ModerationContext {
  return {
    surface,
    userId: w.userId,
    role: w.role,
    accountType: "student",
    accountAgeMs: w.accountAgeMs,
    activeStrikePoints: w.activeStrikePoints,
    universityId: w.universityId,
    countryCode: w.countryCode,
    recentHashes: w.recentHashes,
    enabledRulePacks: effectiveRulePacks(w.enabledRulePacks).packs,
  };
}

/**
 * Posting not allowed → the 403 to answer with (UniVerse `assertCanPost` / `requireAuth` copy), else null.
 * muted → `muted` + `{ until }`; suspended / banned → `suspended` / `banned` + `{ until, category }`;
 * an unacknowledged warning → `warning_unacknowledged` + `{ warningId }`.
 */
export function postingFailure(posting: PostingStatus): BuzzApiError | null {
  if (posting.allowed) return null;
  switch (posting.reason) {
    case "muted":
      return new BuzzApiError(403, "muted", "You're muted right now, so you can't post. You can still read, vote and reply in your existing chats.", {
        until: posting.mutedUntil,
      });
    case "suspended":
      return new BuzzApiError(403, "suspended", "Your account is suspended.", { until: posting.mutedUntil, category: posting.category });
    case "banned":
      return new BuzzApiError(403, "banned", "Your account has been permanently banned.", { until: null, category: posting.category });
    case "warning":
      return new BuzzApiError(403, "warning_unacknowledged", "Please read and acknowledge the notice from the safety team before posting.", {
        warningId: posting.warningId,
      });
    default:
      return new BuzzApiError(403, "forbidden", "You can't post on Buzz right now.");
  }
}

/** Polls unlock 24 hours after joining (UniVerse `assertAccountAge`); the database checks it again. */
export function pollFailure(w: WriterContext, now: number): BuzzApiError | null {
  const unlockAt = w.posting.pollsUnlockAt ?? (w.accountAgeMs < POLL_MIN_ACCOUNT_AGE_MS ? now + (POLL_MIN_ACCOUNT_AGE_MS - w.accountAgeMs) : null);
  if (unlockAt === null || unlockAt <= now) return null;
  return new BuzzApiError(403, "too_new", "Polls unlock 24 hours after you join.", { availableAt: unlockAt });
}

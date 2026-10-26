/**
 * Rule-pack registry — the rule-pack half of UniVerse `server/src/lib/moderation/index.ts`. `baseline` and the eleven
 * `admin.<category>` packs are registered at import time (pure, no I/O), exactly as UniVerse's full server did.
 *
 * Two ways to switch a pack off:
 *  - per call, `ctx.enabledRulePacks` (UniBuzz: `ts_writer_context().enabledRulePacks`, which reflects the staff
 *    console's toggles stored in `moderation_rule_state`) — the normal path;
 *  - process-wide, `setRulePackEnabled()` (UniVerse's in-memory switch; kept for tests and tooling).
 * PII and behavioural detectors are not packs: they always run.
 */
import { ADMIN_RULE_PACKS } from './rules/admin/index';
import { BASELINE_PACK } from './rules/baseline';
import type { RulePack } from './types';

const packs = new Map<string, RulePack>();
const disabled = new Set<string>();

/** Idempotent by id; a later registration replaces the earlier one. Pure (no DB). Never throws. */
export function registerRulePack(pack: RulePack): void {
  try {
    if (!pack || typeof pack.id !== 'string' || !Array.isArray(pack.rules)) return;
    packs.set(pack.id, pack);
  } catch {
    /* never throws */
  }
}

export interface RulePackInfo {
  id: string;
  version: string;
  ruleCount: number;
  /** Process-wide switch only; `ctx.enabledRulePacks` applies per call on top of it. */
  enabled: boolean;
}

export function listRulePacks(): RulePackInfo[] {
  return [...packs.values()].map((p) => ({ id: p.id, version: p.version, ruleCount: p.rules.length, enabled: !disabled.has(p.id) }));
}

export function setRulePackEnabled(id: string, enabled: boolean): void {
  if (enabled) disabled.delete(id);
  else disabled.add(id);
}

/** The packs a call runs: registered, not switched off process-wide, and in `only` when a list is given. */
export function packsFor(only?: readonly string[] | null): RulePack[] {
  const on = [...packs.values()].filter((p) => !disabled.has(p.id));
  if (!only) return on;
  const wanted = new Set(only);
  return on.filter((p) => wanted.has(p.id));
}

registerRulePack(BASELINE_PACK);
for (const pack of ADMIN_RULE_PACKS) registerRulePack(pack);

/** Every pack id this engine ships, in registration order (for the database's `moderation_rule_state` / staff console). */
export const RULE_PACK_IDS: readonly string[] = [BASELINE_PACK.id, ...ADMIN_RULE_PACKS.map((p) => p.id)];

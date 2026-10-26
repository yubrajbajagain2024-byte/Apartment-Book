"use server";

/**
 * The staff console's writes. Every one is a console_* database function run as the signed-in user: the database checks
 * the role (non-staff: not found), the conflict-of-interest filter, the ladder rules and the notes, and writes the
 * audit row in the same transaction. These wrappers only shape the input and the answer.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { staffRpc, toStaffError } from "./rpc";
import type { BlindLiftResult, BulkActionId, BulkActionResult, RulePackState, StaffActionId, StaffAppeal, StaffQueueItemDetail, StaffUserDetail, UnmaskReasonCode, UnmaskResponse } from "./types";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; error: string };

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

async function run<T>(fn: string, args: Record<string, unknown>, revalidate: string | null = "/admin"): Promise<ActionResult<T>> {
  try {
    const supabase = await createClient();
    const data = await staffRpc<T>(supabase, fn, args);
    if (revalidate) revalidatePath(revalidate, "layout");
    return { ok: true, data };
  } catch (e) {
    const err = toStaffError(e);
    return { ok: false, code: err.code, error: err.message };
  }
}

export async function claimItemAction(id: string): Promise<ActionResult<unknown>> {
  return run("console_claim", { p_id: str(id, 64) });
}

export async function releaseItemAction(id: string): Promise<ActionResult<unknown>> {
  return run("console_release", { p_id: str(id, 64) });
}

export interface ActInput {
  id: string;
  action: StaffActionId;
  category: string;
  note?: string;
  confirmText?: string;
  reference?: string;
  badFaith?: boolean;
}

export async function actOnItemAction(input: ActInput): Promise<ActionResult<{ status: string; resolution: string | null }>> {
  const options: Record<string, unknown> = {};
  if (input.confirmText) options.confirmText = str(input.confirmText, 20);
  if (input.reference) options.reference = str(input.reference, 200);
  if (input.badFaith) options.badFaith = true;
  const res = await run<StaffQueueItemDetail>("console_act", {
    p_id: str(input.id, 64),
    p_action: str(input.action, 40),
    p_category: str(input.category, 40),
    p_note: str(input.note ?? "", 2000) || null,
    p_sanction: options,
    p_batch: null,
  });
  return res.ok ? { ok: true, data: { status: res.data.status, resolution: res.data.resolution } } : res;
}

export async function bulkAction(input: { ids: string[]; action: BulkActionId; category: string; note?: string }): Promise<ActionResult<BulkActionResult>> {
  const ids = Array.isArray(input.ids) ? input.ids.filter((x) => typeof x === "string").slice(0, 50) : [];
  return run<BulkActionResult>("console_bulk", { p_ids: ids, p_action: str(input.action, 40), p_category: str(input.category, 40), p_note: str(input.note ?? "", 2000) || null });
}

/**
 * Admins only. The identity comes back in this answer and nowhere else: the console holds it in component state until
 * `expiresAt` (five minutes) and drops it on unmount. Nothing here caches it.
 */
export async function unmaskAction(input: {
  entityType: "buzz" | "buzz_reply";
  entityId: string;
  reasonCode: UnmaskReasonCode;
  reason: string;
  confirm: string;
  caseRef?: string;
}): Promise<ActionResult<UnmaskResponse>> {
  return run<UnmaskResponse>(
    "console_unmask",
    {
      p_entity_type: str(input.entityType, 20),
      p_entity_id: str(input.entityId, 64),
      p_reason_code: str(input.reasonCode, 40),
      p_reason: str(input.reason, 2000),
      p_confirm: str(input.confirm, 20),
      p_case_ref: str(input.caseRef ?? "", 100) || null,
    },
    // no revalidation: the answer carries the identity only; the audit page reads fresh rows on its next visit anyway
    null,
  );
}

export async function directSanctionAction(input: {
  userId: string;
  kind: "warning" | "mute" | "suspension" | "ban";
  durationMs: number | null;
  scope: "all" | "buzz_only" | "requests";
  category: string;
  note: string;
}): Promise<ActionResult<StaffUserDetail>> {
  return run<StaffUserDetail>("console_sanction", {
    p_user: str(input.userId, 64),
    p_kind: str(input.kind, 20),
    p_duration_ms: typeof input.durationMs === "number" && Number.isFinite(input.durationMs) ? Math.round(input.durationMs) : null,
    p_scope: str(input.scope, 20),
    p_category: str(input.category, 40),
    p_note: str(input.note, 2000),
  });
}

export async function liftSanctionAction(input: { sanctionId: string; note: string }): Promise<ActionResult<StaffUserDetail | BlindLiftResult>> {
  return run<StaffUserDetail | BlindLiftResult>("console_lift", { p_id: str(input.sanctionId, 128), p_note: str(input.note, 2000) });
}

export async function grantRoleAction(input: { userId: string; role: "user" | "moderator" | "admin" }): Promise<ActionResult<StaffUserDetail>> {
  return run<StaffUserDetail>("console_grant_role", { p_user: str(input.userId, 64), p_role: str(input.role, 20) });
}

export async function decideAppealAction(input: { id: string; outcome: "upheld" | "reversed" | "reduced"; note: string; reducedUntil: number | null }): Promise<ActionResult<StaffAppeal>> {
  return run<StaffAppeal>("console_decide_appeal", {
    p_id: str(input.id, 64),
    p_outcome: str(input.outcome, 20),
    p_note: str(input.note, 2000),
    p_reduced_until: typeof input.reducedUntil === "number" && Number.isFinite(input.reducedUntil) ? Math.round(input.reducedUntil) : null,
  });
}

export async function setRulePackAction(input: { id: string; enabled: boolean; note?: string }): Promise<ActionResult<RulePackState>> {
  return run<RulePackState>("console_set_rule_pack", { p_id: str(input.id, 64), p_enabled: input.enabled === true, p_note: str(input.note ?? "", 500) || null });
}

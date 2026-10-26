/**
 * Trust & Safety, the parts every signed-in person uses (ported from UniVerse): your own sanctions and appeals, and
 * whether you are staff. The staff console's own calls live in the website (`apps/web/src/lib/staff`), never here,
 * so no staff payload type is bundled into the app.
 *
 * Database functions: migration `20261103000000_trust_safety.sql`. They raise `ts:<code>:<message>` on failure.
 */
import type { Client } from "../types/models";
import type { ModerationCategory } from "../buzz/types";

export type SanctionKind = "warning" | "mute" | "suspension" | "ban";
export type SanctionScope = "all" | "buzz_only" | "requests";
export type AppealStatus = "none" | "open" | "upheld" | "reversed" | "reduced";
export type StaffRole = "moderator" | "admin";

/**
 * One row of "Account status": everything the affected person may see about their own account. It can quote their own
 * buzz back to them, so it is returned ONLY to that person (`my_sanctions()`); staff payloads never reuse it.
 */
export interface SanctionNotice {
  id: string;
  kind: SanctionKind | "removal";
  scope: SanctionScope;
  category: ModerationCategory | null;
  guidelineAnchor: string | null;
  /** The person's own content, quoted back, ≤ 140 chars. */
  contentExcerpt: string | null;
  contentLabel: string | null;
  /** Epoch ms. */
  startsAt: number;
  until: number | null;
  acknowledgedAt: number | null;
  canAppeal: boolean;
  appealStatus: AppealStatus;
  appealDeadline: number | null;
  createdAt: number;
}

export class TrustSafetyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TrustSafetyError";
    this.code = code;
  }
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function call<T>(supabase: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const rpc = (supabase.rpc as unknown as Rpc).bind(supabase);
  const { data, error } = await rpc(fn, args);
  if (error) {
    const m = /ts:([a-z_]+):([\s\S]*)$/.exec(error.message);
    throw m ? new TrustSafetyError(m[1]!, m[2]!.trim()) : new TrustSafetyError("unknown", error.message || "Something went wrong. Try again.");
  }
  return data as T;
}

/** Warnings, mutes, suspensions, bans and removals on your account, newest first. */
export function listMySanctions(supabase: Client): Promise<SanctionNotice[]> {
  return call<SanctionNotice[]>(supabase, "my_sanctions");
}

/** "I understand" on a warning (posting resumes once every warning is acknowledged). */
export async function acknowledgeSanction(supabase: Client, sanctionId: string): Promise<void> {
  await call<null>(supabase, "ack_sanction", { p_id: sanctionId });
}

/** One appeal per sanction, within 14 days; reviewed by a different staff member than the one who acted. */
export async function submitAppeal(supabase: Client, sanctionId: string, text: string): Promise<void> {
  await call<null>(supabase, "submit_appeal", { p_sanction: sanctionId, p_text: text.trim() });
}

/** Your staff role, or null for everyone else (the staff console answers "not found" to non-staff). */
export async function getStaffRole(supabase: Client): Promise<StaffRole | null> {
  return (await call<StaffRole | null>(supabase, "ts_staff_role")) ?? null;
}

export const SANCTION_KIND_LABELS: Record<SanctionNotice["kind"], string> = {
  warning: "Warning",
  mute: "Muted",
  suspension: "Suspended",
  ban: "Banned",
  removal: "Content removed",
};

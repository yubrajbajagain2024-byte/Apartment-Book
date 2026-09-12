import type { Client } from "../types/models";

export type ReportTargetType = "apartment" | "item" | "roommate" | "profile" | "message" | "comment";
export type ReportReason = "spam" | "scam" | "harassment" | "inappropriate" | "other";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam or misleading" },
  { value: "scam", label: "Scam or fraud" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "other", label: "Something else" },
];

/** File a report about a post, comment, message or person. Reports are reviewed by the team. */
export async function reportContent(supabase: Client, userId: string, input: { targetType: ReportTargetType; targetId: string; reason: ReportReason; details?: string | null }): Promise<void> {
  const { error } = await supabase.from("reports").insert({
    reporter_id: userId,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    details: input.details?.trim() ? input.details.trim().slice(0, 1000) : null,
  });
  if (error) throw error;
}

/** Block someone: their posts and comments vanish for you, and neither of you can message the other. */
export async function blockUser(supabase: Client, userId: string, blockedId: string): Promise<void> {
  const { error } = await supabase.from("blocks").upsert({ blocker_id: userId, blocked_id: blockedId }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function unblockUser(supabase: Client, userId: string, blockedId: string): Promise<void> {
  const { error } = await supabase.from("blocks").delete().match({ blocker_id: userId, blocked_id: blockedId });
  if (error) throw error;
}

/** Ids of the people I have blocked. */
export async function listBlockedIds(supabase: Client, userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.blocked_id);
}

export async function isBlocked(supabase: Client, userId: string, otherId: string): Promise<boolean> {
  const { data, error } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", userId).eq("blocked_id", otherId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

const UPLOAD_KINDS = ["apartments", "items", "roommates", "avatars", "messages"] as const;

/** Best-effort removal of every file the user uploaded (their own folders only, per storage policies). */
async function removeMyUploads(supabase: Client, userId: string): Promise<void> {
  const bucket = supabase.storage.from("uploads");
  for (const kind of UPLOAD_KINDS) {
    const { data } = await bucket.list(`${kind}/${userId}`, { limit: 1000 });
    const paths = (data ?? []).filter((f) => f.name && !f.name.endsWith("/")).map((f) => `${kind}/${userId}/${f.name}`);
    if (paths.length > 0) await bucket.remove(paths);
  }
}

/** Permanently delete the signed-in user's account, their uploads and everything they posted. Sign out afterwards. */
export async function deleteMyAccount(supabase: Client): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (data.user) await removeMyUploads(supabase, data.user.id).catch(() => {});
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
}

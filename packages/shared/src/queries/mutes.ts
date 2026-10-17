import { MUTE_DURATIONS } from "../constants";
import type { Client, MuteDuration, MuteScope, NotificationMute } from "../types/models";

/** When a mute chosen now lifts: an ISO time, or null for "until unmuted". */
export function muteUntil(duration: MuteDuration, now: Date = new Date()): string | null {
  const hours = MUTE_DURATIONS.find((d) => d.value === duration)?.hours ?? null;
  return hours === null ? null : new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

/** Still in force: no end, or an end that has not come. */
export function isMuteActive(mute: Pick<NotificationMute, "until">, now: Date = new Date()): boolean {
  return mute.until === null || new Date(mute.until).getTime() > now.getTime();
}

/** The mute in force for a scope and target (the person, the chat, or nothing for every group chat), if any. */
export function activeMute(mutes: NotificationMute[], scope: MuteScope, targetId: string | null = null, now: Date = new Date()): NotificationMute | null {
  return mutes.find((m) => m.scope === scope && (m.target_id ?? null) === targetId && isMuteActive(m, now)) ?? null;
}

/** "Muted" with no end, "Muted until 3:15 PM" today, "Muted until Tue 9:00 AM" further out. */
export function muteLabel(mute: Pick<NotificationMute, "until"> | null, now: Date = new Date()): string | null {
  if (!mute || !isMuteActive(mute, now)) return null;
  if (mute.until === null) return "Muted";
  const until = new Date(mute.until);
  const time = until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = until.toDateString() === now.toDateString();
  return `Muted until ${sameDay ? time : `${until.toLocaleDateString(undefined, { weekday: "short" })} ${time}`}`;
}

/** Everything the person has muted, lapsed ones included (they are harmless and few). */
export async function listMutes(supabase: Client, userId: string): Promise<NotificationMute[]> {
  const { data, error } = await supabase.from("notification_mutes").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Mute a person, a chat or every group chat for `duration`; an earlier mute of the same thing is replaced. */
export async function setMute(supabase: Client, userId: string, scope: MuteScope, targetId: string | null, duration: MuteDuration): Promise<NotificationMute> {
  await clearMute(supabase, userId, scope, targetId);
  const { data, error } = await supabase
    .from("notification_mutes")
    .insert({ user_id: userId, scope, target_id: scope === "all_groups" ? null : targetId, until: muteUntil(duration) })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function clearMute(supabase: Client, userId: string, scope: MuteScope, targetId: string | null = null): Promise<void> {
  let query = supabase.from("notification_mutes").delete().eq("user_id", userId).eq("scope", scope);
  query = scope === "all_groups" || targetId === null ? query.is("target_id", null) : query.eq("target_id", targetId);
  const { error } = await query;
  if (error) throw error;
}

import type { Client, NotificationWithActor } from "../types/models";

export const NOTIFICATION_SELECT = "*, actor:profiles!notifications_actor_id_fkey(id, full_name, avatar_url)";

/**
 * New messages and Snaps sent in a chat: they live in Messages (its unread counts and the push), never in the
 * Notifications list or its badge. Their rows still exist, one per chat, because the push rides on them.
 */
export const MESSAGE_NOTIFICATION_TYPES = ["message", "snap"] as const;
const NOT_MESSAGES = `(${MESSAGE_NOTIFICATION_TYPES.join(",")})`;

export function isMessageNotification(type: string): boolean {
  return (MESSAGE_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** Newest first, without new messages and Snaps (see MESSAGE_NOTIFICATION_TYPES). Pass `before` (created_at of the last row) to load older ones. */
export async function listNotifications(
  supabase: Client,
  opts: { limit?: number; before?: string; unreadOnly?: boolean } = {},
): Promise<NotificationWithActor[]> {
  let query = supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .not("type", "in", NOT_MESSAGES)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.before) query = query.lt("created_at", opts.before);
  if (opts.unreadOnly) query = query.is("read_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return data as NotificationWithActor[];
}

/**
 * The Notifications badge: my unread notifications, without new messages and Snaps (Messages counts those). Counted
 * here rather than by unread_notification_count(), so it reads the same on a database before migration 37.
 */
export async function getUnreadNotificationCount(supabase: Client): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null)
    .not("type", "in", NOT_MESSAGES);
  if (error) throw error;
  return count ?? 0;
}

/** Mark the given notifications (or all of mine) as read. Returns how many changed. */
export async function markNotificationsRead(supabase: Client, ids?: string[]): Promise<number> {
  const { data, error } = await supabase.rpc("mark_notifications_read", ids ? { p_ids: ids } : {});
  if (error) throw error;
  return Number(data ?? 0);
}

export async function deleteNotification(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) throw error;
}

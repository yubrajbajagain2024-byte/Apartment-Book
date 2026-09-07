import type { Client, NotificationWithActor } from "../types/models";

export const NOTIFICATION_SELECT = "*, actor:profiles!notifications_actor_id_fkey(id, full_name, avatar_url)";

/** Newest first. Pass `before` (created_at of the last row) to load older ones. */
export async function listNotifications(
  supabase: Client,
  opts: { limit?: number; before?: string; unreadOnly?: boolean } = {},
): Promise<NotificationWithActor[]> {
  let query = supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.before) query = query.lt("created_at", opts.before);
  if (opts.unreadOnly) query = query.is("read_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return data as NotificationWithActor[];
}

export async function getUnreadNotificationCount(supabase: Client): Promise<number> {
  const { data, error } = await supabase.rpc("unread_notification_count");
  if (error) throw error;
  return Number(data ?? 0);
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

import { MESSAGES_PAGE_SIZE } from "../constants";
import type {
  Client,
  ConversationSummary,
  ConversationType,
  MemberStatus,
  MessageWithSender,
  ProfileSummary,
} from "../types/models";
import { conversationTitle } from "../utils";

export const MESSAGE_SELECT = "*, sender:profiles!messages_sender_id_fkey(id, full_name, avatar_url)";
const MEMBER_SELECT = "conversation_id, user_id, last_read_at, last_delivered_at, profile:profiles!conversation_members_user_id_fkey(id, full_name, avatar_url, last_seen_at)";

type MemberRow = {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
  last_delivered_at: string;
  profile: (ProfileSummary & { last_seen_at: string | null }) | null;
};

function memberStatusOf(rows: MemberRow[]): Record<string, MemberStatus> {
  const out: Record<string, MemberStatus> = {};
  for (const r of rows) out[r.user_id] = { lastReadAt: r.last_read_at, lastDeliveredAt: r.last_delivered_at, lastSeenAt: r.profile?.last_seen_at ?? null };
  return out;
}

function summaryOf(rows: MemberRow[]): ProfileSummary[] {
  return rows.map((r) => r.profile).filter((p): p is ProfileSummary & { last_seen_at: string | null } => p !== null).map(({ id, full_name, avatar_url }) => ({ id, full_name, avatar_url }));
}

/** All conversations the user belongs to, newest activity first, with unread counts. */
export async function listConversations(supabase: Client, userId: string): Promise<ConversationSummary[]> {
  const { data: memberships, error } = await supabase
    .from("conversation_members")
    .select(
      "conversation_id, last_read_at, conversation:conversations!conversation_members_conversation_id_fkey(id, type, name, created_by, last_message_at, last_message_preview, created_at)",
    )
    .eq("user_id", userId);
  if (error) throw error;

  const conversationIds = memberships.map((m) => m.conversation_id);
  if (conversationIds.length === 0) return [];

  const [{ data: members, error: membersError }, { data: unread, error: unreadError }] = await Promise.all([
    supabase.from("conversation_members").select(MEMBER_SELECT).in("conversation_id", conversationIds),
    supabase.rpc("get_unread_counts"),
  ]);
  if (membersError) throw membersError;
  if (unreadError) throw unreadError;

  const membersByConversation = new Map<string, MemberRow[]>();
  for (const row of members as MemberRow[]) {
    const list = membersByConversation.get(row.conversation_id) ?? [];
    list.push(row);
    membersByConversation.set(row.conversation_id, list);
  }
  const unreadByConversation = new Map<string, number>();
  for (const row of unread ?? []) unreadByConversation.set(row.conversation_id, Number(row.unread_count));

  const summaries: ConversationSummary[] = [];
  for (const m of memberships) {
    const c = m.conversation;
    if (!c) continue;
    const rows = membersByConversation.get(c.id) ?? [];
    const allMembers = summaryOf(rows);
    const otherMembers = allMembers.filter((p) => p.id !== userId);
    summaries.push({
      id: c.id,
      type: c.type as ConversationType,
      name: c.name,
      createdBy: c.created_by,
      lastMessageAt: c.last_message_at,
      lastMessagePreview: c.last_message_preview,
      members: allMembers,
      otherMembers,
      memberStatus: memberStatusOf(rows),
      unreadCount: unreadByConversation.get(c.id) ?? 0,
      title: conversationTitle(c.type as ConversationType, c.name, otherMembers),
    });
  }

  summaries.sort((a, b) => {
    const at = a.lastMessageAt ?? "";
    const bt = b.lastMessageAt ?? "";
    return bt.localeCompare(at);
  });
  return summaries;
}

export async function getConversation(
  supabase: Client,
  conversationId: string,
  userId: string,
): Promise<ConversationSummary | null> {
  const { data: c, error } = await supabase
    .from("conversations")
    .select("id, type, name, created_by, last_message_at, last_message_preview, created_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!c) return null;

  const { data: members, error: membersError } = await supabase.from("conversation_members").select(MEMBER_SELECT).eq("conversation_id", conversationId);
  if (membersError) throw membersError;

  const rows = members as MemberRow[];
  const allMembers = summaryOf(rows);
  const otherMembers = allMembers.filter((p) => p.id !== userId);
  return {
    id: c.id,
    type: c.type as ConversationType,
    name: c.name,
    createdBy: c.created_by,
    lastMessageAt: c.last_message_at,
    lastMessagePreview: c.last_message_preview,
    members: allMembers,
    otherMembers,
    memberStatus: memberStatusOf(rows),
    unreadCount: 0,
    title: conversationTitle(c.type as ConversationType, c.name, otherMembers),
  };
}

/**
 * Messages in a conversation, oldest first. Pass `before` to load older pages,
 * or `after` to catch up on anything newer than what you already have.
 */
export async function listMessages(
  supabase: Client,
  conversationId: string,
  opts: { before?: string; after?: string; limit?: number } = {},
): Promise<MessageWithSender[]> {
  if (opts.after) {
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("conversation_id", conversationId)
      .gt("created_at", opts.after)
      .order("created_at", { ascending: true })
      .limit(opts.limit ?? MESSAGES_PAGE_SIZE);
    if (error) throw error;
    return data as MessageWithSender[];
  }
  let query = supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? MESSAGES_PAGE_SIZE);
  if (opts.before) query = query.lt("created_at", opts.before);
  const { data, error } = await query;
  if (error) throw error;
  return (data as MessageWithSender[]).reverse();
}

export async function sendMessage(
  supabase: Client,
  input: { conversationId: string; senderId: string; content: string; imageUrl?: string | null },
): Promise<MessageWithSender> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      content: input.content,
      image_url: input.imageUrl ?? null,
    })
    .select(MESSAGE_SELECT)
    .single();
  if (error) throw error;
  return data as MessageWithSender;
}

export async function getOrCreateDirectConversation(supabase: Client, otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    p_other_user_id: otherUserId,
  });
  if (error) throw error;
  return data;
}

export async function createGroupConversation(
  supabase: Client,
  name: string,
  memberIds: string[],
): Promise<string> {
  const { data, error } = await supabase.rpc("create_group_conversation", {
    p_name: name,
    p_member_ids: memberIds,
  });
  if (error) throw error;
  return data;
}

export async function addGroupMembers(supabase: Client, conversationId: string, memberIds: string[]): Promise<void> {
  const { error } = await supabase.rpc("add_group_members", {
    p_conversation_id: conversationId,
    p_member_ids: memberIds,
  });
  if (error) throw error;
}

export async function renameGroup(supabase: Client, conversationId: string, name: string): Promise<void> {
  const { error } = await supabase.from("conversations").update({ name }).eq("id", conversationId);
  if (error) throw error;
}

export async function leaveConversation(supabase: Client, conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("conversation_members")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function markConversationRead(supabase: Client, conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  if (error) throw error;
}

/** Every message in all my conversations reached this device ("Delivered" for senders). */
export async function markDeliveredAll(supabase: Client): Promise<void> {
  const { error } = await supabase.rpc("mark_delivered_all");
  if (error) throw error;
}

/** Heartbeat while the app is open, for "Active 5m ago". Ignored when the user hides their active status. */
export async function touchPresence(supabase: Client): Promise<void> {
  const { error } = await supabase.rpc("touch_presence");
  if (error) throw error;
}

/**
 * Messenger-style state of one of your own messages: "seen" once any other
 * member read it, "delivered" once any other member's app received it, else "sent".
 */
export function receiptFor(createdAt: string, others: MemberStatus[]): "sent" | "delivered" | "seen" {
  if (others.some((s) => s.lastReadAt >= createdAt)) return "seen";
  if (others.some((s) => s.lastDeliveredAt >= createdAt)) return "delivered";
  return "sent";
}

export async function getTotalUnread(supabase: Client): Promise<number> {
  const { data, error } = await supabase.rpc("get_total_unread");
  if (error) throw error;
  return Number(data ?? 0);
}

export async function deleteMessage(supabase: Client, messageId: string): Promise<void> {
  const { error } = await supabase.from("messages").delete().eq("id", messageId);
  if (error) throw error;
}

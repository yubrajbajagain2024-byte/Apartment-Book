import { MESSAGES_PAGE_SIZE } from "../constants";
import type { Client, ConversationSummary, ConversationType, MemberStatus, MessageWithSender, ProfileSummary, SharedPost } from "../types/models";
import type { Json } from "../types/database";
import {
  MESSAGE_ATTACHMENT_LIMITS,
  MESSAGE_MEDIA_BUCKET,
  parseAttachments,
  sharedItemsFromMessages,
  type MessageAttachment,
  type SharedContentKind,
  type SharedItem,
  type SharedSourceMessage,
} from "../message-media";
import { sharedPostOf } from "../share";
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

/** A message row as it comes from the API: attachments are raw JSON, or missing before migration 20. */
type MessageRow = Omit<MessageWithSender, "attachments"> & { attachments?: unknown };

/** Rows as the apps use them: attachments always a checked list (empty when there are none). */
function messageOf(row: MessageRow): MessageWithSender {
  return { ...row, attachments: parseAttachments(row.attachments) };
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
    return (data as unknown as MessageRow[]).map(messageOf);
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
  return (data as unknown as MessageRow[]).map(messageOf).reverse();
}

/**
 * `sharedPost` attaches a post, reel or listing card and `attachments` files already uploaded to MESSAGE_MEDIA_BUCKET
 * (each path from messageAttachmentPath()); with either, the text may be empty.
 */
export async function sendMessage(
  supabase: Client,
  input: {
    conversationId: string;
    senderId: string;
    content: string;
    imageUrl?: string | null;
    sharedPost?: SharedPost | null;
    attachments?: MessageAttachment[];
  },
): Promise<MessageWithSender> {
  const attachments = input.attachments ?? [];
  if (attachments.length > MESSAGE_ATTACHMENT_LIMITS.maxItems) throw new Error(`You can send up to ${MESSAGE_ATTACHMENT_LIMITS.maxItems} files at a time.`);
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      content: input.content,
      image_url: input.imageUrl ?? null,
      // Only shares carry the column, so plain messages keep working on a database that has not run migration 17 yet.
      ...(input.sharedPost ? { shared_post: input.sharedPost as unknown as Json } : {}),
      // Likewise only messages with files send attachments (migration 20).
      ...(attachments.length > 0 ? { attachments: attachments as unknown as Json } : {}),
    })
    .select(MESSAGE_SELECT)
    .single();
  if (error) throw error;
  return messageOf(data as unknown as MessageRow);
}

/**
 * The share sheet's Send: one direct message per friend, each carrying the same snapshot and the optional note. Friends
 * are sent one after another; the ones that failed come back so the sheet can say who did not get it.
 */
export async function sendSharedPost(
  supabase: Client,
  input: { senderId: string; recipientIds: string[]; sharedPost: SharedPost; note?: string },
): Promise<{ sent: string[]; failed: string[] }> {
  // Through the same reader the chat uses, so the stored snapshot always has the canonical link and https pictures.
  const sharedPost = sharedPostOf(input.sharedPost);
  if (!sharedPost) throw new Error("There is nothing to share.");
  const sent: string[] = [];
  const failed: string[] = [];
  const content = (input.note ?? "").trim();
  for (const recipientId of input.recipientIds) {
    try {
      const conversationId = await getOrCreateDirectConversation(supabase, recipientId);
      await sendMessage(supabase, { conversationId, senderId: input.senderId, content, sharedPost });
      sent.push(recipientId);
    } catch {
      failed.push(recipientId);
    }
  }
  return { sent, failed };
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

/** Fresh read/delivered/active times for every member of a conversation. */
export async function getMemberStatus(supabase: Client, conversationId: string): Promise<Record<string, MemberStatus>> {
  const { data, error } = await supabase.from("conversation_members").select(MEMBER_SELECT).eq("conversation_id", conversationId);
  if (error) throw error;
  return memberStatusOf(data as MemberRow[]);
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

/** Delete one of my messages, then (best effort) the files it carried. */
export async function deleteMessage(supabase: Client, messageId: string): Promise<void> {
  const { data, error } = await supabase.from("messages").delete().eq("id", messageId).select("*");
  if (error) throw error;
  const row = (data ?? [])[0] as { conversation_id: string; sender_id: string | null; attachments?: unknown } | undefined;
  if (row?.sender_id) await removeAttachmentFiles(supabase, row.conversation_id, row.sender_id, parseAttachments(row.attachments)).catch(() => {});
}

/** Remove a deleted message's own files, except any another message of the chat still shows (a resend reuses them). */
async function removeAttachmentFiles(supabase: Client, conversationId: string, senderId: string, attachments: MessageAttachment[]): Promise<void> {
  const prefix = `${conversationId}/${senderId}/`;
  const paths = [...new Set(attachments.map((a) => a.path).filter((p) => p.startsWith(prefix)))];
  if (paths.length === 0) return;
  const stillShown = await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .contains("attachments", JSON.stringify([{ path }]))
        .limit(1);
      // When unsure, keep the file.
      return Boolean(error) || (data?.length ?? 0) > 0;
    }),
  );
  const unused = paths.filter((_, i) => !stillShown[i]);
  if (unused.length > 0) await supabase.storage.from(MESSAGE_MEDIA_BUCKET).remove(unused);
}

/**
 * Signed URLs for chat files (the bucket is private), as path -> URL. Paths the user may not read are left out. Show
 * images with a cache key equal to the path, so a fresh URL for the same file does not download it again.
 */
export async function signMessageMedia(supabase: Client, paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p) => typeof p === "string" && p.length > 0))];
  const urls: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase.storage.from(MESSAGE_MEDIA_BUCKET).createSignedUrls(unique.slice(i, i + 100), expiresIn);
    if (error) throw error;
    for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl;
  }
  return urls;
}

async function searchMessages(supabase: Client, query: string, conversationId: string | null, limit: number): Promise<MessageWithSender[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const { data, error } = await supabase
    .rpc("search_messages", { p_q: q, p_conversation_id: conversationId, p_limit: limit })
    .select(MESSAGE_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as MessageRow[]).map(messageOf);
}

/** Messages of one chat whose text contains `query` (any case; % and _ are plain characters), newest first. */
export async function searchConversationMessages(
  supabase: Client,
  conversationId: string,
  query: string,
  opts: { limit?: number } = {},
): Promise<MessageWithSender[]> {
  return searchMessages(supabase, query, conversationId, opts.limit ?? 50);
}

/** The same search across every chat I belong to, newest first; each row's conversation_id says where it is. */
export async function searchMyMessages(supabase: Client, query: string, opts: { limit?: number } = {}): Promise<MessageWithSender[]> {
  return searchMessages(supabase, query, null, opts.limit ?? 30);
}

/**
 * One page of a chat's Media (photos and videos, website photos included), Files or Links (addresses in the text and
 * shared posts), newest first. `limit` counts messages, so a page can hold more items than that (a message with three
 * photos gives three). Pass `next` back as `before` for the following page; it is null after the last one.
 */
export async function listConversationShared(
  supabase: Client,
  conversationId: string,
  opts: { kind: SharedContentKind; before?: string | null; limit?: number },
): Promise<{ items: SharedItem[]; next: string | null }> {
  const limit = Number.isFinite(opts.limit) ? Math.min(Math.max(Math.floor(opts.limit as number), 1), 100) : 30;
  const { data, error } = await supabase
    .rpc("conversation_shared_messages", { p_conversation_id: conversationId, p_kind: opts.kind, p_before: opts.before ?? null, p_limit: limit })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as SharedSourceMessage[];
  return {
    items: sharedItemsFromMessages(rows, opts.kind, sharedPostOf),
    next: rows.length >= limit ? rows[rows.length - 1].created_at : null,
  };
}

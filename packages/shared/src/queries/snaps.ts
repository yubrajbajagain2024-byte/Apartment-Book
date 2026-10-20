import type { Json } from "../types/database";
import type { Client, ProfileSummary } from "../types/models";
import type { SnapKind, SnapMime } from "../snaps";

/** Someone the Send To list offers: a person I have a direct chat with, a friend, or both. */
export type SnapRecipient = ProfileSummary & {
  /** We follow each other. */
  isFriend: boolean;
  /** The newest message in our direct chat, or null when we have none. */
  lastMessageAt: string | null;
};

/** Everyone a Snap can go to, the most recent chats first, then friends A to Z (blocked people never); `q` narrows by name. */
export async function listSnapRecipients(supabase: Client, q?: string): Promise<SnapRecipient[]> {
  const { data, error } = await supabase.rpc("list_snap_recipients", { p_q: q?.trim() ? q.trim() : null });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, full_name: r.full_name, avatar_url: r.avatar_url, isFriend: Boolean(r.is_friend), lastMessageAt: r.last_message_at }));
}

export type SendSnapInput = {
  /** Where the file was uploaded: snapMediaPath(). */
  path: string;
  kind: SnapKind;
  mime: SnapMime;
  width: number | null;
  height: number | null;
  /** Seconds, for a video. */
  duration: number | null;
  recipientIds: string[];
};

export type SentSnap = {
  snapId: string;
  expiresAt: string;
  sent: { recipientId: string; conversationId: string; messageId: string }[];
};

const obj = (value: Json | null | undefined): Record<string, Json | undefined> => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const str = (value: Json | undefined): string => (typeof value === "string" ? value : "");
const num = (value: Json | undefined): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Sends an uploaded Snap: one message in my direct chat with each person (all or nothing). */
export async function sendSnap(supabase: Client, input: SendSnapInput): Promise<SentSnap> {
  const { data, error } = await supabase.rpc("send_snap", {
    p_path: input.path,
    p_kind: input.kind,
    p_mime: input.mime,
    p_width: input.width ? Math.round(input.width) : null,
    p_height: input.height ? Math.round(input.height) : null,
    p_duration: input.kind === "video" && input.duration ? Math.round(input.duration * 10) / 10 : null,
    p_recipient_ids: input.recipientIds,
  });
  if (error) throw error;
  const result = obj(data);
  const sent = Array.isArray(result.sent) ? result.sent : [];
  return {
    snapId: str(result.snap_id),
    expiresAt: str(result.expires_at),
    sent: sent.map((s) => {
      const row = obj(s ?? null);
      return { recipientId: str(row.recipient_id), conversationId: str(row.conversation_id), messageId: str(row.message_id) };
    }),
  };
}

/** A Snap being viewed: its file, and who sent it. */
export type OpenedSnap = {
  id: string;
  path: string;
  kind: SnapKind;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sentAt: string;
  openedAt: string;
  /** Until when the file can be loaded (unless it is closed sooner). */
  viewUntil: string;
  conversationId: string;
  messageId: string;
  sender: ProfileSummary;
};

/** The one view: marks the Snap opened and says where its file is. Throws the database's words (SNAP_ERRORS) when it cannot. */
export async function openSnap(supabase: Client, snapId: string): Promise<OpenedSnap> {
  const { data, error } = await supabase.rpc("open_snap", { p_snap_id: snapId });
  if (error) throw error;
  const s = obj(data);
  const sender = obj(s.sender ?? null);
  return {
    id: str(s.id),
    path: str(s.path),
    kind: s.kind === "video" ? "video" : "image",
    mime: str(s.mime),
    width: num(s.width),
    height: num(s.height),
    duration: num(s.duration),
    sentAt: str(s.sent_at),
    openedAt: str(s.opened_at),
    viewUntil: str(s.view_until),
    conversationId: str(s.conversation_id),
    messageId: str(s.message_id),
    sender: { id: str(sender.id), full_name: str(sender.full_name) || "Someone", avatar_url: typeof sender.avatar_url === "string" ? sender.avatar_url : null },
  };
}

/** Ends the view: the file is out of reach from now on. */
export async function closeSnap(supabase: Client, snapId: string): Promise<void> {
  const { error } = await supabase.rpc("close_snap", { p_snap_id: snapId });
  if (error) throw error;
}


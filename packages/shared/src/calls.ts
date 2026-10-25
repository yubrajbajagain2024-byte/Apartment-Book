// Audio and video calls in chats (migration 32). Pure helpers only: no queries and no runtime imports, so the unit
// tests can load this file directly. The media itself travels over LiveKit (the apps hold a room per call); the
// database keeps who is calling whom, who answered, and the call rows in the chat.

export type CallKind = "audio" | "video";

/** Where a call stands: ringing until someone answers, active while anyone is in it, then ended. */
export type CallStatus = "ringing" | "active" | "ended";

/**
 * Why a call ended: everyone hung up after talking (completed), nobody answered before the caller gave up or the ring
 * ran out (missed), everyone it rang declined (declined), or the database closed it after it was left hanging (expired).
 */
export type CallEndReason = "completed" | "missed" | "declined" | "expired";

/** One person's part in a call. */
export type CallParticipantState = "ringing" | "joined" | "left" | "declined" | "missed";

/**
 * What a chat message carries for a call (messages.call): enough to draw the row and to call back. Written only by the
 * call functions in the database (a trigger refuses it from the API), and updated as the call goes on, so the row in the
 * chat follows the call live.
 */
export type MessageCall = {
  id: string;
  kind: CallKind;
  status: CallStatus;
  ended_reason: CallEndReason | null;
  /** Seconds the call lasted once answered; null until it ends, or when it was never answered. */
  duration: number | null;
  started_by: string | null;
};

/** A call as the call screen reads it: the row plus everyone it rang and where each of them stands. */
export type CallParticipant = {
  user_id: string;
  state: CallParticipantState;
  joined_at: string | null;
  left_at: string | null;
  profile: { id: string; full_name: string; avatar_url: string | null } | null;
};

export type CallRecord = {
  id: string;
  conversation_id: string;
  started_by: string | null;
  kind: CallKind;
  status: CallStatus;
  ended_reason: CallEndReason | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  participants: CallParticipant[];
};

/** How long a call rings before it is missed: the apps stop ringing here, and the database closes it a little after. */
export const CALL_RING_SECONDS = 45;

/** The notification type of a missed call. */
export const CALL_NOTIFICATION_TYPE = "call";

const KINDS: readonly CallKind[] = ["audio", "video"];
const STATUSES: readonly CallStatus[] = ["ringing", "active", "ended"];
const REASONS: readonly CallEndReason[] = ["completed", "missed", "declined", "expired"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The call stored on a message, if it is one. Anything malformed reads as "no call". */
export function callOf(value: unknown): MessageCall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" && UUID.test(v.id) ? v.id : null;
  const kind = typeof v.kind === "string" && (KINDS as readonly string[]).includes(v.kind) ? (v.kind as CallKind) : null;
  if (!id || !kind) return null;
  const status = typeof v.status === "string" && (STATUSES as readonly string[]).includes(v.status) ? (v.status as CallStatus) : "ended";
  const reason = typeof v.ended_reason === "string" && (REASONS as readonly string[]).includes(v.ended_reason) ? (v.ended_reason as CallEndReason) : null;
  const duration = typeof v.duration === "number" && Number.isFinite(v.duration) && v.duration >= 0 ? Math.round(v.duration) : null;
  return { id, kind, status, ended_reason: status === "ended" ? (reason ?? "missed") : null, duration, started_by: typeof v.started_by === "string" && UUID.test(v.started_by) ? v.started_by : null };
}

/** "0:42", "12:05", "1:03:20". */
export function formatCallDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const kindWord = (kind: CallKind) => (kind === "video" ? "Video call" : "Audio call");

/**
 * The inbox line for a chat whose newest message is a call; the same text the database writes into
 * last_message_preview (one string for both sides of the call).
 */
export function callPreview(call: Pick<MessageCall, "kind" | "status" | "ended_reason">): string {
  if (call.status !== "ended") return kindWord(call.kind);
  switch (call.ended_reason) {
    case "completed":
      return kindWord(call.kind);
    case "declined":
      return `${kindWord(call.kind)} declined`;
    default:
      return `Missed ${kindWord(call.kind).toLowerCase()}`;
  }
}

/**
 * What a call's row in the chat says to `viewerId`: "Calling…" and "In progress" while it goes on, then "Audio call ·
 * 3:24", "Missed audio call" (someone who did not pick up), "No answer" (the one who called), "Audio call declined".
 */
export function callRowText(call: MessageCall, viewerId: string | null): { title: string; detail: string | null; missed: boolean } {
  const word = kindWord(call.kind);
  const caller = viewerId !== null && call.started_by === viewerId;
  if (call.status === "ringing") return { title: word, detail: caller ? "Calling…" : "Ringing", missed: false };
  if (call.status === "active") return { title: word, detail: "In progress", missed: false };
  switch (call.ended_reason) {
    case "completed":
      return { title: word, detail: formatCallDuration(call.duration) || null, missed: false };
    case "declined":
      return { title: word, detail: "Declined", missed: !caller };
    default:
      return caller ? { title: word, detail: "No answer", missed: false } : { title: `Missed ${word.toLowerCase()}`, detail: null, missed: true };
  }
}

/** The body of a missed call's notification; the same text the database writes. */
export function missedCallBody(kind: CallKind): string {
  return `Missed ${kindWord(kind).toLowerCase()}`;
}

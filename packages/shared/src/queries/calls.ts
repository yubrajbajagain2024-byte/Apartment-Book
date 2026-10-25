import type { Json } from "../types/database";
import type { Client } from "../types/models";
import type { CallEndReason, CallKind, CallParticipant, CallParticipantState, CallRecord, CallStatus } from "../calls";

// Audio and video calls (migration 35): the database keeps who is calling whom and where everyone stands; the media
// travels over LiveKit, with a token from the livekit-token function (supabase/functions/livekit-token).

const obj = (value: Json | null | undefined): Record<string, Json | undefined> => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const str = (value: Json | undefined): string => (typeof value === "string" ? value : "");
const strOrNull = (value: Json | undefined): string | null => (typeof value === "string" ? value : null);

const STATUSES: readonly CallStatus[] = ["ringing", "active", "ended"];
const REASONS: readonly CallEndReason[] = ["completed", "missed", "declined", "expired"];
const STATES: readonly CallParticipantState[] = ["ringing", "joined", "left", "declined", "missed"];

/** A call as get_call() and answer_call() give it; null for anything that is not one. */
export function callRecordOf(value: Json | null | undefined): CallRecord | null {
  const c = obj(value);
  const id = str(c.id);
  if (!id) return null;
  const participants: CallParticipant[] = (Array.isArray(c.participants) ? c.participants : []).map((p) => {
    const row = obj(p ?? null);
    const profile = obj(row.profile ?? null);
    const state = str(row.state);
    return {
      user_id: str(row.user_id),
      state: (STATES as readonly string[]).includes(state) ? (state as CallParticipantState) : "left",
      joined_at: strOrNull(row.joined_at),
      left_at: strOrNull(row.left_at),
      profile: str(profile.id) ? { id: str(profile.id), full_name: str(profile.full_name) || "Someone", avatar_url: strOrNull(profile.avatar_url) } : null,
    };
  });
  const status = str(c.status);
  const reason = str(c.ended_reason);
  return {
    id,
    conversation_id: str(c.conversation_id),
    started_by: strOrNull(c.started_by),
    kind: c.kind === "video" ? "video" : "audio",
    status: (STATUSES as readonly string[]).includes(status) ? (status as CallStatus) : "ended",
    ended_reason: (REASONS as readonly string[]).includes(reason) ? (reason as CallEndReason) : null,
    started_at: str(c.started_at),
    answered_at: strOrNull(c.answered_at),
    ended_at: strOrNull(c.ended_at),
    participants,
  };
}

/** What start_call() hands back: the call (new, or the one already going on in the chat, which you have now joined). */
export type StartedCall = { callId: string; messageId: string | null; conversationId: string; joined: boolean };

/** Starts a call in a chat: everyone else there is rung. If a call is already going on there, joins it instead. */
export async function startCall(supabase: Client, conversationId: string, kind: CallKind): Promise<StartedCall> {
  const { data, error } = await supabase.rpc("start_call", { p_conversation_id: conversationId, p_kind: kind });
  if (error) throw error;
  const r = obj(data);
  return { callId: str(r.call_id), messageId: strOrNull(r.message_id), conversationId: str(r.conversation_id), joined: r.joined === true };
}

/** The database's words for a call that is over, as answerCall() throws them. */
export const CALL_ENDED = "This call has ended";

/** Answers a call that rang you (or joins one going on in your chat). Throws CALL_ENDED once it is over. */
export async function answerCall(supabase: Client, callId: string): Promise<CallRecord> {
  const { data, error } = await supabase.rpc("answer_call", { p_call_id: callId });
  if (error) throw error;
  const call = callRecordOf(data);
  if (!call) throw new Error("This call isn't available");
  if (call.status === "ended") throw new Error(CALL_ENDED);
  return call;
}

/** Declines a call that rang you. */
export async function declineCall(supabase: Client, callId: string): Promise<void> {
  const { error } = await supabase.rpc("decline_call", { p_call_id: callId });
  if (error) throw error;
}

/** Hangs up: leaves the call, ending it when nobody is left in it (or cancelling it, if it was still ringing from you). */
export async function leaveCall(supabase: Client, callId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_call", { p_call_id: callId });
  if (error) throw error;
}

/** The call with everyone it rang; null when it is out of reach. */
export async function getCall(supabase: Client, callId: string): Promise<CallRecord | null> {
  const { data, error } = await supabase.rpc("get_call", { p_call_id: callId });
  if (error) throw error;
  return callRecordOf(data);
}

/** The call going on in a chat right now (ringing or active), or null. */
export async function currentCall(supabase: Client, conversationId: string): Promise<CallRecord | null> {
  const { data, error } = await supabase.rpc("current_call", { p_conversation_id: conversationId });
  if (error) throw error;
  return callRecordOf(data);
}

/**
 * A LiveKit token for a call you are in, from the livekit-token function (it checks with the database that you are),
 * with the server to connect to. Throws the function's words when it refuses.
 */
export async function fetchCallToken(supabase: Client, callId: string): Promise<{ token: string; url: string }> {
  const { data, error } = await supabase.functions.invoke("livekit-token", { body: { call_id: callId } });
  if (error) {
    // A refusal carries the function's own words ({"error": "…"}); supabase-js only says "non-2xx status code".
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    let words = "";
    try {
      const body = context && typeof context.json === "function" ? await context.json() : null;
      words = str(obj(body as Json).error);
    } catch {
      words = "";
    }
    throw words ? new Error(words) : error;
  }
  const r = obj(data as Json);
  const token = str(r.token);
  const url = str(r.url);
  if (!token || !url) throw new Error(str(r.error) || "Calls aren't set up on the server yet.");
  return { token, url };
}

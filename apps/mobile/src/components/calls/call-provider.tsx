import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AppState } from "react-native";
import { useRouter } from "expo-router";
import { CALL_RING_SECONDS, CALL_ENDED, answerCall, declineCall, getCall, startCall, type CallKind, type CallRecord } from "@apartment-book/shared";
import { errorText } from "@/lib/hooks";
import { startRinging, stopRinging } from "@/lib/call-sounds";
import { CALLS_PAUSED } from "@/lib/calls";
import { alertWithHaptic, hapticSoft } from "@/lib/haptics";
import { watchNotificationTaps } from "@/lib/push";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { ComingSoonNotice } from "./coming-soon";
import { IncomingCallScreen } from "./incoming-call";

type CallsValue = {
  /** The call ringing this phone right now, if any. */
  incoming: CallRecord | null;
  /** Starts a call in a chat (or joins the one going on there) and opens the call screen. */
  place: (conversationId: string, kind: CallKind) => Promise<void>;
  /** Answers a call (one that rang, or one going on in a chat) and opens the call screen. */
  join: (callId: string, kind?: CallKind) => Promise<void>;
};

const CallsContext = createContext<CallsValue | null>(null);

/**
 * Calls, app-wide: listens for calls that ring this person (their own call_participants rows, over realtime, a
 * look on every return to the app, and the push that rang the phone while the app was away), rings the phone and
 * shows the incoming-call screen over whatever is on screen,
 * and hands Accept, Decline, Place and Join to the rest of the app. A ring that nobody answers within CALL_RING_SECONDS
 * stops on its own (the database closes the call as missed a little after). One ring at a time: a second call arriving
 * while one rings is left for the chat's banner.
 *
 * While calls are paused (CALLS_PAUSED) Place and Join show the "Coming Soon" notice instead, and no ring is listened
 * for; taps on every other notification still open what they point at.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const router = useRouter();
  const userId = user?.id ?? null;
  const [incoming, setIncoming] = useState<CallRecord | null>(null);
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;
  /** Calls this phone already answered, declined or let ring out: never rung again. */
  const settled = useRef(new Set<string>());
  const busy = useRef(false);
  /** The "Coming Soon" notice while calls are paused; a new key restarts it when tapped again. */
  const [soon, setSoon] = useState<{ key: number; kind: CallKind } | null>(null);
  const showSoon = useCallback((kind: CallKind) => setSoon({ key: Date.now(), kind }), []);
  const hideSoon = useCallback(() => setSoon(null), []);

  const dismiss = useCallback((callId: string) => {
    settled.current.add(callId);
    setIncoming((current) => (current?.id === callId ? null : current));
  }, []);

  /** A call that may be ringing me: ring if it is, and nobody has dealt with it here. True when it rings now. */
  const consider = useCallback(
    async (callId: string): Promise<boolean> => {
      if (!userId || settled.current.has(callId) || incomingRef.current) return false;
      try {
        const call = await getCall(supabase, callId);
        if (!call || call.status !== "ringing" || call.started_by === userId) return false;
        const me = call.participants.find((p) => p.user_id === userId);
        if (!me || me.state !== "ringing") return false;
        // A ring already older than the ring itself (the app was away): too late, the database will have closed it.
        if (Date.now() - Date.parse(call.started_at) > CALL_RING_SECONDS * 1000) return false;
        if (!incomingRef.current && !settled.current.has(callId)) setIncoming(call);
        return true;
      } catch {
        // Not reachable right now: the next change will say.
        return false;
      }
    },
    [userId],
  );

  // Rings that reach this phone while the app is open; and on every return to the app, any ring left waiting.
  useEffect(() => {
    if (!userId || CALLS_PAUSED) {
      setIncoming(null);
      return;
    }
    const lookAround = () => {
      supabase
        .from("call_participants")
        .select("call_id")
        .eq("user_id", userId)
        .eq("state", "ringing")
        .then(({ data }) => {
          for (const row of data ?? []) void consider(row.call_id);
        });
    };
    lookAround();
    const channel = supabase
      .channel(`calls:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_participants", filter: `user_id=eq.${userId}` }, (payload) => {
        const row = (payload.new ?? payload.old) as { call_id?: string; state?: string } | null;
        if (!row?.call_id) return;
        if (row.state === "ringing") void consider(row.call_id);
        else if (incomingRef.current?.id === row.call_id) dismiss(row.call_id);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls" }, (payload) => {
        const row = payload.new as { id?: string; status?: string };
        if (row.id && row.status === "ended" && incomingRef.current?.id === row.id) dismiss(row.id);
      })
      .subscribe();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") lookAround();
    });
    return () => {
      supabase.removeChannel(channel);
      sub.remove();
    };
  }, [userId, consider, dismiss]);

  // A push tapped (a ring, or any notification): a ring still going rings here; one that ran out opens its chat (the
  // missed call's row); any other notification opens its link.
  useEffect(() => {
    if (!userId) return;
    return watchNotificationTaps({
      onRing: (callId, conversationId) => {
        if (CALLS_PAUSED) {
          if (conversationId) router.push({ pathname: "/messages/[id]", params: { id: conversationId } });
          return;
        }
        consider(callId).then((ringing) => {
          if (!ringing && conversationId) router.push({ pathname: "/messages/[id]", params: { id: conversationId } });
        });
      },
      onOpen: (link) => router.push(link as never),
    });
  }, [userId, consider, router]);

  // The phone rings while a call is incoming, and stops on its own once the ring has run its course.
  useEffect(() => {
    if (!incoming) return;
    startRinging();
    const left = Math.max(1000, CALL_RING_SECONDS * 1000 - (Date.now() - Date.parse(incoming.started_at)));
    const timer = setTimeout(() => dismiss(incoming.id), left);
    return () => {
      clearTimeout(timer);
      stopRinging();
    };
  }, [incoming, dismiss]);

  const join = useCallback(
    async (callId: string, kind: CallKind = "audio") => {
      if (CALLS_PAUSED) return showSoon(kind);
      if (busy.current) return;
      busy.current = true;
      try {
        settled.current.add(callId);
        setIncoming((current) => (current?.id === callId ? null : current));
        await answerCall(supabase, callId);
        hapticSoft();
        router.push({ pathname: "/call/[id]", params: { id: callId } });
      } catch (e) {
        const text = errorText(e, "Couldn't join the call.");
        Alert.alert(text === CALL_ENDED ? "This call has ended" : "Couldn't join the call", text === CALL_ENDED ? "It ended before you could join." : text);
      } finally {
        busy.current = false;
      }
    },
    [router, showSoon],
  );

  const place = useCallback(
    async (conversationId: string, kind: CallKind) => {
      if (CALLS_PAUSED) return showSoon(kind);
      if (busy.current) return;
      busy.current = true;
      try {
        const started = await startCall(supabase, conversationId, kind);
        settled.current.add(started.callId);
        hapticSoft();
        router.push({ pathname: "/call/[id]", params: started.joined ? { id: started.callId } : { id: started.callId, outgoing: "1" } });
      } catch (e) {
        alertWithHaptic("error", "Couldn't start the call", errorText(e, "Check your connection and try again."));
      } finally {
        busy.current = false;
      }
    },
    [router, showSoon],
  );

  const decline = useCallback(
    (callId: string) => {
      dismiss(callId);
      declineCall(supabase, callId).catch(() => {});
    },
    [dismiss],
  );

  const value = useMemo<CallsValue>(() => ({ incoming, place, join }), [incoming, place, join]);
  return (
    <CallsContext.Provider value={value}>
      {children}
      {incoming && userId ? <IncomingCallScreen call={incoming} onAccept={() => void join(incoming.id, incoming.kind)} onDecline={() => decline(incoming.id)} /> : null}
      {soon ? <ComingSoonNotice key={soon.key} kind={soon.kind} onDone={hideSoon} /> : null}
    </CallsContext.Provider>
  );
}

export function useCalls(): CallsValue {
  const value = useContext(CallsContext);
  if (!value) throw new Error("useCalls must be used inside CallProvider");
  return value;
}

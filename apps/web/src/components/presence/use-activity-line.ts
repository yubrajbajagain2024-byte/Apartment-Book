"use client";

import { useEffect, useState } from "react";
import { ACTIVITY_LABEL_REFRESH_MS, ACTIVITY_REFETCH_MS, activityLine, getActivityStatus, type ActivityLine, type ActivityStatus } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { useIsOnline, usePresenceReady, usePresenceStatus } from "./presence-provider";

/** Whether the latest answer about each person (in any chat) had something to show: then it may well show again soon. */
const hadTime = new Map<string, boolean>();
const incoming = new Set<(conversationId: string, senderId: string) => void>();

/**
 * A message from `senderId` reached an open chat (chat-window's realtime handler): its header asks about them again.
 * They are active right now, and their first message is what lets you see their status at all.
 */
export function noteIncomingMessage(conversationId: string, senderId: string | null | undefined): void {
  if (!senderId) return;
  for (const listener of [...incoming]) listener(conversationId, senderId);
}

/**
 * The line under the other person's name at the top of a direct chat: "Active now" (shown with a green dot) or when
 * they were last active ("Active 5 min ago"), as `line`. Null means show no status: for a group (pass no user), until
 * presence is known, and whenever the database has nothing for me to see (they or I hide our activity status, either
 * of us blocked the other, or I am signed out; and when they were last active, if they have not written to me).
 * `waiting` is true while nothing shows yet but their status probably will in a moment (presence is reconnecting, or
 * nothing is known about them yet, and the last answer about them had something), for a header that keeps the line's
 * place meanwhile. Asking again (every minute, say) keeps the answer that stands, which already decides the line: an
 * answer with nothing to show while they are offline ("recent" but no time) is not waiting.
 */
export function useActivityLine(userId: string | null, conversationId: string): { line: ActivityLine | null; waiting: boolean } {
  const ready = usePresenceReady();
  const status = usePresenceStatus();
  const online = useIsOnline(userId);
  const activity = useLastActivity(userId, conversationId, online, ready);
  const now = useNow(userId ? ACTIVITY_LABEL_REFRESH_MS : null);
  const line = userId ? activityLine({ ready, online, activity }, now) : null;
  const live = status === "connecting" || status === "ready";
  const waiting = userId !== null && !line && live && hadTime.get(userId) === true && (!ready || activity === undefined);
  return { line, waiting };
}

/** What the database said about one person in one chat, and which question it answers. */
type Answer = { question: string; activity: ActivityStatus | null };

/**
 * When `userId` was last active, as the database lets me see it (undefined while not known). Asked whenever presence
 * becomes ready (the chat opens, the tab comes back, the connection is back, my own status is shown again), whenever
 * they come online or leave, when a message from them arrives, and every minute while the chat is open. Until presence
 * is ready the line shows nothing anyway, so nothing is asked, and what was known is forgotten: their time may have
 * moved meanwhile. When they leave it is forgotten too: their final time is on its way. A failed question is asked
 * again twice before giving up.
 */
function useLastActivity(userId: string | null, conversationId: string, online: boolean, ready: boolean): ActivityStatus | null | undefined {
  const key = userId ? `${conversationId}|${userId}` : null;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [seen, setSeen] = useState({ key, ready, online });
  if (seen.key !== key || seen.ready !== ready || seen.online !== online) {
    setSeen({ key, ready, online });
    if (seen.key !== key || !ready || (seen.online && !online)) setAnswer(null);
  }
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!key || !ready) return;
    const again = () => setRound((n) => n + 1);
    const timer = setInterval(again, ACTIVITY_REFETCH_MS);
    const onMessage = (c: string, sender: string) => {
      if (c === conversationId && sender === userId) again();
    };
    incoming.add(onMessage);
    return () => {
      clearInterval(timer);
      incoming.delete(onMessage);
    };
  }, [key, ready, conversationId, userId]);
  const question = key && ready ? `${key}|${online ? "online" : "offline"}|${round}` : null;
  useEffect(() => {
    if (!question || !userId) return;
    let current = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const ask = (attempt: number) => {
      getActivityStatus(createClient(), userId).then(
        (activity) => {
          if (!current) return;
          hadTime.set(userId, activity !== null);
          setAnswer({ question, activity });
        },
        () => {
          if (!current) return;
          if (attempt < 2) retry = setTimeout(() => ask(attempt + 1), 2000 * (attempt + 1));
          else setAnswer({ question, activity: null });
        },
      );
    };
    ask(0);
    return () => {
      current = false;
      if (retry) clearTimeout(retry);
    };
  }, [question, userId]);
  // An answer about this person in this chat still stands while a newer question is on its way.
  return answer && key && answer.question.startsWith(`${key}|`) ? answer.activity : undefined;
}

/** The time, again every `intervalMs` (never with null) and whenever the tab comes back, so "Active 5 min ago" keeps counting. */
function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const tick = () => setNow(Date.now());
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
  return now;
}

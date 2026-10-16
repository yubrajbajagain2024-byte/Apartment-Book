import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { ACTIVITY_LABEL_REFRESH_MS, ACTIVITY_REFETCH_MS, activityLine, getActivityStatus, type ActivityLine, type ActivityStatus } from "@apartment-book/shared";
import { useOnlineUsers, usePresenceReady, usePresenceStatus } from "@/lib/presence";
import { supabase } from "@/lib/supabase";

/** Whether the latest answer about each person (in any chat) had something to show: then it may well show again soon. */
const hadTime = new Map<string, boolean>();

/**
 * The time now, renewed every `intervalMs` and as soon as the app is back in front (timers stand still in the
 * background). A null interval never renews it.
 */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, intervalMs);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}

/**
 * What activity_status says about the other person in a direct chat (getActivityStatus), for activityLine(): undefined
 * while that is not known, then their time (null if they have not written to you) and whether it is recent, or null
 * when there is nothing to show (the database leaves them out). Pass a null `userId` for a group. Asking again keeps the
 * answer that stands until the new one is in, and `refresh` asks again (a message from them arrived, an unblock). It is
 * asked only while presence is ready, since nothing shows before that:
 *   * when the chat comes into view (it opens, or comes back from chat info or their profile, where a block may have
 *     changed), and every minute while it stays in view (someone active without presence keeps stamping, and "Active
 *     now" needs a recent stamp);
 *   * when presence is known again: at first, after a reconnect, and after coming back to the app from a while away.
 *     Meanwhile the time is forgotten, since it may have moved;
 *   * when they come online or go offline. Going offline forgets the time first: they were active until just now.
 * A failed question is asked again twice before giving up. An answer that a newer question overtook, or that belongs to
 * another chat, is dropped.
 */
export function useActivityStatus(userId: string | null, conversationId: string, online: boolean): { activity: ActivityStatus | null | undefined; refresh: () => void } {
  const ready = usePresenceReady();
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const key = userId ? `${conversationId}|${userId}` : null;
  const [answer, setAnswer] = useState<{ key: string; activity: ActivityStatus | null } | null>(null);
  // Moves on with every question and every forget, so only the latest question's answer is kept.
  const asked = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    asked.current += 1;
    if (retry.current) clearTimeout(retry.current);
    retry.current = null;
  }, []);
  const forget = useCallback(() => {
    cancel();
    setAnswer(null);
  }, [cancel]);
  const ask = useCallback(() => {
    if (!key || !userId || !readyRef.current) return;
    cancel();
    const question = asked.current;
    const run = (attempt: number) => {
      getActivityStatus(supabase, userId).then(
        (activity) => {
          if (asked.current !== question) return;
          hadTime.set(userId, activity !== null);
          setAnswer({ key, activity });
        },
        () => {
          if (asked.current !== question) return;
          if (attempt < 2) {
            retry.current = setTimeout(() => {
              retry.current = null;
              if (asked.current === question) run(attempt + 1);
            }, 2000 * (attempt + 1));
            return;
          }
          setAnswer({ key, activity: null });
        },
      );
    };
    run(0);
  }, [key, userId, cancel]);

  useFocusEffect(
    useCallback(() => {
      ask();
      const timer = setInterval(ask, ACTIVITY_REFETCH_MS);
      return () => clearInterval(timer);
    }, [ask]),
  );

  // Before the screen is drawn, so an out-of-date time never shows, not even for a frame.
  const last = useRef({ ready, online });
  useLayoutEffect(() => {
    const was = last.current;
    last.current = { ready, online };
    if (was.ready === ready && was.online === online) return;
    if (!ready) {
      forget();
      return;
    }
    if (was.online && !online) forget();
    ask();
  }, [ready, online, ask, forget]);

  // Gone: answers still on their way are dropped.
  useEffect(() => cancel, [cancel]);

  return { activity: answer && answer.key === key ? answer.activity : undefined, refresh: ask };
}

/**
 * What a direct chat's header shows under the other person's name (pass a null `userId` for a group, which shows its
 * member count instead): `line` is "Active now" (with the green dot) or when they were last active, redrawn every 30
 * seconds, or null for nothing at all (see activityLine). `waiting` is true while nothing shows yet but their status
 * probably will in a moment (presence is reconnecting, or nothing is known about them yet, and the last answer about
 * them had something), so the header keeps the line's place and the name does not jump. Asking again (every minute, on
 * focus) keeps the answer that stands, which already decides the line: an answer with nothing to show while they are
 * offline ("recent" but no time) is not waiting. For someone whose last answer had nothing (they hide their status, a
 * block) it is false: their header looks as it did before activity status. `refresh` asks for their time again.
 */
export function useChatActivity(userId: string | null, conversationId: string): { line: ActivityLine | null; waiting: boolean; refresh: () => void } {
  const users = useOnlineUsers();
  const online = userId ? users.has(userId) : false;
  const ready = usePresenceReady();
  const status = usePresenceStatus();
  const { activity, refresh } = useActivityStatus(userId, conversationId, online);
  const now = useNow(userId ? ACTIVITY_LABEL_REFRESH_MS : null);
  const line = userId ? activityLine({ ready, online, activity }, now) : null;
  const live = status === "connecting" || status === "ready";
  const waiting = userId !== null && !line && live && hadTime.get(userId) === true && (!ready || activity === undefined);
  return { line, waiting, refresh };
}

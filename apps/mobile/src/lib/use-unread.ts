import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { getTotalUnread, getUnreadNotificationCount } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";

/** Who is showing the Messages badge right now (see reportMessagesRead). */
const readListeners = new Set<(count: number) => void>();

/**
 * The inbox has just marked `count` messages read in one go ("Mark all as read"): the Messages badge drops by that many
 * at once, ahead of the server's word, which then takes over as usual (the memberships' change events refetch it).
 */
export function reportMessagesRead(count: number) {
  for (const listener of readListeners) listener(count);
}

/**
 * How many messages you have not read, across all chats, for the inbox badge. Refetched when any message arrives and when
 * one of your memberships changes (that is where "last read" lives); also when the app comes back to the front and
 * whenever the subscription (re)joins, since changes made while the connection was down (a chat read on the website
 * meanwhile, say) send no event, and opening a chat with nothing new to read writes nothing. "Mark all as read" changes
 * one membership per chat in one statement, so events are gathered for a moment and fetched once. 0 and no subscription
 * while signed out.
 */
export function useUnreadCount(userId: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    const fetchCount = () => getTotalUnread(supabase).then(setCount).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void fetchCount();
      }, 150);
    };
    const drop = (n: number) => setCount((c) => Math.max(0, c - n));
    readListeners.add(drop);
    void fetchCount();
    const channel = supabase
      .channel(`unread:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void fetchCount();
      });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void fetchCount();
    });
    return () => {
      readListeners.delete(drop);
      if (timer) clearTimeout(timer);
      sub.remove();
      supabase.removeChannel(channel);
    };
  }, [userId]);
  return count;
}


/**
 * How many notifications you have not read, for the bell's badge: refetched on any change to your notifications (the
 * table is in the realtime publication), when the app comes back to the front and whenever the subscription (re)joins.
 * 0 and no subscription while signed out.
 */
export function useUnreadNotifications(userId: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    const refresh = () => getUnreadNotificationCount(supabase).then(setCount).catch(() => {});
    refresh();
    const channel = supabase
      .channel(`notifications:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      sub.remove();
      supabase.removeChannel(channel);
    };
  }, [userId]);
  return count;
}

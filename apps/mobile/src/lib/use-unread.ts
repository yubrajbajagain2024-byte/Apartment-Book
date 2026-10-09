import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { getTotalUnread } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";

/**
 * How many messages you have not read, across all chats, for the inbox badge. Refetched when any message arrives and when
 * one of your memberships changes (that is where "last read" lives); 0 and no subscription while signed out.
 */
export function useUnreadCount(userId: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    const refresh = () => getTotalUnread(supabase).then(setCount).catch(() => {});
    refresh();
    const channel = supabase
      .channel(`unread:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
  return count;
}

const UnreadContext = createContext(0);

/**
 * Subscribes once for the whole tab navigator. Every tab header and Home's floating bar shows the badge, and each of them
 * subscribing on its own would mean one realtime channel and one count query per header for every incoming message.
 */
export function UnreadProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const count = useUnreadCount(userId);
  return createElement(UnreadContext.Provider, { value: count }, children);
}

/** The shared unread count from the nearest UnreadProvider (0 outside one). */
export function useUnread(): number {
  return useContext(UnreadContext);
}

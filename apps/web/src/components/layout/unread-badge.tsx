"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getTotalUnread, markDeliveredAll } from "@apartment-book/shared";
import { createClient, ensureRealtimeAuth, uniqueChannelName } from "@/lib/supabase/client";

/** Red counter on the Messages tab. Refreshes when new messages arrive. */
export function UnreadBadge({ initial, userId }: { initial: number; userId: string }) {
  const [count, setCount] = useState(initial);
  const [syncedInitial, setSyncedInitial] = useState(initial);
  const pathname = usePathname();

  // Adopt the server-rendered value whenever it changes (e.g. after router.refresh()).
  if (initial !== syncedInitial) {
    setSyncedInitial(initial);
    setCount(initial);
  }

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const refresh = () => {
      getTotalUnread(supabase)
        .then((n) => {
          if (!cancelled) setCount(n);
        })
        .catch(() => {});
    };

    // Reading a conversation lowers the count; refresh after navigation.
    refresh();
    // The app is open, so every message has reached this device ("Delivered" for senders).
    markDeliveredAll(supabase).catch(() => {});

    ensureRealtimeAuth(supabase).then((authed) => {
      if (cancelled || !authed) return;
      channel = supabase
        .channel(uniqueChannelName(`unread:${userId}`), { config: { postgres_changes_options: { wait: true } } })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
          const row = payload.new as { sender_id: string | null };
          if (row.sender_id !== userId) {
            refresh();
            markDeliveredAll(supabase).catch(() => {});
          }
        })
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, pathname]);

  if (count <= 0) return null;
  return (
    <span className="absolute -right-2 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

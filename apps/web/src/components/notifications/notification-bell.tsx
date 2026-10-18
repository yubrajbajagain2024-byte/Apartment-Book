"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { getUnreadNotificationCount, listNotifications, markNotificationsRead, type NotificationWithActor } from "@apartment-book/shared";
import { createClient, ensureRealtimeAuth, uniqueChannelName } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { RowSkeleton } from "@/components/feed/feed-bits";
import { NotificationItem } from "./notification-item";

/** Top-bar bell: live unread count, dropdown with the latest notifications. */
export function NotificationBell({ userId, initialCount }: { userId: string; initialCount: number }) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationWithActor[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Live badge: any change to my notifications refreshes the count (and the open list).
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => {
      getUnreadNotificationCount(supabase).then((n) => { if (!cancelled) setCount(n); }).catch(() => {});
    };
    refresh();
    ensureRealtimeAuth(supabase).then((authed) => {
      if (cancelled || !authed) return;
      channel = supabase
        .channel(uniqueChannelName(`notifications:${userId}`), { config: { postgres_changes_options: { wait: true } } })
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
          refresh();
          setItems((current) => {
            if (current) listNotifications(supabase, { limit: 12 }).then((list) => { if (!cancelled) setItems(list); }).catch(() => {});
            return current;
          });
        })
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) {
      setLoading(true);
      try { setItems(await listNotifications(createClient(), { limit: 12 })); } catch { setItems([]); } finally { setLoading(false); }
    }
  }

  async function openNotification(n: NotificationWithActor) {
    setOpen(false);
    if (n.read_at === null) {
      setItems((current) => current?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
      setCount((c) => Math.max(0, c - 1));
      markNotificationsRead(createClient(), [n.id]).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    setItems((current) => current?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? null);
    setCount(0);
    markNotificationsRead(createClient()).catch(() => {});
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
        className={cn("ab-press relative flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-900 hover:bg-gray-200", open && "bg-gray-200")}
      >
        <Bell className="h-5 w-5" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Notifications" className="ab-fade-in absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-[14px] bg-white shadow-float ring-1 ring-gray-200">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="font-display text-xl tracking-tight text-gray-900">Notifications</h2>
            {count > 0 ? (
              <button type="button" onClick={markAll} className="text-[13px] font-semibold text-gray-900 hover:underline">
                Mark all as read
              </button>
            ) : null}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {loading || items === null ? (
              // The shape of three rows while the list loads.
              <div className="divide-y divide-gray-100" aria-busy="true" aria-label="Loading">
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </div>
            ) : items.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm leading-relaxed text-gray-500">Nothing yet. New messages, saves and places near campus will show here.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {items.map((n) => <NotificationItem key={n.id} notification={n} onOpen={openNotification} compact />)}
              </div>
            )}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-gray-100 px-4 py-2.5 text-center text-[13px] font-semibold text-gray-900 transition-colors hover:bg-gray-50">
            See all
          </Link>
        </div>
      ) : null}
    </div>
  );
}

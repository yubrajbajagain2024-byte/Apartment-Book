"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { listNotifications, markNotificationsRead, type NotificationWithActor } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { NotificationItem } from "./notification-item";

const PAGE = 30;

/** Full notifications page body: mark all, open, load older. */
export function NotificationList({ initial }: { initial: NotificationWithActor[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const unread = items.filter((n) => n.read_at === null).length;

  async function open(n: NotificationWithActor) {
    if (n.read_at === null) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      markNotificationsRead(createClient(), [n.id]).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loading) return;
    setLoading(true);
    try {
      const older = await listNotifications(createClient(), { limit: PAGE, before: last.created_at });
      setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.id === o.id))]);
      setDone(older.length < PAGE);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
        {unread > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setItems((cur) => cur.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
              markNotificationsRead(createClient()).catch(() => {});
              router.refresh();
            }}
          >
            Mark all as read
          </Button>
        ) : null}
      </div>
      <div className="divide-y divide-gray-100 rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-600">Nothing yet. New messages, saves and places near campus will show here.</p>
        ) : (
          items.map((n) => <NotificationItem key={n.id} notification={n} onOpen={open} />)
        )}
      </div>
      {!done ? (
        <Button variant="outline" onClick={loadMore} loading={loading} className="self-center">
          Load older
        </Button>
      ) : null}
    </div>
  );
}

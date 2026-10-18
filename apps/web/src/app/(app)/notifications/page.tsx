import type { Metadata } from "next";
import { listNotifications } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NotificationList } from "@/components/notifications/notification-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireUser("/notifications");
  const notifications = await listNotifications(await createClient(), { limit: 30 }).catch(() => []);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-3xl tracking-tight text-gray-900">Notifications</h1>
      <NotificationList initial={notifications} />
    </div>
  );
}

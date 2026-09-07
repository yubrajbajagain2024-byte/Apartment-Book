"use client";

import { Bell, Bookmark, MapPin, MessageCircle } from "lucide-react";
import { timeAgo, type NotificationWithActor } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

const ICONS = { message: MessageCircle, listing_saved: Bookmark, nearby_listing: MapPin, system: Bell } as const;

/** One row in the bell dropdown or the notifications page. */
export function NotificationItem({ notification, onOpen, compact }: { notification: NotificationWithActor; onOpen: (n: NotificationWithActor) => void; compact?: boolean }) {
  const Icon = ICONS[notification.type as keyof typeof ICONS] ?? Bell;
  const unread = notification.read_at === null;
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cn("flex w-full items-start gap-3 rounded-lg px-3 text-left hover:bg-gray-100", compact ? "py-2" : "py-3", unread && "bg-brand-50/60")}
    >
      <span className="relative shrink-0">
        {notification.actor ? (
          <Avatar name={notification.actor.full_name} src={notification.actor.avatar_url} size={compact ? "sm" : "md"} />
        ) : (
          <span className={cn("flex items-center justify-center rounded-full bg-brand-100 text-brand-700", compact ? "h-8 w-8" : "h-10 w-10")}>
            <Icon className="h-4 w-4" />
          </span>
        )}
        {notification.actor ? (
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white ring-2 ring-white">
            <Icon className="h-3 w-3" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", unread ? "font-semibold text-gray-900" : "text-gray-800")}>{notification.title}</span>
        {notification.body ? <span className="line-clamp-2 text-sm text-gray-600">{notification.body}</span> : null}
        <span className={cn("block text-xs", unread ? "font-medium text-brand-700" : "text-gray-500")} suppressHydrationWarning>
          {timeAgo(notification.created_at)}
        </span>
      </span>
      {unread ? <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" aria-label="Unread" /> : null}
    </button>
  );
}

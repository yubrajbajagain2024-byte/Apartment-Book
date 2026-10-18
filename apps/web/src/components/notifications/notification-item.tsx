"use client";

import { Bell, Bookmark, MapPin, MessageCircle, MessageSquare, ThumbsUp, UserPlus } from "lucide-react";
import { timeAgo, type NotificationWithActor } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

const ICONS = { message: MessageCircle, listing_saved: Bookmark, nearby_listing: MapPin, system: Bell, like: ThumbsUp, comment: MessageSquare, follow: UserPlus } as const;

/** One row in the bell dropdown or the notifications page. */
export function NotificationItem({ notification, onOpen, compact }: { notification: NotificationWithActor; onOpen: (n: NotificationWithActor) => void; compact?: boolean }) {
  const Icon = ICONS[notification.type as keyof typeof ICONS] ?? Bell;
  const unread = notification.read_at === null;
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      // Unread is said by the weight of the words and the small accent dot, never by a tinted row.
      className={cn("flex w-full items-start gap-3 px-4 text-left transition-colors hover:bg-gray-50", compact ? "py-2.5" : "py-3.5")}
    >
      <span className="relative shrink-0">
        {notification.actor ? (
          <Avatar name={notification.actor.full_name} src={notification.actor.avatar_url} size={compact ? "sm" : "md"} />
        ) : (
          <span className={cn("flex items-center justify-center rounded-full bg-white text-gray-900 ring-1 ring-gray-200", compact ? "h-8 w-8" : "h-10 w-10")}>
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
        )}
        {notification.actor ? (
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-white ring-2 ring-white">
            <Icon className="h-3 w-3" strokeWidth={2} />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", unread ? "font-semibold text-gray-900" : "font-medium text-gray-700")}>{notification.title}</span>
        {notification.body ? <span className={cn("line-clamp-2 text-sm", unread ? "text-gray-700" : "text-gray-500")}>{notification.body}</span> : null}
        <span className={cn("mt-0.5 block text-[11px] tracking-[0.02em]", unread ? "text-gray-600" : "text-gray-400")} suppressHydrationWarning>
          {timeAgo(notification.created_at)}
        </span>
      </span>
      {unread ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
    </button>
  );
}

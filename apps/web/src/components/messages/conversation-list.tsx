"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SquarePen, Users } from "lucide-react";
import type { ConversationSummary } from "@apartment-book/shared";
import { useHydrated } from "@/lib/hooks";
import { createClient, ensureRealtimeAuth, uniqueChannelName } from "@/lib/supabase/client";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { OnlineDot } from "@/components/presence/online-dot";

export function ConversationAvatar({ conversation, size = "md" }: { conversation: ConversationSummary; size?: "sm" | "md" | "lg" }) {
  if (conversation.type === "group") {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700", size === "lg" ? "h-14 w-14" : size === "md" ? "h-12 w-12" : "h-8 w-8")}>
        <Users className={size === "sm" ? "h-4 w-4" : "h-6 w-6"} />
      </span>
    );
  }
  const other = conversation.otherMembers[0];
  return (
    <span className="relative flex shrink-0">
      <Avatar name={other?.full_name ?? "?"} src={other?.avatar_url} size={size === "md" ? "lg" : size} />
      {other ? <OnlineDot userId={other.id} size={size === "sm" ? "sm" : "md"} /> : null}
    </span>
  );
}

export function ConversationList({ conversations, currentUserId }: { conversations: ConversationSummary[]; currentUserId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh the list (previews, order, unread counts) when anything changes.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    ensureRealtimeAuth(supabase).then((authed) => {
      if (cancelled || !authed) return;
      channel = supabase
        .channel(uniqueChannelName(`conversation-list:${currentUserId}`), { config: { postgres_changes_options: { wait: true } } })
        .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, refresh)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [currentUserId, router]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-xl font-bold">Chats</h1>
        <Link href="/messages/new" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200" aria-label="New message">
          <SquarePen className="h-5 w-5" />
        </Link>
      </div>
      <ul className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-gray-500">
            No conversations yet. Message a listing owner, or{" "}
            <Link href="/messages/new" className="font-medium text-brand-600 hover:underline">
              start a new chat
            </Link>
            .
          </li>
        ) : null}
        {conversations.map((c) => {
          const active = pathname === `/messages/${c.id}`;
          const unread = c.unreadCount > 0;
          return (
            <li key={c.id}>
              <Link
                href={`/messages/${c.id}`}
                className={cn("flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-gray-100", active && "bg-brand-50 hover:bg-brand-50")}
              >
                <ConversationAvatar conversation={c} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("truncate text-sm", unread ? "font-bold text-gray-900" : "font-semibold text-gray-800")}>{c.title}</p>
                    <span className="shrink-0 text-[11px] text-gray-500">{hydrated ? timeAgo(c.lastMessageAt) : ""}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("truncate text-xs", unread ? "font-semibold text-gray-900" : "text-gray-500")}>
                      {c.lastMessagePreview ?? (c.type === "group" ? `${c.members.length} members` : "Say hi 👋")}
                    </p>
                    {unread ? (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

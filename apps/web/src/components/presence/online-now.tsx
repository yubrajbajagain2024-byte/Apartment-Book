"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { startDirectConversationAction } from "@/lib/actions/messages";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { useOnlineUsers } from "./presence-provider";

/**
 * Who is online right now, like Facebook's contacts column. `layout="column"`
 * for the desktop sidebar, `layout="strip"` for a horizontal row on phones.
 */
export function OnlineNow({ currentUserId, layout = "column", className }: { currentUserId: string | null; layout?: "column" | "strip"; className?: string }) {
  const users = useOnlineUsers();
  const people = [...users.values()].filter((u) => u.id !== currentUserId).sort((a, b) => a.full_name.localeCompare(b.full_name));

  if (!currentUserId) return null;

  if (layout === "strip") {
    if (people.length === 0) return null;
    return (
      <div className={cn("flex items-center gap-3 overflow-x-auto px-3 py-2", className)} data-testid="online-strip" aria-label="Online now">
        {people.map((u) => (
          <form key={u.id} action={startDirectConversationAction} className="flex w-14 shrink-0 flex-col items-center gap-1">
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="returnTo" value="/roommates" />
            <button type="submit" className="relative rounded-full" aria-label={`Message ${u.full_name}`}>
              <Avatar name={u.full_name} src={u.avatar_url} size="lg" />
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-green-500 ring-2 ring-white" />
            </button>
            <span className="w-full truncate text-center text-[11px] text-gray-700">{u.full_name.split(" ")[0]}</span>
          </form>
        ))}
      </div>
    );
  }

  return (
    <section className={cn("rounded-xl bg-white p-3 ring-1 ring-gray-200", className)} aria-label="Online now" data-testid="online-now">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-gray-700">Online now</h2>
        <span className="text-xs text-gray-500">{people.length}</span>
      </div>
      {people.length === 0 ? (
        <p className="px-1 py-2 text-sm text-gray-500">No one else is online right now.</p>
      ) : (
        <ul className="flex flex-col">
          {people.map((u) => (
            <li key={u.id} className="group flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-gray-100">
              <Link href={`/profile/${u.id}`} className="relative shrink-0">
                <Avatar name={u.full_name} src={u.avatar_url} size="sm" />
                <span className="absolute -bottom-0 -right-0 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white" />
              </Link>
              <Link href={`/profile/${u.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                {u.full_name}
              </Link>
              <form action={startDirectConversationAction}>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="returnTo" value="/roommates" />
                <button type="submit" className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-brand-50 hover:text-brand-600" aria-label={`Message ${u.full_name}`}>
                  <MessageCircle className="h-4 w-4" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

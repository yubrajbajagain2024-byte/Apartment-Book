"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PHONE_TABS } from "./nav-tabs";
import { UnreadBadge } from "./unread-badge";

export function BottomNav({ unread, userId }: { unread: number; userId: string | null }) {
  const pathname = usePathname();
  // Hide the bar inside an open chat so the composer has the full screen.
  if (/^\/messages\/[^/]+$/.test(pathname) && pathname !== "/messages/new") return null;

  // Home, Explore, Messages, Profile, like the app; Search lives in the header.
  const tabs = PHONE_TABS;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="Main"
    >
      {tabs.map((tab) => {
        const active = tab.match(pathname, userId);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold tracking-[0.02em] transition-colors",
              active ? "text-gray-900" : "text-gray-400",
            )}
            aria-current={active ? "page" : undefined}
          >
            <span className="relative">
              <Icon className="h-6 w-6" strokeWidth={active ? 2.25 : 1.75} />
              {tab.href === "/messages" && userId ? <UnreadBadge initial={unread} userId={userId} /> : null}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

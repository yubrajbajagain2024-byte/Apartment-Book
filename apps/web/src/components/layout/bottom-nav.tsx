"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_TABS } from "./nav-tabs";
import { UnreadBadge } from "./unread-badge";

export function BottomNav({ unread, userId }: { unread: number; userId: string | null }) {
  const pathname = usePathname();
  // Hide the bar inside an open chat so the composer has the full screen.
  if (/^\/messages\/[^/]+$/.test(pathname) && pathname !== "/messages/new") return null;

  const tabs = [
    ...NAV_TABS,
    {
      href: userId ? "/profile/me" : "/login",
      label: userId ? "Profile" : "Log in",
      icon: User,
      match: (p: string) => p.startsWith("/profile") || p.startsWith("/settings") || p === "/login",
    },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Main"
    >
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium",
              active ? "text-brand-600" : "text-gray-500",
            )}
            aria-current={active ? "page" : undefined}
          >
            <span className="relative">
              <Icon className="h-6 w-6" />
              {tab.href === "/messages" && userId ? <UnreadBadge initial={unread} userId={userId} /> : null}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

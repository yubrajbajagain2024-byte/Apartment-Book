"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageCircle, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "./unread-badge";

export type NavTab = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Marks the tab active for every path under this prefix. */
  match: (pathname: string) => boolean;
};

export const NAV_TABS: NavTab[] = [
  { href: "/", label: "Home", icon: Home, match: (p) => p === "/" || p.startsWith("/apartments") },
  { href: "/roommates", label: "Roommates", icon: Users, match: (p) => p.startsWith("/roommates") },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingBag, match: (p) => p.startsWith("/marketplace") },
  { href: "/messages", label: "Messages", icon: MessageCircle, match: (p) => p.startsWith("/messages") },
];

export function NavTabs({ unread, userId }: { unread: number; userId: string | null }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-stretch md:flex" aria-label="Main">
      {NAV_TABS.map((tab) => {
        const active = tab.match(pathname);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "relative flex w-24 flex-col items-center justify-center gap-0.5 border-b-[3px] text-xs font-medium transition-colors lg:w-28",
              active
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-800",
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

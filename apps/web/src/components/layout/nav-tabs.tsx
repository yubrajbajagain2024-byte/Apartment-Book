"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Home, MessageCircle, ShoppingBag, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "./unread-badge";

export type NavTab = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Marks the tab active for every path under this prefix. */
  match: (pathname: string) => boolean;
};

/** Home = For you, Buzz, Posts and Reels. */
const HOME_PREFIXES = ["/posts", "/reels", "/buzz"];
/** Housing = the Apartments and Roommates pages, which keep their own addresses and switch through the Housing sub-tabs. */
const HOUSING_PREFIXES = ["/apartments", "/roommates"];

export const NAV_TABS: NavTab[] = [
  { href: "/", label: "Home", icon: Home, match: (p) => p === "/" || HOME_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)) },
  { href: "/apartments", label: "Housing", icon: Building2, match: (p) => HOUSING_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)) },
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
              "relative flex w-20 flex-col items-center justify-center gap-0.5 border-b-[3px] text-xs font-medium transition-colors lg:w-24 xl:w-28",
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

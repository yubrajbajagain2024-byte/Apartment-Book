"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Home, MessageCircle, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "./unread-badge";

export type NavTab = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Marks the tab active for the given path; `userId` lets Profile light up only on the viewer's own pages. */
  match: (pathname: string, userId: string | null) => boolean;
};

/** Home = For you, Buzz, Posts and Reels. */
const HOME_PREFIXES = ["/posts", "/reels", "/buzz"];
/** Explore (housing) = the Apartments, Roommates and Marketplace pages, which keep their own addresses and switch through the Housing sub-tabs. */
const HOUSING_PREFIXES = ["/apartments", "/roommates", "/marketplace"];

const HOME: NavTab = { href: "/", label: "Home", icon: Home, match: (p) => p === "/" || HOME_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)) };
const HOUSING: NavTab = { href: "/apartments", label: "Explore", icon: Compass, match: (p) => HOUSING_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)) };
const MESSAGES: NavTab = { href: "/messages", label: "Messages", icon: MessageCircle, match: (p) => p.startsWith("/messages") };
/** Profile = your own profile (never someone else's) plus the pages the app's Profile tab lists (Saved, Settings). Signed out, /profile/me redirects to login. */
const PROFILE: NavTab = {
  href: "/profile/me",
  label: "Profile",
  icon: UserRound,
  match: (p, me) => p === "/profile/me" || (me !== null && (p === `/profile/${me}` || p.startsWith(`/profile/${me}/`))) || p.startsWith("/saved") || p.startsWith("/settings"),
};

/** Desktop header tabs. Search is not a tab: the header's search box is the search entry point on every screen, like TikTok's magnifier. */
export const NAV_TABS: NavTab[] = [HOME, HOUSING, MESSAGES];

/** Phone bottom bar, mirroring the app: Home, Explore, Messages, Profile. Search lives in the header (a magnifier on phones). */
export const PHONE_TABS: NavTab[] = [HOME, HOUSING, MESSAGES, PROFILE];

export function NavTabs({ unread, userId }: { unread: number; userId: string | null }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-stretch md:flex" aria-label="Main">
      {NAV_TABS.map((tab) => {
        const active = tab.match(pathname, userId);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "relative flex w-20 flex-col items-center justify-center gap-0.5 border-b-2 text-[11px] font-semibold tracking-[0.02em] transition-colors lg:w-24 xl:w-28",
              active
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-900",
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

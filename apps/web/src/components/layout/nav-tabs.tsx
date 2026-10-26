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
/** My buzzes is opened from Settings, never from Home (UniVerse keeps it out of Home), so it lights Profile like Settings does. */
const isMyBuzzes = (p: string) => p === "/buzz/mine" || p.startsWith("/buzz/mine/");
/** Explore (housing) = the Apartments, Roommates and Marketplace pages, which keep their own addresses and switch through the Housing sub-tabs. */
const HOUSING_PREFIXES = ["/apartments", "/roommates", "/marketplace"];

const HOME: NavTab = { href: "/", label: "Home", icon: Home, match: (p) => p === "/" || (!isMyBuzzes(p) && HOME_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) };
const HOUSING: NavTab = { href: "/apartments", label: "Explore", icon: Compass, match: (p) => HOUSING_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)) };
const MESSAGES: NavTab = { href: "/messages", label: "Messages", icon: MessageCircle, match: (p) => p.startsWith("/messages") };
/** Profile = your own profile (never someone else's) plus the pages the app's Profile tab lists (Saved, Settings). Signed out, /profile/me redirects to login. */
const PROFILE: NavTab = {
  href: "/profile/me",
  label: "Profile",
  icon: UserRound,
  match: (p, me) => p === "/profile/me" || (me !== null && (p === `/profile/${me}` || p.startsWith(`/profile/${me}/`))) || p.startsWith("/saved") || p.startsWith("/settings") || isMyBuzzes(p),
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
              "relative flex w-20 flex-col items-center justify-center gap-0.5 border-b-[3px] text-xs font-medium transition-colors lg:w-24 xl:w-28",
              active
                ? "border-transparent text-brand-600"
                : "border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-800",
            )}
            aria-current={active ? "page" : undefined}
          >
            {/* The active tab's bar, drawn over its bottom border: the aurora, as under the section tabs. */}
            {active ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-[3px] h-[3px] bg-brand-600 bg-aurora-line" /> : null}
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

"use client";

import { Briefcase, Building2, Inbox, LayoutDashboard, LogOut, ShieldCheck, Store, Tag, Users, type LucideIcon } from "lucide-react";
import { BUSINESS_PORTAL_NAME, type BusinessStanding } from "@apartment-book/shared";
import { businessSignOutAction } from "@/lib/actions/business";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { UnreadBadge } from "@/components/layout/unread-badge";
import { PortalLink, usePortalPathname } from "./portal-base";

type Tab = { href: string; label: string; icon: LucideIcon };

const BUSINESS_TABS: Tab[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/listings", label: "Listings", icon: Building2 },
  { href: "/deals", label: "Deals", icon: Tag },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/team", label: "Team", icon: Users },
];
const ADMIN_TAB: Tab = { href: "/admin", label: "Review", icon: ShieldCheck };
/** What each standing opens: drafting while pending, everything once approved, only the profile when rejected. */
const TABS_BY_STANDING: Record<BusinessStanding, string[]> = {
  pending: ["/", "/listings", "/deals", "/team"],
  approved: ["/", "/listings", "/deals", "/inbox", "/team"],
  rejected: ["/"],
  suspended: [],
};

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The portal's chrome: a top bar with the business's name, the tabs on wider screens and an account menu; on phones
 * the tabs sit in a bottom bar, like the student site's. Inside an open inquiry the bottom bar steps aside for the composer.
 */
export function PortalNav({
  user,
  business,
  isAdmin,
  unread,
}: {
  user: { id: string; name: string; avatarUrl: string | null };
  business: { name: string; role: "owner" | "staff"; standing: BusinessStanding } | null;
  isAdmin: boolean;
  unread: number;
}) {
  const pathname = usePortalPathname();
  const tabs = [...(business ? BUSINESS_TABS.filter((t) => TABS_BY_STANDING[business.standing].includes(t.href)) : []), ...(isAdmin ? [ADMIN_TAB] : [])];
  const inChat = /^\/inbox\/[^/]+$/.test(pathname);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 sm:px-4">
          <PortalLink href="/" className="flex min-w-0 items-center gap-2 text-brand-600" aria-label={BUSINESS_PORTAL_NAME}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 bg-aurora text-white">
              <Briefcase className="h-5 w-5" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-bold text-gray-900">{business?.name ?? BUSINESS_PORTAL_NAME}</span>
              <span className="block truncate text-[11px] text-gray-500">{business ? BUSINESS_PORTAL_NAME : "Admin"}</span>
            </span>
          </PortalLink>

          <nav className="ml-4 hidden flex-1 items-stretch md:flex" aria-label="Portal">
            {tabs.map((tab) => {
              const active = isActive(pathname, tab.href);
              const Icon = tab.icon;
              return (
                <PortalLink
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "relative flex h-14 items-center gap-1.5 px-3 text-sm font-medium transition-colors",
                    active ? "text-brand-600" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {active ? <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-[3px] bg-brand-600 bg-aurora-line" /> : null}
                  <span className="relative">
                    <Icon className="h-5 w-5" />
                    {tab.href === "/inbox" ? <UnreadBadge initial={unread} userId={user.id} /> : null}
                  </span>
                  {tab.label}
                </PortalLink>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {business ? (
              <PortalLink href="/profile" className="hidden items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 sm:inline-flex">
                <Store className="h-4 w-4" /> Business profile
              </PortalLink>
            ) : null}
            <details className="relative">
              <summary className="list-none cursor-pointer rounded-full [&::-webkit-details-marker]:hidden" aria-label="Account menu">
                <Avatar name={user.name} src={user.avatarUrl} size="md" className="ring-2 ring-transparent hover:ring-gray-300" />
              </summary>
              <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-gray-200">
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-semibold text-gray-900">{user.name}</p>
                  <p className="text-xs text-gray-500">{business ? (business.role === "owner" ? "Owner" : "Staff") : "CampConnect admin"}</p>
                </div>
                <div className="my-1 h-px bg-gray-100" />
                {business ? (
                  <PortalLink href="/profile" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 sm:hidden">
                    <Store className="h-4 w-4" /> Business profile
                  </PortalLink>
                ) : null}
                <form action={businessSignOutAction}>
                  <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100">
                    <LogOut className="h-4 w-4" /> Log out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>

      {!inChat && tabs.length > 0 ? (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Portal">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab.href);
            const Icon = tab.icon;
            return (
              <PortalLink
                key={tab.href}
                href={tab.href}
                className={cn(
                  "group flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-150",
                  active ? "text-brand-600" : "text-gray-500",
                )}
                aria-current={active ? "page" : undefined}
              >
                <span className="relative transition-[scale] duration-150 ease-out motion-safe:group-active:scale-90">
                  <Icon className="h-6 w-6" />
                  {tab.href === "/inbox" ? <UnreadBadge initial={unread} userId={user.id} /> : null}
                </span>
                {tab.label}
              </PortalLink>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}

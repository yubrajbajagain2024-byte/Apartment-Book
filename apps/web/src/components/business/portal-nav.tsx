"use client";

import { BarChart3, Bell, Building2, Inbox, LayoutGrid, LogOut, Megaphone, ShieldCheck, Store, Users, type LucideIcon } from "lucide-react";
import { BUSINESS_PORTAL_NAME, teamRoleAllows, teamRoleLabel, type BusinessStanding, type BusinessTeamRole } from "@apartment-book/shared";
import { businessSignOutAction } from "@/lib/actions/business";
import type { PortalTheme } from "@/lib/business/theme";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { UnreadBadge } from "@/components/layout/unread-badge";
import { PortalLink, usePortalPathname } from "./portal-base";
import { ThemeSwitch } from "./theme-switch";

type Tab = { href: string; label: string; icon: LucideIcon };

const DASHBOARD: Tab = { href: "/", label: "Home", icon: LayoutGrid };
const ADS: Tab = { href: "/ads", label: "Ads", icon: Megaphone };
const POSTS: Tab = { href: "/deals", label: "Posts", icon: Store };
const LISTINGS: Tab = { href: "/listings", label: "Listings", icon: Building2 };
const INBOX: Tab = { href: "/inbox", label: "Inbox", icon: Inbox };
const ANALYTICS: Tab = { href: "/analytics", label: "Analytics", icon: BarChart3 };
const TEAM: Tab = { href: "/team", label: "Team", icon: Users };
const ADMIN: Tab = { href: "/admin", label: "Review", icon: ShieldCheck };

/**
 * What a member's place opens: drafting while pending, everything their role allows once approved, nothing but the
 * front page when rejected. The inbox is for the roles that reply (never an analyst); listings for housing businesses
 * and any business that already has one.
 */
function tabsFor(business: { role: BusinessTeamRole; standing: BusinessStanding; housing: boolean }): Tab[] {
  if (business.standing === "rejected" || business.standing === "suspended") return [DASHBOARD];
  const tabs = [DASHBOARD, ADS, POSTS];
  if (business.housing) tabs.push(LISTINGS);
  if (business.standing === "approved" && teamRoleAllows(business.role, "reply")) tabs.push(INBOX);
  tabs.push(ANALYTICS, TEAM);
  return tabs;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The portal's chrome: a frosted bar with the business, its tabs on wider screens, the notifications and the account
 * menu (appearance included); on phones the main tabs sit in a frosted bottom bar, which steps aside inside an open
 * inquiry for the composer.
 */
export function PortalNav({
  user,
  business,
  isAdmin,
  unread,
  notifications,
  theme,
}: {
  user: { id: string; name: string; avatarUrl: string | null };
  business: { name: string; logoUrl: string | null; role: BusinessTeamRole; standing: BusinessStanding; housing: boolean } | null;
  isAdmin: boolean;
  unread: number;
  notifications: number;
  theme: PortalTheme;
}) {
  const pathname = usePortalPathname();
  const tabs = [...(business ? tabsFor(business) : []), ...(isAdmin ? [ADMIN] : [])];
  const phoneTabs = tabs.slice(0, 5);
  const inChat = /^\/inbox\/[^/]+$/.test(pathname);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-biz-line bg-biz-glass backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <PortalLink href="/" className="flex min-w-0 items-center gap-2.5" aria-label={BUSINESS_PORTAL_NAME}>
            <Avatar name={business?.name ?? BUSINESS_PORTAL_NAME} src={business?.logoUrl ?? null} size="sm" className="ring-1 ring-biz-line" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-biz-ink">{business?.name ?? BUSINESS_PORTAL_NAME}</span>
              <span className="block truncate text-[11px] text-biz-ink-4">{business ? BUSINESS_PORTAL_NAME : "UniBuzz team"}</span>
            </span>
          </PortalLink>

          <nav className="ml-6 hidden flex-1 items-center gap-1 md:flex" aria-label="Portal">
            {tabs.map((tab) => {
              const active = isActive(pathname, tab.href);
              return (
                <PortalLink
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color] duration-200",
                    active ? "bg-biz-ink text-biz-surface" : "text-biz-ink-3 hover:bg-biz-line hover:text-biz-ink",
                  )}
                >
                  {tab.label}
                  {tab.href === "/inbox" ? <UnreadBadge initial={unread} userId={user.id} /> : null}
                </PortalLink>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            {business ? (
              <PortalLink
                href="/notifications"
                aria-label={notifications ? `Notifications, ${notifications} new` : "Notifications"}
                className="relative flex h-9 w-9 items-center justify-center rounded-full text-biz-ink-2 transition-colors hover:bg-biz-line hover:text-biz-ink"
              >
                <Bell className="h-[18px] w-[18px]" />
                {notifications ? (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-biz-danger px-1 text-[10px] font-semibold text-white">{notifications > 9 ? "9+" : notifications}</span>
                ) : null}
              </PortalLink>
            ) : null}
            <details className="group relative">
              <summary className="list-none cursor-pointer rounded-full [&::-webkit-details-marker]:hidden" aria-label="Account menu">
                <Avatar name={user.name} src={user.avatarUrl} size="sm" className="ring-2 ring-transparent transition-[box-shadow] group-open:ring-biz-accent hover:ring-biz-line-strong" />
              </summary>
              <div className="ab-menu-in absolute right-0 top-full z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl bg-biz-surface p-2 shadow-biz-lift ring-1 ring-biz-line">
                <div className="px-3 pb-2 pt-1.5">
                  <p className="truncate text-sm font-semibold text-biz-ink">{user.name}</p>
                  <p className="text-xs text-biz-ink-3">{business ? `${teamRoleLabel(business.role)} · ${business.name}` : "UniBuzz team"}</p>
                </div>
                {business ? (
                  <div className="flex flex-col border-t border-biz-line py-1">
                    <MenuLink href="/profile" icon={Store} label="Business profile" />
                    {tabs.slice(5).map((t) => (
                      <MenuLink key={t.href} href={t.href} icon={t.icon} label={t.label} className="md:hidden" />
                    ))}
                  </div>
                ) : null}
                <div className="border-t border-biz-line px-1 py-2">
                  <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-biz-ink-4">Appearance</p>
                  <ThemeSwitch initial={theme} />
                </div>
                <form action={businessSignOutAction} className="border-t border-biz-line pt-1">
                  <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-biz-ink-2 transition-colors hover:bg-biz-line hover:text-biz-ink">
                    <LogOut className="h-4 w-4" /> Log out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>

      {!inChat && phoneTabs.length > 1 ? (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-biz-line bg-biz-glass pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden" aria-label="Portal">
          {phoneTabs.map((tab) => {
            const active = isActive(pathname, tab.href);
            const Icon = tab.icon;
            return (
              <PortalLink
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn("group flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors duration-200", active ? "text-biz-accent-ink" : "text-biz-ink-4")}
              >
                <span className="relative transition-[scale] duration-200 ease-out motion-safe:group-active:scale-90">
                  <Icon className="h-6 w-6" strokeWidth={active ? 2.2 : 1.8} />
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

function MenuLink({ href, icon: Icon, label, className }: { href: string; icon: LucideIcon; label: string; className?: string }) {
  return (
    <PortalLink href={href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-biz-ink-2 transition-colors hover:bg-biz-line hover:text-biz-ink", className)}>
      <Icon className="h-4 w-4" /> {label}
    </PortalLink>
  );
}

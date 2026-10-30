"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, Bell, ChevronRight, CreditCard, Inbox, LayoutGrid, LogOut, Megaphone, Menu, Package, Settings, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { BUSINESS_PORTAL_NAME, portalSectionsFor, teamRoleLabel, type BusinessStanding, type BusinessTeamRole, type PortalSection } from "@apartment-book/shared";
import { businessSignOutAction } from "@/lib/actions/business";
import type { PortalTheme } from "@/lib/business/theme";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { useInboxUnread } from "./inbox-live";
import { IntentLink, PortalLink, usePortalPathname } from "./portal-base";
import { ThemeSwitch } from "./theme-switch";

type Item = { href: string; label: string; icon: LucideIcon; match: string[] };

/** Every section's page and the pages that belong to it (Products & Services holds the posts and the listings). */
const ITEMS: Record<PortalSection | "settings" | "review", Item> = {
  overview: { href: "/", label: "Overview", icon: LayoutGrid, match: [] },
  ads: { href: "/ads", label: "Advertisements", icon: Megaphone, match: ["/ads"] },
  inbox: { href: "/inbox", label: "Inbox", icon: Inbox, match: ["/inbox"] },
  products: { href: "/deals", label: "Products & Services", icon: Package, match: ["/deals", "/listings"] },
  analytics: { href: "/analytics", label: "Analytics", icon: BarChart3, match: ["/analytics"] },
  billing: { href: "/billing", label: "Billing", icon: CreditCard, match: ["/billing"] },
  settings: { href: "/settings", label: "Settings", icon: Settings, match: ["/settings", "/profile", "/team"] },
  review: { href: "/admin", label: "Business review", icon: ShieldCheck, match: ["/admin"] },
};

function isActive(pathname: string, item: Item): boolean {
  if (item.href === "/") return pathname === "/";
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

type SidebarProps = {
  user: { id: string; name: string; avatarUrl: string | null };
  business: { name: string; logoUrl: string | null; role: BusinessTeamRole; standing: BusinessStanding } | null;
  isAdmin: boolean;
  unread: number;
  notifications: number;
  theme: PortalTheme;
};

/**
 * The portal's chrome: a graphite sidebar with the business, its sections in a fixed order (what the member's role
 * and the business's standing open: portalSectionsFor), the UniBuzz team's review for admins, and Settings set apart
 * at the bottom above the account. On wide screens it stays in place; on tablets and phones a slim top bar opens it as
 * a drawer, which closes on the next page, on Escape and on the scrim.
 */
export function PortalSidebar(props: SidebarProps) {
  const pathname = usePortalPathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // A new page closes the drawer (state adjusted during render, as React recommends over an effect).
  if (open && pathname !== openedAt) setOpen(false);

  useEffect(() => {
    if (!open) return;
    const button = trigger.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      button?.focus();
    };
  }, [open]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--biz-sidebar-width)] border-r border-biz-side-line bg-biz-side lg:flex print:hidden" aria-label="Portal">
        <SidebarBody {...props} pathname={pathname} />
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-biz-side-line bg-biz-side px-2 text-biz-side-ink lg:hidden print:hidden">
        <button
          ref={trigger}
          type="button"
          onClick={() => {
            setOpenedAt(pathname);
            setOpen(true);
          }}
          aria-label="Open the menu"
          aria-expanded={open}
          aria-controls="portal-drawer"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-biz-side-ink-2 transition-colors hover:bg-biz-side-hover hover:text-biz-side-ink"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <PortalLink
          href={props.business ? "/preview" : "/"}
          aria-label={props.business ? `${props.business.name}: view your public profile` : undefined}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1"
        >
          <Avatar name={props.business?.name ?? BUSINESS_PORTAL_NAME} src={props.business?.logoUrl ?? null} size="xs" className="ring-1 ring-biz-side-line" />
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{props.business?.name ?? BUSINESS_PORTAL_NAME}</span>
        </PortalLink>
        {props.business ? <NotificationsButton count={props.notifications} /> : null}
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" id="portal-drawer">
          <button type="button" aria-label="Close the menu" tabIndex={-1} onClick={() => setOpen(false)} className="ab-scrim-in absolute inset-0 bg-biz-scrim" />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Portal menu"
            className="ab-drawer-in absolute inset-y-0 left-0 flex w-[min(var(--biz-sidebar-width),86vw)] bg-biz-side shadow-biz-lift"
          >
            <SidebarBody {...props} pathname={pathname} onClose={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function SidebarBody({ user, business, isAdmin, unread, notifications, theme, pathname, onClose }: SidebarProps & { pathname: string; onClose?: () => void }) {
  const sections = business ? portalSectionsFor({ role: business.role, standing: business.standing }) : { main: [], settings: true };
  const main = sections.main.map((s) => ({ key: s, item: ITEMS[s] }));

  return (
    <div className="flex h-full w-full flex-col text-biz-side-ink">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">
        {/* The business's name and photo open its public profile as students see it (/preview), as an Apple account's
            name opens the account; the UniBuzz team without a business goes to the front page. */}
        <PortalLink
          href={business ? "/preview" : "/"}
          aria-current={business && pathname === "/preview" ? "page" : undefined}
          aria-label={business ? `${business.name}: view your public profile` : `${BUSINESS_PORTAL_NAME}, Overview`}
          data-testid="profile-preview-link"
          className={cn(
            "group -ml-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1.5 pl-1.5 pr-2 transition-colors duration-200",
            business ? (pathname === "/preview" ? "bg-biz-side-raise" : "hover:bg-biz-side-hover") : null,
          )}
        >
          <Avatar name={business?.name ?? BUSINESS_PORTAL_NAME} src={business?.logoUrl ?? null} size="sm" className="ring-1 ring-biz-side-line" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[14px] font-semibold tracking-[-0.01em]">{business?.name ?? BUSINESS_PORTAL_NAME}</span>
            {business ? (
              <span className="flex items-center gap-0.5 text-[11px] text-biz-side-ink-3 transition-colors group-hover:text-biz-side-ink-2">
                <span className="truncate">View public profile</span>
                <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
              </span>
            ) : (
              <span className="block truncate text-[11px] text-biz-side-ink-3">UniBuzz team</span>
            )}
          </span>
        </PortalLink>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close the menu" className="flex h-9 w-9 items-center justify-center rounded-xl text-biz-side-ink-3 transition-colors hover:bg-biz-side-hover hover:text-biz-side-ink">
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        ) : business ? (
          <NotificationsButton count={notifications} />
        ) : null}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-2" aria-label="Sections">
        <ul className="flex flex-col gap-0.5">
          {main.map(({ key, item }) => (
            <li key={key}>
              <SideLink item={item} active={isActive(pathname, item)}>
                {key === "inbox" ? <InboxBadge initial={unread} /> : null}
              </SideLink>
            </li>
          ))}
        </ul>
        {isAdmin ? (
          <div className="mt-6">
            <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-biz-side-ink-3">UniBuzz team</p>
            <SideLink item={ITEMS.review} active={isActive(pathname, ITEMS.review)} />
          </div>
        ) : null}
      </nav>

      <div className="shrink-0 border-t border-biz-side-line px-3 pb-3 pt-3">
        {sections.settings ? (
          // The UniBuzz team without a business of its own has only an account to set.
          <SideLink item={business ? ITEMS.settings : { ...ITEMS.settings, href: "/settings/account" }} active={isActive(pathname, ITEMS.settings)} />
        ) : null}
        <AccountMenu user={user} business={business} theme={theme} />
      </div>
    </div>
  );
}

/**
 * The Inbox's unread count, from the shell's one live count (inbox-live.ts; the alerts keep it current as messages
 * arrive and chats are read). The server's number until the first count; nothing when there is nothing unread.
 */
function InboxBadge({ initial }: { initial: number }) {
  const count = useInboxUnread(initial);
  if (count <= 0) return null;
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-biz-side-mark px-1 text-[11px] font-bold text-biz-side" data-testid="inbox-badge">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** A section's link: prefetched in full as soon as the pointer, focus or a finger reaches it, so the page opens at once. */
function SideLink({ item, active, children }: { item: Item; active: boolean; children?: React.ReactNode }) {
  const Icon = item.icon;
  return (
    <IntentLink
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium tracking-[-0.005em] transition-[background-color,color] duration-200",
        active ? "bg-biz-side-raise text-biz-side-ink" : "text-biz-side-ink-2 hover:bg-biz-side-hover hover:text-biz-side-ink",
      )}
    >
      <span aria-hidden="true" className={cn("absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-biz-side-mark transition-opacity duration-200", active ? "opacity-100" : "opacity-0")} />
      <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-biz-side-ink" : "text-biz-side-ink-3 group-hover:text-biz-side-ink-2")} strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">{item.label}</span>
      {children}
    </IntentLink>
  );
}

function NotificationsButton({ count }: { count: number }) {
  return (
    <PortalLink
      href="/notifications"
      aria-label={count ? `Notifications, ${count} new` : "Notifications"}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-biz-side-ink-2 transition-colors hover:bg-biz-side-hover hover:text-biz-side-ink"
    >
      <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {count ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-biz-danger px-1 text-[10px] font-semibold text-white">{count > 9 ? "9+" : count}</span>
      ) : null}
    </PortalLink>
  );
}

/** Who is signed in, and what the account menu always had: the appearance and Log out. */
function AccountMenu({ user, business, theme }: Pick<SidebarProps, "user" | "business" | "theme">) {
  return (
    <details className="group relative mt-1">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-biz-side-hover [&::-webkit-details-marker]:hidden" aria-label="Account menu">
        <Avatar name={user.name} src={user.avatarUrl} size="sm" className="ring-1 ring-biz-side-line" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-semibold text-biz-side-ink">{user.name}</span>
          <span className="block truncate text-[11px] text-biz-side-ink-3">{business ? teamRoleLabel(business.role) : "UniBuzz team"}</span>
        </span>
      </summary>
      <div className="ab-menu-in absolute bottom-full left-0 z-50 mb-2 w-full min-w-56 origin-bottom-left overflow-hidden rounded-2xl bg-biz-surface p-2 text-biz-ink shadow-biz-lift ring-1 ring-biz-line">
        <div className="px-1 pb-2 pt-1">
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
  );
}

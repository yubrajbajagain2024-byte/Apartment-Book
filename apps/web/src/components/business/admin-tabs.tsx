"use client";

import { cn } from "@/lib/utils";
import { PortalLink, usePortalPathname } from "./portal-base";

const TABS = [
  { href: "/admin", label: "Businesses" },
  { href: "/admin/ads", label: "Ads" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/audit", label: "Audit log" },
];

/** The UniBuzz team's review screens. */
export function AdminTabs({ counts }: { counts: { businesses: number; ads: number; reports: number } }) {
  const pathname = usePortalPathname();
  const badge: Record<string, number> = { "/admin": counts.businesses, "/admin/ads": counts.ads, "/admin/reports": counts.reports };
  return (
    <nav aria-label="Review" className="flex gap-1 overflow-x-auto no-scrollbar">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <PortalLink
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors", active ? "bg-biz-ink text-biz-surface" : "bg-biz-surface text-biz-ink-2 ring-1 ring-biz-line hover:text-biz-ink")}
          >
            {t.label}
            {badge[t.href] ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-biz-danger px-1.5 text-[11px] font-semibold text-white">{badge[t.href]}</span> : null}
          </PortalLink>
        );
      })}
    </nav>
  );
}

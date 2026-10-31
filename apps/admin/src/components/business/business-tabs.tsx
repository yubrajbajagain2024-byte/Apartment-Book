"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/business", label: "Overview", exact: true },
  { href: "/business/advertisers", label: "Advertisers" },
  { href: "/business/campaigns", label: "Campaigns" },
  { href: "/business/payments", label: "Payments" },
  { href: "/business/pricing", label: "Pricing" },
  { href: "/business/reports", label: "Reports" },
  { href: "/business/audit", label: "Audit" },
] as const;

/** Business: Overview · Advertisers · Campaigns · Payments · Pricing · Reports · Audit, with what waits on two of them. */
export function BusinessTabs({ counts }: { counts: { advertisers: number; campaigns: number; reports: number } | null }) {
  const path = usePathname() ?? "/business";
  return (
    <nav aria-label="Business sections" className="no-scrollbar -mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-2">
        {TABS.map((t) => {
          const active = "exact" in t ? path === t.href : path.startsWith(t.href);
          const n = t.label === "Advertisers" ? counts?.advertisers : t.label === "Campaigns" ? counts?.campaigns : t.label === "Reports" ? counts?.reports : null;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-medium ring-1 ring-inset transition-colors",
                  active ? "bg-brand-50 text-brand-800 ring-brand-300" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
                )}
              >
                {t.label}
                {n ? <span className="tabular-nums text-gray-500">· {n}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

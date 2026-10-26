"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Queue", match: (p: string) => p === "/admin" || p.startsWith("/admin/queue") },
  { href: "/admin/users", label: "Users", match: (p: string) => p.startsWith("/admin/users") },
  { href: "/admin/appeals", label: "Appeals", match: (p: string) => p.startsWith("/admin/appeals") },
  { href: "/admin/audit", label: "Audit", match: (p: string) => p.startsWith("/admin/audit") },
  { href: "/admin/metrics", label: "Metrics", match: (p: string) => p.startsWith("/admin/metrics") },
  { href: "/admin/rules", label: "Rules", match: (p: string) => p.startsWith("/admin/rules") },
] as const;

/** Queue · Users · Appeals · Audit · Metrics · Rules, with the open counts on Queue and Appeals. */
export function StaffTabs({ queueCount, appealCount }: { queueCount: number | null; appealCount: number | null }) {
  const path = usePathname() ?? "/admin";
  return (
    <nav aria-label="Trust & Safety sections" className="no-scrollbar -mx-3 overflow-x-auto border-b border-gray-200 sm:mx-0">
      <ul className="flex min-w-max gap-1 px-3 sm:px-0">
        {TABS.map((t) => {
          const active = t.match(path);
          const count = t.label === "Queue" ? queueCount : t.label === "Appeals" ? appealCount : null;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-11 items-center gap-1.5 px-3 text-sm font-semibold transition-colors",
                  active ? "text-gray-900" : "text-gray-500 hover:text-gray-800",
                )}
              >
                {t.label}
                {count ? <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600")}>{count}</span> : null}
                {active ? <span className="absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-brand-600 bg-aurora-line" aria-hidden /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

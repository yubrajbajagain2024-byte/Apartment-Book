"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Flag, EyeOff, Film, LayoutDashboard, Megaphone, ScrollText, ShieldAlert, ShieldCheck, Users, UserCog, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** adminOnly: shown to owners and admins only (the pages check it too, as every page does). */
type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; adminOnly?: boolean };

export const ADMIN_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/reports", label: "Reports", icon: Flag },
  { href: "/flagged", label: "Flagged", icon: ShieldAlert },
  { href: "/content", label: "Content", icon: EyeOff },
  { href: "/users", label: "Users", icon: Users },
  { href: "/media", label: "Media", icon: Film },
  { href: "/analytics", label: "Analytics", icon: BarChart3, adminOnly: true },
  { href: "/business", label: "Business", icon: Megaphone, adminOnly: true },
  { href: "/staff", label: "Staff", icon: UserCog },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/security", label: "Security", icon: ShieldCheck },
];

function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** `sidebar` is the dark vertical list on large screens, `tabs` the scrollable strip under the header on phones. */
export function AdminNav({ variant, admin = false }: { variant: "sidebar" | "tabs"; admin?: boolean }) {
  const pathname = usePathname();
  const items = ADMIN_NAV.filter((item) => admin || !item.adminOnly);

  if (variant === "sidebar") {
    return (
      <nav aria-label="Admin" className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0", active ? "text-brand-200" : "text-slate-400")} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Admin" className="no-scrollbar -mb-px flex gap-1 overflow-x-auto px-3 sm:px-6">
      {items.map((item) => {
        const active = isActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
              active ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

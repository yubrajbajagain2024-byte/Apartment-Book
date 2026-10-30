import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { fetchBusinessBadge, fetchQueueCounts, requireStaff, staffMetadata } from "@/lib/staff/server";
import { Pill, ROLE_TONE } from "@/components/staff/parts";
import { StaffTabs } from "@/components/staff/tabs";

// Every page here reads the session cookie, so Next renders it per request; nothing is prerendered or cached.
export const generateMetadata = () => staffMetadata("Trust & Safety");

/**
 * The staff console (UniVerse features/admin): moderators and admins only. Everyone else, signed out included, gets
 * Next's not-found page, the way the database answers them.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const me = await requireStaff();
  const admin = me.role === "admin";
  const [counts, businessCount] = await Promise.all([fetchQueueCounts().catch(() => null), admin ? fetchBusinessBadge() : null]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4" data-testid="staff-console">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-gray-900">Trust &amp; Safety</h1>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Pill tone={ROLE_TONE[me.role]}>{me.role}</Pill>
            <span className="truncate">{me.username ? `@${me.username}` : me.name}</span>
          </div>
        </div>
      </header>
      <StaffTabs
        queueCount={counts?.priority ?? null}
        appealCount={counts?.appeals ?? null}
        admin={admin}
        businessCount={businessCount}
      />
      {children}
    </div>
  );
}

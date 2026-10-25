import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, LogOut, ShieldAlert, ShieldCheck } from "lucide-react";
import type { StaffAccess } from "@apartment-book/shared";
import { signOutAction } from "@/lib/actions/auth";
import { ADMIN_APP_NAME, PRODUCT_NAME } from "@/lib/brand";
import { getMainSiteUrl } from "@/lib/env";
import { Avatar } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/staff/role-badge";
import { AdminNav } from "./admin-nav";

/**
 * Chrome of the admin app: white top bar with the brand, the role and a sign-out; dark
 * sidebar on large screens, tab strip below; amber banner while the session has not
 * passed the second factor yet.
 */
export function AdminShell({ access, name, email, avatarUrl, children }: { access: StaffAccess; name: string; email: string | null; avatarUrl: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label={`${ADMIN_APP_NAME} overview`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-base font-bold text-gray-900">{ADMIN_APP_NAME}</span>
              <span className="hidden text-xs text-gray-500 sm:block">for {PRODUCT_NAME}</span>
            </span>
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <RoleBadge role={access.role} />
            <a
              href={getMainSiteUrl()}
              target="_blank"
              rel="noreferrer"
              className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 sm:inline-flex"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open site
            </a>
            <span className="hidden min-w-0 items-center gap-2 md:flex" title={email ?? undefined}>
              <Avatar name={name} src={avatarUrl} size="sm" />
              <span className="max-w-40 truncate text-sm font-medium text-gray-800">{name}</span>
            </span>
            <form action={signOutAction}>
              <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100" aria-label="Log out">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </form>
          </div>
        </div>
        <div className="lg:hidden">
          <AdminNav variant="tabs" />
        </div>
      </header>

      {!access.mfaVerified ? (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm text-amber-900 sm:px-6">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1">Two-factor authentication is required before you can do anything here.</p>
            <Link href="/security" className="font-semibold underline-offset-2 hover:underline">
              {access.mfaEnrolled ? "Enter your code" : "Set it up"}
            </Link>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 items-stretch">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col bg-sidebar px-3 py-5 lg:flex">
          <AdminNav variant="sidebar" />
          <p className="mt-auto px-3 text-xs text-slate-500">Every action is re-checked in the database and written to the audit log.</p>
        </aside>
        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-3 py-6 pb-16 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

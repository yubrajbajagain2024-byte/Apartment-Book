import Link from "next/link";
import { Briefcase } from "lucide-react";
import { APP_NAME, BUSINESS_PORTAL_NAME, BUSINESS_PORTAL_TAGLINE } from "@apartment-book/shared";
import { getSiteUrl } from "@/lib/env";
import { portalPath } from "@/lib/business/portal";

export default async function BusinessAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <Link href={await portalPath("/")} className="flex items-center gap-2 text-2xl font-bold text-brand-600">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 bg-aurora text-white">
            <Briefcase className="h-6 w-6" />
          </span>
          {BUSINESS_PORTAL_NAME}
        </Link>
        <p className="max-w-sm text-sm text-gray-600">{BUSINESS_PORTAL_TAGLINE}</p>
      </div>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 sm:p-8">{children}</div>
      <p className="mt-6 text-center text-xs text-gray-500">
        A student?{" "}
        <a href={getSiteUrl()} className="font-medium text-brand-600 hover:underline">
          {APP_NAME} is this way
        </a>
        .
      </p>
    </main>
  );
}

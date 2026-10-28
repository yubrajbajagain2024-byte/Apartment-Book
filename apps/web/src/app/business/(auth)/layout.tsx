import Link from "next/link";
import { Briefcase } from "lucide-react";
import { APP_NAME, BUSINESS_PORTAL_NAME, BUSINESS_PORTAL_TAGLINE } from "@apartment-book/shared";
import { getSiteUrl } from "@/lib/env";
import { portalPath } from "@/lib/business/portal";

/** Logging in, signing up and joining a team: one quiet card on the portal's canvas. */
export default async function BusinessAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-16">
      {/* A faint glow of the accent behind the card: depth without decoration. */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-biz-accent opacity-[0.07] blur-[120px]" />
      <div className="ab-fade-in relative mb-10 flex flex-col items-center gap-3 text-center">
        <Link href={await portalPath("/")} className="flex flex-col items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-biz-ink text-biz-surface shadow-biz-lift">
            <Briefcase className="h-7 w-7" />
          </span>
          <span className="text-[32px] font-semibold tracking-[-0.03em] text-biz-ink">{BUSINESS_PORTAL_NAME}</span>
        </Link>
        <p className="max-w-sm text-[15px] leading-relaxed text-biz-ink-3">{BUSINESS_PORTAL_TAGLINE}</p>
      </div>
      <div className="ab-fade-in relative w-full max-w-md rounded-[28px] bg-biz-glass p-7 shadow-biz-lift ring-1 ring-biz-line backdrop-blur-2xl sm:p-9">{children}</div>
      <p className="relative mt-8 text-center text-[13px] text-biz-ink-4">
        A student?{" "}
        <a href={getSiteUrl()} className="font-medium text-biz-accent-ink hover:underline">
          {APP_NAME} is this way
        </a>
        .
      </p>
    </main>
  );
}

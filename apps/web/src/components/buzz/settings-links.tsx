import Link from "next/link";
import { BookOpen, ChevronRight, Scale, VenetianMask, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Settings → the Buzz and safety rows (UniVerse's Privacy & safety → Buzz group, plus Account status): My buzzes and
 * "How Buzz anonymity works" live here and nowhere public — never on Home, never on a profile. The Buzz rows wear the
 * small Phosphor mask disc, the one bit of Buzz's world allowed on a regular page.
 */
function Row({ href, icon: Icon, title, subtitle, incognito }: { href: string; icon: LucideIcon; title: string; subtitle?: string; incognito?: boolean }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50" data-testid={`settings-${href.split("/").pop()}`}>
      <span
        aria-hidden="true"
        data-surface={incognito ? "incognito" : undefined}
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", incognito ? "bg-incog-surface-2 text-incog-accent" : "bg-gray-100 text-gray-700")}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-gray-900">{title}</span>
        {subtitle ? <span className="block truncate text-sm text-gray-500">{subtitle}</span> : null}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
    </Link>
  );
}

export function BuzzSettingsLinks() {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="settings-buzz-title" data-testid="settings-buzz">
      <h2 id="settings-buzz-title" className="px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Buzz and safety
      </h2>
      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
        <Row href="/buzz/mine" icon={VenetianMask} title="My buzzes" subtitle="Everything you posted anonymously" incognito />
        <Row href="/settings/buzz-anonymity" icon={VenetianMask} title="How Buzz anonymity works" incognito />
        <Row href="/settings/account-status" icon={Scale} title="Account status" subtitle="Warnings, limits and appeals" />
        <Row href="/guidelines" icon={BookOpen} title="Community Guidelines" />
      </div>
      <p className="px-1 text-xs text-gray-500">Buzz is fully anonymous to other students. Your public profile never links to it.</p>
    </section>
  );
}

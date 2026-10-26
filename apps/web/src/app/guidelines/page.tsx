import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Home } from "lucide-react";
import { APP_NAME, BUZZ_GUIDELINES_VERSION } from "@apartment-book/shared";
import { GuidelinesContent, GUIDELINE_SECTIONS } from "./guidelines-content";

export const metadata: Metadata = {
  title: "Community Guidelines",
  description: `How ${APP_NAME} works for everyone: what's OK, what isn't, how Buzz anonymity works, and what happens when rules are broken.`,
};

/**
 * /guidelines: public (signed out too). Every block, removal and sanction notice deep-links to a section here
 * (`/guidelines#harassment`, `#buzz-anonymity`, `#enforcement`, …).
 */
export default function GuidelinesPage() {
  const updated = new Date(`${BUZZ_GUIDELINES_VERSION}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <Link href="/" aria-label={`${APP_NAME} home`} className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 bg-aurora text-white">
            <Home className="h-5 w-5" />
          </Link>
          <h1 className="min-w-0 truncate text-base font-bold text-gray-900 sm:text-lg">Community Guidelines</h1>
          <Link href="/" aria-label={`Back to ${APP_NAME}`} className="ml-auto inline-flex shrink-0 items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Back to {APP_NAME}</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
        <article className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:p-8">
          <div className="mb-6 flex flex-col gap-1">
            <h2 className="text-2xl font-bold text-gray-900">{APP_NAME} Community Guidelines</h2>
            <p className="text-sm text-gray-500">Version {BUZZ_GUIDELINES_VERSION} · updated {updated}</p>
          </div>
          <nav aria-label="Sections" className="mb-8 rounded-lg bg-gray-50 p-4">
            <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {GUIDELINE_SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-gray-700 hover:text-brand-700 hover:underline">
                    <span className="tabular-nums text-gray-400">{s.number}</span> {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <GuidelinesContent />
        </article>
      </main>
    </div>
  );
}

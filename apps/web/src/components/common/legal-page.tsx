import type { ReactNode } from "react";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:py-14">
      <article className="rounded-[14px] bg-white px-6 py-8 shadow-card ring-1 ring-gray-200 sm:px-10 sm:py-12 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:tracking-tight [&_h2]:text-gray-900 [&_p]:mt-2.5 [&_p]:text-[15px] [&_p]:leading-relaxed [&_p]:text-gray-700">
        <h1 className="font-display text-3xl tracking-tight text-gray-900 sm:text-4xl">{title}</h1>
        <p className="mt-3 border-b border-gray-100 pb-6 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Last updated {updated}</p>
        {children}
      </article>
    </main>
  );
}

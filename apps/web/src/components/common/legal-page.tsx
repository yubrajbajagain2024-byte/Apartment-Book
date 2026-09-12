import type { ReactNode } from "react";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-2xl rounded-xl bg-white p-6 ring-1 ring-gray-200 sm:p-8 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_p]:mt-2 [&_p]:text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="text-sm text-gray-500">Last updated {updated}</p>
      {children}
    </article>
  );
}

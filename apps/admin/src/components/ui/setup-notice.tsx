import { Database } from "lucide-react";

/** Shown where a feature needs a migration the live database does not have yet. */
export function SetupNotice({ migration, what }: { migration: string; what: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Database className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Database update needed.</span> {what} needs migration {migration}. Apply it with <code className="rounded bg-white/70 px-1">npm run db:setup</code> (or the SQL
        Editor); nothing else changes.
      </p>
    </div>
  );
}

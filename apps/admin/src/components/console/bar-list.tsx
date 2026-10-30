import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A ranked breakdown as horizontal bars on one scale, the value written at each bar's end (so nothing needs hovering),
 * in the console's accent. Labels and values wear text colors; the bar alone carries the accent.
 */
export function BarList({ rows, format, empty = "Nothing in this range.", className }: {
  rows: { key: string; label: ReactNode; value: number; hint?: ReactNode }[];
  format: (v: number) => string;
  empty?: string;
  className?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-3 text-sm">
          <span className="truncate text-gray-700">{r.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-3 rounded-r bg-brand-600" style={{ width: `${Math.max(1, (r.value / max) * 80)}%` }} aria-hidden />
            <span className="shrink-0 tabular-nums text-gray-900">
              {format(r.value)}
              {r.hint ? <span className="ml-1 text-xs text-gray-500">{r.hint}</span> : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

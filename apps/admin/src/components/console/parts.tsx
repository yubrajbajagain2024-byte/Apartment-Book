/**
 * Building blocks of the Analytics and Business pages, in the admin app's light kit: pills in words (never color
 * alone), sections, panels, key/value lists, stat tiles and an empty state. Utilitarian on purpose: dense type.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "gray" | "blue" | "green" | "amber" | "red" | "violet";

const SOFT: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-brand-50 text-brand-700",
  green: "bg-green-50 text-green-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  violet: "bg-violet-50 text-violet-700",
};

export function Pill({ tone = "gray", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", SOFT[tone], className)}>
      {children}
    </span>
  );
}

export function Section({ title, hint, action, children, className }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {hint !== undefined && hint !== null ? <span className="text-xs text-gray-500">{hint}</span> : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function KeyValue({ rows, className }: { rows: { k: string; v: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm", className)}>
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt className="text-gray-500">{r.k}</dt>
          <dd className="min-w-0 break-words text-gray-900">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200", className)}>{children}</div>;
}

export function StatTile({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-gray-900">{value}</span>
      {hint ? <span className="text-xs text-gray-600">{hint}</span> : null}
      {children}
    </div>
  );
}

export function EmptyBox({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      {description ? <p className="max-w-md text-sm text-gray-600">{description}</p> : null}
      {children}
    </div>
  );
}

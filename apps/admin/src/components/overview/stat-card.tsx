import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  gray: "bg-gray-100 text-gray-700",
  brand: "bg-brand-50 text-brand-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  green: "bg-green-100 text-green-700",
} as const;

/** One number with a label, a hint and where to go about it. */
export function StatCard({ label, value, hint, href, icon: Icon, tone = "gray" }: { label: string; value: number | string; hint?: string; href?: string; icon: LucideIcon; tone?: keyof typeof TONES }) {
  const body = (
    <>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums text-gray-900">{value}</span>
        <span className="block truncate text-sm font-medium text-gray-700">{label}</span>
        {hint ? <span className="block truncate text-xs text-gray-500">{hint}</span> : null}
      </span>
    </>
  );
  const className = "flex items-center gap-3 rounded-xl bg-white px-4 py-4 shadow-sm ring-1 ring-gray-200";
  if (href) {
    return (
      <Link href={href} className={cn(className, "transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500")}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

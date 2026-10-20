/**
 * The staff console's building blocks (UniVerse features/admin/parts.tsx), in the website's light kit: pills, the
 * severity rail, Buzz excerpts inside a Phosphor chip-frame with the mask glyph (never an avatar, never an alias unless
 * the thread context gives one), highlighted spans, sections, key/value lists, stat tiles, an inline-SVG sparkline and
 * the Limitations panel. Utilitarian on purpose: dense type, no hero gradients.
 */
import type { CSSProperties, ReactNode } from "react";
import { ShieldAlert, VenetianMask } from "lucide-react";
import { BUZZ_PHOSPHOR } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import type { LIMITATIONS } from "@/lib/staff/constants";
import type { ModerationPriority, ModerationSeverity } from "@/lib/staff/types";

export type Tone = "gray" | "blue" | "green" | "amber" | "red" | "violet";

const SOFT: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-brand-50 text-brand-700",
  green: "bg-green-50 text-green-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  violet: "bg-violet-50 text-violet-700",
};
const OUTLINE: Record<Tone, string> = {
  gray: "ring-gray-300 text-gray-700",
  blue: "ring-brand-200 text-brand-700",
  green: "ring-green-300 text-green-800",
  amber: "ring-amber-300 text-amber-800",
  red: "ring-red-300 text-red-700",
  violet: "ring-violet-300 text-violet-700",
};

export function Pill({ tone = "gray", variant = "soft", className, children, title }: { tone?: Tone; variant?: "soft" | "outline"; className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "soft" ? SOFT[tone] : cn("bg-white ring-1 ring-inset", OUTLINE[tone]),
        className,
      )}
    >
      {children}
    </span>
  );
}

export const PRIORITY_TONE: Record<ModerationPriority, Tone> = { p0: "red", p1: "amber", p2: "blue", p3: "gray" };
export const ROLE_TONE: Record<string, Tone> = { admin: "amber", moderator: "blue", system: "gray", user: "gray" };

/** The left rail of a queue card: how severe the engine (or the reports) think it is. */
export const SEVERITY_RAIL: Record<ModerationSeverity, string> = {
  none: "border-l-gray-300",
  low: "border-l-sky-400",
  medium: "border-l-amber-400",
  high: "border-l-red-500",
  critical: "border-l-red-600",
};

/** `[start, end)` spans of the original text, marked. */
export function HighlightedText({ text, spans, markClassName, markStyle }: { text: string; spans?: [number, number][]; markClassName?: string; markStyle?: CSSProperties }) {
  if (!spans || spans.length === 0) return <>{text}</>;
  const sorted = spans.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a && a < text.length).sort((x, y) => x[0] - y[0]);
  const out: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach(([a, b], i) => {
    const start = Math.max(a, cursor);
    const end = Math.min(b, text.length);
    if (start > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, start)}</span>);
    if (end > start)
      out.push(
        <mark key={`m${i}`} className={cn("rounded px-0.5", markClassName)} style={markStyle}>
          {text.slice(start, end)}
        </mark>,
      );
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
}

const P = BUZZ_PHOSPHOR;

/**
 * An excerpt. Buzz (anon) text sits inside a Phosphor chip-frame with the mask glyph: the incognito world, never an
 * avatar or a name. `aliasLabel` only when the blind thread context provides one.
 */
export function ExcerptBlock({ text, anon, aliasLabel, spans, className, clamp }: { text: string; anon: boolean; aliasLabel?: string | null; spans?: [number, number][]; className?: string; clamp?: boolean }) {
  const empty = !text.trim();
  if (anon) {
    return (
      <div
        data-surface="incognito"
        className={cn("rounded-lg border p-3", className)}
        style={{ background: P.surface1, borderColor: P.line, color: P.ink }}
      >
        <div className="flex items-start gap-2">
          <VenetianMask className="mt-0.5 h-4 w-4 shrink-0" style={{ color: P.accent }} aria-label="Anonymous" />
          <div className="min-w-0 flex-1">
            {aliasLabel ? (
              <div className="mb-0.5 text-xs" style={{ color: P.ink3 }}>
                {aliasLabel}
              </div>
            ) : null}
            <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed", clamp && "line-clamp-4")}>
              {empty ? <span style={{ color: P.ink3 }}>(no text)</span> : <HighlightedText text={text} spans={spans} markStyle={{ background: P.accentSoft, color: P.accentInk }} />}
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <blockquote className={cn("whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-900 ring-1 ring-inset ring-gray-200", clamp && "line-clamp-4", className)}>
      {empty ? <span className="text-gray-500">(no text)</span> : <HighlightedText text={text} spans={spans} markClassName="bg-amber-100 text-gray-900" />}
    </blockquote>
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

/** Inline SVG sparkline (no chart library). */
export function Sparkline({ points, label, className }: { points: number[]; label: string; className?: string }) {
  const n = points.length;
  if (n < 2) return <div className={cn("h-8", className)} aria-hidden />;
  const max = Math.max(1, ...points);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (n - 1)) * 100).toFixed(2)},${(30 - (p / max) * 28).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn("h-8 w-full text-brand-600", className)} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function BlindNote() {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
      <span>Anonymous surface. You are acting on the author of this item; the server resolves the account and never shows it here.</span>
    </div>
  );
}

export function LimitationsPanel({ items }: { items: typeof LIMITATIONS }) {
  return (
    <Section title="Known limitations" hint="what this tooling cannot do">
      <div className="flex flex-col gap-2">
        {items.map((l) => (
          <div key={l.id} className="flex items-start gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200">
            <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-gray-100 px-1 font-mono text-[11px] text-gray-700">{l.id}</span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">{l.title}</h3>
              <p className="mt-0.5 text-sm text-gray-600">{l.body}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function EmptyBox({ icon: Icon, title, description, children }: { icon: typeof ShieldAlert; title: string; description?: string; children?: ReactNode }) {
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

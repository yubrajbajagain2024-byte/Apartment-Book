"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { compactCount, formatCents } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

export type ChartFormat = "count" | "cents";
export interface ChartMeasure<K extends string> {
  key: K;
  label: string;
  format?: ChartFormat;
  /**
   * The headline when no day is picked: the range's sum (counts of things, the default), its last day (a running
   * total), or a number of its own (distinct people over the range, which is not the sum of each day's).
   */
  headline?: "sum" | "last" | number;
}
type Row<K extends string> = { day: string } & { [P in K]: number | null };

const W = 640;
const H = 200;
const PAD = { top: 14, right: 10, bottom: 26, left: 48 };

function dayLabel(day: string, long = false): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-US", long ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A round axis top: the smallest of 1, 2, 5 × 10ⁿ at or above the highest value. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function show(v: number | null, format: ChartFormat, compact = false): string {
  if (v === null) return "no data";
  if (format === "cents") return compact && v >= 1_000_000 ? `$${compactCount(v / 100)}` : formatCents(v, "USD");
  return compact ? compactCount(v) : v.toLocaleString("en-US");
}

/**
 * One measure a day on one axis (a switch picks the measure, never two scales at once), in the console's accent:
 * columns up to three months, a line beyond. Hover, or focus the chart and use the arrow keys, to read a day; the
 * same numbers are a table one click away. A day with no data (null) is a gap, not a zero.
 */
export function ConsoleChart<K extends string>({ series, measures, label, emptyText = "Nothing in this range yet." }: {
  series: Row<K>[];
  measures: ChartMeasure<K>[];
  label: string;
  emptyText?: string;
}) {
  const [metric, setMetric] = useState<K>(measures[0]!.key);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const current = measures.find((m) => m.key === metric) ?? measures[0]!;
  const format = current.format ?? "count";
  const values = series.map((d) => (d[current.key] === null || d[current.key] === undefined ? null : Number(d[current.key])));
  const known = values.filter((v): v is number => v !== null);
  const mode = current.headline ?? "sum";
  const headline = typeof mode === "number" ? mode : mode === "last" ? ([...values].reverse().find((v) => v !== null) ?? null) : known.reduce((a, b) => a + b, 0);
  const top = niceMax(Math.max(0, ...known));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = Math.max(series.length, 1);
  const slot = plotW / n;
  const line = series.length > 92;
  const barW = Math.max(1, Math.min(24, slot * 0.7));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const cx = (i: number) => PAD.left + i * slot + slot / 2;
  const shown = active !== null ? series[active] : null;
  const shownValue = active !== null ? values[active] : null;

  // The line, broken where a day has no data.
  const path = line
    ? values.reduce<string>((d, v, i) => (v === null ? d : `${d}${i === 0 || values[i - 1] === null ? "M" : "L"}${cx(i).toFixed(1)},${y(v).toFixed(1)} `), "")
    : "";

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!series.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(series.length - 1, Math.max(0, (a ?? (step > 0 ? -1 : series.length)) + step)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : series.length - 1);
    } else if (e.key === "Escape") setActive(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums text-gray-900">{show(shown ? shownValue : headline, format)}</p>
          <p className="text-xs text-gray-600" aria-live="polite">
            {current.label} {shown ? `on ${dayLabel(shown.day, true)}` : mode === "last" ? "on the last day" : `in ${series.length} ${series.length === 1 ? "day" : "days"}`}
          </p>
        </div>
        {measures.length > 1 ? (
          <div role="radiogroup" aria-label="Measure" className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1">
            {measures.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={metric === m.key}
                onClick={() => setMetric(m.key)}
                className={cn("h-7 shrink-0 rounded-md px-2.5 text-xs font-medium", metric === m.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
              >
                {m.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {table ? (
        <div className="relative max-h-72 overflow-y-auto rounded-lg ring-1 ring-gray-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{`${label}: ${current.label} by day`}</caption>
            <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">Day</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">{current.label}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {series.map((d, i) => (
                <tr key={d.day}>
                  <td className="px-3 py-1 text-gray-700">{dayLabel(d.day, true)}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-gray-900">{show(values[i] ?? null, format)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          tabIndex={0}
          role="group"
          aria-label={`${label}: ${current.label} by day. Use the arrow keys to read each day.`}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-brand-600" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setActive(null)}>
            <title id={`${id}-t`}>{`${label}: ${current.label} by day`}</title>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(top * f)} y2={y(top * f)} className="stroke-gray-200" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(top * f) + 4} textAnchor="end" className="fill-gray-500 text-[11px] tabular-nums">
                  {show(top * f, format, true).replace(/\.00$/, "")}
                </text>
              </g>
            ))}
            {line ? (
              <>
                <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {active !== null && values[active] !== null ? (
                  <>
                    <line x1={cx(active)} x2={cx(active)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-gray-400" strokeWidth={1} />
                    <circle cx={cx(active)} cy={y(values[active]!)} r={4} fill="currentColor" className="stroke-white" strokeWidth={2} />
                  </>
                ) : null}
              </>
            ) : (
              values.map((v, i) => {
                if (v === null || v <= 0) return null;
                const h = (v / top) * plotH;
                const x = cx(i) - barW / 2;
                const base = PAD.top + plotH;
                const r = Math.min(4, barW / 2, h);
                return (
                  <path
                    key={series[i]!.day}
                    d={`M${x},${base} L${x},${base - h + r} Q${x},${base - h} ${x + r},${base - h} L${x + barW - r},${base - h} Q${x + barW},${base - h} ${x + barW},${base - h + r} L${x + barW},${base} Z`}
                    fill="currentColor"
                    opacity={active === null || active === i ? 1 : 0.35}
                  />
                );
              })
            )}
            {/* The hit area is the whole column, wider than any mark. */}
            {series.map((d, i) => (
              <rect key={d.day} x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setActive(i)} />
            ))}
            {[0, Math.floor((series.length - 1) / 2), series.length - 1]
              .filter((i, k, a) => i >= 0 && a.indexOf(i) === k)
              .map((i, k, shown) => (
                // The first and last labels hug the plot's edges so neither is cut off.
                <text
                  key={i}
                  x={shown.length > 1 && k === 0 ? PAD.left : shown.length > 1 && k === shown.length - 1 ? W - PAD.right : cx(i)}
                  y={H - 8}
                  textAnchor={shown.length > 1 && k === 0 ? "start" : shown.length > 1 && k === shown.length - 1 ? "end" : "middle"}
                  className="fill-gray-500 text-[11px]"
                >
                  {dayLabel(series[i]!.day)}
                </text>
              ))}
          </svg>
          {shown ? (
            <div
              className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow"
              style={{ left: `${Math.min(92, Math.max(8, (cx(active!) / W) * 100))}%` }}
            >
              <span className="font-semibold tabular-nums">{show(shownValue, format)}</span> <span className="text-gray-300">{dayLabel(shown.day, true)}</span>
            </div>
          ) : null}
          {known.every((v) => v === 0) ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6 text-sm text-gray-500">{emptyText}</p> : null}
        </div>
      )}
      <button type="button" onClick={() => setTable((t) => !t)} className="self-start text-xs font-medium text-brand-700 hover:underline">
        {table ? "Show as a chart" : "Show as a table"}
      </button>
    </div>
  );
}

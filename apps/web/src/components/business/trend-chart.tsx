"use client";

import { useId, useState } from "react";
import type { BusinessDailyStats } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

const METRICS = [
  { key: "impressions", label: "Impressions" },
  { key: "reach", label: "Reach" },
  { key: "clicks", label: "Clicks" },
  { key: "saves", label: "Saves" },
  { key: "profile_visits", label: "Profile visits" },
  { key: "inquiries", label: "Inquiries" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

const W = 640;
const H = 196;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };

function dayLabel(day: string, long = false): string {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString("en-US", long ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
}

/** A round axis top: the smallest of 1, 2, 5 × 10ⁿ at or above the highest day. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * One measure a day, as bars on one axis (never two scales at once: the switch picks the measure), in the accent, with
 * the day's number on hover or focus and the same numbers as a table for anyone who would rather read them. Counts of
 * real events only; the database never says who.
 */
export function TrendChart({ series, initial = "impressions", label }: { series: BusinessDailyStats[]; initial?: MetricKey; label: string }) {
  const [metric, setMetric] = useState<MetricKey>(initial);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const values = series.map((d) => Number(d[metric] ?? 0));
  const total = values.reduce((a, b) => a + b, 0);
  const top = niceMax(Math.max(...values, 0));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(series.length, 1);
  const barW = Math.max(2, Math.min(18, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const current = METRICS.find((m) => m.key === metric)!;
  const shown = active !== null ? series[active] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[32px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-biz-ink">{(shown ? Number(shown[metric]) : total).toLocaleString("en-US")}</p>
          <p className="mt-1.5 text-[13px] text-biz-ink-3" aria-live="polite">
            {current.label.toLowerCase()} {shown ? `on ${dayLabel(shown.day, true)}` : `in ${series.length} days`}
          </p>
        </div>
        <div role="radiogroup" aria-label="Measure" className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-biz-surface-3 p-1 no-scrollbar">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={cn("h-7 shrink-0 rounded-full px-3 text-xs font-medium transition-[background-color,color,box-shadow] duration-200", metric === m.key ? "bg-biz-surface text-biz-ink shadow-biz" : "text-biz-ink-3 hover:text-biz-ink")}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {table ? (
        <div className="max-h-72 overflow-y-auto rounded-2xl ring-1 ring-biz-line">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">{`${label}, ${current.label} by day`}</caption>
            <thead className="sticky top-0 bg-biz-surface-2 text-biz-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Day</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{current.label}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-biz-line">
              {series.map((d, i) => (
                <tr key={d.day}>
                  <td className="px-4 py-1.5 text-biz-ink-2">{dayLabel(d.day, true)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-biz-ink">{values[i].toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setActive(null)}>
            <title id={`${id}-t`}>{`${label}: ${current.label} by day, ${total} in total`}</title>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(top * f)} y2={y(top * f)} stroke="var(--biz-line)" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(top * f) + 4} textAnchor="end" className="fill-[var(--biz-ink-4)] text-[11px] tabular-nums">
                  {Math.round(top * f).toLocaleString("en-US")}
                </text>
              </g>
            ))}
            {series.map((d, i) => {
              const v = values[i];
              const x = PAD.left + i * slot + (slot - barW) / 2;
              const h = Math.max(0, (v / top) * plotH);
              const r = Math.min(4, barW / 2, h);
              const base = PAD.top + plotH;
              return (
                <g key={d.day}>
                  {h > 0 ? (
                    <path
                      d={`M${x},${base} L${x},${base - h + r} Q${x},${base - h} ${x + r},${base - h} L${x + barW - r},${base - h} Q${x + barW},${base - h} ${x + barW},${base - h + r} L${x + barW},${base} Z`}
                      fill="var(--biz-accent)"
                      opacity={active === null || active === i ? 1 : 0.35}
                      className="transition-opacity duration-150"
                    />
                  ) : null}
                  {/* The hit area is the whole column, not just the bar. */}
                  <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setActive(i)} />
                </g>
              );
            })}
            {[0, Math.floor((series.length - 1) / 2), series.length - 1].filter((i, k, a) => i >= 0 && a.indexOf(i) === k).map((i) => (
              <text key={i} x={PAD.left + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="fill-[var(--biz-ink-4)] text-[11px]">
                {dayLabel(series[i].day)}
              </text>
            ))}
          </svg>
          {total === 0 ? (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6 text-[13px] text-biz-ink-3">Nothing yet. Numbers appear as students see your ads, posts and profile.</p>
          ) : null}
        </div>
      )}
      <button type="button" onClick={() => setTable((t) => !t)} className="self-start text-[13px] font-medium text-biz-accent-ink hover:underline">
        {table ? "Show as a chart" : "Show as a table"}
      </button>
    </div>
  );
}

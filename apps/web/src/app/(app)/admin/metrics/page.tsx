import Link from "next/link";
import { STAFF_SANCTION_LABELS, UNMASK_REASON_LABELS } from "@/lib/staff/constants";
import { minutes, percent } from "@/lib/staff/format";
import { fetchMetrics, requireStaff, staffMetadata } from "@/lib/staff/server";
import type { ModerationPriority, UnmaskReasonCode } from "@/lib/staff/types";
import { cn, firstParam } from "@/lib/utils";
import { KeyValue, Panel, Section, Sparkline, StatTile } from "@/components/staff/parts";

export const generateMetadata = () => staffMetadata("Metrics · Trust & Safety");

const DAY = 86_400_000;
const RANGES = [
  { value: "7d", label: "7 days", ms: 7 * DAY },
  { value: "30d", label: "30 days", ms: 30 * DAY },
  { value: "90d", label: "90 days", ms: 90 * DAY },
] as const;
const PRIORITIES: ModerationPriority[] = ["p0", "p1", "p2", "p3"];
/** The range's end, anchored to the hour so reloads within it ask the same question. */
function rangeEnd(): number {
  return Math.floor(Date.now() / 3_600_000) * 3_600_000;
}
const PRIORITY_BG: Record<ModerationPriority, string> = { p0: "bg-red-50 text-red-800", p1: "bg-amber-50 text-amber-800", p2: "bg-brand-50 text-brand-800", p3: "bg-gray-100 text-gray-800" };

/**
 * Moderation metrics (UniVerse AnalyticsPage's moderation block, safety 6.7): the queue by priority, time to first
 * action against the SLA, actions and reports per day, reports per 1,000 moderated writes, appeals overturned,
 * auto-hide reversals, active sanctions and unmasks. From the moderation tables only; nothing is broken down by person.
 */
export default async function StaffMetricsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireStaff();
  const params = await searchParams;
  const raw = firstParam(params.range) ?? "30d";
  const range = RANGES.find((r) => r.value === raw) ?? RANGES[1];
  const to = rangeEnd();
  const m = await fetchMetrics(to - range.ms, to);
  const open = PRIORITIES.reduce((n, p) => n + (m.openByPriority[p] ?? 0), 0);
  const actions = m.perDay.map((d) => d.actions);
  const reports = m.perDay.map((d) => d.reports);
  const opened = m.perDay.map((d) => d.opened);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Date range" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-200/70 p-1 sm:max-w-sm">
        {RANGES.map((r) => (
          <Link
            key={r.value}
            href={`/admin/metrics?range=${r.value}`}
            prefetch={false}
            aria-current={r === range ? "page" : undefined}
            className={cn("flex h-8 items-center justify-center rounded-lg text-sm font-medium", r === range ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
          >
            {r.label}
          </Link>
        ))}
      </nav>

      <Section title="Queue">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile label="Open items" value={String(open)} hint={m.oldestOpenMin === null ? "queue clear" : `oldest ${minutes(m.oldestOpenMin)}`}>
            <div className="mt-1 flex flex-wrap gap-1">
              {PRIORITIES.map((p) => (
                <span key={p} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums", m.openByPriority[p] ? PRIORITY_BG[p] : "bg-gray-50 text-gray-400")}>
                  {p.toUpperCase()} {m.openByPriority[p] ?? 0}
                </span>
              ))}
            </div>
          </StatTile>
          <StatTile label="Opened" value={String(sum(opened))} hint={`in ${range.label}`}>
            <Sparkline points={opened} label="Queue items opened per day" />
          </StatTile>
          <StatTile label="Staff actions" value={String(sum(actions))} hint={`in ${range.label}`}>
            <Sparkline points={actions} label="Staff actions per day" />
          </StatTile>
          <StatTile label="Wellbeing / week" value={String(m.wellbeingPerWeek)} hint="P0 self-harm items, last 7 days" />
        </div>
      </Section>

      <Section title="Community">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile label="Reports" value={String(m.reportsInRange)} hint={`in ${range.label}`}>
            <Sparkline points={reports} label="Reports per day" />
          </StatTile>
          <StatTile label="Reports / 1k" value={String(m.reportsPer1k)} hint={`per 1,000 moderated writes (${m.moderatedWritesInRange})`} />
          <StatTile label="Appeal overturn" value={percent(m.appealOverturnRate)} hint="reversed or reduced" />
          <StatTile label="Auto-hide reversal" value={`${percent(m.autoHideReversalRate.reports)} · ${percent(m.autoHideReversalRate.score)}`} hint="reports · community score" />
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Time to first action" hint="vs. the SLA">
          <Panel className="p-3">
            <KeyValue
              rows={PRIORITIES.map((p) => ({
                k: p.toUpperCase(),
                v: `median ${minutes(m.timeToFirstAction[p]?.medianMin)} · p90 ${minutes(m.timeToFirstAction[p]?.p90Min)} · SLA ${minutes(m.timeToFirstAction[p]?.slaMin)}`,
              }))}
            />
          </Panel>
        </Section>
        <Section title="Sanctions in force · unmasks">
          <Panel className="p-3">
            <KeyValue
              rows={[
                ...(["warning", "mute", "suspension", "ban"] as const).map((k) => ({ k: STAFF_SANCTION_LABELS[k], v: String(m.activeSanctions[k] ?? 0) })),
                ...Object.entries(m.unmasksByReason).map(([code, n]) => ({ k: `Unmask · ${UNMASK_REASON_LABELS[code as UnmaskReasonCode] ?? code}`, v: String(n) })),
              ]}
            />
            {Object.keys(m.unmasksByReason).length === 0 ? <p className="mt-2 text-xs text-gray-500">No unmasks in this range.</p> : null}
          </Panel>
        </Section>
      </div>

      <Section title="Rule precision" hint="closed items the engine flagged">
        {m.rulePrecision.length === 0 ? (
          <p className="text-sm text-gray-500">No rule-flagged items closed in this range.</p>
        ) : (
          <Panel className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Rule</th>
                  <th className="px-3 py-2 text-right font-medium">Flagged</th>
                  <th className="px-3 py-2 text-right font-medium">Removed</th>
                  <th className="px-3 py-2 text-right font-medium">Approved</th>
                  <th className="px-3 py-2 text-right font-medium">Precision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {m.rulePrecision.map((r) => (
                  <tr key={r.ruleId}>
                    <td className="px-3 py-1.5 font-mono text-xs">{r.ruleId}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.flagged}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.removed}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.approved}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.removed + r.approved ? percent(r.removed / (r.removed + r.approved)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </Section>
    </div>
  );
}

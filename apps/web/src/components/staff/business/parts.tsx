/**
 * Small pieces the Business section's pages share: status pills in words (never color alone), money and dates as
 * the console writes them, and where an ad runs.
 */
import { AD_PLACEMENTS, formatCents } from "@apartment-book/shared";
import type { AdStatus, BusinessStatus } from "@/lib/staff/ops-types";
import { Pill, type Tone } from "@/components/staff/parts";

const AD_STATUS: Record<AdStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "gray" },
  pending_review: { label: "In review", tone: "amber" },
  scheduled: { label: "Scheduled", tone: "blue" },
  active: { label: "Running", tone: "green" },
  paused: { label: "Paused", tone: "amber" },
  completed: { label: "Ended", tone: "gray" },
  rejected: { label: "Rejected", tone: "red" },
};
const BUSINESS_STATUS: Record<BusinessStatus, { label: string; tone: Tone }> = {
  pending: { label: "Awaiting review", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  suspended: { label: "Suspended", tone: "red" },
};

export function AdStatusPill({ status, pausedBy }: { status: AdStatus; pausedBy?: string | null }) {
  const s = AD_STATUS[status] ?? { label: status, tone: "gray" as Tone };
  return <Pill tone={s.tone}>{status === "paused" && pausedBy === "admin" ? "Paused by the team" : s.label}</Pill>;
}

export function BusinessStatusPill({ status }: { status: BusinessStatus }) {
  const s = BUSINESS_STATUS[status] ?? { label: status, tone: "gray" as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export const adStatusLabel = (s: AdStatus) => AD_STATUS[s]?.label ?? s;
export const usd = (cents: number | null | undefined) => formatCents(cents ?? 0, "USD");
export const placementLabel = (p: string) => AD_PLACEMENTS.find((x) => x.value === p)?.label ?? p;
export const placementsText = (ps: readonly string[]) => (ps.length ? ps.map(placementLabel).join(", ") : "—");

/** "Oct 21, 2026" in Central time, the day boundaries the console counts by. */
export function centralDay(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

/** "Oct 21, 2026, 9:05 AM CT". */
export function centralTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT`;
}

export function period(startMs: number | null, endMs: number | null): string {
  if (startMs === null && endMs === null) return "No dates yet";
  return `${centralDay(startMs)} to ${centralDay(endMs)}`;
}

import { AUTO_HIDE_STATUSES, REPORT_REASONS, type AutoHiddenRow, type AutoHideStatus } from "@apartment-book/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const STATUS_TONES: Record<AutoHideStatus, BadgeTone> = { pending: "amber", upheld: "red", restored: "green", deleted: "gray" };

export function autoHideStatusLabel(status: AutoHideStatus): string {
  return AUTO_HIDE_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function AutoHideStatusBadge({ status }: { status: AutoHideStatus }) {
  return <Badge tone={STATUS_TONES[status] ?? "gray"}>{autoHideStatusLabel(status)}</Badge>;
}

/** Production's reports use Trust & Safety's reasons too (hate, threat, doxxing…), which the apps' list does not name. */
function reasonText(reason: string): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason.replace(/_/g, " ");
}

/** "harassment ×6, hate ×4", most given first. */
export function reasonsSummary(reasons: AutoHiddenRow["reasons"]): string {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, n]) => `${reasonText(reason)} ×${n}`)
    .join(", ");
}

/** Who hid it: the 10-reporter rule, or Trust & Safety's own (earlier) Buzz threshold. */
export function sourceText(row: Pick<AutoHiddenRow, "source" | "reporterCount">): string {
  return row.source === "trust_safety"
    ? `Hidden by Buzz's own report threshold (${row.reporterCount} eligible ${row.reporterCount === 1 ? "reporter" : "reporters"} so far)`
    : `${row.reporterCount} different people reported it`;
}

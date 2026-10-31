import { MODERATION_TARGET_TYPES, REPORT_DECISIONS, REPORT_REASONS, type ReportDecision, type ReportRow, type ReportStatus } from "@apartment-book/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";

export function reasonLabel(reason: string): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export function targetTypeLabel(type: ReportRow["targetType"] | string): string {
  if (type === "profile") return "Profile";
  return MODERATION_TARGET_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function decisionLabel(decision: ReportDecision | string | null): string {
  if (!decision) return "";
  return REPORT_DECISIONS.find((d) => d.value === decision)?.label ?? decision;
}

const REASON_TONES: Record<string, BadgeTone> = { spam: "amber", scam: "red", harassment: "red", inappropriate: "purple", other: "gray" };

export function ReasonBadge({ reason }: { reason: string }) {
  return <Badge tone={REASON_TONES[reason] ?? "gray"}>{reasonLabel(reason)}</Badge>;
}

export function StatusBadge({ status, decision }: { status: ReportStatus; decision: ReportDecision | null }) {
  if (status === "open") return <Badge tone="amber">Open</Badge>;
  if (status === "dismissed") return <Badge tone="gray">Dismissed</Badge>;
  if (status === "actioned" && !decision) return <Badge tone="green">Action taken</Badge>;
  return <Badge tone="green">{decision ? decisionLabel(decision) : "Reviewed"}</Badge>;
}

import Link from "next/link";
import { Check, Flag } from "lucide-react";
import { categoryLabel, PRIORITY_LABEL, SOURCE_LABEL, surfaceLabel } from "@/lib/staff/constants";
import type { StaffQueueItem } from "@/lib/staff/types";
import { cn } from "@/lib/utils";
import { Ago, SlaChip } from "./live";
import { ExcerptBlock, Pill, PRIORITY_TONE, SEVERITY_RAIL } from "./parts";

export function StatusChip({ item }: { item: Pick<StaffQueueItem, "status" | "resolution" | "claimedByMe" | "claimedByOther"> }) {
  if (item.status === "closed")
    return (
      <Pill variant="outline" tone={item.resolution === "approved" || item.resolution === "dismissed" ? "green" : "gray"}>
        {item.resolution ?? "closed"}
      </Pill>
    );
  if (item.status === "escalated") return <Pill tone="amber">Escalated</Pill>;
  if (item.claimedByOther) return <Pill tone="blue">Being reviewed</Pill>;
  if (item.claimedByMe) return <Pill tone="green">Yours</Pill>;
  return null;
}

function CardBody({ item }: { item: StaffQueueItem }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={PRIORITY_TONE[item.priority]}>{PRIORITY_LABEL[item.priority]}</Pill>
        <Pill variant="outline">{surfaceLabel(item.surface)}</Pill>
        {item.label === "wellbeing" ? <Pill tone="blue">Wellbeing</Pill> : null}
        {item.appealId ? <Pill tone="violet">Appeal</Pill> : null}
        {item.category ? <span className="text-xs text-gray-700">{categoryLabel(item.category)}</span> : null}
        <Ago ms={item.createdAt} className="ml-auto text-xs text-gray-500" />
      </div>
      <ExcerptBlock text={item.excerpt} anon={item.anon} clamp />
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <span>{SOURCE_LABEL[item.source] ?? item.source}</span>
        {item.entityId === null ? <Pill variant="outline" tone="red">Blocked text</Pill> : null}
        {item.reportCount > 0 ? (
          <Pill>
            <Flag className="h-3 w-3" aria-hidden />
            {item.reportCount} {item.reportCount === 1 ? "report" : "reports"}
          </Pill>
        ) : null}
        {item.contentStatus && item.contentStatus !== "active" ? (
          <Pill variant="outline" tone="amber">
            {item.contentStatus}
          </Pill>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <SlaChip dueAt={item.slaDueAt} closed={item.status === "closed"} p0={item.priority === "p0"} />
          <StatusChip item={item} />
        </span>
      </div>
    </div>
  );
}

/** One queue item: a link to its detail, or (select mode) a checkbox card. */
export function QueueCard({ item, selecting, selected, onToggle }: { item: StaffQueueItem; selecting?: boolean; selected?: boolean; onToggle?: () => void }) {
  const cls = cn(
    "block w-full rounded-xl border-l-4 bg-white p-3 text-left shadow-sm ring-1 ring-gray-200 transition-shadow hover:ring-gray-300",
    SEVERITY_RAIL[item.severity],
    selected && "ring-2 ring-brand-500",
  );
  if (selecting) {
    return (
      <button type="button" onClick={onToggle} aria-pressed={selected} aria-label={selected ? "Deselect item" : "Select item"} className={cls}>
        <div className="flex items-start gap-3">
          <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border", selected ? "border-brand-600 bg-brand-600 text-white" : "border-gray-300 bg-white")} aria-hidden>
            {selected ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
          <div className="min-w-0 flex-1">
            <CardBody item={item} />
          </div>
        </div>
      </button>
    );
  }
  return (
    // Opening an item claims it for 10 minutes, so nothing here is prefetched.
    <Link href={`/admin/queue/${item.id}`} prefetch={false} className={cls} data-testid="staff-queue-card">
      <CardBody item={item} />
    </Link>
  );
}

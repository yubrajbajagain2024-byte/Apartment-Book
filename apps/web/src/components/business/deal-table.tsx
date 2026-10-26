"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Archive, Eye, Inbox, Pause, Pencil, Play, Tag, Trash2 } from "lucide-react";
import { dealStatusLabel, type BusinessDealStats, type Deal } from "@apartment-book/shared";
import { deleteDealAction, setDealStatusAction } from "@/lib/actions/business";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PortalLink } from "./portal-base";

export function DealTable({ deals, stats, universityNames }: { deals: Deal[]; stats: BusinessDealStats[]; universityNames: Map<string, string> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const statsById = new Map(stats.map((s) => [s.deal_id, s]));

  const run = (id: string, work: () => Promise<{ error?: string }>) => {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await work();
      setError(result.error ?? null);
      setBusyId(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="deal-table">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {deals.map((deal) => {
        const busy = pending && busyId === deal.id;
        const s = statsById.get(deal.id);
        const label = dealStatusLabel(deal);
        const where = deal.university_ids.length === 0 ? "Every campus" : deal.university_ids.map((id) => universityNames.get(id) ?? "Campus").join(", ");
        return (
          <article key={deal.id} className={cn("flex flex-col gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:items-center", busy && "opacity-60")}>
            <PortalLink href={`/deals/${deal.id}/edit`} className="relative h-24 w-full shrink-0 overflow-hidden rounded-lg bg-gray-100 sm:h-20 sm:w-28">
              {deal.image_url ? (
                <Image src={deal.image_url} alt="" fill sizes="112px" className="object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center text-gray-400">
                  <Tag className="h-6 w-6" />
                </span>
              )}
            </PortalLink>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <PortalLink href={`/deals/${deal.id}/edit`} className="truncate font-semibold text-gray-900 hover:underline">
                  {deal.title}
                </PortalLink>
                {deal.discount_label ? <Badge tone="blue">{deal.discount_label}</Badge> : null}
                <Badge tone={label === "Live" ? "green" : label === "Archived" || label === "Ended" ? "gray" : "amber"}>{label}</Badge>
                {s?.sponsored_until ? <Badge tone="blue">Sponsored until {formatDate(s.sponsored_until)}</Badge> : null}
              </div>
              <p className="truncate text-sm text-gray-600">
                {where}
                {deal.ends_at ? ` · ends ${formatDate(deal.ends_at)}` : ""}
              </p>
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                <div className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" /> <dd className="font-semibold text-gray-900">{s?.views ?? 0}</dd> views <span className="text-gray-400">({s?.views_7d ?? 0} this week)</span>
                </div>
                <div className="flex items-center gap-1">
                  <Inbox className="h-3.5 w-3.5" /> <dd className="font-semibold text-gray-900">{s?.inquiries ?? 0}</dd> inquiries
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap items-center gap-1 sm:justify-end">
              <PortalLink href={`/deals/${deal.id}/edit`} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                <Pencil className="h-4 w-4" /> Edit
              </PortalLink>
              {deal.status === "active" ? (
                <button type="button" disabled={busy} onClick={() => run(deal.id, () => setDealStatusAction(deal.id, "paused"))} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <Pause className="h-4 w-4" /> Pause
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => run(deal.id, () => setDealStatusAction(deal.id, "active"))} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <Play className="h-4 w-4" /> Resume
                </button>
              )}
              {deal.status !== "archived" ? (
                <button type="button" disabled={busy} onClick={() => run(deal.id, () => setDealStatusAction(deal.id, "archived"))} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <Archive className="h-4 w-4" /> Archive
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Delete "${deal.title}"? This cannot be undone.`)) return;
                  run(deal.id, () => deleteDealAction(deal.id));
                }}
                className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

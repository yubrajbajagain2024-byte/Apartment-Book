"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, CalendarDays, Eye, Inbox, Pause, Pencil, Play, Store, Trash2 } from "lucide-react";
import { dealStatusLabel, formatCents, mediaCover, mediaItems, postKindLabel, type BusinessDealStats, type Deal } from "@apartment-book/shared";
import { deleteDealAction, setDealStatusAction } from "@/lib/actions/business";
import { cn, formatDate } from "@/lib/utils";
import { useListFilter } from "./filter-tabs";
import { PortalLink } from "./portal-base";
import { Notice, Pill, type Tone } from "./ui";

const STATUS_TONE: Record<string, Tone> = { Live: "success", Scheduled: "accent", Ended: "neutral", Paused: "neutral", Archived: "neutral" };

/**
 * The business's posts as a grid: the picture, what kind of post it is, where and until when it runs, its views and
 * inquiries, and pausing, archiving, editing and deleting (for the roles that publish; the database checks the same).
 * Kept under v1's name, DealTable: every post lives in the deals table.
 */
export function DealTable({
  deals,
  stats,
  universityNames,
  canPublish = true,
  filter,
}: {
  deals: Deal[];
  stats: BusinessDealStats[];
  universityNames: Map<string, string>;
  canPublish?: boolean;
  /** The type filter (FilterTabs above the grid): the address's parameter, and the kinds each value shows (null: all). */
  filter?: { param: string; fallback: string; kinds: Record<string, readonly string[] | null> };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const statsById = new Map(stats.map((s) => [s.deal_id, s]));
  const active = useListFilter(filter?.param ?? "kind", filter ? Object.keys(filter.kinds) : [], filter?.fallback ?? "all");
  const kinds = filter?.kinds[active] ?? null;
  const shown = kinds ? deals.filter((d) => kinds.includes(d.kind)) : deals;

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
  const action = "inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-biz-ink-2 transition-colors hover:bg-biz-line hover:text-biz-ink";

  if (shown.length === 0) return <p className="py-10 text-center text-[15px] text-biz-ink-3">Nothing of this type yet.</p>;
  return (
    <div className="flex flex-col gap-4" data-testid="deal-table">
      {error ? <Notice tone="danger" title={error} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((deal) => {
          const busy = pending && busyId === deal.id;
          const s = statsById.get(deal.id);
          const label = dealStatusLabel(deal);
          const cover = mediaCover(mediaItems(deal.media)) ?? deal.image_url;
          const where = deal.university_ids.length === 0 ? "Every campus" : deal.university_ids.map((id) => universityNames.get(id) ?? "Campus").join(", ");
          return (
            <article key={deal.id} className={cn("flex flex-col overflow-hidden rounded-[22px] bg-biz-surface shadow-biz ring-1 ring-biz-line transition-[opacity,box-shadow] duration-300 hover:shadow-biz-lift", busy && "opacity-60")}>
              <PortalLink href={canPublish ? `/deals/${deal.id}/edit` : "/deals"} className="relative block aspect-[4/3] bg-biz-surface-3">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the business's own upload, any host v1 allowed
                  <img src={cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <Store className="absolute inset-0 m-auto h-8 w-8 text-biz-ink-4" />
                )}
                <span className="absolute left-3 top-3 flex gap-1.5">
                  <Pill tone="neutral" className="bg-biz-glass backdrop-blur">{postKindLabel(deal.kind)}</Pill>
                  {s?.sponsored_until ? <Pill tone="accent" className="backdrop-blur">Sponsored</Pill> : null}
                </span>
              </PortalLink>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-semibold leading-snug text-biz-ink">{deal.title}</h3>
                  <Pill tone={STATUS_TONE[label] ?? "neutral"}>{label}</Pill>
                </div>
                <p className="text-[13px] text-biz-ink-3">
                  {[deal.price_cents != null ? formatCents(deal.price_cents, deal.currency) : null, deal.discount_label, deal.code ? `Code ${deal.code}` : null].filter(Boolean).join(" · ") || where}
                </p>
                {deal.kind === "event" && deal.event_at ? (
                  <p className="flex items-center gap-1.5 text-[13px] text-biz-ink-2">
                    <CalendarDays className="h-4 w-4" /> {new Date(deal.event_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                ) : null}
                <p className="text-xs text-biz-ink-4">
                  {where}
                  {deal.ends_at ? ` · until ${formatDate(deal.ends_at)}` : ""}
                </p>
                <div className="mt-auto flex items-center gap-4 pt-2 text-[13px] text-biz-ink-3">
                  <span className="flex items-center gap-1 tabular-nums" title="Views (one per student per day)">
                    <Eye className="h-4 w-4" /> {s?.views ?? 0}
                  </span>
                  <span className="flex items-center gap-1 tabular-nums" title="Inquiries">
                    <Inbox className="h-4 w-4" /> {s?.inquiries ?? 0}
                  </span>
                </div>
                {canPublish ? (
                  <div className="-mx-2 flex flex-wrap gap-0.5 border-t border-biz-line pt-2">
                    <PortalLink href={`/deals/${deal.id}/edit`} className={action}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </PortalLink>
                    {deal.status === "active" ? (
                      <button type="button" disabled={busy} onClick={() => run(deal.id, () => setDealStatusAction(deal.id, "paused"))} className={action}>
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => run(deal.id, () => setDealStatusAction(deal.id, "active"))} className={action}>
                        <Play className="h-3.5 w-3.5" /> {deal.status === "archived" ? "Restore" : "Resume"}
                      </button>
                    )}
                    {deal.status !== "archived" ? (
                      <button type="button" disabled={busy} onClick={() => run(deal.id, () => setDealStatusAction(deal.id, "archived"))} className={action}>
                        <Archive className="h-3.5 w-3.5" /> Archive
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (confirmDelete !== deal.id) return setConfirmDelete(deal.id);
                        setConfirmDelete(null);
                        run(deal.id, () => deleteDealAction(deal.id));
                      }}
                      className={cn(action, confirmDelete === deal.id && "bg-biz-danger-soft text-biz-danger")}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {confirmDelete === deal.id ? "Delete for good?" : "Delete"}
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

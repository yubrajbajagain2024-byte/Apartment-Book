"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Archive, Building2, Eye, Inbox, MessageCircle, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { formatPrice, type BusinessListingStats, type ListingStatus } from "@apartment-book/shared";
import { deleteBusinessListingAction, setBusinessListingStatusAction } from "@/lib/actions/business";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PortalLink } from "./portal-base";

export type ListingRow = {
  id: string;
  title: string;
  status: ListingStatus;
  price: number;
  currency: string;
  place: string;
  image: string | null;
  createdAt: string;
  stats: BusinessListingStats | null;
};

const TONE: Record<ListingStatus, "green" | "amber" | "gray"> = { active: "green", rented: "amber", archived: "gray" };

/** The business's listings with their numbers and the actions a team member has on each. Cards, so phones get the same. */
export function ListingTable({ rows }: { rows: ListingRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    <div className="flex flex-col gap-3" data-testid="listing-table">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {rows.map((row) => {
        const busy = pending && busyId === row.id;
        const s = row.stats;
        return (
          <article key={row.id} className={cn("flex flex-col gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:items-center", busy && "opacity-60")}>
            <PortalLink href={`/listings/${row.id}/edit`} className="relative h-24 w-full shrink-0 overflow-hidden rounded-lg bg-gray-100 sm:h-20 sm:w-28">
              {row.image ? (
                <Image src={row.image} alt="" fill sizes="112px" className="object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center text-gray-400">
                  <Building2 className="h-6 w-6" />
                </span>
              )}
            </PortalLink>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <PortalLink href={`/listings/${row.id}/edit`} className="truncate font-semibold text-gray-900 hover:underline">
                  {row.title}
                </PortalLink>
                <Badge tone={TONE[row.status]}>{row.status}</Badge>
                {s?.sponsored_until ? <Badge tone="blue">Sponsored until {formatDate(s.sponsored_until)}</Badge> : null}
              </div>
              <p className="truncate text-sm text-gray-600">
                {formatPrice(row.price, row.currency)}/mo · {row.place} · posted {timeAgo(row.createdAt)}
              </p>
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                <div className="flex items-center gap-1" title="Views (last 7 days)">
                  <Eye className="h-3.5 w-3.5" /> <dd className="font-semibold text-gray-900">{s?.views ?? 0}</dd> views <span className="text-gray-400">({s?.views_7d ?? 0} this week)</span>
                </div>
                <div className="flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" /> <dd className="font-semibold text-gray-900">{s?.contacts ?? 0}</dd> contacts
                </div>
                <div className="flex items-center gap-1">
                  <Inbox className="h-3.5 w-3.5" /> <dd className="font-semibold text-gray-900">{s?.inquiries ?? 0}</dd> inquiries
                </div>
                <div className="flex items-center gap-1">
                  <dd className="font-semibold text-gray-900">{s?.saves ?? 0}</dd> saves
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap items-center gap-1 sm:justify-end">
              <PortalLink href={`/listings/${row.id}/edit`} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                <Pencil className="h-4 w-4" /> Edit
              </PortalLink>
              {row.status === "active" ? (
                <button type="button" disabled={busy} onClick={() => run(row.id, () => setBusinessListingStatusAction(row.id, "rented"))} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Mark rented
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => run(row.id, () => setBusinessListingStatusAction(row.id, "active"))} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <RotateCcw className="h-4 w-4" /> Reactivate
                </button>
              )}
              {row.status !== "archived" ? (
                <button type="button" disabled={busy} onClick={() => run(row.id, () => setBusinessListingStatusAction(row.id, "archived"))} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <Archive className="h-4 w-4" /> Archive
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
                  run(row.id, () => deleteBusinessListingAction(row.id));
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

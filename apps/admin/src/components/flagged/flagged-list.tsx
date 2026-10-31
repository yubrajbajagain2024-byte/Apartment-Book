"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { listAutoHidden, type AutoHiddenRow, type AutoHideStatus } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { Time } from "@/components/common/time";
import { targetTypeLabel } from "@/components/reports/report-badges";
import { AutoHideStatusBadge, reasonsSummary, sourceText } from "./flag-badges";

const PAGE = 50;

/** A row that opens the content page, or a plain one once the content is gone (deleted, by staff or its author). */
function RowShell({ href, children }: { href: string | null; children: ReactNode }) {
  const className = "flex items-start gap-3 px-4 py-3 sm:px-5";
  return href ? (
    <Link href={href} className={`${className} hover:bg-gray-50`}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

/** Content reports hid automatically, newest first. Each row opens the content page, where staff restore, keep it hidden or delete it. */
export function FlaggedList({ initial, status }: { initial: AutoHiddenRow[]; status: AutoHideStatus | "all" }) {
  const [items, setItems] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loading) return;
    setLoading(true);
    setError(null);
    try {
      const older = await listAutoHidden(createClient(), { status, limit: PAGE, before: last.createdAt });
      setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.id === o.id))]);
      setDone(older.length < PAGE);
    } catch (e) {
      setError(`Could not load older rows. ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={status === "pending" ? "Nothing waiting for review" : "Nothing here"}
        description="When 10 different people report the same post, reel, comment, listing or buzz, it is hidden at once and listed here for review."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-gray-100">
          {items.map((row) => (
            <li key={row.id}>
              <RowShell href={row.targetExists ? `/content/${row.targetType}/${row.targetId}` : null}>
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="blue">{targetTypeLabel(row.targetType)}</Badge>
                    <AutoHideStatusBadge status={row.status} />
                    {!row.targetExists ? <Badge tone="gray">Gone</Badge> : null}
                    <span className="truncate text-sm font-semibold text-gray-900">{row.title || row.preview || "(no text)"}</span>
                  </div>
                  {row.title && row.preview ? <p className="mt-0.5 truncate text-sm text-gray-600">{row.preview}</p> : null}
                  <p className="mt-1 text-xs text-gray-500">
                    hidden <Time iso={row.hiddenAt} /> · {sourceText(row)}
                    {Object.keys(row.reasons).length ? ` · ${reasonsSummary(row.reasons)}` : ""} · by{" "}
                    {row.authorName ?? (row.authorId ? "unnamed" : row.targetType.startsWith("buzz") ? "an anonymous student" : "a deleted account")}
                  </p>
                  {row.status !== "pending" && row.reviewedAt ? (
                    <p className="mt-0.5 text-xs text-gray-500">
                      reviewed <Time iso={row.reviewedAt} /> by {row.reviewerName ?? (row.reviewedBy ? "a former staff member" : "the system")}
                      {row.reviewNote ? ` · “${row.reviewNote}”` : ""}
                    </p>
                  ) : null}
                </div>
                {row.targetExists ? <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" /> : null}
              </RowShell>
            </li>
          ))}
        </ul>
      </Card>
      <FormMessage error={error} />
      {!done ? (
        <Button variant="outline" onClick={loadMore} loading={loading} className="self-center">
          Load older
        </Button>
      ) : null}
    </div>
  );
}

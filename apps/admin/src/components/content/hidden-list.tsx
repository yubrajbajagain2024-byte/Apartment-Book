"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, EyeOff } from "lucide-react";
import { listHiddenContent, type HiddenContentRow, type ModerationTargetType } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { Time } from "@/components/common/time";
import { targetTypeLabel } from "@/components/reports/report-badges";

const PAGE = 50;

/** Everything currently hidden, newest hide first. */
export function HiddenList({ initial, type }: { initial: HiddenContentRow[]; type: ModerationTargetType | null }) {
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
      const older = await listHiddenContent(createClient(), { type, limit: PAGE, before: last.hiddenAt });
      setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.targetId === o.targetId && c.targetType === o.targetType))]);
      setDone(older.length < PAGE);
    } catch (e) {
      setError(`Could not load older rows. ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return <EmptyState icon={EyeOff} title="Nothing is hidden" description="Content you hide from a report or a lookup is listed here until it is restored or deleted." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-gray-100">
          {items.map((row) => (
            <li key={`${row.targetType}:${row.targetId}`}>
              <Link href={`/content/${row.targetType}/${row.targetId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 sm:px-5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="blue">{targetTypeLabel(row.targetType)}</Badge>
                    <span className="truncate text-sm font-semibold text-gray-900">{row.title || row.preview || "(no text)"}</span>
                  </div>
                  {row.title && row.preview ? <p className="mt-0.5 truncate text-sm text-gray-600">{row.preview}</p> : null}
                  <p className="mt-1 text-xs text-gray-500">
                    hidden <Time iso={row.hiddenAt} />
                    {row.hiddenReason ? ` · “${row.hiddenReason}”` : ""} · by {row.authorName ?? (row.authorId ? "unnamed" : row.targetType.startsWith("buzz") ? "an anonymous student" : "a deleted account")}
                  </p>
                </div>
                <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              </Link>
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

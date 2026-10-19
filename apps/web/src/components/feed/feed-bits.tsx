"use client";

import type { RefObject } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function SkeletonCard({ aspect = "aspect-[4/3]", lines = 3 }: { aspect?: string; lines?: number }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      <div className={cn("ab-skeleton w-full", aspect)} />
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cn("ab-skeleton h-3 rounded", i === 0 ? "w-1/3" : i === 1 ? "w-4/5" : "w-1/2")} />
        ))}
      </div>
    </div>
  );
}

export function FeedFooter({
  sentinelRef,
  loading,
  done,
  error,
  onRetry,
  count,
  emptyMessage,
}: {
  sentinelRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  done: boolean;
  error: string | null;
  onRetry: () => void;
  count: number;
  emptyMessage?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-sm text-gray-500">
      <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
      {error ? (
        <button type="button" onClick={onRetry} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300">
          Could not load more. Try again
        </button>
      ) : loading ? (
        <span>Loading more…</span>
      ) : done && count > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-brand-600" /> You&apos;re all caught up
        </span>
      ) : done && count === 0 && emptyMessage ? (
        <span>{emptyMessage}</span>
      ) : null}
    </div>
  );
}

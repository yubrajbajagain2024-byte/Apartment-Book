"use client";

import type { RefObject } from "react";
import { cn } from "@/lib/utils";

/** A card still loading: a shimmer block in the shape of its picture and a few lines of text. */
export function SkeletonCard({ aspect = "aspect-[4/3]", lines = 3 }: { aspect?: string; lines?: number }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200" aria-hidden="true">
      <div className={cn("ab-skeleton w-full", aspect)} />
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cn("ab-skeleton h-3 rounded", i === 0 ? "w-1/3" : i === 1 ? "w-4/5" : "w-1/2")} />
        ))}
      </div>
    </div>
  );
}

/** The shape of an Instagram-style post while the next page loads: avatar and name, the photo, the action row, the caption. */
export function PostSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col bg-white pb-4 sm:rounded-xl sm:ring-1 sm:ring-gray-200", className)} aria-hidden="true">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="ab-skeleton h-8 w-8 rounded-full" />
        <span className="flex flex-col gap-1.5">
          <span className="ab-skeleton h-3 w-28 rounded" />
          <span className="ab-skeleton h-2.5 w-20 rounded" />
        </span>
      </div>
      <div className="ab-skeleton aspect-[4/5] w-full" />
      <div className="flex items-center gap-4 px-3 pt-3">
        <span className="ab-skeleton h-6 w-6 rounded-full" />
        <span className="ab-skeleton h-6 w-6 rounded-full" />
        <span className="ab-skeleton h-6 w-6 rounded-full" />
      </div>
      <div className="flex flex-col gap-2 px-3 pt-3">
        <span className="ab-skeleton h-3 w-4/5 rounded" />
        <span className="ab-skeleton h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}

/** The shape of a row in a list (a Buzz thread, a notification): a small mark, a title line, a shorter second line. */
export function RowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-start gap-3 px-4 py-3.5", className)} aria-hidden="true">
      <span className="ab-skeleton h-6 w-6 shrink-0 rounded-full" />
      <span className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <span className="ab-skeleton h-3.5 w-3/4 rounded" />
        <span className="ab-skeleton h-3 w-1/2 rounded" />
      </span>
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
    <div className="flex flex-col items-center gap-3 py-8 text-sm text-gray-500">
      <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
      {error ? (
        <button type="button" onClick={onRetry} className="ab-press rounded-[10px] border border-gray-300 px-4 py-2 text-[13px] font-semibold text-gray-900 hover:bg-gray-50">
          Could not load more. Try again
        </button>
      ) : loading ? (
        <span className="text-xs tracking-[0.02em] text-gray-400">Loading more…</span>
      ) : done && count > 0 ? (
        // The end of the feed, said quietly in the serif.
        <span className="font-display text-base italic text-gray-500">You&apos;re all caught up</span>
      ) : done && count === 0 && emptyMessage ? (
        <span>{emptyMessage}</span>
      ) : null}
    </div>
  );
}

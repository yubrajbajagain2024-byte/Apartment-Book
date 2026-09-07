"use client";

import type { ReactNode } from "react";
import { hasVideo, type FeedMedia } from "@apartment-book/shared";

/**
 * Lays out posts Instagram-style: posts with video take the full column,
 * photo-only posts sit two per row as smaller 4:5 tiles.
 */
export function PostFeed<T extends { id: string }>({
  items,
  mediaOf,
  render,
  trailing,
}: {
  items: T[];
  mediaOf: (item: T) => FeedMedia[];
  render: (item: T, compact: boolean, index: number) => ReactNode;
  trailing?: ReactNode;
}) {
  const rows: ReactNode[] = [];
  let pending: { item: T; index: number }[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    rows.push(
      <div key={`row-${pending[0].item.id}`} className="grid grid-cols-2 gap-1 sm:gap-3">
        {pending.map(({ item, index }) => (
          <div key={item.id}>{render(item, true, index)}</div>
        ))}
      </div>,
    );
    pending = [];
  };
  items.forEach((item, index) => {
    if (hasVideo(mediaOf(item))) {
      flush();
      rows.push(<div key={item.id}>{render(item, false, index)}</div>);
    } else {
      pending.push({ item, index });
      if (pending.length === 2) flush();
    }
  });
  flush();
  return (
    <div className="-mx-3 flex flex-col gap-1 sm:mx-0 sm:gap-4">
      {rows}
      {trailing}
    </div>
  );
}

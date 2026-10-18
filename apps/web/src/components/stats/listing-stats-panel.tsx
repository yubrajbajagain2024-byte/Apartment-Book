import { Bookmark, Eye, MessageCircle } from "lucide-react";
import type { ListingStats } from "@apartment-book/shared";

/** Owner-only numbers for a post. */
export function ListingStatsPanel({ stats, title = "Your post so far" }: { stats: ListingStats; title?: string }) {
  const items = [
    { icon: Eye, label: "views", value: stats.views },
    { icon: Bookmark, label: "saves", value: stats.saves },
    { icon: MessageCircle, label: "messages", value: stats.contacts },
  ];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{title}</p>
      <dl className="grid grid-cols-3 divide-x divide-gray-200 overflow-hidden rounded-[10px] ring-1 ring-gray-200">
        {items.map((i) => (
          <div key={i.label} className="flex flex-col items-center gap-0.5 px-2 py-2.5 text-center">
            <dd className="font-display text-xl leading-none tracking-tight tabular-nums text-gray-900">{i.value}</dd>
            <dt className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">
              <i.icon className="h-3 w-3" strokeWidth={1.75} /> {i.label}
            </dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

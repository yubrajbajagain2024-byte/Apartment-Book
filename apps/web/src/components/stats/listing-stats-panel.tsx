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
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <dl className="grid grid-cols-3 gap-2">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg bg-gray-50 px-3 py-2 text-center">
            <dt className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <i.icon className="h-3.5 w-3.5" /> {i.label}
            </dt>
            <dd className="text-lg font-bold text-gray-900">{i.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

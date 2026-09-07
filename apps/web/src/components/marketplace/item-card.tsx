import Link from "next/link";
import { formatPrice, ITEM_CATEGORIES, ITEM_CONDITIONS, labelFor, type ItemWithSeller } from "@apartment-book/shared";
import { timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ListingImage } from "@/components/common/listing-image";
import { SaveButton } from "@/components/common/save-button";

export function ItemCard({ item, saved, signedIn }: { item: ItemWithSeller; saved: boolean; signedIn: boolean }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 transition-shadow hover:shadow-md">
      <Link href={`/marketplace/${item.id}`} className="flex flex-1 flex-col">
        <ListingImage src={item.images[0]} alt={item.title} className="aspect-square" />
        <div className="flex flex-1 flex-col gap-1 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-lg font-bold text-gray-900">{item.price === 0 ? "Free" : formatPrice(item.price, item.currency)}</p>
            {item.status !== "available" ? <Badge tone="amber">{item.status}</Badge> : null}
          </div>
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">{item.title}</h3>
          <p className="text-xs text-gray-500">
            {labelFor(ITEM_CATEGORIES, item.category)} · {labelFor(ITEM_CONDITIONS, item.condition)}
          </p>
          <p className="mt-auto truncate pt-1 text-xs text-gray-500">
            {item.pickup_location || item.university?.name || item.seller.full_name} · {timeAgo(item.created_at)}
          </p>
        </div>
      </Link>
      <div className="absolute right-2 top-2">
        <SaveButton targetType="item" targetId={item.id} initialSaved={saved} signedIn={signedIn} size="sm" className="bg-white/90 shadow" />
      </div>
    </article>
  );
}

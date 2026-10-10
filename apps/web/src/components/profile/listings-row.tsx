import Link from "next/link";
import { Building2, Play, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import type { ProfileTile, ProfileTileType } from "@apartment-book/shared";
import { TileImage } from "./tile-image";

/** One card of the Listings row; `status` ("Rented", "Sold", "Found") marks one that is no longer live (only its owner sees those). */
export type ProfileListingCard = { tile: ProfileTile; status: string | null };

const KIND: Partial<Record<ProfileTileType, { label: string; icon: LucideIcon }>> = {
  apartment: { label: "Apartment", icon: Building2 },
  roommate: { label: "Roommate", icon: Users },
  item: { label: "For sale", icon: ShoppingBag },
};
const FALLBACK_KIND = { label: "Listing", icon: Building2 };

/** Someone's apartments, roommate posts and items for sale as a row of small cards that scrolls sideways. */
export function ListingsRow({ cards }: { cards: ProfileListingCard[] }) {
  return (
    <section aria-labelledby="profile-listings-heading" className="pb-4 text-left" data-testid="profile-listings">
      <h2 id="profile-listings-heading" className="px-4 text-sm font-semibold text-gray-900">
        Listings
      </h2>
      <ul className="no-scrollbar mt-2 flex snap-x gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-1">
        {cards.map(({ tile, status }) => {
          const kind = KIND[tile.type] ?? FALLBACK_KIND;
          const KindIcon = kind.icon;
          return (
            <li key={tile.key} className="w-[7.5rem] shrink-0 snap-start">
              <Link href={tile.href} className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" data-testid="profile-listing">
                <span className="relative block aspect-square overflow-hidden rounded-xl bg-gray-100 ring-1 ring-gray-200">
                  {tile.imageUrl ? (
                    <TileImage src={tile.imageUrl} sizes="120px" className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-gray-400">
                      <KindIcon className="h-8 w-8" aria-hidden="true" />
                    </span>
                  )}
                  {status ? <span className="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">{status}</span> : null}
                  {tile.isVideo ? <Play className="absolute right-1.5 top-1.5 h-4 w-4 fill-current text-white drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.65)]" aria-hidden="true" /> : null}
                </span>
                <span className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-gray-500">
                  <KindIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {kind.label}
                </span>
                <span className="line-clamp-2 break-words text-xs font-semibold leading-snug text-gray-900">{tile.text ?? kind.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

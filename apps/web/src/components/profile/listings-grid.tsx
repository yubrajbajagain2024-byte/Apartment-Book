import Link from "next/link";
import { Building2, Play, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import type { ProfileTile, ProfileTileType } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { TileImage } from "./tile-image";

/** One square of the Listings tab; `status` ("Rented", "Sold", "Found") marks one that is no longer live (only its owner sees those). */
export type ProfileListing = { tile: ProfileTile; status: string | null };

/** What each kind says on its square, and what the screen reader calls it. */
const KIND: Partial<Record<ProfileTileType, { label: string; name: string; icon: LucideIcon }>> = {
  apartment: { label: "Apartment", name: "Apartment", icon: Building2 },
  roommate: { label: "Roommate", name: "Roommate post", icon: Users },
  item: { label: "For sale", name: "Marketplace item", icon: ShoppingBag },
};
const FALLBACK_KIND = { label: "Listing", name: "Listing", icon: Building2 };
/** Three columns, as in the other tabs: a third of the 672px column on wide screens, a third of the screen on phones. */
const TILE_SIZES = "(min-width: 672px) 224px, 33vw";

/**
 * The Listings tab: someone's apartments, roommate posts and items for sale in the same three-column grid as the other
 * tabs. Each square opens the listing and shows its cover (or the kind's icon), the kind and title, a play mark on a
 * video, and the status of one that is no longer live.
 */
export function ListingsGrid({ listings }: { listings: ProfileListing[] }) {
  return (
    <ul className="grid grid-cols-3 gap-0.5" data-testid="profile-listings">
      {listings.map(({ tile, status }, i) => (
        <li key={tile.key}>
          <ListingTile tile={tile} status={status} eager={i < 3} />
        </li>
      ))}
    </ul>
  );
}

function ListingTile({ tile, status, eager }: ProfileListing & { eager: boolean }) {
  const kind = KIND[tile.type] ?? FALLBACK_KIND;
  const KindIcon = kind.icon;
  const title = tile.text ?? kind.label;
  const picture = Boolean(tile.imageUrl);
  // White with a soft shadow over pictures; grey on the pale square of one without.
  const ink = picture ? "text-white drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.65)]" : "text-gray-600";
  const label = [`${kind.name}: ${title}`, status?.toLowerCase(), tile.isVideo ? "video" : null].filter(Boolean).join(", ");
  return (
    <Link
      href={tile.href}
      aria-label={label}
      className="group relative block aspect-[3/4] overflow-hidden bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      data-testid="profile-listing"
    >
      {tile.imageUrl ? (
        <TileImage src={tile.imageUrl} sizes={TILE_SIZES} eager={eager} className="transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center pb-10 text-gray-400">
          <KindIcon className="h-8 w-8" />
        </span>
      )}
      {picture ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" /> : null}

      {status ? <span aria-hidden="true" className="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white">{status}</span> : null}
      {tile.isVideo ? <Play aria-hidden="true" className={cn("absolute right-1.5 top-1.5 h-4 w-4 fill-current", ink)} /> : null}

      <span aria-hidden="true" className={cn("absolute inset-x-1.5 bottom-1.5 flex flex-col gap-0.5 text-left", ink)}>
        <span className="flex items-center gap-1 text-[11px] font-semibold">
          <KindIcon className="h-3 w-3 shrink-0" strokeWidth={2.5} />
          {kind.label}
        </span>
        <span className={cn("line-clamp-2 break-words text-xs font-bold leading-snug", !picture && "text-gray-900")}>{title}</span>
      </span>
    </Link>
  );
}

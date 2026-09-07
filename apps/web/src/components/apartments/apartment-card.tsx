import Link from "next/link";
import { Bath, BedDouble, MapPin } from "lucide-react";
import { formatDistance, formatPrice, type ApartmentWithOwner } from "@apartment-book/shared";
import { timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ListingImage } from "@/components/common/listing-image";
import { SaveButton } from "@/components/common/save-button";

export function ApartmentCard({
  apartment,
  saved,
  signedIn,
}: {
  apartment: ApartmentWithOwner;
  saved: boolean;
  signedIn: boolean;
}) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 transition-shadow hover:shadow-md">
      <Link href={`/apartments/${apartment.id}`} className="flex flex-1 flex-col">
        <ListingImage src={apartment.images[0]} alt={apartment.title} />
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-lg font-bold text-gray-900">
              {formatPrice(apartment.price_per_month, apartment.currency)}
              <span className="text-sm font-normal text-gray-500"> / month</span>
            </p>
            {apartment.status !== "active" ? <Badge tone="amber">{apartment.status}</Badge> : null}
          </div>
          <h3 className="line-clamp-2 font-semibold leading-snug text-gray-900">{apartment.title}</h3>
          <p className="flex items-center gap-1 truncate text-sm text-gray-600">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{apartment.city || apartment.address}</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">
            <span className="flex items-center gap-1">
              <BedDouble className="h-4 w-4" /> {apartment.bedrooms === 0 ? "Studio" : `${apartment.bedrooms} bd`}
            </span>
            <span className="flex items-center gap-1">
              <Bath className="h-4 w-4" /> {apartment.bathrooms} ba
            </span>
            {apartment.furnished ? <Badge tone="blue">Furnished</Badge> : null}
            {apartment.distance_km !== null ? <Badge>{formatDistance(apartment.distance_km)} to campus</Badge> : null}
          </div>
          {apartment.university ? <p className="truncate text-xs text-gray-500">Near {apartment.university.name}</p> : null}
          <div className="mt-auto flex items-center gap-2 pt-2 text-xs text-gray-500">
            <Avatar name={apartment.owner.full_name} src={apartment.owner.avatar_url} size="xs" />
            <span className="truncate">{apartment.owner.full_name}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{timeAgo(apartment.created_at)}</span>
          </div>
        </div>
      </Link>
      <div className="absolute right-2 top-2">
        <SaveButton targetType="apartment" targetId={apartment.id} initialSaved={saved} signedIn={signedIn} size="sm" className="bg-white/90 shadow" />
      </div>
    </article>
  );
}

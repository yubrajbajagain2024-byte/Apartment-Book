"use client";

import { useState } from "react";
import Link from "next/link";
import { Bath, BedDouble, MapPin } from "lucide-react";
import { formatDistance, formatPrice, photosFor, timeAgo, type ApartmentWithOwner } from "@apartment-book/shared";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { SaveBurst, SaveToggleButton, useSaveToggle } from "@/components/common/save-button";
import { PhotoCarousel } from "@/components/photos/photo-carousel";

export function ApartmentCard({
  apartment,
  saved,
  signedIn,
  priority,
}: {
  apartment: ApartmentWithOwner;
  saved: boolean;
  signedIn: boolean;
  priority?: boolean;
}) {
  const photos = photosFor(apartment.images, apartment.image_meta);
  const href = `/apartments/${apartment.id}`;
  const save = useSaveToggle("apartment", apartment.id, saved, signedIn);
  const [burst, setBurst] = useState(0);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 transition-shadow hover:shadow-md">
      <div className="relative">
        <PhotoCarousel
          photos={photos}
          alt={apartment.title}
          aspect="4 / 3"
          href={href}
          priority={priority}
          sizes="(min-width: 1280px) 320px, (min-width: 640px) 50vw, 100vw"
          onDoubleTap={() => {
            if (!save.saved) save.toggle();
            setBurst((b) => b + 1);
          }}
        >
          <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-full bg-black/65 px-2.5 py-1 text-sm font-bold text-white backdrop-blur">
            {formatPrice(apartment.price_per_month, apartment.currency)}
            <span className="font-normal opacity-80"> /mo</span>
          </div>
          {apartment.status !== "active" ? (
            <div className="pointer-events-none absolute left-2 top-2 z-20">
              <Badge tone="amber">{apartment.status}</Badge>
            </div>
          ) : null}
          <SaveBurst key={burst} show={burst > 0} />
        </PhotoCarousel>
        <div className="absolute right-2 top-2 z-20">
          <SaveToggleButton controller={save} size="sm" className="bg-white/90 shadow" />
        </div>
      </div>
      <Link href={href} className="flex flex-1 flex-col gap-1 p-3">
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
          <span className="shrink-0" suppressHydrationWarning>
            {timeAgo(apartment.created_at)}
          </span>
        </div>
      </Link>
    </article>
  );
}

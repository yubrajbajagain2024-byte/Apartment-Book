"use client";

import { useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
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
  // The eyebrow line under the title: rooms, baths and whether it comes furnished.
  const facts = [apartment.bedrooms === 0 ? "Studio" : `${apartment.bedrooms} bd`, `${apartment.bathrooms} ba`, apartment.furnished ? "Furnished" : null].filter(Boolean);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[14px] bg-white shadow-card ring-1 ring-gray-200 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float">
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
          {apartment.status !== "active" ? (
            <div className="pointer-events-none absolute left-3 top-3 z-20">
              <Badge tone="amber">{apartment.status}</Badge>
            </div>
          ) : null}
          <SaveBurst key={burst} show={burst > 0} />
        </PhotoCarousel>
        <div className="absolute right-3 top-3 z-20">
          <SaveToggleButton controller={save} size="sm" />
        </div>
      </div>
      <Link href={href} className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-xl leading-none tracking-tight text-gray-900">
            {formatPrice(apartment.price_per_month, apartment.currency)}
            <span className="font-sans text-xs font-medium tracking-normal text-gray-500"> /mo</span>
          </p>
          {apartment.distance_km !== null ? (
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{formatDistance(apartment.distance_km)} to campus</span>
          ) : null}
        </div>
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-gray-900">{apartment.title}</h3>
        <p className="flex items-center gap-1 truncate text-sm text-gray-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{apartment.city || apartment.address}</span>
        </p>
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{facts.join(" · ")}</p>
        {apartment.university ? <p className="truncate text-xs text-gray-500">Near {apartment.university.name}</p> : null}
        <div className="mt-auto flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
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

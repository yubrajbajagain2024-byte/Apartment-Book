"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPrice, ITEM_CONDITIONS, labelFor, photosFor, timeAgo, type ItemWithSeller } from "@apartment-book/shared";
import { Badge } from "@/components/ui/badge";
import { SaveBurst, SaveToggleButton, useSaveToggle } from "@/components/common/save-button";
import { PhotoCarousel } from "@/components/photos/photo-carousel";
import { PostMenu } from "@/components/posts/post-menu";

export function ItemCard({
  item,
  saved,
  signedIn,
  priority,
}: {
  item: ItemWithSeller;
  saved: boolean;
  signedIn: boolean;
  priority?: boolean;
}) {
  const photos = photosFor(item.images, item.image_meta);
  const href = `/marketplace/${item.id}`;
  const save = useSaveToggle("item", item.id, saved, signedIn);
  const [burst, setBurst] = useState(0);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 transition-shadow hover:shadow-md">
      <div className="relative">
        <PhotoCarousel
          photos={photos}
          alt={item.title}
          aspect="1 / 1"
          href={href}
          priority={priority}
          sizes="(min-width: 1280px) 240px, (min-width: 768px) 33vw, 50vw"
          onDoubleTap={() => {
            if (!save.saved) save.toggle();
            setBurst((b) => b + 1);
          }}
        >
          <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-full bg-black/65 px-2.5 py-1 text-sm font-bold text-white backdrop-blur">
            {item.price === 0 ? "Free" : formatPrice(item.price, item.currency)}
          </div>
          {item.status !== "available" ? (
            <div className="pointer-events-none absolute left-2 top-2 z-20">
              <Badge tone="amber">{item.status}</Badge>
            </div>
          ) : null}
          <SaveBurst key={burst} show={burst > 0} />
        </PhotoCarousel>
        <div className="absolute right-2 top-2 z-20">
          <SaveToggleButton controller={save} size="sm" className="bg-white/90 shadow" />
        </div>
      </div>
      <div className="flex flex-1 items-start gap-1 p-2.5">
        <Link href={href} className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">{item.title}</h3>
          <p className="truncate text-xs text-gray-500">
            {labelFor(ITEM_CONDITIONS, item.condition)} · {item.pickup_location || item.university?.name || item.seller.full_name}
          </p>
          <p className="truncate text-xs text-gray-400" suppressHydrationWarning>
            {timeAgo(item.created_at)}
          </p>
        </Link>
        <PostMenu save={save} path={href} title={item.title} className="-mr-1.5 -mt-1" />
      </div>
    </article>
  );
}

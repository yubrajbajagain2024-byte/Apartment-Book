"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { budgetLabel, formatDate, formatDistance, photosFor, timeAgo, type RoommatePostWithAuthor } from "@apartment-book/shared";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { SaveBurst, SaveToggleButton, useSaveToggle } from "@/components/common/save-button";
import { PhotoCarousel } from "@/components/photos/photo-carousel";

export function RoommateCard({ post, saved, signedIn }: { post: RoommatePostWithAuthor; saved: boolean; signedIn: boolean }) {
  const budget = budgetLabel(post);
  const photos = photosFor(post.images, post.image_meta);
  const href = `/roommates/${post.id}`;
  const save = useSaveToggle("roommate", post.id, saved, signedIn);
  const [burst, setBurst] = useState(0);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[14px] bg-white shadow-card ring-1 ring-gray-200 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float">
      {photos.length > 0 ? (
        <div className="relative">
          <PhotoCarousel
            photos={photos}
            alt={post.title}
            aspect="16 / 9"
            href={href}
            sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
            onDoubleTap={() => {
              if (!save.saved) save.toggle();
              setBurst((b) => b + 1);
            }}
          >
            <SaveBurst key={burst} show={burst > 0} />
          </PhotoCarousel>
        </div>
      ) : null}
      <div className="absolute right-3 top-3 z-20">
        <SaveToggleButton controller={save} size="sm" />
      </div>
      <Link href={href} className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-center gap-3 pr-10">
          <Avatar name={post.author.full_name} src={post.author.avatar_url} size="md" />
          <div className="min-w-0">
            <p className="truncate font-display text-lg leading-tight tracking-tight text-gray-900">{post.author.full_name}</p>
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500" suppressHydrationWarning>
              {post.university?.name ?? "University not set"} · {timeAgo(post.created_at)}
            </p>
          </div>
        </div>
        <Badge tone={post.post_type === "has_room" ? "green" : "blue"} className="w-fit">
          {post.post_type === "has_room" ? "Has a room" : "Looking for a room"}
        </Badge>
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-gray-900">{post.title}</h3>
        <p className="line-clamp-2 text-sm leading-relaxed text-gray-500">{post.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600">
          {budget ? <span className="font-semibold text-gray-900">{budget}/mo</span> : null}
          {post.location ? (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} /> {post.location}
            </span>
          ) : null}
          {post.move_in_date ? (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} /> {formatDate(post.move_in_date)}
            </span>
          ) : null}
          {post.distance_km !== null ? <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{formatDistance(post.distance_km)} to campus</span> : null}
        </div>
      </Link>
    </article>
  );
}

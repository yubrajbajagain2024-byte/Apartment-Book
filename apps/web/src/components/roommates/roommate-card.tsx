import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { formatDistance, formatPrice, type RoommatePostWithAuthor } from "@apartment-book/shared";
import { formatDate, timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ListingImage } from "@/components/common/listing-image";
import { SaveButton } from "@/components/common/save-button";

export function budgetLabel(post: { budget_min: number | null; budget_max: number | null; currency: string }): string | null {
  if (post.budget_min !== null && post.budget_max !== null) {
    return `${formatPrice(post.budget_min, post.currency)} – ${formatPrice(post.budget_max, post.currency)}`;
  }
  if (post.budget_max !== null) return `Up to ${formatPrice(post.budget_max, post.currency)}`;
  if (post.budget_min !== null) return `From ${formatPrice(post.budget_min, post.currency)}`;
  return null;
}

export function RoommateCard({ post, saved, signedIn }: { post: RoommatePostWithAuthor; saved: boolean; signedIn: boolean }) {
  const budget = budgetLabel(post);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 transition-shadow hover:shadow-md">
      <Link href={`/roommates/${post.id}`} className="flex flex-1 flex-col">
        {post.images.length > 0 ? (
          <ListingImage src={post.images[0]} alt={post.title} className="aspect-[16/9]" />
        ) : null}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={post.author.full_name} src={post.author.avatar_url} size="md" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-gray-900">{post.author.full_name}</p>
              <p className="truncate text-xs text-gray-500">
                {post.university?.name ?? "University not set"} · {timeAgo(post.created_at)}
              </p>
            </div>
          </div>
          <Badge tone={post.post_type === "has_room" ? "green" : "blue"} className="w-fit">
            {post.post_type === "has_room" ? "Has a room" : "Looking for a room"}
          </Badge>
          <h3 className="line-clamp-2 font-semibold leading-snug text-gray-900">{post.title}</h3>
          <p className="line-clamp-2 text-sm text-gray-600">{post.description}</p>
          <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-sm text-gray-700">
            {budget ? <span className="font-semibold">{budget}/mo</span> : null}
            {post.location ? (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {post.location}
              </span>
            ) : null}
            {post.move_in_date ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" /> {formatDate(post.move_in_date)}
              </span>
            ) : null}
            {post.distance_km !== null ? <Badge>{formatDistance(post.distance_km)} to campus</Badge> : null}
          </div>
        </div>
      </Link>
      <div className="absolute right-2 top-2">
        <SaveButton targetType="roommate" targetId={post.id} initialSaved={saved} signedIn={signedIn} size="sm" className="bg-white/90 shadow" />
      </div>
    </article>
  );
}

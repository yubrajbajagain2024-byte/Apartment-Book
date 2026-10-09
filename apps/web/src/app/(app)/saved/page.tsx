import type { Metadata } from "next";
import { Bookmark } from "lucide-react";
import { getApartmentsByIds, getFeedPostsByIds, getItemsByIds, getPostEngagementMany, getPostPreviewsMany, getRoommatePostsByIds, listSaved, type PostEngagement, type PostPreview } from "@apartment-book/shared";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { ApartmentCard } from "@/components/apartments/apartment-card";
import { ItemCard } from "@/components/marketplace/item-card";
import { RoommateCard } from "@/components/roommates/roommate-card";
import { FeedPostCard } from "@/components/home/posts-feed";

export const metadata: Metadata = { title: "Saved" };

export default async function SavedPage() {
  const user = await requireUser("/saved");
  const supabase = await createClient();
  const [saved, profile] = await Promise.all([listSaved(supabase, user.id), getCurrentProfile()]);
  const [apartments, posts, items, unorderedFeedPosts] = await Promise.all([
    getApartmentsByIds(supabase, saved.apartment),
    getRoommatePostsByIds(supabase, saved.roommate),
    getItemsByIds(supabase, saved.item),
    getFeedPostsByIds(supabase, saved.post).catch(() => []),
  ]);
  const feedIds = unorderedFeedPosts.map((p) => p.id);
  const [feedEngagement, feedPreviews] = await Promise.all([
    getPostEngagementMany(supabase, "post", feedIds).catch(() => ({}) as Record<string, PostEngagement>),
    getPostPreviewsMany(supabase, "post", feedIds).catch(() => ({}) as Record<string, PostPreview>),
  ]);
  const currentUser = { id: user.id, name: profile?.full_name || "You", avatarUrl: profile?.avatar_url ?? null };
  const order = (ids: string[]) => new Map(ids.map((id, i) => [id, i]));
  const byOrder = <T extends { id: string }>(list: T[], ids: string[]) => {
    const index = order(ids);
    return [...list].sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
  };
  // Saved Home posts and reels, most recently saved first like the other groups.
  const feedPosts = byOrder(unorderedFeedPosts, saved.post);
  const total = apartments.length + posts.length + items.length + feedPosts.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-gray-600">{total} saved {total === 1 ? "thing" : "things"}</p>
      </div>
      {total === 0 ? (
        <EmptyState icon={Bookmark} title="Nothing saved yet" description="Tap the bookmark on any apartment, roommate post or item, or use Save in a post's menu, to keep it here." action={<LinkButton href="/apartments">Browse apartments</LinkButton>} />
      ) : null}
      {feedPosts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Posts</h2>
          <div className="-mx-3 grid items-start gap-1 sm:mx-0 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
            {feedPosts.map((p) => (
              <FeedPostCard key={p.id} post={p} saved signedIn currentUserId={user.id} currentUser={currentUser} engagement={feedEngagement[p.id]} preview={feedPreviews[p.id]} />
            ))}
          </div>
        </section>
      ) : null}
      {apartments.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Apartments</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {byOrder(apartments, saved.apartment).map((a) => (
              <ApartmentCard key={a.id} apartment={a} saved signedIn />
            ))}
          </div>
        </section>
      ) : null}
      {posts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Roommate posts</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {byOrder(posts, saved.roommate).map((p) => (
              <RoommateCard key={p.id} post={p} saved signedIn />
            ))}
          </div>
        </section>
      ) : null}
      {items.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Marketplace items</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {byOrder(items, saved.item).map((i) => (
              <ItemCard key={i.id} item={i} saved signedIn />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

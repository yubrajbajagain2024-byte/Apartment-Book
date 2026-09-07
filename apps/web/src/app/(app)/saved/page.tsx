import type { Metadata } from "next";
import { Bookmark } from "lucide-react";
import { getApartmentsByIds, getItemsByIds, getRoommatePostsByIds, listSaved } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { ApartmentCard } from "@/components/apartments/apartment-card";
import { ItemCard } from "@/components/marketplace/item-card";
import { RoommateCard } from "@/components/roommates/roommate-card";

export const metadata: Metadata = { title: "Saved" };

export default async function SavedPage() {
  const user = await requireUser("/saved");
  const supabase = await createClient();
  const saved = await listSaved(supabase, user.id);
  const [apartments, posts, items] = await Promise.all([
    getApartmentsByIds(supabase, saved.apartment),
    getRoommatePostsByIds(supabase, saved.roommate),
    getItemsByIds(supabase, saved.item),
  ]);
  const order = (ids: string[]) => new Map(ids.map((id, i) => [id, i]));
  const byOrder = <T extends { id: string }>(list: T[], ids: string[]) => {
    const index = order(ids);
    return [...list].sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
  };
  const total = apartments.length + posts.length + items.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-gray-600">{total} saved {total === 1 ? "listing" : "listings"}</p>
      </div>
      {total === 0 ? (
        <EmptyState icon={Bookmark} title="Nothing saved yet" description="Tap the bookmark on any apartment, roommate post or item to keep it here." action={<LinkButton href="/">Browse apartments</LinkButton>} />
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

import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { getSavedIds, listApartments, listItems, listRoommatePosts } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { ApartmentCard } from "@/components/apartments/apartment-card";
import { ItemCard } from "@/components/marketplace/item-card";
import { RoommateCard } from "@/components/roommates/roommate-card";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").trim();
  const [user, supabase] = await Promise.all([getCurrentUser(), createClient()]);

  if (!q) {
    return <EmptyState icon={Search} title="Search Apartment Book" description="Type what you are looking for in the search bar above." />;
  }

  const [apartments, posts, items, savedIds] = await Promise.all([
    listApartments(supabase, { q, pageSize: 8 }),
    listRoommatePosts(supabase, { q, pageSize: 6 }),
    listItems(supabase, { q, pageSize: 8 }),
    user ? getSavedIds(supabase, user.id) : Promise.resolve(new Set<string>()),
  ]);
  const signedIn = Boolean(user);
  const total = apartments.count + posts.count + items.count;
  const encoded = encodeURIComponent(q);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Results for &ldquo;{q}&rdquo;</h1>
        <p className="text-sm text-gray-600">{total} {total === 1 ? "result" : "results"} across all universities</p>
      </div>
      {total === 0 ? <EmptyState icon={Search} title="No results" description="Try different or fewer words." /> : null}

      {apartments.count > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Apartments ({apartments.count})</h2>
            <Link href={`/?q=${encoded}&university=all`} className="text-sm font-medium text-brand-600 hover:underline">
              See all
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {apartments.data.map((a) => (
              <ApartmentCard key={a.id} apartment={a} saved={savedIds.has(a.id)} signedIn={signedIn} />
            ))}
          </div>
        </section>
      ) : null}

      {posts.count > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Roommates ({posts.count})</h2>
            <Link href={`/roommates?q=${encoded}&university=all`} className="text-sm font-medium text-brand-600 hover:underline">
              See all
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.data.map((p) => (
              <RoommateCard key={p.id} post={p} saved={savedIds.has(p.id)} signedIn={signedIn} />
            ))}
          </div>
        </section>
      ) : null}

      {items.count > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Marketplace ({items.count})</h2>
            <Link href={`/marketplace?q=${encoded}&university=all`} className="text-sm font-medium text-brand-600 hover:underline">
              See all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {items.data.map((i) => (
              <ItemCard key={i.id} item={i} saved={savedIds.has(i.id)} signedIn={signedIn} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

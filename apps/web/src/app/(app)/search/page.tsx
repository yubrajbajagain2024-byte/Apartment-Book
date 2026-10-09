import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { getFollowStatsMany, getSavedIds, listApartments, listItems, listRoommatePosts, searchPeople, type FollowStats } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ApartmentCard } from "@/components/apartments/apartment-card";
import { ItemCard } from "@/components/marketplace/item-card";
import { RoommateCard } from "@/components/roommates/roommate-card";
import { PersonRow } from "@/components/profile/person-row";
import { SearchBox } from "@/components/layout/search-box";

export const metadata: Metadata = { title: "Search" };

/** How many accounts the Search page lists before anything is typed, and at most per search. */
const PEOPLE_LIMIT = 12;

/**
 * The Search page, reached from the header's search box on every screen (Search is not a tab, like TikTok's magnifier).
 * People (accounts) come first, like Instagram; listings follow. With nothing typed the page shows people to follow
 * (your campus first), so it is never blank.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").trim();
  const [user, profile, supabase] = await Promise.all([getCurrentUser(), getCurrentProfile(), createClient()]);
  const signedIn = Boolean(user);
  const excludeIds = user ? [user.id] : [];

  if (!q) {
    const campus = profile?.university_id ?? undefined;
    const people = await searchPeople(supabase, "", { universityId: campus, sort: "newest", limit: PEOPLE_LIMIT, excludeIds }).catch(() => []);
    const stats = await rowStats(people.map((p) => p.id));
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">Search</h1>
          <PhoneSearchBox />
          <p className="text-sm text-gray-600">Find people by name, or apartments, roommates and items.</p>
        </div>
        <PeopleSection title={campus && profile?.university?.name ? `People at ${profile.university.name}` : "New on Apartment Book"} people={people} stats={stats} viewerId={user?.id ?? null} signedIn={signedIn} testId="search-people" emptyTitle="Nobody to show yet" />
      </div>
    );
  }

  const [people, apartments, posts, items, savedIds] = await Promise.all([
    searchPeople(supabase, q, { limit: PEOPLE_LIMIT, excludeIds }).catch(() => []),
    listApartments(supabase, { q, pageSize: 8 }),
    listRoommatePosts(supabase, { q, pageSize: 6 }),
    listItems(supabase, { q, pageSize: 8 }),
    user ? getSavedIds(supabase, user.id) : Promise.resolve(new Set<string>()),
  ]);
  const stats = await rowStats(people.map((p) => p.id));
  const total = people.length + apartments.count + posts.count + items.count;
  const encoded = encodeURIComponent(q);

  // Follow buttons need the viewer's relationship with each person; signed out there is none to fetch.
  async function rowStats(ids: string[]): Promise<Record<string, FollowStats>> {
    return user && ids.length > 0 ? getFollowStatsMany(supabase, ids).catch(() => ({})) : {};
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PhoneSearchBox />
        <h1 className="text-2xl font-bold">Results for &ldquo;{q}&rdquo;</h1>
        <p className="text-sm text-gray-600">{total} {total === 1 ? "result" : "results"} across all universities</p>
      </div>
      {total === 0 ? <EmptyState icon={Search} title="No results" description="Try different or fewer words." /> : null}

      {people.length > 0 ? (
        <div className="max-w-[640px]">
          <PeopleSection title={`People (${people.length})`} people={people} stats={stats} viewerId={user?.id ?? null} signedIn={signedIn} testId="search-people" />
        </div>
      ) : null}

      {apartments.count > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Apartments ({apartments.count})</h2>
            <Link href={`/apartments?q=${encoded}&university=all`} className="text-sm font-medium text-brand-600 hover:underline">
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

/** The header hides its search box on phones in favour of a magnifier, so the page itself carries one there. */
function PhoneSearchBox() {
  return (
    <Suspense fallback={null}>
      <SearchBox className="md:hidden" />
    </Suspense>
  );
}

/** A heading and a card of person rows; an empty state when there is nobody to list. */
function PeopleSection({ title, people, stats, viewerId, signedIn, testId, emptyTitle }: { title: string; people: Awaited<ReturnType<typeof searchPeople>>; stats: Record<string, FollowStats>; viewerId: string | null; signedIn: boolean; testId: string; emptyTitle?: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Users className="h-5 w-5 text-brand-600" /> {title}
      </h2>
      {people.length === 0 ? (
        <EmptyState icon={Users} title={emptyTitle ?? "No one found"} description="Try a different spelling of their name." />
      ) : (
        <Card>
          <ul className="divide-y divide-gray-100" data-testid={testId}>
            {people.map((p) => (
              <PersonRow key={p.id} profile={p} viewerId={viewerId} signedIn={signedIn} stats={stats[p.id]} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

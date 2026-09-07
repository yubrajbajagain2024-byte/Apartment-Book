import Link from "next/link";
import { Building2, List, Map as MapIcon, Plus } from "lucide-react";
import {
  DEFAULT_MAP_CENTER,
  formatDistance,
  formatPrice,
  getSavedIds,
  isRecent,
  listApartments,
  listApartmentsForMap,
  listUniversities,
  milesToKm,
  photosFor,
  type ApartmentFilters as Filters,
  type ApartmentSort,
  type ApartmentWithOwner,
} from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam, numberParam } from "@/lib/utils";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ApartmentFilters } from "@/components/apartments/apartment-filters";
import { ApartmentFeed } from "@/components/feed/apartment-feed";
import { PhotoRail, type RailItem } from "@/components/feed/photo-rail";
import { ListingMap, type MapPin } from "@/components/map/listing-map";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const [user, profile, supabase] = await Promise.all([getCurrentUser(), getCurrentProfile(), createClient()]);

  const values = {
    q: firstParam(params.q),
    university: firstParam(params.university),
    minPrice: firstParam(params.minPrice),
    maxPrice: firstParam(params.maxPrice),
    bedrooms: firstParam(params.bedrooms),
    furnished: firstParam(params.furnished),
    pets: firstParam(params.pets),
    radius: firstParam(params.radius),
    sort: firstParam(params.sort),
    page: firstParam(params.page),
  };
  const view = firstParam(params.view) === "map" ? "map" : "list";

  // Default to the student's own university until they pick "All universities".
  const universityId =
    values.university === "all" ? undefined : values.university || profile?.university_id || undefined;
  const radiusMiles = numberParam(params.radius);

  const filters: Filters = {
    q: values.q,
    universityId,
    minPrice: numberParam(params.minPrice),
    maxPrice: numberParam(params.maxPrice),
    minBedrooms: numberParam(params.bedrooms),
    furnished: values.furnished === "1",
    petsAllowed: values.pets === "1",
    radiusKm: universityId && radiusMiles ? milesToKm(radiusMiles) : undefined,
    sort: (values.sort as ApartmentSort | undefined) ?? "newest",
    page: numberParam(params.page) ?? 1,
  };

  // A photo strip above the feed: closest to campus when a university is chosen, otherwise the newest.
  const showRail = view === "list" && !values.q && filters.page === 1;
  const [universities, result, savedIds, mapListings, railListings] = await Promise.all([
    listUniversities(supabase),
    listApartments(supabase, filters),
    user ? getSavedIds(supabase, user.id, "apartment") : Promise.resolve(new Set<string>()),
    view === "map" ? listApartmentsForMap(supabase, filters) : Promise.resolve([] as ApartmentWithOwner[]),
    showRail
      ? listApartments(supabase, { universityId, sort: universityId ? "distance" : "newest", pageSize: 14 }).then((r) => r.data)
      : Promise.resolve([] as ApartmentWithOwner[]),
  ]);
  const railItems: RailItem[] = railListings
    .filter((a) => a.images.length > 0)
    .slice(0, 12)
    .map((a) => ({
      id: a.id,
      href: `/apartments/${a.id}`,
      photo: photosFor(a.images, a.image_meta)[0],
      label: formatPrice(a.price_per_month, a.currency),
      sublabel: a.distance_km !== null ? `${formatDistance(a.distance_km)} to campus` : a.title,
      fresh: isRecent(a.created_at),
    }));

  const activeUniversity = universities.find((u) => u.id === universityId);
  const campus =
    activeUniversity && activeUniversity.latitude !== null && activeUniversity.longitude !== null
      ? { latitude: activeUniversity.latitude, longitude: activeUniversity.longitude, name: activeUniversity.name }
      : null;
  const hasFilters = Object.entries(values).some(([key, value]) => key !== "page" && value !== undefined && value !== "");
  const filterValues = { ...values, university: universityId ?? "all" };

  const viewHref = (target: "list" | "map") => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filterValues)) if (value && key !== "page") search.set(key, value);
    if (target === "map") search.set("view", "map");
    const query = search.toString();
    return query ? `/?${query}` : "/";
  };

  const pins: MapPin[] = [
    ...(campus ? [{ id: "campus", latitude: campus.latitude, longitude: campus.longitude, label: campus.name, kind: "campus" as const }] : []),
    ...mapListings.map((a) => ({
      id: a.id,
      latitude: a.latitude as number,
      longitude: a.longitude as number,
      label: formatPrice(a.price_per_month, a.currency),
      title: a.title,
      subtitle: `${a.bedrooms === 0 ? "Studio" : `${a.bedrooms} bd`} · ${a.city || a.address}`,
      href: `/apartments/${a.id}`,
    })),
  ];

  const toggleClass = (active: boolean) =>
    cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold", active ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-gray-200");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {activeUniversity ? `Apartments near ${activeUniversity.name}` : "Apartments near campus"}
          </h1>
          <p className="text-sm text-gray-600">
            {result.count} {result.count === 1 ? "listing" : "listings"}
            {radiusMiles && universityId ? ` within ${radiusMiles} ${radiusMiles === 1 ? "mile" : "miles"} of campus` : ""}
            {profile && !profile.university_id ? (
              <>
                {" · "}
                <Link href="/settings/profile" className="text-brand-600 hover:underline">
                  Set your university
                </Link>{" "}
                to see places near you first.
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-gray-100 p-1" role="group" aria-label="View">
            <Link href={viewHref("list")} className={toggleClass(view === "list")} aria-current={view === "list" ? "page" : undefined}>
              <List className="h-4 w-4" /> List
            </Link>
            <Link href={viewHref("map")} className={toggleClass(view === "map")} aria-current={view === "map" ? "page" : undefined}>
              <MapIcon className="h-4 w-4" /> Map
            </Link>
          </div>
          <LinkButton href="/apartments/new">
            <Plus className="h-5 w-5" /> Post a listing
          </LinkButton>
        </div>
      </div>

      {showRail ? <PhotoRail title={universityId ? "Closest to campus" : "Just listed"} items={railItems} /> : null}

      <ApartmentFilters universities={universities} values={filterValues} hasFilters={hasFilters} />

      {view === "map" ? (
        <div className="flex flex-col gap-2">
          <ListingMap center={campus ?? (pins[0] ? { latitude: pins[0].latitude, longitude: pins[0].longitude } : DEFAULT_MAP_CENTER)} pins={pins} fitToPins={pins.length > 0} height={440} />
          <p className="text-xs text-gray-500">
            {mapListings.length} {mapListings.length === 1 ? "listing" : "listings"} with a pinned location shown on the map. Listings without a pin only appear in the list.
          </p>
        </div>
      ) : null}

      {result.data.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No apartments found"
          description={
            hasFilters || universityId
              ? "Try clearing some filters, a larger distance, or All universities."
              : "Be the first to post a place near your campus."
          }
          action={
            <div className="flex gap-2">
              {universityId ? (
                <LinkButton href="/?university=all" variant="secondary">
                  Show all universities
                </LinkButton>
              ) : null}
              <LinkButton href="/apartments/new">Post a listing</LinkButton>
            </div>
          }
        />
      ) : (
        <div className="mx-auto w-full max-w-[640px]">
        <ApartmentFeed
          key={JSON.stringify({ ...filters, page: undefined })}
          initial={result.data}
          totalPages={result.totalPages}
          filters={{ ...filters, page: undefined }}
          savedIds={[...savedIds]}
          signedIn={Boolean(user)}
          currentUserId={user?.id ?? null}
        />
        </div>
      )}
    </div>
  );
}

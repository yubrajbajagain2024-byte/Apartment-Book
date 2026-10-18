import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bath, BedDouble, CalendarDays, Clock, ExternalLink, MapPin, Phone, School } from "lucide-react";
import { AMENITIES, formatDistance, formatPrice, getApartment, getListingStats, getVideoVsPhotoStats, isSaved, labelFor, listingMedia, photosFor } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { PhotoHero } from "@/components/photos/photo-hero";
import { PostedBanner } from "@/components/video/posted-banner";
import { ListingStatsPanel } from "@/components/stats/listing-stats-panel";
import { VideoNudge } from "@/components/stats/video-nudge";
import { ViewTracker } from "@/components/stats/view-tracker";
import { ListingMap, type MapPin as Pin } from "@/components/map/listing-map";
import { MessageButton } from "@/components/common/message-button";
import { SaveButton } from "@/components/common/save-button";
import { ApartmentOwnerActions } from "@/components/apartments/apartment-owner-actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const apartment = await getApartment(await createClient(), id).catch(() => null);
  if (!apartment) return { title: "Apartment not found" };
  return {
    title: apartment.title,
    description: apartment.description.slice(0, 160),
    openGraph: { images: apartment.images.slice(0, 1) },
  };
}

export default async function ApartmentPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const posted = typeof query.posted === "string" ? query.posted : null;
  const supabase = await createClient();
  const [apartment, user] = await Promise.all([getApartment(supabase, id), getCurrentUser()]);
  if (!apartment) notFound();

  const saved = user ? await isSaved(supabase, user.id, "apartment", apartment.id) : false;
  const isOwner = user?.id === apartment.owner_id;
  const [stats, comparison] = isOwner
    ? await Promise.all([
        getListingStats(supabase, "apartment", apartment.id).catch(() => null),
        apartment.has_video ? Promise.resolve(null) : getVideoVsPhotoStats(supabase).catch(() => null),
      ])
    : [null, null];
  const path = `/apartments/${apartment.id}`;
  const pinned = apartment.latitude !== null && apartment.longitude !== null;
  const campus =
    apartment.university && apartment.university.latitude !== null && apartment.university.longitude !== null
      ? { latitude: apartment.university.latitude, longitude: apartment.university.longitude, name: apartment.university.name }
      : null;
  const mapPins: Pin[] = pinned
    ? [
        { id: apartment.id, latitude: apartment.latitude as number, longitude: apartment.longitude as number, label: formatPrice(apartment.price_per_month, apartment.currency), title: apartment.title, subtitle: apartment.address },
        ...(campus ? [{ id: "campus", latitude: campus.latitude, longitude: campus.longitude, label: campus.name, kind: "campus" as const }] : []),
      ]
    : [];

  const facts = [
    { icon: BedDouble, label: apartment.bedrooms === 0 ? "Studio" : `${apartment.bedrooms} bedroom${apartment.bedrooms > 1 ? "s" : ""}` },
    { icon: Bath, label: `${apartment.bathrooms} bathroom${apartment.bathrooms > 1 ? "s" : ""}` },
    apartment.available_from ? { icon: CalendarDays, label: `Available ${formatDate(apartment.available_from)}` } : null,
    apartment.lease_months ? { icon: Clock, label: `${apartment.lease_months}-month lease` } : null,
    apartment.distance_km !== null ? { icon: MapPin, label: `${formatDistance(apartment.distance_km)} to campus` } : null,
    apartment.university ? { icon: School, label: apartment.university.name } : null,
  ].filter((f): f is { icon: typeof BedDouble; label: string } => f !== null);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/apartments" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Back to apartments
      </Link>

      <ViewTracker targetType="apartment" targetId={apartment.id} />
      {posted && isOwner ? <PostedBanner kind={posted === "video" ? "video" : "photo"} stats={stats} /> : null}
      {isOwner && !apartment.has_video ? <VideoNudge editHref={`/apartments/${apartment.id}/edit`} comparison={comparison} /> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <PhotoHero photos={photosFor(apartment.images, apartment.image_meta)} media={listingMedia(apartment.images, apartment.image_meta, apartment.videos)} alt={apartment.title} />

          <Card>
            <CardBody className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-2xl tracking-tight text-gray-900 sm:text-3xl">{apartment.title}</h1>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-500">
                    <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.75} /> {apartment.address}
                    {apartment.city ? `, ${apartment.city}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl tracking-tight text-gray-900 sm:text-3xl">{formatPrice(apartment.price_per_month, apartment.currency)}</p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">per month</p>
                </div>
              </div>

              {apartment.status !== "active" ? (
                <Badge tone="amber" className="w-fit">
                  This place is marked as {apartment.status}
                </Badge>
              ) : null}

              {/* The facts as a hairline grid: the gap shows the line colour between the white cells. */}
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] bg-gray-200 ring-1 ring-gray-200 sm:grid-cols-3">
                {facts.map((f) => (
                  <div key={f.label} className="flex items-center gap-2.5 bg-white px-3.5 py-3 text-sm text-gray-800">
                    <f.icon className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.75} /> {f.label}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {apartment.furnished ? <Badge tone="blue">Furnished</Badge> : <Badge>Unfurnished</Badge>}
                {apartment.utilities_included ? <Badge tone="green">Utilities included</Badge> : null}
                {apartment.pets_allowed ? <Badge tone="green">Pets allowed</Badge> : null}
                {apartment.amenities.map((a) => (
                  <Badge key={a}>{labelFor(AMENITIES, a)}</Badge>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-5">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">About this place</h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-800">{apartment.description}</p>
              </div>

              {pinned ? (
                <div className="border-t border-gray-100 pt-5">
                  <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Where it is</h2>
                  <ListingMap center={{ latitude: apartment.latitude as number, longitude: apartment.longitude as number }} pins={mapPins} fitToPins height={280} scrollWheelZoom={false} />
                </div>
              ) : null}
              {apartment.map_url ? (
                <a href={apartment.map_url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-brand-600 underline-offset-4 hover:underline">
                  <ExternalLink className="h-4 w-4" strokeWidth={1.75} /> Open in maps
                </a>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <Link href={`/profile/${apartment.owner.id}`} className="flex items-center gap-3">
                <Avatar name={apartment.owner.full_name} src={apartment.owner.avatar_url} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-display text-lg leading-tight tracking-tight text-gray-900">{apartment.owner.full_name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">Posted {timeAgo(apartment.created_at)}</p>
                </div>
              </Link>
              {!isOwner ? (
                <div className="flex flex-col gap-2">
                  <MessageButton
                    userId={apartment.owner.id}
                    currentUserId={user?.id ?? null}
                    returnTo={path}
                    prefill={`Hi! I'm interested in "${apartment.title}". Is it still available?`}
                    label="Message owner"
                    target={{ type: "apartment", id: apartment.id }}
                  />
                  <SaveButton targetType="apartment" targetId={apartment.id} initialSaved={saved} signedIn={Boolean(user)} />
                  {apartment.contact_phone ? (
                    <a href={`tel:${apartment.contact_phone}`} className={buttonClasses({ variant: "outline" })}>
                      <Phone className="h-4 w-4" strokeWidth={1.75} /> {apartment.contact_phone}
                    </a>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {stats ? <ListingStatsPanel stats={stats} /> : null}
                  <ApartmentOwnerActions apartment={apartment} />
                </div>
              )}
            </CardBody>
          </Card>
          <p className="px-1 text-xs leading-relaxed text-gray-500">
            Stay safe: never send deposits before seeing the place, and meet in public or on campus.
          </p>
        </aside>
      </div>
    </div>
  );
}

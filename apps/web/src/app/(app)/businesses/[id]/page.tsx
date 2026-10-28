import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, Building2, Globe, MapPin, MessageCircle, Phone, Store } from "lucide-react";
import {
  businessCategoryLabel,
  dealIsLive,
  formatCents,
  formatPrice,
  getPublicBusiness,
  isBusinessBlocked,
  listApartmentsByBusiness,
  listPublicBusinessPosts,
  listUniversities,
  mediaCover,
  mediaItems,
  photosFor,
  postKindLabel,
} from "@apartment-book/shared";
import { startBusinessChatAction } from "@/lib/actions/ads";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { DealCard } from "@/components/deals/deal-card";
import { BusinessMenu, TrackProfileVisit } from "@/components/business-profile/profile-actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const business = await getPublicBusiness(await createClient(), id).catch(() => null);
  return { title: business ? business.name : "Business" };
}

/**
 * A business's public profile on UniBuzz, laid out like a student's: its logo, name and the Business badge (and Verified
 * Partner when the UniBuzz team verified it), its bio, category, place, contact and campuses, then its posts and, for
 * housing, its listings. Only approved businesses have one. Students message it from here (they write first, always),
 * report it or block it.
 */
export default async function BusinessProfilePage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [business, user] = await Promise.all([getPublicBusiness(supabase, id), getCurrentUser()]);
  if (!business) notFound();
  const blocked = user ? await isBusinessBlocked(supabase, id) : false;
  const [posts, listings, universities] = blocked
    ? [[], [], []]
    : await Promise.all([listPublicBusinessPosts(supabase, id).catch(() => []), listApartmentsByBusiness(supabase, id).catch(() => []), listUniversities(supabase).catch(() => [])]);
  const live = posts.filter((p) => dealIsLive(p));
  const activeListings = listings.filter((l) => l.status === "active");
  const opened = live.find((p) => p.id === firstParam(query.post)) ?? null;
  const adId = firstParam(query.ad) ?? null;
  const campuses = business.university_ids.length ? universities.filter((u) => business.university_ids.includes(u.id)).map((u) => u.name) : [];
  const back = `/businesses/${id}`;

  return (
    <div className="mx-auto flex w-full max-w-[935px] flex-col gap-6">
      {user ? <TrackProfileVisit businessId={id} adId={adId} /> : null}
      {firstParam(query.error) ? <FormMessage error={firstParam(query.error)} /> : null}

      <header className="flex flex-col gap-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:items-start sm:gap-8 sm:p-8" data-testid="business-profile">
        <div className="shrink-0 self-center rounded-full bg-gray-200 p-[3px] sm:self-start">
          <Avatar name={business.name} src={business.logo_url} size="xl" className="h-24 w-24 ring-4 ring-white sm:h-32 sm:w-32" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-gray-900">{business.name}</h1>
            <Badge tone="gray" data-testid="business-badge">
              <Store className="mr-1 h-3.5 w-3.5" /> Business
            </Badge>
            {business.verified_partner ? (
              <Badge tone="blue">
                <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Verified Partner
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-gray-600">
            {businessCategoryLabel(business.category)}
            {business.city || business.address ? (
              <span className="ml-2 inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {[business.address, business.city].filter(Boolean).join(", ")}
              </span>
            ) : null}
          </p>
          {business.description ? <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-800">{business.description}</p> : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {business.website ? (
              <a href={business.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                <Globe className="h-4 w-4" /> {business.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            ) : null}
            {business.phone ? (
              <a href={`tel:${business.phone}`} className="inline-flex items-center gap-1 font-medium text-gray-700 hover:underline">
                <Phone className="h-4 w-4" /> {business.phone}
              </a>
            ) : null}
          </div>
          {campuses.length ? <p className="text-xs text-gray-500">Serves {campuses.join(", ")}</p> : null}
          <div className="flex items-center gap-2 pt-1">
            {blocked ? null : user ? (
              <form action={startBusinessChatAction}>
                <input type="hidden" name="targetType" value="business" />
                <input type="hidden" name="targetId" value={id} />
                <input type="hidden" name="back" value={back} />
                <Button type="submit" size="md">
                  <MessageCircle className="h-4 w-4" /> Message
                </Button>
              </form>
            ) : (
              <Link href={`/login?next=${encodeURIComponent(back)}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                <MessageCircle className="h-4 w-4" /> Log in to message
              </Link>
            )}
            {user ? <BusinessMenu businessId={id} name={business.name} blocked={blocked} /> : null}
          </div>
        </div>
      </header>

      {blocked ? (
        <EmptyState icon={Store} title={`You blocked ${business.name}`} description="Its posts, listings and ads don't show to you, and you can't message it. Unblock it from the … menu." />
      ) : (
        <>
          {opened ? (
            <div id={`post-${opened.id}`} className="mx-auto w-full max-w-[640px]">
              <DealCard deal={opened} signedIn={Boolean(user)} />
            </div>
          ) : null}

          <section aria-label="Posts" className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 border-t border-gray-200 pt-4 text-xs font-semibold uppercase tracking-widest text-gray-600">Posts</h2>
            {live.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">No posts yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1 sm:gap-4">
                {live.map((p) => {
                  const cover = mediaCover(mediaItems(p.media)) ?? p.image_url;
                  const line = [p.price_cents !== null ? formatCents(p.price_cents, p.currency) : null, p.discount_label].filter(Boolean).join(" · ");
                  return (
                    <Link key={p.id} href={`${back}?post=${p.id}${adId ? `&ad=${adId}` : ""}`} scroll className="group relative aspect-square overflow-hidden bg-gray-100 sm:rounded-lg" aria-label={p.title} data-testid="business-post">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the business's uploads, any host v1 allowed
                        <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                      ) : (
                        <span className="flex h-full items-center justify-center p-3 text-center text-sm font-semibold text-gray-700">{p.title}</span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-8 text-left text-white">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-white/80">{postKindLabel(p.kind)}</span>
                        <span className="block truncate text-xs font-semibold sm:text-sm">{p.title}</span>
                        {line ? <span className="hidden truncate text-xs text-white/90 sm:block">{line}</span> : null}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {activeListings.length ? (
            <section aria-label="Listings" className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 border-t border-gray-200 pt-4 text-xs font-semibold uppercase tracking-widest text-gray-600">
                <Building2 className="h-4 w-4" /> Listings
              </h2>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-4">
                {activeListings.map((l) => {
                  const photo = photosFor(l.images, l.image_meta)[0]?.url ?? null;
                  return (
                    <Link key={l.id} href={`/apartments/${l.id}`} className="group overflow-hidden bg-white ring-1 ring-gray-200 sm:rounded-lg">
                      <span className="block aspect-[4/3] overflow-hidden bg-gray-100">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- listing photos, shown whole
                          <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                        ) : null}
                      </span>
                      <span className="block p-2.5">
                        <span className="block truncate text-sm font-semibold text-gray-900">{l.title}</span>
                        <span className="block text-xs text-gray-600">
                          {formatPrice(l.price_per_month, l.currency)}/mo · {l.bedrooms} bd
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, Building2, Globe, MapPin, MessageCircle, MoreHorizontal, Phone, Store } from "lucide-react";
import {
  businessCategoryLabel,
  formatCents,
  formatPrice,
  mediaCover,
  mediaItems,
  photosFor,
  postKindLabel,
  type ApartmentWithOwner,
  type BusinessHours,
  type DealWithBusiness,
  type HoursStatus,
  type PublicBusiness,
} from "@apartment-book/shared";
import { startBusinessChatAction } from "@/lib/actions/ads";
import { isOptimizableImage } from "@/lib/images";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DealCard } from "@/components/deals/deal-card";
import { BusinessHoursPanel } from "./business-hours";
import { BusinessMenu } from "./profile-actions";

export type BusinessProfileViewProps = {
  business: PublicBusiness;
  hours: BusinessHours | null;
  hoursStatus: HoursStatus | null;
  /** The names of the campuses it serves; empty for every campus. */
  campuses: string[];
  /** Its live posts and active listings, as students get them. */
  posts: DealWithBusiness[];
  listings: ApartmentWithOwner[];
  signedIn: boolean;
  blocked: boolean;
  /** The post opened from the grid (?post=), shown above it. */
  opened?: DealWithBusiness | null;
  adId?: string | null;
  /**
   * The business's own preview in the portal: the page exactly as a signed-in student sees it, with nothing to act on
   * (no message, menu or links into the student site, which sends business accounts back to the portal).
   */
  preview?: boolean;
};

/** Only an http(s) website is a link (the database drops anything else since migration 56; older rows may differ). */
function websiteOf(website: string | null): { href: string; host: string } | null {
  if (!website || !/^https?:\/\//i.test(website)) return null;
  return { href: website, host: website.replace(/^https?:\/\//i, "").replace(/\/$/, "") };
}

/**
 * A business's public profile on UniBuzz, laid out like a student's: its logo, name and the Business badge (and Verified
 * Partner when the UniBuzz team verified it), what it is and where, its bio, whether it is open now with its hours, its
 * website and phone, the campuses it serves, then its posts and, for housing, its listings. The student page and the
 * portal's preview render this same component, so the preview cannot drift from what students see.
 */
export function BusinessProfileView({ business, hours, hoursStatus, campuses, posts, listings, signedIn, blocked, opened = null, adId = null, preview = false }: BusinessProfileViewProps) {
  const id = business.id;
  const back = `/businesses/${id}`;
  const website = websiteOf(business.website);

  return (
    <div className="mx-auto flex w-full max-w-[935px] flex-col gap-6">
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
          {hours ? <BusinessHoursPanel hours={hours} initial={hoursStatus} /> : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {website ? (
              <a href={website.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 font-medium text-brand-700 hover:underline" data-testid="business-website-link">
                <Globe className="h-4 w-4 shrink-0" /> <span className="truncate">{website.host}</span>
              </a>
            ) : null}
            {business.phone ? (
              <a href={`tel:${business.phone}`} className="inline-flex items-center gap-1 font-medium text-gray-700 hover:underline">
                <Phone className="h-4 w-4" /> {business.phone}
              </a>
            ) : null}
          </div>
          {campuses.length ? <p className="text-xs text-gray-500">Serves {campuses.join(", ")}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {blocked ? null : preview ? (
              <span className={buttonClasses({ size: "md" })} aria-disabled="true" title="Students tap this to message you">
                <MessageCircle className="h-4 w-4" /> Message
              </span>
            ) : signedIn ? (
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
            {website ? (
              // The business's own site, in a new tab; never told where the student came from beyond the browser's default.
              <a href={website.href} target="_blank" rel="noopener noreferrer nofollow" className={buttonClasses({ variant: "secondary", size: "md" })} data-testid="business-website">
                <Globe className="h-4 w-4" /> Website <ArrowUpRight className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
              </a>
            ) : null}
            {preview ? (
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200 text-gray-900" aria-hidden="true">
                <MoreHorizontal className="h-5 w-5" />
              </span>
            ) : signedIn ? (
              <BusinessMenu businessId={id} name={business.name} blocked={blocked} />
            ) : null}
          </div>
        </div>
      </header>

      {blocked ? (
        <EmptyState icon={Store} title={`You blocked ${business.name}`} description="Its posts, listings and ads don't show to you, and you can't message it. Unblock it from the … menu." />
      ) : (
        <>
          {opened ? (
            <div id={`post-${opened.id}`} className="mx-auto w-full max-w-[640px]">
              <DealCard deal={opened} signedIn={signedIn} />
            </div>
          ) : null}

          <section aria-label="Posts" className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 border-t border-gray-200 pt-4 text-xs font-semibold uppercase tracking-widest text-gray-600">Posts</h2>
            {posts.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">No posts yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1 sm:gap-4">
                {posts.map((p) => {
                  // Only what next/image serves: our server fetches it, so the business never sees who opened its profile.
                  const raw = mediaCover(mediaItems(p.media)) ?? p.image_url;
                  const cover = isOptimizableImage(raw) ? raw : null;
                  const line = [p.price_cents != null ? formatCents(p.price_cents, p.currency) : null, p.discount_label].filter(Boolean).join(" · ");
                  const tile = "group relative aspect-square overflow-hidden bg-gray-100 sm:rounded-lg";
                  const body = (
                    <>
                      {cover ? (
                        <Image src={cover} alt="" fill sizes="(min-width: 640px) 300px, 33vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                      ) : (
                        <span className="flex h-full items-center justify-center p-3 text-center text-sm font-semibold text-gray-700">{p.title}</span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-8 text-left text-white">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-white/80">{postKindLabel(p.kind)}</span>
                        <span className="block truncate text-xs font-semibold sm:text-sm">{p.title}</span>
                        {line ? <span className="hidden truncate text-xs text-white/90 sm:block">{line}</span> : null}
                      </span>
                    </>
                  );
                  return preview ? (
                    <div key={p.id} className={tile} aria-label={p.title} data-testid="business-post">
                      {body}
                    </div>
                  ) : (
                    <Link key={p.id} href={`${back}?post=${p.id}${adId ? `&ad=${adId}` : ""}`} scroll className={tile} aria-label={p.title} data-testid="business-post">
                      {body}
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {listings.length ? (
            <section aria-label="Listings" className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 border-t border-gray-200 pt-4 text-xs font-semibold uppercase tracking-widest text-gray-600">
                <Building2 className="h-4 w-4" /> Listings
              </h2>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-4">
                {listings.map((l) => {
                  const first = photosFor(l.images, l.image_meta)[0]?.url ?? null;
                  const photo = isOptimizableImage(first) ? first : null;
                  const card = "group overflow-hidden bg-white ring-1 ring-gray-200 sm:rounded-lg";
                  const body = (
                    <>
                      <span className="relative block aspect-[4/3] overflow-hidden bg-gray-100">
                        {photo ? <Image src={photo} alt="" fill sizes="(min-width: 640px) 300px, 50vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : null}
                      </span>
                      <span className="block p-2.5">
                        <span className="block truncate text-sm font-semibold text-gray-900">{l.title}</span>
                        <span className="block text-xs text-gray-600">
                          {formatPrice(l.price_per_month, l.currency)}/mo · {l.bedrooms} bd
                        </span>
                      </span>
                    </>
                  );
                  return preview ? (
                    <div key={l.id} className={card}>
                      {body}
                    </div>
                  ) : (
                    <Link key={l.id} href={`/apartments/${l.id}`} className={card}>
                      {body}
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

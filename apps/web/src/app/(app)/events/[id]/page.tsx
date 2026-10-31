import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarDays, ExternalLink, MapPin } from "lucide-react";
import { ORGANIZATION_KINDS, categoryLabel, eventPath, eventWhen, getEvent, getSavedEventIds, getUniversityTimeZone, listFollowedOrganizationIds, organizationPath } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { ShareButton } from "@/components/common/share-button";
import { CATEGORY_ICONS, EventStatusPill, isStorageImage } from "@/components/events/event-card";
import { CountedLink, EventOpenTracker } from "@/components/events/event-open-tracker";
import { EventSaveButton } from "@/components/events/event-save-button";
import { OrganizationFollowButton } from "@/components/events/organization-follow-button";
import { Badge } from "@/components/ui/badge";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TIME_ZONE = "America/Chicago";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const event = UUID.test(id) ? await getEvent(supabase, id).catch(() => null) : null;
  if (!event) return { title: "Event not found" };
  const timeZone = (await getUniversityTimeZone(supabase, event.university_id)) ?? DEFAULT_TIME_ZONE;
  const when = eventWhen(event, timeZone, Date.now());
  const words = event.description?.trim().replace(/\s+/g, " ");
  return {
    title: event.title,
    description: words ? `${when} · ${words.slice(0, 140)}${words.length > 140 ? "…" : ""}` : `${when}${event.location ? ` · ${event.location}` : ""}`,
    openGraph: event.image_url ? { images: [event.image_url] } : undefined,
  };
}

/**
 * One event: its picture, when and where on the campus's clock, who is behind it (with Follow), the words, and the
 * actions: Register (or the calendar's own page), Save and Share. The database decides who sees it: a pending or
 * hidden event answers "not found" to everyone but the organization's members and staff.
 */
export default async function EventPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [event, user] = await Promise.all([getEvent(supabase, id), getCurrentUser()]);
  if (!event) notFound();
  const signedIn = Boolean(user);
  const [timeZone, savedIds, followedIds] = await Promise.all([
    getUniversityTimeZone(supabase, event.university_id),
    user ? getSavedEventIds(supabase, user.id).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    user && event.organization ? listFollowedOrganizationIds(supabase, user.id).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  const nowMs = requestNow();
  const when = eventWhen(event, timeZone ?? DEFAULT_TIME_ZONE, nowMs);
  const Icon = CATEGORY_ICONS[event.category] ?? CalendarDays;
  const org = event.organization;
  const kindLabel = org ? (ORGANIZATION_KINDS.find((k) => k.value === org.kind)?.label ?? "Organization") : null;
  const mapsHref = event.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}` : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <EventOpenTracker eventId={event.id} signedIn={signedIn} />
      <Link href="/events" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-brand-600 bg-aurora">
        {event.image_url ? <Image src={event.image_url} alt="" fill priority unoptimized={!isStorageImage(event.image_url)} sizes="(max-width: 768px) 100vw, 672px" className="object-cover" /> : <Icon className="absolute inset-0 m-auto h-16 w-16 text-white/90" aria-hidden />}
      </div>

      {event.status === "cancelled" ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="status">
          This event has been cancelled.
        </p>
      ) : event.status === "pending" ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          Awaiting verification: this event shows to the organization&apos;s members only until UniBuzz staff verify the organization.
        </p>
      ) : event.status === "hidden" ? (
        <p className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-700" role="status">
          Hidden by staff: students cannot see this event.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">{categoryLabel(event.category)}</Badge>
          <EventStatusPill status={event.status} />
        </div>
        <h1 className="text-2xl font-bold leading-tight text-gray-900">{event.title}</h1>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-start gap-2">
            <dt>
              <CalendarDays className="mt-0.5 h-4 w-4 text-brand-600" aria-label="When" />
            </dt>
            <dd className="font-medium text-gray-900">{when}</dd>
          </div>
          {event.location ? (
            <div className="flex items-start gap-2">
              <dt>
                <MapPin className="mt-0.5 h-4 w-4 text-brand-600" aria-label="Where" />
              </dt>
              <dd className="text-gray-800">
                <a href={mapsHref!} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {event.location}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {event.registration_url ? (
            <CountedLink eventId={event.id} kind="register" signedIn={signedIn} href={event.registration_url} className={buttonClasses({ size: "md" })}>
              {event.source === "feed" ? "Event page" : "Register"} <ExternalLink className="h-4 w-4" />
            </CountedLink>
          ) : null}
          <EventSaveButton eventId={event.id} saved={savedIds.has(event.id)} signedIn={signedIn} withLabel />
          <ShareButton path={eventPath(event.id)} title={event.title} />
        </div>
      </div>

      {org ? (
        <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <Link href={organizationPath(org.id)} className="shrink-0">
            <Avatar name={org.name} src={org.avatar_url} size="lg" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={organizationPath(org.id)} className="flex items-center gap-1 font-semibold text-gray-900 hover:underline">
              <span className="truncate">{org.name}</span>
              {org.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-label="Verified" /> : null}
            </Link>
            <p className="text-xs text-gray-500">{kindLabel}</p>
          </div>
          <OrganizationFollowButton organizationId={org.id} following={followedIds.has(org.id)} signedIn={signedIn} />
        </div>
      ) : (
        <p className="px-1 text-xs text-gray-500">From the campus calendar.</p>
      )}

      {event.description ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">About this event</h2>
          <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-gray-800">{event.description}</p>
        </section>
      ) : null}
    </div>
  );
}

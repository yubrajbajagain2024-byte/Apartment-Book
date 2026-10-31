import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, Briefcase, CalendarDays, Church, Cpu, Globe2, GraduationCap, HandHeart, HeartPulse, MapPin, Music, Palette, PartyPopper, Trophy, type LucideIcon } from "lucide-react";
import { categoryLabel, eventPath, eventWhen, type EventSummary } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EventSaveButton } from "./event-save-button";

/** The glyph that stands in for a picture, one per category, on the aurora. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  academic: GraduationCap,
  career: Briefcase,
  social: PartyPopper,
  sports: Trophy,
  music: Music,
  arts: Palette,
  tech: Cpu,
  wellness: HeartPulse,
  cultural: Globe2,
  service: HandHeart,
  faith: Church,
  other: CalendarDays,
};

/** The red or amber pill an event wears when it is not simply on: cancelled, or waiting for its organization to be verified. */
export function EventStatusPill({ status, className }: { status: EventSummary["status"]; className?: string }) {
  if (status === "cancelled") return <Badge tone="red" className={className}>Cancelled</Badge>;
  if (status === "pending") return <Badge tone="amber" className={className}>Awaiting verification</Badge>;
  if (status === "hidden") return <Badge tone="gray" className={className}>Hidden</Badge>;
  return null;
}

/** The picture of an event, or its category's glyph on the aurora when it has none. */
export function EventThumb({ event, className, sizes = "96px" }: { event: Pick<EventSummary, "image_url" | "category" | "title">; className?: string; sizes?: string }) {
  const Icon = CATEGORY_ICONS[event.category] ?? CalendarDays;
  return (
    <span className={cn("relative block overflow-hidden rounded-lg bg-brand-600 bg-aurora", className)}>
      {event.image_url ? <Image src={event.image_url} alt="" fill sizes={sizes} className="object-cover" /> : <Icon className="absolute inset-0 m-auto h-8 w-8 text-white/90" aria-hidden />}
    </span>
  );
}

/**
 * One event in a list: the picture (or the category's glyph), the title, when and where, who is behind it and its
 * category, with the bookmark at the right. `withDay: false` leaves the day out of the time, for a list already grouped
 * under day headings. Server-rendered; only the bookmark is a client component.
 */
export function EventCard({ event, timeZone, nowMs, saved, signedIn, withDay = true }: { event: EventSummary; timeZone: string; nowMs: number; saved: boolean; signedIn: boolean; withDay?: boolean }) {
  const href = eventPath(event.id);
  const cancelled = event.status === "cancelled";
  return (
    <article className={cn("flex gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200 transition-shadow hover:shadow-md", cancelled && "opacity-80")} data-testid="event-card">
      <Link href={href} className="shrink-0" aria-hidden tabIndex={-1}>
        <EventThumb event={event} className="h-24 w-24" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start gap-2">
          <h3 className={cn("min-w-0 flex-1 text-base font-semibold leading-snug text-gray-900", cancelled && "line-through decoration-gray-400")}>
            <Link href={href} className="line-clamp-2 hover:underline">
              {event.title}
            </Link>
          </h3>
          <EventSaveButton eventId={event.id} saved={saved} signedIn={signedIn} className="-mr-1 -mt-1" />
        </div>
        <p className="text-sm font-medium text-gray-800">{eventWhen(event, timeZone, nowMs, { withDay })}</p>
        {event.location ? (
          <p className="flex items-center gap-1 truncate text-sm text-gray-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{event.location}</span>
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
          {event.organization ? (
            <span className="inline-flex items-center gap-1 truncate">
              <span className="truncate">{event.organization.name}</span>
              {event.organization.verified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-label="Verified" /> : null}
            </span>
          ) : (
            <span>Campus calendar</span>
          )}
          <Badge tone="blue">{categoryLabel(event.category)}</Badge>
          <EventStatusPill status={event.status} />
        </div>
      </div>
    </article>
  );
}

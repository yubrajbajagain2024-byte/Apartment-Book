import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark, CalendarX2 } from "lucide-react";
import {
  EVENT_DATE_FILTERS,
  EVENTS_PAGE_SIZE,
  FOR_YOU_EVENTS_POOL,
  eventDateRange,
  getForYouContext,
  getSavedEventIds,
  getUniversityTimeZone,
  groupEventsByDay,
  isEventCategory,
  listEvents,
  rankEvents,
  type EventDateFilter,
  type EventSection,
  type EventSummary,
  type ForYouContext,
} from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam, requestNow } from "@/lib/utils";
import { EventsTabs } from "@/components/events/events-tabs";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCard } from "@/components/events/event-card";
import { EventFilters, eventsHref, type EventListParams } from "@/components/events/event-filters";

export const metadata: Metadata = { title: "Events" };

/** The campus's clock when the campus is unknown (signed out, or a database before migration 61): the launch campus's. */
const DEFAULT_TIME_ZONE = "America/Chicago";
const WHEN = new Set<string>(EVENT_DATE_FILTERS.map((f) => f.value));

/**
 * Events, the website's fourth tab (migration 61): For you, ranked for the signed-in student from their interests,
 * follows, saves and what is soon; All, in time order under day headings; both narrowed by the when and category pills
 * and the search box. The campus is the student's own (every campus signed out). Everything is server-rendered from
 * the address, so a filtered view can be shared as a link.
 */
export default async function EventsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const [user, profile, supabase] = await Promise.all([getCurrentUser(), getCurrentProfile(), createClient()]);
  const signedIn = Boolean(user);
  const requestedView = firstParam(params.view);
  const view: EventSection = requestedView === "all" || requestedView === "foryou" ? requestedView : signedIn ? "foryou" : "all";
  const whenParam = firstParam(params.when) ?? "any";
  const when = (WHEN.has(whenParam) ? whenParam : "any") as EventDateFilter;
  const categoryParam = firstParam(params.category);
  const category = isEventCategory(categoryParam) ? categoryParam : null;
  const q = (firstParam(params.q) ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.floor(Number(firstParam(params.page)) || 1));
  const listParams: EventListParams = { view, when, category, q };

  const universityId = profile?.university_id ?? null;
  const timeZone = (await getUniversityTimeZone(supabase, universityId)) ?? DEFAULT_TIME_ZONE;
  const nowMs = requestNow();
  const range = eventDateRange(when, nowMs, timeZone);
  const filters = { universityId, from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString(), category, q };

  let events: EventSummary[];
  let hasMore = false;
  let ctx: ForYouContext = {};
  if (view === "foryou") {
    const [pool, context] = await Promise.all([listEvents(supabase, { ...filters, limit: FOR_YOU_EVENTS_POOL }), user ? getForYouContext(supabase, user.id).catch(() => ({}) as ForYouContext) : Promise.resolve({} as ForYouContext)]);
    ctx = context;
    events = rankEvents(pool, ctx, nowMs);
  } else {
    // One row more than the page: whether there is a next page, without a count.
    const rows = await listEvents(supabase, { ...filters, limit: EVENTS_PAGE_SIZE + 1, offset: (page - 1) * EVENTS_PAGE_SIZE });
    hasMore = rows.length > EVENTS_PAGE_SIZE;
    events = rows.slice(0, EVENTS_PAGE_SIZE);
  }
  const savedIds = ctx.savedIds ?? (user ? await getSavedEventIds(supabase, user.id).catch(() => new Set<string>()) : new Set<string>());
  const narrowed = when !== "any" || category !== null || q !== "";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Events</h1>
          <p className="truncate text-sm text-gray-600">{profile?.university?.name ? `At ${profile.university.name}` : "On every campus"}</p>
        </div>
        {signedIn ? (
          <Link href="/events/saved" className={buttonClasses({ variant: "outline", size: "sm" })} data-testid="events-saved-link">
            <Bookmark className="h-4 w-4" /> Saved
          </Link>
        ) : null}
      </header>
      <EventsTabs active={view} params={listParams} />
      <EventFilters params={listParams} />
      {view === "foryou" && signedIn && !ctx.interests?.length ? <p className="text-xs text-gray-500">For you learns from what you save, open and follow. Pick your interests in the UniBuzz app to tune it.</p> : null}
      {events.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title={narrowed ? "No events match" : "No upcoming events yet"}
          description={narrowed ? "Try another day, category or search." : "Events from the campus calendars and verified clubs show up here as they are published."}
          action={
            narrowed ? (
              <Link href={eventsHref({ view })} className={buttonClasses({ variant: "outline", size: "sm" })}>
                Show every upcoming event
              </Link>
            ) : undefined
          }
        />
      ) : view === "foryou" ? (
        <ul className="flex flex-col gap-2" data-testid="events-foryou">
          {events.map((e) => (
            <li key={e.id}>
              <EventCard event={e} timeZone={timeZone} nowMs={nowMs} saved={savedIds.has(e.id)} signedIn={signedIn} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-5" data-testid="events-all">
          {groupEventsByDay(events, timeZone, nowMs).map((group) => (
            <section key={group.key} className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{group.label}</h2>
              <ul className="flex flex-col gap-2">
                {group.events.map((e) => (
                  <li key={e.id}>
                    <EventCard event={e} timeZone={timeZone} nowMs={nowMs} saved={savedIds.has(e.id)} signedIn={signedIn} withDay={false} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {page > 1 || hasMore ? (
            <nav className="flex justify-between" aria-label="Pages">
              {page > 1 ? (
                <Link href={eventsHref(listParams, page - 1)} className={buttonClasses({ variant: "outline", size: "sm" })}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              {hasMore ? (
                <Link href={eventsHref(listParams, page + 1)} className={buttonClasses({ variant: "outline", size: "sm" })}>
                  Next
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}

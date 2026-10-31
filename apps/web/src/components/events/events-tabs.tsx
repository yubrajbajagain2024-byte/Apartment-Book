"use client";

import { EVENT_SECTIONS, type EventSection } from "@apartment-book/shared";
import { SectionTabs } from "@/components/layout/section-tabs";
import { eventsHref, type EventListParams } from "./event-filters";

/**
 * For you | All events, sticky under the navbar like the Home and Housing tabs. A client component of its own because
 * the bar takes a function for its links, which a server page cannot hand to the browser: the page passes the filters
 * in force instead, and each tab's link keeps them.
 */
export function EventsTabs({ active, params }: { active: EventSection; params: EventListParams }) {
  return <SectionTabs sections={EVENT_SECTIONS} active={active} hrefFor={(view) => eventsHref({ ...params, view })} label="Events sections" testIdPrefix="events-tab" />;
}

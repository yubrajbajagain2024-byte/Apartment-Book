import Link from "next/link";
import { Search } from "lucide-react";
import { EVENT_CATEGORIES, EVENT_DATE_FILTERS, type EventCategory, type EventDateFilter, type EventSection } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type EventListParams = { view: EventSection; when: EventDateFilter; category: EventCategory | null; q: string };

/** The /events address for a set of choices, with the defaults left out so the plain address stays plain. */
export function eventsHref(params: Partial<EventListParams>, page?: number): string {
  const search = new URLSearchParams();
  if (params.view && params.view !== "foryou") search.set("view", params.view);
  if (params.when && params.when !== "any") search.set("when", params.when);
  if (params.category) search.set("category", params.category);
  if (params.q) search.set("q", params.q);
  if (page && page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `/events?${query}` : "/events";
}

function PillLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors", active ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-800 hover:bg-gray-200")}
    >
      {children}
    </Link>
  );
}

/**
 * The search box and the two rows of pills under the section tabs: when (Upcoming, Today, This week, Weekend) and the
 * categories. Plain links and a GET form, so the server renders every choice and nothing needs JavaScript; each link
 * keeps the other choices.
 */
export function EventFilters({ params }: { params: EventListParams }) {
  return (
    <div className="flex flex-col gap-2">
      <form action="/events" method="get" role="search" className="relative">
        {params.view !== "foryou" ? <input type="hidden" name="view" value={params.view} /> : null}
        {params.when !== "any" ? <input type="hidden" name="when" value={params.when} /> : null}
        {params.category ? <input type="hidden" name="category" value={params.category} /> : null}
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <Input name="q" defaultValue={params.q} placeholder="Search events" aria-label="Search events" className="h-11 rounded-full pl-9" autoComplete="off" />
      </form>
      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:px-0">
        {EVENT_DATE_FILTERS.map((f) => (
          <PillLink key={f.value} href={eventsHref({ ...params, when: f.value })} active={params.when === f.value}>
            {f.label}
          </PillLink>
        ))}
        <span className="my-1 w-px shrink-0 bg-gray-300" aria-hidden />
        <PillLink href={eventsHref({ ...params, category: null })} active={params.category === null}>
          All
        </PillLink>
        {EVENT_CATEGORIES.map((c) => (
          <PillLink key={c.value} href={eventsHref({ ...params, category: c.value })} active={params.category === c.value}>
            {c.label}
          </PillLink>
        ))}
      </div>
    </div>
  );
}

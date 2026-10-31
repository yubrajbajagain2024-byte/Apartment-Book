import Link from "next/link";
import { listUniversities } from "@apartment-book/shared";
import { fetchConsoleEvents, fetchConsoleOrganizations, fetchEventFeeds, fetchEventsCounts } from "@/lib/staff/events";
import { requireStaff, staffMetadata } from "@/lib/staff/server";
import { firstParam } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FilterBar } from "@/components/common/filter-bar";
import { EventFeedsPanel } from "@/components/staff/events-feeds";
import { EventsConsoleList } from "@/components/staff/events-list";
import { EventOrganizationsPanel } from "@/components/staff/events-organizations";
import { Section, StatTile } from "@/components/staff/parts";

export const generateMetadata = () => staffMetadata("Events · Trust & Safety");

const PAGE = 50;
const STATUSES = ["scheduled", "cancelled", "pending", "hidden"] as const;

/**
 * Events (migration 61): what staff monitor and moderate. The calendar feeds the sync reads (admins add and change
 * them; anyone on staff may sync now), the organizations waiting to be verified, and the events themselves with
 * Hide / Cancel / Restore. Every write is a console function that checks the role and writes the audit row.
 */
export default async function StaffEventsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const me = await requireStaff();
  const params = await searchParams;
  const status = firstParam(params.status) ?? "";
  const source = firstParam(params.source) ?? "";
  const q = (firstParam(params.q) ?? "").trim().slice(0, 80);
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const filter = {
    status: (STATUSES as readonly string[]).includes(status) ? status : undefined,
    source: source === "feed" || source === "organization" ? source : undefined,
    q: q || undefined,
    offset: page * PAGE,
    limit: PAGE,
  };
  const [counts, feeds, organizations, events, universities] = await Promise.all([
    fetchEventsCounts(),
    fetchEventFeeds(),
    fetchConsoleOrganizations(),
    fetchConsoleEvents(filter),
    listUniversities(me.supabase).catch(() => []),
  ]);
  const hasFilters = Boolean(filter.status || filter.source || filter.q);
  const pageHref = (p: number) => {
    const s = new URLSearchParams();
    if (filter.status) s.set("status", filter.status);
    if (filter.source) s.set("source", filter.source);
    if (filter.q) s.set("q", filter.q);
    if (p > 0) s.set("page", String(p));
    const query = s.toString();
    return query ? `/admin/events?${query}` : "/admin/events";
  };
  const lastPage = Math.max(0, Math.ceil(events.total / PAGE) - 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Organizations to verify" value={String(counts.organizations_pending)} hint="awaiting verification" />
        <StatTile label="Feeds failing" value={String(counts.feeds_failing)} hint="last sync errored" />
        <StatTile label="Upcoming events" value={String(counts.events_upcoming)} hint="scheduled, ahead" />
      </div>

      <Section title="Calendar feeds" hint={me.role === "admin" ? "the sync runs daily; changes are audited" : "the sync runs daily; admins add feeds"}>
        <EventFeedsPanel feeds={feeds} universities={universities.map((u) => ({ id: u.id, name: u.name }))} admin={me.role === "admin"} />
      </Section>

      <Section title="Organizations" hint="unverified first; verifying publishes their pending events">
        <EventOrganizationsPanel organizations={organizations} />
      </Section>

      <Section title="Events" hint={`${events.total} ${hasFilters ? "matching" : "upcoming"}`}>
        <FilterBar action="/admin/events" hasFilters={hasFilters}>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
            Search
            <Input name="q" defaultValue={q} placeholder="Title, words, place" />
          </label>
          <label className="flex w-36 flex-col gap-1 text-xs font-medium text-gray-600">
            Status
            <Select name="status" defaultValue={filter.status ?? ""}>
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex w-36 flex-col gap-1 text-xs font-medium text-gray-600">
            Source
            <Select name="source" defaultValue={filter.source ?? ""}>
              <option value="">Any</option>
              <option value="feed">Feed</option>
              <option value="organization">Organization</option>
            </Select>
          </label>
        </FilterBar>
        <EventsConsoleList events={events.items} />
        {page > 0 || page < lastPage ? (
          <div className="flex justify-between">
            {page > 0 ? (
              <Link href={pageHref(page - 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            {page < lastPage ? (
              <Link href={pageHref(page + 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
                Next
              </Link>
            ) : null}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

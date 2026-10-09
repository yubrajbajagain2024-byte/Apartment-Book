"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessagesSquare, Plus, Search, VenetianMask, X } from "lucide-react";
import { BUZZ_PAGE_SIZE, BUZZ_SORTS, BUZZ_TOPICS, listBuzz, type BuzzFilters, type BuzzPost } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedFooter } from "@/components/feed/feed-bits";
import { BUZZ_FOCUS_SEARCH, BUZZ_SEARCH_ID, BuzzSortMenu, BuzzTopicIcon } from "./buzz-bits";
import { BuzzRow, BuzzSearchRow } from "./buzz-card";

export type BuzzFeedProps = {
  initial: BuzzPost[];
  filters: BuzzFilters;
  signedIn: boolean;
  /** Which campus the feed is showing, for the "All universities" switch. */
  scope?: { universityName: string | null; hasHomeUniversity: boolean };
};

type LinkState = { sort?: string; topic?: string; q?: string; all: boolean };

/** Every Buzz filter is a plain link that keeps tab=buzz, so the address can be shared and the back button works. */
function buzzHref(state: LinkState): string {
  const params = new URLSearchParams({ tab: "buzz" });
  if (state.sort && state.sort !== "hot") params.set("sort", state.sort);
  if (state.topic) params.set("topic", state.topic);
  if (state.q) params.set("q", state.q);
  if (state.all) params.set("university", "all");
  return `/?${params.toString()}`;
}

function dedupe(prev: BuzzPost[], next: BuzzPost[]): BuzzPost[] {
  const seen = new Set(prev.map((p) => p.id));
  return [...prev, ...next.filter((n) => !seen.has(n.id))];
}

/** Home → Buzz: anonymous threads with search, Hot/New/Top, topics and load-more. */
export function BuzzFeed({ initial, filters, signedIn, scope }: BuzzFeedProps) {
  const [items, setItems] = useState(initial);
  const [done, setDone] = useState(initial.length < BUZZ_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  // How many rows the server has handed out so far (hidden or deleted cards still count).
  const offset = useRef(initial.length);

  const all = !filters.universityId && Boolean(scope?.hasHomeUniversity);
  const current: LinkState = { sort: filters.sort, topic: filters.topic, q: filters.q, all };
  const filtered = Boolean(filters.topic || filters.q);

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await listBuzz(createClient(), { ...filters, offset: offset.current });
      offset.current += next.length;
      setItems((prev) => dedupe(prev, next));
      if (next.length < BUZZ_PAGE_SIZE) setDone(true);
    } catch {
      setError("Could not load more");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, done]);

  // The Search button on a thread page lands here and expects the cursor in the search box.
  useEffect(() => {
    let asked = window.location.hash === `#${BUZZ_SEARCH_ID}`;
    try {
      asked = sessionStorage.getItem(BUZZ_FOCUS_SEARCH) === "1" || asked;
      sessionStorage.removeItem(BUZZ_FOCUS_SEARCH);
    } catch {
      // Private mode: the address still says it.
    }
    if (asked) searchRef.current?.focus();
  }, []);

  /** A deleted or hidden thread just leaves the list. Hiding covers that one thread, so no other row changes. */
  function onRemoved(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }

  const pill = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors";

  return (
    <div className="-mx-3 -mt-1 flex flex-col sm:mx-0 sm:mt-0" data-testid="buzz-feed">
      {/* One white sheet like Reddit's feed: edge to edge on a phone, rounded on a desktop, rows split by hairlines. */}
      <div className="bg-white sm:rounded-xl sm:shadow-sm sm:ring-1 sm:ring-gray-200">
        <section className="flex flex-col gap-2.5 px-4 pb-2.5 pt-3" aria-label="Buzz filters">
          <div className="flex items-center gap-2">
            <form action="/" method="get" role="search" className="relative min-w-0 flex-1">
              <input type="hidden" name="tab" value="buzz" />
              {filters.sort && filters.sort !== "hot" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
              {filters.topic ? <input type="hidden" name="topic" value={filters.topic} /> : null}
              {all ? <input type="hidden" name="university" value="all" /> : null}
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500" />
              <input
                ref={searchRef}
                id={BUZZ_SEARCH_ID}
                type="search"
                name="q"
                defaultValue={filters.q ?? ""}
                maxLength={100}
                placeholder="Search Buzz"
                aria-label="Search Buzz"
                className="h-10 w-full rounded-full bg-gray-100 pl-10 pr-4 text-base text-gray-900 sm:text-[15px] outline-none placeholder:text-gray-500 focus:bg-white focus:ring-2 focus:ring-brand-500"
              />
            </form>
            <Link href="/buzz/new" aria-label="Start a thread" title="Start a thread" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-900 transition-colors hover:bg-gray-200" data-testid="buzz-start">
              <Plus className="h-6 w-6" />
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <BuzzSortMenu label="Sort by" variant="pill" value={filters.sort ?? "hot"} options={BUZZ_SORTS.map((s) => ({ value: s.value, label: s.label, href: buzzHref({ ...current, sort: s.value }) }))} />
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-gray-200" />
            <div className="-mr-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-4 [scrollbar-width:none]" role="group" aria-label="Topic" data-no-swipe>
              <Link href={buzzHref({ ...current, topic: undefined })} scroll={false} aria-current={!filters.topic ? "true" : undefined} className={cn(pill, !filters.topic ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800 hover:bg-gray-200")}>
                All
              </Link>
              {BUZZ_TOPICS.map((t) => {
                const active = filters.topic === t.value;
                return (
                  <Link key={t.value} href={buzzHref({ ...current, topic: active ? undefined : t.value })} scroll={false} aria-current={active ? "true" : undefined} className={cn(pill, "pl-1", active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800 hover:bg-gray-200")}>
                    <BuzzTopicIcon topic={t.value} />
                    {t.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-gray-500">
            <VenetianMask className="mt-px h-4 w-4 shrink-0" />
            <span>
              Buzz is anonymous. Nobody sees your name or profile here, only a random name like &quot;Student 48213&quot;. Be kind.
              {filters.universityId || scope?.hasHomeUniversity ? (
                <>
                  {" "}
                  {filters.universityId ? `Showing ${scope?.universityName ?? "your university"}` : "Showing all universities"} ·{" "}
                  <Link href={buzzHref({ ...current, all: Boolean(filters.universityId) })} scroll={false} className="font-semibold text-brand-700 hover:underline">
                    {filters.universityId ? "All universities" : "My university"}
                  </Link>
                </>
              ) : null}
            </span>
          </p>
        </section>

        {filters.q ? (
          <p className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-2.5 text-[15px] font-bold text-gray-900">
            <span className="min-w-0 truncate">Threads for &quot;{filters.q}&quot;</span>
            <Link href={buzzHref({ ...current, q: undefined })} scroll={false} className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-brand-700 hover:underline">
              <X className="h-3.5 w-3.5" /> Clear
            </Link>
          </p>
        ) : null}

        {items.length === 0 && done ? (
          <div className="border-t border-gray-200 px-4 py-4">
            <EmptyState
              icon={MessagesSquare}
              title={filtered ? "Nothing matches yet" : "No threads yet"}
              description={filtered ? "Try another topic or search, or start the conversation yourself." : "Ask a question, share an experience or give some advice. Nobody will know it was you."}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {filtered ? (
                    <LinkButton href={buzzHref({ all })} variant="secondary">
                      Clear filters
                    </LinkButton>
                  ) : filters.universityId ? (
                    <LinkButton href={buzzHref({ ...current, all: true })} variant="secondary">
                      Show all universities
                    </LinkButton>
                  ) : null}
                  <LinkButton href="/buzz/new">Start a thread</LinkButton>
                </div>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 border-t border-gray-200 sm:[&>li:last-child>article]:rounded-b-xl" data-testid="buzz-list">
            {items.map((p, i) => (
              <li key={p.id}>
                {filters.q ? <BuzzSearchRow post={p} /> : <BuzzRow post={p} signedIn={signedIn} priority={i < 3} onRemoved={onRemoved} topicHref={(topic) => buzzHref({ sort: filters.sort, topic, all })} />}
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length > 0 || !done ? <FeedFooter sentinelRef={sentinelRef} loading={loading} done={done} error={error} onRetry={loadMore} count={items.length} /> : null}
    </div>
  );
}

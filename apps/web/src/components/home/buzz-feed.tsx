"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessagesSquare, PenLine, Search, VenetianMask, X } from "lucide-react";
import { BUZZ_PAGE_SIZE, BUZZ_SORTS, BUZZ_TOPICS, listBuzz, type BuzzFilters, type BuzzPost } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedFooter } from "@/components/feed/feed-bits";
import { BuzzCard } from "./buzz-card";

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

  /** A deleted or hidden thread just leaves the list. Hiding covers that one thread, so no other card changes. */
  function onRemoved(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }

  const pill = "inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold transition-colors";

  return (
    <div className="-mx-3 flex flex-col gap-1 sm:mx-0 sm:gap-3" data-testid="buzz-feed">
      <section className="flex flex-col gap-3 bg-white px-3 py-3 shadow-sm ring-1 ring-gray-200 sm:rounded-xl" aria-label="Buzz filters">
        <div className="flex items-center gap-2">
          <form action="/" method="get" role="search" className="relative min-w-0 flex-1">
            <input type="hidden" name="tab" value="buzz" />
            {filters.sort && filters.sort !== "hot" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
            {filters.topic ? <input type="hidden" name="topic" value={filters.topic} /> : null}
            {all ? <input type="hidden" name="university" value="all" /> : null}
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              maxLength={100}
              placeholder="Search Buzz"
              aria-label="Search Buzz"
              className="h-10 w-full rounded-full bg-gray-100 pl-9 pr-3 text-sm text-gray-900 outline-none placeholder:text-gray-500 focus:bg-white focus:ring-2 focus:ring-brand-500"
            />
          </form>
          <LinkButton href="/buzz/new" className="shrink-0 rounded-full" data-testid="buzz-start">
            <PenLine className="h-4 w-4" /> Start a thread
          </LinkButton>
        </div>

        <div className="flex items-center gap-1.5" role="group" aria-label="Sort">
          {BUZZ_SORTS.map((s) => {
            const active = (filters.sort ?? "hot") === s.value;
            return (
              <Link key={s.value} href={buzzHref({ ...current, sort: s.value })} scroll={false} aria-current={active ? "true" : undefined} className={cn(pill, active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}>
                {s.label}
              </Link>
            );
          })}
        </div>

        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Topic">
          <Link href={buzzHref({ ...current, topic: undefined })} scroll={false} aria-current={!filters.topic ? "true" : undefined} className={cn(pill, !filters.topic ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700 hover:bg-brand-100")}>
            All topics
          </Link>
          {BUZZ_TOPICS.map((t) => {
            const active = filters.topic === t.value;
            return (
              <Link key={t.value} href={buzzHref({ ...current, topic: active ? undefined : t.value })} scroll={false} aria-current={active ? "true" : undefined} className={cn(pill, active ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700 hover:bg-brand-100")}>
                {t.label}
              </Link>
            );
          })}
        </div>
      </section>

      <p className="flex items-start gap-1.5 px-3 text-xs text-gray-600 sm:px-1">
        <VenetianMask className="mt-px h-4 w-4 shrink-0 text-gray-500" />
        <span>
          Buzz is anonymous. Nobody sees your name or profile here, only a random name like &quot;Student 4821&quot;. Be kind.
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

      {filters.q ? (
        <p className="flex items-center gap-2 px-3 text-sm text-gray-700 sm:px-1">
          Results for &quot;{filters.q}&quot;
          <Link href={buzzHref({ ...current, q: undefined })} scroll={false} className="inline-flex items-center gap-0.5 font-semibold text-brand-700 hover:underline">
            <X className="h-3.5 w-3.5" /> Clear
          </Link>
        </p>
      ) : null}

      {items.length === 0 && done ? (
        <div className="px-3 sm:px-0">
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
        <>
          {items.map((p, i) => (
            <BuzzCard key={p.id} post={p} signedIn={signedIn} priority={i < 2} onRemoved={onRemoved} topicHref={(topic) => buzzHref({ sort: filters.sort, topic, all })} />
          ))}
          <FeedFooter sentinelRef={sentinelRef} loading={loading} done={done} error={error} onRetry={loadMore} count={items.length} />
        </>
      )}
    </div>
  );
}

"use client";

/**
 * /buzz/search (UniVerse's `SearchPage`): search buzzes by keyword (title + body), on your campus or in Global, newest
 * or top first. Results are ordinary cards (aliases only). The query lives in memory for the session, so "back" from a
 * thread lands on the same results; nothing is written to the browser's storage.
 */
import { useEffect, useRef, useState } from "react";
import { SearchX } from "lucide-react";
import { BUZZ_LIMITS, BUZZ_SEARCH_COPY, BUZZ_SEARCH_SORTS, BUZZ_SEARCH_SUGGESTIONS, type Buzz } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { BuzzCard, BuzzCardSkeleton } from "./buzz-card";
import { useBuzzMeta, useBuzzSearch } from "./data";
import { BuzzPageHeader, PAGE_FRAME, TabBarSpacer, useBuzzBack } from "./frame";
import { BuzzGatePanel, BuzzGateSkeleton, BuzzSignInPanel, useBuzzGate } from "./gate";
import { buzzActions, useBuzzUi } from "./store";
import { BuzzSurface } from "./surface";
import { Chip, EmptyState, ErrorState, InfiniteSentinel, SCOPE_OPTIONS, SearchInput, Segmented, T } from "./ui";

const FEED = "/?tab=buzz";

export function BuzzSearchScreen({ userId, fixtures }: { userId: string | null; fixtures?: string | null }) {
  return (
    <BuzzSurface userId={userId} fixtures={fixtures} className={PAGE_FRAME} fallback={<BuzzGateSkeleton className="mt-16" />}>
      <SearchBody />
    </BuzzSurface>
  );
}

function SearchBody() {
  const gate = useBuzzGate();
  const back = useBuzzBack(FEED);
  if (gate.signedIn && gate.accepted) return <SearchView onBack={back} />;
  return (
    <>
      <BuzzPageHeader title={BUZZ_SEARCH_COPY.title} onBack={back} />
      {!gate.signedIn ? (
        <BuzzSignInPanel next="/buzz/search" className="pt-4" />
      ) : gate.isLoading ? (
        <BuzzGateSkeleton className="mt-4" />
      ) : gate.isError ? (
        <ErrorState title={BUZZ_SEARCH_COPY.loadError} error={gate.error} onRetry={() => void gate.retry()} />
      ) : (
        <BuzzGatePanel variant="page" onDismiss={back} className="pt-4" />
      )}
      <TabBarSpacer />
    </>
  );
}

/** The query the list follows, 300 ms behind the typing. */
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function SearchView({ onBack }: { onBack(): void }) {
  const search = useBuzzUi((s) => s.search);
  const q = useDebounced(search.q, 300);
  const results = useBuzzSearch(q, search.scope, search.sort, true);
  const meta = useBuzzMeta("campus", true);
  const campus = meta.data?.campus?.shortName ?? "campus";
  const where = search.scope === "campus" ? campus : "Global";
  const ready = q.trim().length >= 2;
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on arrival when there is nothing typed yet (a back from a thread keeps the results without the keyboard).
  useEffect(() => {
    if (!search.q) inputRef.current?.focus();
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <BuzzPageHeader
        title={BUZZ_SEARCH_COPY.title}
        onBack={onBack}
        below={
          <div className="flex flex-col gap-2">
            <SearchInput
              ref={inputRef}
              aria-label="Search buzzes"
              placeholder={`Search ${where} buzz`}
              maxLength={BUZZ_LIMITS.search}
              value={search.q}
              onValueChange={(v) => buzzActions.setSearch({ q: v })}
              onKeyDown={(e) => {
                if (e.key === "Enter") inputRef.current?.blur();
              }}
              data-testid="buzz-search-input"
            />
            <div className="flex items-center justify-between gap-2">
              <Segmented aria-label="Sort results" value={search.sort} onChange={(sort) => buzzActions.setSearch({ sort })} options={BUZZ_SEARCH_SORTS} />
              <Segmented aria-label="Search scope" value={search.scope} onChange={(scope) => buzzActions.setSearch({ scope })} options={SCOPE_OPTIONS} />
            </div>
          </div>
        }
      />
      <div className="flex flex-1 flex-col">
        {!ready ? (
          <div className="flex flex-col gap-3 px-4 pt-4">
            <p className={cn("text-incog-ink-3", T.footnote)}>{BUZZ_SEARCH_COPY.intro}</p>
            <div className="flex flex-wrap gap-2">
              {BUZZ_SEARCH_SUGGESTIONS.map((s) => (
                <Chip key={s} size="sm" onClick={() => buzzActions.setSearch({ q: s })}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        ) : results.isLoading ? (
          <div className="flex flex-col gap-3 px-4 pt-3" aria-busy="true">
            <BuzzCardSkeleton />
            <BuzzCardSkeleton />
          </div>
        ) : results.isError ? (
          <ErrorState title={BUZZ_SEARCH_COPY.loadError} error={results.error} onRetry={() => void results.refetch()} className="px-4 pt-6" />
        ) : results.items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={BUZZ_SEARCH_COPY.noMatch(where, q.trim())}
            description={search.scope === "campus" ? BUZZ_SEARCH_COPY.tryGlobal : BUZZ_SEARCH_COPY.tryCampus}
            action={{
              label: search.scope === "campus" ? "Search Global" : `Search ${campus}`,
              onClick: () => buzzActions.setSearch({ scope: search.scope === "campus" ? "global" : "campus" }),
            }}
            compact
            className="pt-6"
          />
        ) : (
          <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
            {results.items.map((b: Buzz) => (
              <BuzzCard key={b.id} buzz={b} />
            ))}
            <InfiniteSentinel
              onReach={results.fetchNextPage}
              hasMore={results.hasNextPage}
              isFetching={results.isFetchingNextPage}
              error={results.nextError}
              onRetry={results.fetchNextPage}
              skeleton={<BuzzCardSkeleton />}
              endLabel={BUZZ_SEARCH_COPY.end}
            />
          </div>
        )}
      </div>
      <TabBarSpacer />
    </>
  );
}

"use client";

/**
 * Home → Buzz (UniVerse's `features/buzz/pane.tsx`), inside the website's Home column.
 *
 * Signed out → a sign-in panel. Before the guidelines are accepted → the INLINE gate panel (never a modal), and no
 * Buzz request other than the gate check; "Not now" goes back to the previous Home tab and the tab row / swipe stay
 * usable. After acceptance: the sticky filter bar (search pill → /buzz/search, Hot / New / Top, Campus / Global) that
 * slides away while scrolling down and comes back on the way up; Top → window chips; the Daily Campus Prompt (Hot);
 * the small-campus note; cold start (an empty campus Hot feed moves to Global with a dismissible banner); cards,
 * skeletons, empty and error states, infinite scroll; the pen-and-mask FAB; the composer sheet.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, PenLine, Search, Sparkles, VenetianMask, X } from "lucide-react";
import {
  BUZZ_FEED_COPY,
  BUZZ_SORT_OPTIONS,
  BUZZ_TOP_WINDOWS,
  homeSectionHref,
  type Buzz,
  type BuzzFeedSort,
  type BuzzScope,
  type BuzzTopWindow,
} from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { BuzzCard, BuzzCardSkeleton } from "./buzz-card";
import { BuzzComposer } from "./composer";
import { useBuzzFeed, useBuzzMeta } from "./data";
import { TabBarSpacer, useTabBarHeight } from "./frame";
import { BuzzGatePanel, BuzzGateSkeleton, BuzzSignInPanel, useBuzzGate } from "./gate";
import { BuzzPortal } from "./sheet";
import { buzzActions, lastNonBuzzHomeTab, useBuzzUi } from "./store";
import { BuzzSurface } from "./surface";
import { Button, ChipGroup, EmptyState, ErrorState, GLOW, IconButton, InfiniteSentinel, SCOPE_OPTIONS, Segmented, T } from "./ui";

export interface BuzzPaneProps {
  /** The signed-in user's id, or null. Only compared (to wipe Buzz state on a change of account), never shown. */
  userId: string | null;
  /** /buzz/new lands here with ?compose=1: open the composer. */
  compose?: boolean;
  /** The viewer's university from their profile, until the feed's own meta (with the short name) arrives. */
  campusFallback?: { name: string; shortName: string } | null;
  /** `?buzzFixtures=` (development only). */
  fixtures?: string | null;
}

const PANE_FRAME = cn(
  "-mx-3 -mt-1 -mb-24 flex min-h-[calc(100dvh-102px)] flex-col md:-mb-8",
  "sm:mx-0 sm:mt-0 sm:min-h-[calc(100dvh-132px)] sm:rounded-t-[20px] sm:border-x sm:border-t sm:border-incog-line",
);

export function BuzzPane(props: BuzzPaneProps) {
  return (
    <BuzzSurface userId={props.userId} fixtures={props.fixtures} className={PANE_FRAME} fallback={<BuzzGateSkeleton className="mt-4" />}>
      <PaneBody {...props} />
      <TabBarSpacer />
    </BuzzSurface>
  );
}

function PaneBody({ compose, campusFallback }: BuzzPaneProps) {
  const router = useRouter();
  const gate = useBuzzGate();
  if (!gate.signedIn) return <BuzzSignInPanel next="/?tab=buzz" className="py-4" />;
  if (gate.isLoading) return <BuzzGateSkeleton className="mt-4" />;
  if (gate.isError) return <ErrorState title={BUZZ_FEED_COPY.loadError} error={gate.error} onRetry={() => void gate.retry()} />;
  if (!gate.accepted) return <BuzzGatePanel variant="pane" onDismiss={() => router.push(homeSectionHref(lastNonBuzzHomeTab()))} className="py-4" />;
  return <Feed compose={compose} campusFallback={campusFallback ?? null} />;
}

/* ───────────────────────────── scroll-linked bits ───────────────────────────── */

const BAR_ALWAYS_UNDER = 48;
const DIRECTION_SLOP = 6;

/** Hidden while the page scrolls down, back as soon as it scrolls up (or nears the top), like Twitter / Reddit bars. */
function useHiddenOnScroll(alwaysUnder = BAR_ALWAYS_UNDER): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - last;
      if (y <= alwaysUnder) setHidden(false);
      else if (dy > DIRECTION_SLOP) setHidden(true);
      else if (dy < -DIRECTION_SLOP) setHidden(false);
      if (Math.abs(dy) > DIRECTION_SLOP) last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [alwaysUnder]);
  return hidden;
}

/** Where the Home tab row ends (it sticks under the site header), so the filter bar sticks right under it. */
function useUnderHomeTabs(): number {
  const [top, setTop] = useState(101);
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Home sections"]');
    if (!nav) return;
    const ro = new ResizeObserver(() => setTop((parseFloat(getComputedStyle(nav).top) || 56) + nav.offsetHeight));
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);
  return top;
}


/* ───────────────────────────── the feed ───────────────────────────── */

function Feed({ compose, campusFallback }: { compose?: boolean; campusFallback: { name: string; shortName: string } | null }) {
  const sort = useBuzzUi((s) => s.sort);
  const topWindow = useBuzzUi((s) => s.window);
  const scope = useBuzzUi((s) => s.scope);
  const coldStart = useBuzzUi((s) => s.coldStart);
  const coldStartDismissed = useBuzzUi((s) => s.coldStartDismissed);
  const feed = useBuzzFeed(sort, topWindow, scope, true);
  const meta = useBuzzMeta(scope, true);
  const campus = meta.data?.campus ?? campusFallback;
  const barHidden = useHiddenOnScroll();
  const fabHidden = useHiddenOnScroll(0);
  const barTop = useUnderHomeTabs();

  // /buzz/new → here with ?compose=1: open the composer once and drop the parameter (no reload, no new entry).
  useEffect(() => {
    if (!compose) return;
    buzzActions.openComposer();
    window.history.replaceState(window.history.state, "", "/?tab=buzz");
  }, [compose]);

  // Cold start (UniVerse SPEC §1 rule 1): the campus Hot feed is empty on its first page → Global + a banner.
  const empty = !feed.isLoading && !feed.isError && feed.items.length === 0;
  useEffect(() => {
    if (scope === "campus" && sort === "hot" && empty && !coldStartDismissed) buzzActions.setScope("global", { coldStart: true });
  }, [scope, sort, empty, coldStartDismissed]);

  const onScope = (v: BuzzScope) => {
    buzzActions.setScope(v);
    if (v === "campus") buzzActions.dismissColdStart();
  };
  const where = scope === "campus" ? (campus?.shortName ?? "campus") : "Global";

  return (
    <div className="flex flex-col" data-testid="buzz-feed">
      <div
        className={cn(
          "sticky z-20 flex flex-col gap-2 bg-incog-canvas/85 px-4 py-2 backdrop-blur-md transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-opacity sm:rounded-t-[20px]",
          barHidden && "pointer-events-none -translate-y-full opacity-0",
        )}
        style={{ top: barTop }}
        aria-hidden={barHidden || undefined}
        inert={barHidden || undefined}
      >
        <Link
          href="/buzz/search"
          onClick={() => buzzActions.setSearch({ scope })}
          className={cn("flex h-10 w-full items-center gap-2 rounded-full bg-incog-surface-2 px-4 text-left text-incog-ink-3 transition-colors hover:bg-incog-surface-3", T.body)}
          data-testid="buzz-search-pill"
        >
          <Search size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{BUZZ_FEED_COPY.searchPlaceholder(where)}</span>
        </Link>
        <div className="flex items-center justify-between gap-2">
          <Segmented<BuzzFeedSort> aria-label="Sort" value={sort} onChange={buzzActions.setSort} options={BUZZ_SORT_OPTIONS} />
          <Segmented<BuzzScope> aria-label="Feed scope" value={scope} onChange={onScope} options={SCOPE_OPTIONS} />
        </div>
      </div>
      {sort === "top" ? (
        <div className="px-4 pb-2">
          <ChipGroup<BuzzTopWindow> aria-label="Top window" size="sm" scroll value={topWindow} onChange={buzzActions.setWindow} options={BUZZ_TOP_WINDOWS} />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 pt-1 pb-4">
        {coldStart && !coldStartDismissed && scope === "global" ? (
          <div role="status" className="mx-4 flex items-center gap-3 rounded-[20px] border border-incog-accent-line bg-incog-hero-soft px-3.5 py-2.5">
            <p className={cn("min-w-0 flex-1 text-incog-ink", T.footnote)}>{BUZZ_FEED_COPY.coldStart(campus?.name ?? "Your campus")}</p>
            <Button size="sm" variant="secondary" onClick={() => buzzActions.openComposer({ scope: "campus" })} className="shrink-0">
              {BUZZ_FEED_COPY.coldStartAction}
            </Button>
            <IconButton icon={X} aria-label="Dismiss" size="sm" onClick={buzzActions.dismissColdStart} className="-mr-1 shrink-0" />
          </div>
        ) : null}
        {meta.data?.smallCampusNote && scope === "campus" ? <p className={cn("mx-4 rounded-[14px] bg-incog-surface-2 px-3 py-2 text-incog-ink-3", T.footnote)}>{BUZZ_FEED_COPY.smallCampus}</p> : null}
        {meta.data?.prompt && sort === "hot" ? (
          <div className="mx-4 flex flex-col gap-3 rounded-[20px] border border-incog-accent-line bg-incog-hero-soft p-4" data-testid="buzz-prompt">
            <div className={cn("flex items-center gap-2 text-incog-accent-ink", T.overline)}>
              <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
              {BUZZ_FEED_COPY.promptOverline}
            </div>
            <p className={cn("text-incog-ink", T.headline)}>{meta.data.prompt.text}</p>
            <Button variant="secondary" size="sm" className="self-start" onClick={() => buzzActions.openComposer({ promptId: meta.data?.prompt?.id ?? null })}>
              {BUZZ_FEED_COPY.promptAction}
            </Button>
          </div>
        ) : null}

        {feed.isLoading ? (
          <div className="flex flex-col gap-3 px-4" aria-busy="true">
            <BuzzCardSkeleton />
            <BuzzCardSkeleton />
            <BuzzCardSkeleton />
          </div>
        ) : feed.isError ? (
          <ErrorState title={BUZZ_FEED_COPY.loadError} error={feed.error} onRetry={() => void feed.refetch()} className="px-4" />
        ) : feed.items.length === 0 ? (
          <FeedEmpty
            sort={sort}
            topWindow={topWindow}
            scope={scope}
            universityName={campus?.name ?? "your campus"}
            onSeeGlobal={() => onScope("global")}
            onCheckNew={() => buzzActions.setSort("new")}
            onPost={() => buzzActions.openComposer()}
          />
        ) : (
          <div className="flex flex-col gap-3 px-4">
            {feed.items.map((b: Buzz) => (
              <BuzzCard key={b.id} buzz={b} />
            ))}
            <InfiniteSentinel
              onReach={feed.fetchNextPage}
              hasMore={feed.hasNextPage}
              isFetching={feed.isFetchingNextPage}
              error={feed.nextError}
              onRetry={feed.fetchNextPage}
              skeleton={<BuzzCardSkeleton />}
              endLabel={BUZZ_FEED_COPY.end}
            />
          </div>
        )}
      </div>

      <ComposeFab hidden={fabHidden} />
      <BuzzComposer />
    </div>
  );
}

function FeedEmpty({
  sort,
  topWindow,
  scope,
  universityName,
  onSeeGlobal,
  onCheckNew,
  onPost,
}: {
  sort: BuzzFeedSort;
  topWindow: BuzzTopWindow;
  scope: BuzzScope;
  universityName: string;
  onSeeGlobal(): void;
  onCheckNew(): void;
  onPost(): void;
}) {
  if (sort === "top" && topWindow === "day") return <EmptyState icon={Compass} title={BUZZ_FEED_COPY.topTodayEmpty} action={{ label: BUZZ_FEED_COPY.checkNew, onClick: onCheckNew }} compact />;
  if (scope === "campus") {
    return (
      <EmptyState
        icon={VenetianMask}
        title={BUZZ_FEED_COPY.campusEmpty(universityName)}
        action={{ label: BUZZ_FEED_COPY.startFirst, onClick: onPost }}
        secondary={{ label: BUZZ_FEED_COPY.seeGlobal, onClick: onSeeGlobal }}
        compact
      />
    );
  }
  return <EmptyState icon={VenetianMask} title={BUZZ_FEED_COPY.globalEmptyTitle} description={BUZZ_FEED_COPY.globalEmptyBody} action={{ label: BUZZ_FEED_COPY.startFirst, onClick: onPost }} compact />;
}

/**
 * The screen's one create action: the pen with a small mask badge, on the Phosphor gradient. Bottom-right of the
 * content column; above the tab bar on a phone; slides away while the page scrolls down.
 */
function ComposeFab({ hidden }: { hidden: boolean }) {
  const bar = useTabBarHeight();
  return (
    <BuzzPortal>
      <button
        type="button"
        aria-label={BUZZ_FEED_COPY.newBuzz}
        tabIndex={hidden ? -1 : 0}
        onClick={() => buzzActions.openComposer()}
        style={bar ? { bottom: bar + 16 } : undefined}
        className={cn(
          "fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[35] inline-flex size-14 items-center justify-center rounded-full bg-incog-hero text-incog-on-accent transition-[translate,filter,opacity] duration-300 ease-out select-none hover:brightness-110 active:brightness-95 sm:right-[calc(50%-234px)] md:bottom-6",
          GLOW,
          hidden && "pointer-events-none translate-y-24 opacity-0",
        )}
        data-testid="buzz-fab"
      >
        <span className="relative inline-flex">
          <PenLine size={24} strokeWidth={2} aria-hidden="true" />
          <span className="absolute -right-2.5 -bottom-2 flex size-[18px] items-center justify-center rounded-full bg-incog-on-accent text-incog-accent ring-2 ring-incog-accent">
            <VenetianMask size={11} strokeWidth={2.25} aria-hidden="true" />
          </span>
        </span>
      </button>
    </BuzzPortal>
  );
}

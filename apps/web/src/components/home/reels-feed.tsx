"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Clapperboard, Plus, X } from "lucide-react";
import { homeSectionHref, listReels, reelPath, REELS_PAGE_SIZE, type Reel } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { CommentsSection } from "@/components/posts/comments-section";
import { ReelCard, reelKey, toggleReelSound } from "./reel-card";

export type ReelsFeedProps = {
  initial: Reel[];
  /** The university the feed is limited to; null shows every university. */
  universityId: string | null;
  /** The viewer has a university of their own to go back to from "All universities". */
  hasHomeUniversity?: boolean;
  signedIn: boolean;
  currentUserId: string | null;
  currentUser: { id: string; name: string; avatarUrl: string | null } | null;
};

/**
 * The feed fills what is left of the screen under the navbar and the Home tabs.
 * `--reels-top` is measured in the browser (the fallback covers the first paint),
 * and the negative bottom margin eats the page's bottom padding so the page
 * itself never scrolls, only the reels do.
 */
const FEED_CSS = `
.ab-reels { height: calc(100dvh - var(--reels-top, 7.5rem) - 3.75rem - env(safe-area-inset-bottom, 0px)); min-height: 22rem; margin-bottom: -2.25rem; scrollbar-width: none; overscroll-behavior: contain; }
.ab-reels::-webkit-scrollbar { display: none; }
@media (min-width: 768px) { .ab-reels { height: calc(100dvh - var(--reels-top, 7.5rem) - 1rem); margin-bottom: -1rem; } }
`;

/** Home → Reels: one reel per screen, snap scrolling, only the reel in view plays. */
export function ReelsFeed({ initial, universityId, hasHomeUniversity, signedIn, currentUserId, currentUser }: ReelsFeedProps) {
  const [items, setItems] = useState<Reel[]>(initial);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(initial.length < REELS_PAGE_SIZE);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  /** How many rows we have asked the server for so far (rows without a playable video are dropped, so this is not items.length). */
  const offset = useRef(REELS_PAGE_SIZE);

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await listReels(createClient(), { universityId: universityId ?? undefined, offset: offset.current });
      offset.current += REELS_PAGE_SIZE;
      if (next.length < REELS_PAGE_SIZE) setDone(true);
      setItems((prev) => {
        const seen = new Set(prev.map(reelKey));
        return [...prev, ...next.filter((r) => !seen.has(reelKey(r)))];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more reels.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [universityId]);

  // Measure where the feed starts so it ends exactly at the bottom of the screen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => el.style.setProperty("--reels-top", `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // The reel that is mostly on screen is the one that plays.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll("[data-reel]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items.length]);

  // Fetch the next page while there are still a few reels left to watch.
  useEffect(() => {
    const root = containerRef.current;
    const el = sentinelRef.current;
    if (!root || !el || done || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root, rootMargin: "0px 0px 300% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, done, error, items.length]);

  const goTo = useCallback((index: number) => {
    const root = containerRef.current;
    const el = root?.querySelectorAll<HTMLElement>("[data-reel]")[index];
    if (root && el) root.scrollTo({ top: el.offsetTop, behavior: "smooth" });
  }, []);

  // Arrow keys or j / k move between reels, m toggles sound. Not while typing or while the comments are open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || commentsFor) return;
      // Nor while a dialog is open over the feed (the share sheet): its keys are its own, even if the focus slips out of it.
      if (document.querySelector('[aria-modal="true"]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        goTo(active + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        goTo(active - 1);
      } else if (e.key === "m") {
        toggleReelSound();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, commentsFor, goTo]);

  // Same switch Posts and Buzz have: my campus ↔ every campus.
  const scopeLink = universityId ? { href: homeSectionHref("reels", { university: "all" }), label: "All universities" } : hasHomeUniversity ? { href: homeSectionHref("reels"), label: "My university" } : null;

  if (items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[500px]">
        <EmptyState
          icon={Clapperboard}
          title="No reels yet"
          description={universityId ? "Nobody at your university has posted a video yet. Be the first, or see what other campuses are sharing." : "Short videos from students and video tours of listings show up here."}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <LinkButton href="/reels/new">
                <Plus className="h-5 w-5" /> Post the first reel
              </LinkButton>
              {scopeLink ? (
                <LinkButton href={scopeLink.href} variant="secondary">
                  {universityId ? "See all universities" : "Back to my university"}
                </LinkButton>
              ) : null}
            </div>
          }
        />
      </div>
    );
  }

  const open = commentsFor ? (items.find((r) => reelKey(r) === commentsFor) ?? null) : null;

  return (
    <div className="relative -mx-3 sm:mx-0">
      <style href="ab-reels-feed" precedence="default">
        {FEED_CSS}
      </style>
      <div ref={containerRef} className="ab-reels relative snap-y snap-mandatory overflow-y-auto bg-black sm:bg-transparent" data-testid="reels-feed">
        {items.map((reel, i) => (
          <ReelCard
            key={reelKey(reel)}
            reel={reel}
            index={i}
            active={i === active}
            near={Math.abs(i - active) <= 1}
            signedIn={signedIn}
            currentUserId={currentUserId}
            commentCount={reel.comments}
            scopeLink={scopeLink}
            onOpenComments={() => setCommentsFor(reelKey(reel))}
          />
        ))}
        <div ref={sentinelRef} className="h-px w-full" aria-hidden />
      </div>

      {loading ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
            <Spinner className="h-3.5 w-3.5" /> Loading more reels
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-x-0 bottom-3 z-30 flex justify-center">
          <button type="button" onClick={() => void loadMore()} className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/80">
            Could not load more reels. Tap to retry
          </button>
        </div>
      ) : null}

      <div className="absolute right-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-2 md:flex">
        <button type="button" onClick={() => goTo(active - 1)} disabled={active === 0} aria-label="Previous reel" className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-800 shadow ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-40">
          <ChevronUp className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => goTo(active + 1)} disabled={active >= items.length - 1} aria-label="Next reel" className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-800 shadow ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-40">
          <ChevronDown className="h-5 w-5" />
        </button>
      </div>

      {open ? (
        <CommentsDrawer
          key={reelKey(open)}
          reel={open}
          currentUser={currentUser}
          onClose={() => setCommentsFor(null)}
          onCountChange={(delta) => setItems((prev) => prev.map((r) => (reelKey(r) === reelKey(open) ? { ...r, comments: Math.max(0, r.comments + delta) } : r)))}
        />
      ) : null}
    </div>
  );
}

/** Comments for one reel: a panel on the right on desktop, a sheet from the bottom on phones. */
function CommentsDrawer({
  reel,
  currentUser,
  onClose,
  onCountChange,
}: {
  reel: Reel;
  currentUser: ReelsFeedProps["currentUser"];
  onClose: () => void;
  onCountChange: (delta: number) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Comments">
      <button type="button" aria-label="Close comments" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-black/40 md:bg-black/20" />
      <div className="ab-fade-in absolute inset-x-0 bottom-0 flex max-h-[75dvh] min-h-[50dvh] flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[400px] md:rounded-none md:rounded-l-2xl">
        {/* The thread's own "N comments" line, which stays put under this bar while the comments scroll, is the title; this bar only says which reel and closes the sheet. */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
          <p className="min-w-0 truncate text-xs text-gray-500">
            {reel.title ?? `Reel by ${reel.author.name}`}
            {reel.sourceType !== "post" ? (
              <>
                {" · "}
                <Link href={reelPath(reel)} className="font-semibold text-brand-700 hover:underline">
                  View listing
                </Link>
              </>
            ) : null}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* A flex column, so a short thread still stretches and the composer sits at the bottom of the sheet. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <CommentsSection
            targetType={reel.sourceType}
            targetId={reel.sourceId}
            totalComments={reel.comments}
            onCountChange={onCountChange}
            currentUser={currentUser}
            ownerId={reel.author.id}
            composer="bottom"
            className="flex-1 border-t-0"
          />
        </div>
      </div>
    </div>
  );
}

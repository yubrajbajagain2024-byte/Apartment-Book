"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, VenetianMask } from "lucide-react";
import { forYouKey, getPostEngagementMany, getPostPreviewsMany, homeSectionHref, listForYou, type BuzzTopic, type ForYouFilters, type ForYouItem, type PostEngagement, type PostPreview } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedFooter, SkeletonCard } from "@/components/feed/feed-bits";
import { BuzzRow } from "./buzz-card";
import { InstaPost } from "./insta-post";

export type ForYouFeedProps = {
  initial: ForYouItem[];
  hasMore: boolean;
  filters: Omit<ForYouFilters, "page">;
  savedIds: string[];
  signedIn: boolean;
  currentUserId: string | null;
  currentUser: { id: string; name: string; avatarUrl: string | null } | null;
  /** Like/comment counts for the posts and reels of the first page (server-rendered); later pages are fetched here. */
  engagement: Record<string, PostEngagement>;
  /** "Liked by …" faces and the newest comment, same rule. */
  previews: Record<string, PostPreview>;
  /** Which campus the feed is showing, for the "All universities" switch. */
  scope?: { universityName: string | null; hasHomeUniversity: boolean };
  /** University id -> name, shown under the author when browsing every campus. */
  universityNames?: Record<string, string>;
};

function dedupe(prev: ForYouItem[], next: ForYouItem[]): ForYouItem[] {
  const seen = new Set(prev.map(forYouKey));
  return [...prev, ...next.filter((item) => !seen.has(forYouKey(item)))];
}

/** Home → For you: posts, reels and anonymous Buzz threads from students, blended into one column (see blendForYou). */
export function ForYouFeed({ initial, hasMore: initialHasMore, filters, savedIds, signedIn, currentUserId, currentUser, engagement: initialEngagement, previews: initialPreviews, scope, universityNames }: ForYouFeedProps) {
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engagement, setEngagement] = useState(initialEngagement);
  const [previews, setPreviews] = useState(initialPreviews);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const page = useRef(1);
  const saved = new Set(savedIds);
  // Only posts and reels have likes and comments to fetch; a Buzz thread brings its own numbers.
  const posts = useMemo(() => items.flatMap((item) => (item.type === "post" ? [item.post] : [])), [items]);

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await listForYou(createClient(), { ...filters, page: page.current + 1 });
      page.current = next.page;
      setItems((prev) => dedupe(prev, next.items));
      setHasMore(next.hasMore);
    } catch {
      setError("Could not load more");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  // Counts for posts that arrived through "load more".
  useEffect(() => {
    const missing = posts.filter((p) => !(p.id in engagement)).map((p) => p.id);
    if (missing.length === 0) return;
    let cancelled = false;
    getPostEngagementMany(createClient(), "post", missing)
      .then((rows) => {
        if (cancelled) return;
        // Remember ids that came back empty too, so they are not asked for again.
        const filled: Record<string, PostEngagement> = {};
        for (const id of missing) filled[id] = rows[id] ?? { likes: 0, comments: 0, likedByMe: false };
        setEngagement((prev) => ({ ...prev, ...filled }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [posts, engagement]);

  // The same for the "Liked by …" line and the newest comment.
  useEffect(() => {
    const missing = posts.filter((p) => !(p.id in previews)).map((p) => p.id);
    if (missing.length === 0) return;
    let cancelled = false;
    getPostPreviewsMany(createClient(), "post", missing)
      .then((rows) => {
        if (cancelled) return;
        const filled: Record<string, PostPreview> = {};
        for (const id of missing) filled[id] = rows[id] ?? { likers: [], lastComment: null };
        setPreviews((prev) => ({ ...prev, ...filled }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [posts, previews]);

  const filtered = Boolean(filters.universityId);
  const everyCampus = homeSectionHref("foryou", { university: "all" });
  // A topic opens the Buzz tab with the same campus choice as this feed.
  const topicHref = (topic: BuzzTopic) => homeSectionHref("buzz", { topic, university: filtered ? undefined : scope?.hasHomeUniversity ? "all" : undefined });

  /** A deleted or hidden thread just leaves the list. */
  function onRemoved(id: string) {
    setItems((prev) => prev.filter((item) => item.type !== "buzz" || item.post.id !== id));
  }

  return (
    <div className="-mx-3 flex flex-col bg-white sm:mx-0 sm:gap-4 sm:bg-transparent" data-testid="for-you-feed">
      {filtered || scope?.hasHomeUniversity ? (
        <p className="px-3 pt-2 text-xs text-gray-600 sm:px-1 sm:pt-0">
          Showing posts, reels and Buzz from {filtered ? (scope?.universityName ?? "your university") : "all universities"} ·{" "}
          <Link href={filtered ? everyCampus : homeSectionHref("foryou")} scroll={false} className="font-semibold text-brand-700 hover:underline">
            {filtered ? "All universities" : "My university"}
          </Link>
        </p>
      ) : null}

      {items.length === 0 && !hasMore ? (
        <div className="px-3 sm:px-0">
          <EmptyState
            icon={Sparkles}
            title="Nothing here yet"
            description="Posts, reels and Buzz threads from students show up here."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {filtered ? (
                  <LinkButton href={everyCampus} variant="secondary">
                    Show all universities
                  </LinkButton>
                ) : null}
                <LinkButton href="/posts/new">Write a post</LinkButton>
                <LinkButton href="/buzz/new" variant="secondary">
                  Start a Buzz thread
                </LinkButton>
              </div>
            }
          />
        </div>
      ) : (
        <>
          {items.map((item, i) =>
            item.type === "post" ? (
              <InstaPost
                key={forYouKey(item)}
                post={item.post}
                saved={saved.has(item.post.id)}
                signedIn={signedIn}
                currentUserId={currentUserId}
                currentUser={currentUser}
                engagement={engagement[item.post.id]}
                preview={previews[item.post.id]}
                subtitle={!filtered && item.post.university_id ? universityNames?.[item.post.university_id] : undefined}
                priority={i < 2}
              />
            ) : (
              // Flush between the posts on a phone, set off by hairlines (one, even between two threads); its own card on a desktop.
              <section key={forYouKey(item)} className="border-y border-gray-200 bg-white [&+&]:border-t-0 sm:rounded-xl sm:border-y-0 sm:ring-1 sm:ring-gray-200 sm:[&>article]:rounded-b-xl" data-testid="for-you-buzz">
                <p className="flex items-center gap-1.5 px-4 pt-2.5 text-xs text-gray-500">
                  <VenetianMask className="h-4 w-4" /> Buzz · anonymous
                </p>
                <BuzzRow post={item.post} signedIn={signedIn} priority={i < 3} onRemoved={onRemoved} topicHref={topicHref} />
              </section>
            ),
          )}
          {loading ? <SkeletonCard aspect="aspect-[4/5]" lines={3} /> : null}
          <FeedFooter sentinelRef={sentinelRef} loading={loading} done={!hasMore} error={error} onRetry={loadMore} count={items.length} />
        </>
      )}
    </div>
  );
}

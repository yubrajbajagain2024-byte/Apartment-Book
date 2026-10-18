"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getPostEngagementMany, getPostPreviewsMany, homeSectionHref, listForYou, type ForYouFilters, type ForYouItem, type PostEngagement, type PostPreview } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedFooter, PostSkeleton } from "@/components/feed/feed-bits";
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

/** Posts and reels share one table, so the id alone tells rows apart. */
function dedupe(prev: ForYouItem[], next: ForYouItem[]): ForYouItem[] {
  const seen = new Set(prev.map((post) => post.id));
  return [...prev, ...next.filter((post) => !seen.has(post.id))];
}

/** Home → For you: posts and reels from students, blended into one column (see blendForYou). Anonymous Buzz threads stay on the Buzz tab. */
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
    const missing = items.filter((p) => !(p.id in engagement)).map((p) => p.id);
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
  }, [items, engagement]);

  // The same for the "Liked by …" line and the newest comment.
  useEffect(() => {
    const missing = items.filter((p) => !(p.id in previews)).map((p) => p.id);
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
  }, [items, previews]);

  const filtered = Boolean(filters.universityId);
  const everyCampus = homeSectionHref("foryou", { university: "all" });

  return (
    <div className="-mx-3 flex flex-col bg-white sm:mx-0 sm:gap-4 sm:bg-transparent" data-testid="for-you-feed">
      {filtered || scope?.hasHomeUniversity ? (
        <p className="px-3 pt-2.5 text-xs text-gray-500 sm:px-1 sm:pt-0">
          Showing posts and reels from {filtered ? (scope?.universityName ?? "your university") : "all universities"} ·{" "}
          <Link href={filtered ? everyCampus : homeSectionHref("foryou")} scroll={false} className="font-semibold text-gray-900 underline decoration-gray-300 underline-offset-2 transition-colors hover:decoration-gray-900">
            {filtered ? "All universities" : "My university"}
          </Link>
        </p>
      ) : null}

      {items.length === 0 && !hasMore ? (
        <div className="px-3 sm:px-0">
          <EmptyState
            icon={Sparkles}
            title="Nothing here yet"
            description="Posts and reels from students show up here."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {filtered ? (
                  <LinkButton href={everyCampus} variant="secondary">
                    Show all universities
                  </LinkButton>
                ) : null}
                <LinkButton href="/posts/new">Write a post</LinkButton>
              </div>
            }
          />
        </div>
      ) : (
        <>
          {items.map((post, i) => (
            <InstaPost
              key={post.id}
              post={post}
              saved={saved.has(post.id)}
              signedIn={signedIn}
              currentUserId={currentUserId}
              currentUser={currentUser}
              engagement={engagement[post.id]}
              preview={previews[post.id]}
              subtitle={!filtered && post.university_id ? universityNames?.[post.university_id] : undefined}
              priority={i < 2}
            />
          ))}
          {loading ? <PostSkeleton /> : null}
          <FeedFooter sentinelRef={sentinelRef} loading={loading} done={!hasMore} error={error} onRetry={loadMore} count={items.length} />
        </>
      )}
    </div>
  );
}

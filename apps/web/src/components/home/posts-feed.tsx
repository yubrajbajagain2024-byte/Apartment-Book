"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Newspaper, UserPlus } from "lucide-react";
import { getPostEngagementMany, getPostPreviewsMany, homeSectionHref, listFeedPosts, type FeedPostFilters, type FeedPostWithAuthor, type PostCommentWithAuthor, type PostEngagement, type PostPreview } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedFooter, SkeletonCard } from "@/components/feed/feed-bits";
import { useInfinitePages } from "@/components/feed/use-infinite-pages";
import { InstaPost } from "./insta-post";

export type PostsFeedProps = {
  initial: FeedPostWithAuthor[];
  totalPages: number;
  filters: FeedPostFilters;
  savedIds: string[];
  signedIn: boolean;
  currentUserId: string | null;
  currentUser: { id: string; name: string; avatarUrl: string | null } | null;
  /** Like/comment counts for the first page (server-rendered); later pages are fetched here. */
  engagement: Record<string, PostEngagement>;
  /** "Liked by …" faces and the newest comment, same rule. */
  previews: Record<string, PostPreview>;
  /** Which campus the feed is showing, for the "All universities" switch. */
  scope?: { universityName: string | null; hasHomeUniversity: boolean };
  /** University id -> name, shown under the author when browsing every campus. */
  universityNames?: Record<string, string>;
};

/** One Home-feed post (or reel), Instagram style. Shared by the feed, the post page, Saved and profiles. */
export function FeedPostCard({
  post,
  saved,
  signedIn,
  currentUserId,
  currentUser,
  engagement,
  preview,
  subtitle,
  priority,
  commentsOpen,
  initialComments,
}: {
  post: FeedPostWithAuthor;
  saved: boolean;
  signedIn: boolean;
  currentUserId: string | null;
  currentUser: PostsFeedProps["currentUser"];
  engagement?: PostEngagement;
  preview?: PostPreview;
  subtitle?: string;
  priority?: boolean;
  commentsOpen?: boolean;
  initialComments?: PostCommentWithAuthor[];
}) {
  return (
    <InstaPost
      post={post}
      saved={saved}
      signedIn={signedIn}
      currentUserId={currentUserId}
      currentUser={currentUser}
      engagement={engagement}
      preview={preview}
      subtitle={subtitle}
      priority={priority}
      commentsOpen={commentsOpen}
      initialComments={initialComments}
    />
  );
}

/** Home → Posts: a single column of posts by students, newest first. New posts are made from "Create" in the top bar. */
export function PostsFeed({ initial, totalPages, filters, savedIds, signedIn, currentUserId, currentUser, engagement: initialEngagement, previews: initialPreviews, scope, universityNames }: PostsFeedProps) {
  const load = useCallback(async (page: number) => (await listFeedPosts(createClient(), { ...filters, page })).data, [filters]);
  const feed = useInfinitePages({ initial, totalPages, load });
  const saved = new Set(savedIds);
  const [engagement, setEngagement] = useState(initialEngagement);
  const [previews, setPreviews] = useState(initialPreviews);

  // Counts for posts that arrived through "load more".
  useEffect(() => {
    const missing = feed.items.filter((p) => !(p.id in engagement)).map((p) => p.id);
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
  }, [feed.items, engagement]);

  // The same for the "Liked by …" line and the newest comment.
  useEffect(() => {
    const missing = feed.items.filter((p) => !(p.id in previews)).map((p) => p.id);
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
  }, [feed.items, previews]);

  const filtered = Boolean(filters.universityId);
  const following = Boolean(filters.following);
  // The campus as the address says it (nothing = my university, "all" = every campus) survives the Everyone | Following switch, and the switch survives the campus links.
  const university = filtered ? undefined : "all";
  const feedParam = following ? "following" : undefined;
  // Same pill as the Buzz topics.
  const pill = "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold transition-colors";

  return (
    <div className="-mx-3 flex flex-col bg-white sm:mx-0 sm:gap-4 sm:bg-transparent" data-testid="posts-feed">
      {signedIn ? (
        <div role="group" aria-label="Whose posts" className="flex gap-1.5 px-3 pt-2 sm:px-0 sm:pt-0" data-testid="posts-feed-switch">
          <Link href={homeSectionHref("posts", { university })} scroll={false} aria-current={following ? undefined : "page"} className={cn(pill, following ? "bg-gray-100 text-gray-800 hover:bg-gray-200" : "bg-gray-900 text-white")}>
            Everyone
          </Link>
          <Link href={homeSectionHref("posts", { university, feed: "following" })} scroll={false} aria-current={following ? "page" : undefined} className={cn(pill, following ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800 hover:bg-gray-200")}>
            Following
          </Link>
        </div>
      ) : null}
      {filtered || scope?.hasHomeUniversity ? (
        <p className="px-3 pt-2 text-xs text-gray-600 sm:px-1 sm:pt-0">
          {filtered ? (
            <>
              Showing posts from {scope?.universityName ?? "your university"} ·{" "}
              <Link href={homeSectionHref("posts", { university: "all", feed: feedParam })} scroll={false} className="font-semibold text-brand-700 hover:underline">
                All universities
              </Link>
            </>
          ) : (
            <>
              Showing posts from all universities ·{" "}
              <Link href={homeSectionHref("posts", { feed: feedParam })} scroll={false} className="font-semibold text-brand-700 hover:underline">
                My university
              </Link>
            </>
          )}
        </p>
      ) : null}

      {feed.items.length === 0 ? (
        <div className="px-3 sm:px-0">
          {following ? (
            <EmptyState
              icon={UserPlus}
              title="Nothing from the people you follow yet"
              description="Follow someone from their profile and their posts show up here."
              action={
                <LinkButton href={homeSectionHref("posts", { university })} variant="secondary">
                  Show everyone
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={Newspaper}
              title="No posts yet"
              description={filtered ? "Nobody at your university has posted yet. Be the first, or look at every campus." : "Be the first to share something."}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {filtered ? (
                    <LinkButton href={homeSectionHref("posts", { university: "all" })} variant="secondary">
                      Show all universities
                    </LinkButton>
                  ) : null}
                  <LinkButton href="/posts/new">Write a post</LinkButton>
                </div>
              }
            />
          )}
        </div>
      ) : (
        <>
          {feed.items.map((p, i) => (
            <FeedPostCard
              key={p.id}
              post={p}
              saved={saved.has(p.id)}
              signedIn={signedIn}
              currentUserId={currentUserId}
              currentUser={currentUser}
              engagement={engagement[p.id]}
              preview={previews[p.id]}
              subtitle={!filtered && p.university_id ? universityNames?.[p.university_id] : undefined}
              priority={i < 2}
            />
          ))}
          {feed.loading ? <SkeletonCard aspect="aspect-[4/5]" lines={3} /> : null}
          <FeedFooter sentinelRef={feed.sentinelRef} loading={feed.loading} done={feed.done} error={feed.error} onRetry={feed.loadMore} count={feed.items.length} />
        </>
      )}
    </div>
  );
}

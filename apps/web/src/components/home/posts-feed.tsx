"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Newspaper } from "lucide-react";
import { getPostEngagementMany, isVerifiedPoster, listFeedPosts, listingMedia, type FeedPostFilters, type FeedPostWithAuthor, type PostEngagement } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PostCard } from "@/components/posts/post-card";
import { FeedFooter, SkeletonCard } from "@/components/feed/feed-bits";
import { useInfinitePages } from "@/components/feed/use-infinite-pages";
import { PostComposer } from "./post-composer";

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
  /** Which campus the feed is showing, for the "All universities" switch. */
  scope?: { universityName: string | null; hasHomeUniversity: boolean };
  /** University id -> name, shown under the author when browsing every campus. */
  universityNames?: Record<string, string>;
};

/** One Home-feed post (or reel) as a Facebook-style card. Shared by the feed, the post page, Saved and profiles. */
export function FeedPostCard({
  post,
  saved,
  signedIn,
  currentUserId,
  currentUser,
  engagement,
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
  subtitle?: string;
  priority?: boolean;
  commentsOpen?: boolean;
  initialComments?: React.ComponentProps<typeof PostCard>["initialComments"];
}) {
  return (
    <PostCard
      layout="facebook"
      href={`/posts/${post.id}`}
      targetType="post"
      targetId={post.id}
      poster={{ id: post.author.id, name: post.author.full_name, avatarUrl: post.author.avatar_url, verified: isVerifiedPoster(post.author) }}
      subtitle={subtitle}
      media={listingMedia(post.images, post.image_meta, post.videos)}
      caption={post.body}
      createdAt={post.created_at}
      saved={saved}
      signedIn={signedIn}
      currentUserId={currentUserId}
      currentUser={currentUser}
      engagement={engagement}
      messagePrefill={`Hi ${post.author.full_name.split(" ")[0]}! I saw your post on Apartment Book and wanted to say hi.`}
      priority={priority}
      commentsOpen={commentsOpen}
      initialComments={initialComments}
    />
  );
}

/** Home → Posts: a single column of posts by students, newest first. */
export function PostsFeed({ initial, totalPages, filters, savedIds, signedIn, currentUserId, currentUser, engagement: initialEngagement, scope, universityNames }: PostsFeedProps) {
  const load = useCallback(async (page: number) => (await listFeedPosts(createClient(), { ...filters, page })).data, [filters]);
  const feed = useInfinitePages({ initial, totalPages, load });
  const saved = new Set(savedIds);
  const [engagement, setEngagement] = useState(initialEngagement);

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

  const filtered = Boolean(filters.universityId);

  return (
    <div className="-mx-3 flex flex-col gap-1 sm:mx-0 sm:gap-4" data-testid="posts-feed">
      <PostComposer currentUser={currentUser} />

      {filtered || scope?.hasHomeUniversity ? (
        <p className="px-3 text-xs text-gray-600 sm:px-1">
          {filtered ? (
            <>
              Showing posts from {scope?.universityName ?? "your university"} ·{" "}
              <Link href="/?university=all" scroll={false} className="font-semibold text-brand-700 hover:underline">
                All universities
              </Link>
            </>
          ) : (
            <>
              Showing posts from all universities ·{" "}
              <Link href="/" scroll={false} className="font-semibold text-brand-700 hover:underline">
                My university
              </Link>
            </>
          )}
        </p>
      ) : null}

      {feed.items.length === 0 ? (
        <div className="px-3 sm:px-0">
          <EmptyState
            icon={Newspaper}
            title="No posts yet"
            description={filtered ? "Nobody at your university has posted yet. Be the first, or look at every campus." : "Be the first to share something."}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {filtered ? (
                  <LinkButton href="/?university=all" variant="secondary">
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
          {feed.items.map((p, i) => (
            <FeedPostCard
              key={p.id}
              post={p}
              saved={saved.has(p.id)}
              signedIn={signedIn}
              currentUserId={currentUserId}
              currentUser={currentUser}
              engagement={engagement[p.id]}
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

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { getFeedPost, getPostEngagement, getPostPreviewsMany, homeSectionHref, isSaved, listComments, photosFor, type PostCommentWithAuthor, type PostEngagement, type PostPreview } from "@apartment-book/shared";
import { deletePostAction } from "@/lib/actions/posts";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ConfirmButton } from "@/components/common/confirm-button";
import { FeedPostCard } from "@/components/home/posts-feed";
import { ViewTracker } from "@/components/stats/view-tracker";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = UUID.test(id) ? await getFeedPost(await createClient(), id).catch(() => null) : null;
  if (!post) return { title: "Post not found" };
  const text = post.body.trim();
  const label = post.kind === "reel" ? "Reel" : "Post";
  const cover = photosFor(post.images, post.image_meta)[0]?.url;
  return {
    title: text ? `${post.author.full_name}: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}` : `${label} by ${post.author.full_name}`,
    description: text ? text.slice(0, 160) : `${label} by ${post.author.full_name}`,
    openGraph: cover ? { images: [cover] } : undefined,
  };
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [post, user, profile] = await Promise.all([getFeedPost(supabase, id), getCurrentUser(), getCurrentProfile()]);
  if (!post) notFound();

  const [engagement, comments, saved, previews] = await Promise.all([
    getPostEngagement(supabase, "post", post.id).catch(() => NO_ENGAGEMENT),
    listComments(supabase, "post", post.id).catch(() => [] as PostCommentWithAuthor[]),
    user ? isSaved(supabase, user.id, "post", post.id).catch(() => false) : Promise.resolve(false),
    getPostPreviewsMany(supabase, "post", [post.id]).catch(() => ({}) as Record<string, PostPreview>),
  ]);
  const isOwner = user?.id === post.author_id;
  const reel = post.kind === "reel";

  return (
    <div className="mx-auto flex w-full max-w-[500px] flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Link href={homeSectionHref(reel ? "reels" : "posts")} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back to {reel ? "reels" : "posts"}
        </Link>
        {isOwner ? (
          <ConfirmButton variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" confirmText={`Delete this ${reel ? "reel" : "post"}? This cannot be undone.`} action={deletePostAction.bind(null, post.id)}>
            <Trash2 className="h-4 w-4" /> Delete
          </ConfirmButton>
        ) : null}
      </div>

      <ViewTracker targetType="post" targetId={post.id} />
      <div className="-mx-3 sm:mx-0">
        <FeedPostCard
          post={post}
          saved={saved}
          signedIn={Boolean(user)}
          currentUserId={user?.id ?? null}
          currentUser={user && profile ? { id: user.id, name: profile.full_name, avatarUrl: profile.avatar_url } : null}
          engagement={engagement}
          preview={previews[post.id]}
          subtitle={post.university?.name}
          priority
          commentsOpen
          initialComments={comments}
        />
      </div>
    </div>
  );
}

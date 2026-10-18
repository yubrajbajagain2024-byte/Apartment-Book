import type { Metadata } from "next";
import { createPostAction } from "@/lib/actions/posts";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { PostForm } from "@/components/home/post-form";

export const metadata: Metadata = { title: "Create post" };

export default async function NewPostPage() {
  const user = await requireUser("/posts/new");
  const profile = await getCurrentProfile();
  const name = profile?.full_name || user.email?.split("@")[0] || "You";
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl tracking-tight text-gray-900">Create a post</h1>
        <p className="mt-1 text-sm text-gray-500">Share news, a question or a moment with other students.</p>
      </div>
      <PostForm action={createPostAction} userId={user.id} author={{ name, avatarUrl: profile?.avatar_url ?? null }} defaultUniversityId={profile?.university_id} />
    </div>
  );
}

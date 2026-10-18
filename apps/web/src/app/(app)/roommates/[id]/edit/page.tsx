import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getRoommatePost, listUniversities } from "@apartment-book/shared";
import { updateRoommatePostAction } from "@/lib/actions/roommates";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RoommateForm } from "@/components/roommates/roommate-form";

export const metadata: Metadata = { title: "Edit roommate post" };

export default async function EditRoommatePostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/roommates/${id}/edit`);
  const supabase = await createClient();
  const [post, universities] = await Promise.all([getRoommatePost(supabase, id), listUniversities(supabase)]);
  if (!post) notFound();
  if (post.author_id !== user.id) redirect(`/roommates/${id}`);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-3xl tracking-tight text-gray-900">Edit roommate post</h1>
      <RoommateForm action={updateRoommatePostAction.bind(null, id)} universities={universities} userId={user.id} initial={post} />
    </div>
  );
}

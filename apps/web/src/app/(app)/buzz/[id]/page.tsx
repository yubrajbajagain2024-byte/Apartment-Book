import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBuzz, listBuzzComments, type BuzzComment } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BuzzThread } from "@/components/home/buzz-thread";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Buzz is anonymous: the page title is the thread title and nothing else.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = UUID.test(id) ? await getBuzz(await createClient(), id).catch(() => null) : null;
  return { title: post ? post.title : "Thread not found" };
}

export default async function BuzzThreadPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [post, user] = await Promise.all([getBuzz(supabase, id), getCurrentUser()]);
  if (!post) notFound();
  const comments = await listBuzzComments(supabase, post.id).catch(() => [] as BuzzComment[]);

  return (
    // The thread brings its own Reddit-style header (close, search, options).
    <div className="mx-auto w-full max-w-[500px]">
      <BuzzThread key={post.id} post={post} comments={comments} signedIn={Boolean(user)} />
    </div>
  );
}

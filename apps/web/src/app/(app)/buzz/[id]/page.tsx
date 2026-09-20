import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
    <div className="mx-auto flex w-full max-w-[500px] flex-col gap-3">
      <Link href="/?tab=buzz" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Buzz
      </Link>
      <BuzzThread key={post.id} post={post} comments={comments} signedIn={Boolean(user)} />
    </div>
  );
}

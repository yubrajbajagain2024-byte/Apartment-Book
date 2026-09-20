"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createFeedPost, deleteFeedPost, feedPostSchema, flattenZodError, getFeedPost } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

const ARRAY_FIELDS = ["images", "imageMeta", "videos"];

export async function createPostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/posts/new");
  const parsed = feedPostSchema.safeParse(formToObject(formData, ARRAY_FIELDS));
  if (!parsed.success) {
    const fieldErrors = flattenZodError(parsed.error).fieldErrors;
    return { error: fieldErrors.body?.[0] ?? "Please fix the highlighted fields.", fieldErrors, values: formValues(formData) };
  }
  let id: string;
  try {
    const post = await createFeedPost(await createClient(), user.id, parsed.data);
    id = post.id;
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/");
  redirect(`/posts/${id}`);
}

/** Deletes one of your own posts or reels, then goes back to the tab it lived in. */
export async function deletePostAction(id: string): Promise<void> {
  const user = await requireUser(`/posts/${id}`);
  const supabase = await createClient();
  const existing = await getFeedPost(supabase, id);
  if (!existing || existing.author_id !== user.id) redirect(`/posts/${id}`);
  await deleteFeedPost(supabase, id);
  revalidatePath("/");
  revalidatePath(`/profile/${user.id}`);
  redirect(existing.kind === "reel" ? "/?tab=reels" : "/");
}

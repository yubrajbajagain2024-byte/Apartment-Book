"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addBuzzComment, buzzCommentSchema, buzzPostSchema, createBuzz, deleteBuzz, deleteBuzzComment, flattenZodError, listBuzzComments, muteBuzzAuthor, voteBuzz, voteBuzzComment, type BuzzComment } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

// Buzz is anonymous. Nothing in this file returns, logs or stores who wrote a thread or a reply.

const ARRAY_FIELDS = ["images", "imageMeta", "videos"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createBuzzAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/buzz/new");
  if (formData.get("photosUploading")) return { error: "Your photos are still uploading. Wait a moment, then post again.", values: formValues(formData) };
  const raw = formToObject(formData, ARRAY_FIELDS);
  // The campus comes from the account, never from the form.
  const profile = await getCurrentProfile();
  const parsed = buzzPostSchema.safeParse({ ...raw, universityId: profile?.university_id ?? undefined });
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  let id: string;
  try {
    id = await createBuzz(await createClient(), user.id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/");
  redirect(`/buzz/${id}`);
}

export type BuzzVoteResult = { score: number; myVote: -1 | 0 | 1 } | { error: string };

export async function voteBuzzAction(postId: string, value: -1 | 0 | 1): Promise<BuzzVoteResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to vote." };
  if (!UUID.test(postId) || ![-1, 0, 1].includes(value)) return { error: "Could not save your vote." };
  try {
    return await voteBuzz(await createClient(), postId, value);
  } catch (error) {
    return { error: errorMessage(error, "Could not save your vote.") };
  }
}

/** Up or down vote on a reply. 0 clears your vote. */
export async function voteBuzzCommentAction(commentId: string, value: -1 | 0 | 1): Promise<BuzzVoteResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to vote." };
  if (!UUID.test(commentId) || ![-1, 0, 1].includes(value)) return { error: "Could not save your vote." };
  try {
    return await voteBuzzComment(await createClient(), commentId, value);
  } catch (error) {
    return { error: errorMessage(error, "Could not save your vote.") };
  }
}

/**
 * Adds an anonymous reply and returns the fresh list (the new reply comes back with its alias).
 * `parentId` is the reply being answered; leave it out to answer the thread itself.
 */
export async function addBuzzCommentAction(postId: string, body: string, parentId?: string | null): Promise<{ error?: string; comments?: BuzzComment[] }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to reply." };
  if (!UUID.test(postId) || (parentId != null && !UUID.test(parentId))) return { error: "Could not post your reply." };
  const parsed = buzzCommentSchema.safeParse({ body });
  if (!parsed.success) return { error: flattenZodError(parsed.error).fieldErrors.body?.[0] ?? "Write a reply" };
  try {
    const supabase = await createClient();
    await addBuzzComment(supabase, user.id, postId, parsed.data.body, parentId ?? null);
    const comments = await listBuzzComments(supabase, postId);
    revalidatePath(`/buzz/${postId}`);
    return { comments };
  } catch (error) {
    return { error: errorMessage(error, "Could not post your reply.") };
  }
}

/** Your own reply, or any reply on your own thread. Returns the fresh list. */
export async function deleteBuzzCommentAction(postId: string, commentId: string): Promise<{ error?: string; comments?: BuzzComment[] }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in first." };
  if (!UUID.test(postId) || !UUID.test(commentId)) return { error: "Could not delete the reply." };
  try {
    const supabase = await createClient();
    await deleteBuzzComment(supabase, commentId);
    const comments = await listBuzzComments(supabase, postId);
    revalidatePath(`/buzz/${postId}`);
    return { comments };
  } catch (error) {
    return { error: errorMessage(error, "Could not delete the reply.") };
  }
}

/**
 * Only works on your own threads (the database enforces it).
 * Any revalidatePath makes Next re-render the page the action was called from. On the thread's own page that page
 * no longer exists, so "not found" would flash before the card sends the user back to Buzz. The thread page passes
 * `stayQuiet` and refreshes after it has navigated instead.
 */
export async function deleteBuzzAction(id: string, options?: { stayQuiet?: boolean }): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in first." };
  if (!UUID.test(id)) return { error: "Could not delete the thread." };
  try {
    await deleteBuzz(await createClient(), id);
    if (!options?.stayQuiet) revalidatePath("/");
    return {};
  } catch (error) {
    return { error: errorMessage(error, "Could not delete the thread.") };
  }
}

/** Hide one thread, or one person's replies inside one thread. Works without anyone learning who they are. */
export async function muteBuzzAuthorAction(target: { postId: string } | { commentId: string }, options?: { stayQuiet?: boolean }): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in first." };
  const id = "postId" in target ? target.postId : target.commentId;
  if (!UUID.test(id)) return { error: "Could not hide this." };
  try {
    await muteBuzzAuthor(await createClient(), "postId" in target ? { postId: target.postId } : { commentId: target.commentId });
    // Same reason as deleteBuzzAction: hiding a thread from its own page must not re-render that page.
    if (!options?.stayQuiet) revalidatePath("/");
    return {};
  } catch (error) {
    return { error: errorMessage(error, "Could not hide this.") };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createRoommatePost,
  deleteRoommatePost,
  flattenZodError,
  getRoommatePost,
  roommatePostSchema,
  setRoommatePostActive,
  updateRoommatePost,
} from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

const ARRAY_FIELDS = ["images", "imageMeta"];

export async function createRoommatePostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/roommates/new");
  const parsed = roommatePostSchema.safeParse(formToObject(formData, ARRAY_FIELDS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  let id: string;
  try {
    const post = await createRoommatePost(await createClient(), user.id, parsed.data);
    id = post.id;
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/roommates");
  redirect(`/roommates/${id}`);
}

export async function updateRoommatePostAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(`/roommates/${id}/edit`);
  const parsed = roommatePostSchema.safeParse(formToObject(formData, ARRAY_FIELDS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    const supabase = await createClient();
    const existing = await getRoommatePost(supabase, id);
    if (!existing || existing.author_id !== user.id) return { error: "You can only edit your own posts." };
    await updateRoommatePost(supabase, id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/roommates");
  revalidatePath(`/roommates/${id}`);
  redirect(`/roommates/${id}`);
}

export async function setRoommatePostActiveAction(id: string, isActive: boolean): Promise<void> {
  await requireUser(`/roommates/${id}`);
  await setRoommatePostActive(await createClient(), id, isActive);
  revalidatePath("/roommates");
  revalidatePath(`/roommates/${id}`);
}

export async function deleteRoommatePostAction(id: string): Promise<void> {
  await requireUser(`/roommates/${id}`);
  await deleteRoommatePost(await createClient(), id);
  revalidatePath("/roommates");
  redirect("/profile/me");
}

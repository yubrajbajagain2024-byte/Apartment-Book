"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createItem,
  deleteItem,
  flattenZodError,
  getItem,
  itemSchema,
  setItemStatus,
  updateItem,
  type ItemStatus,
} from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

const ARRAY_FIELDS = ["images", "imageMeta"];

export async function createItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/marketplace/new");
  const parsed = itemSchema.safeParse(formToObject(formData, ARRAY_FIELDS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  let id: string;
  try {
    const item = await createItem(await createClient(), user.id, parsed.data);
    id = item.id;
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/marketplace");
  redirect(`/marketplace/${id}`);
}

export async function updateItemAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(`/marketplace/${id}/edit`);
  const parsed = itemSchema.safeParse(formToObject(formData, ARRAY_FIELDS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    const supabase = await createClient();
    const existing = await getItem(supabase, id);
    if (!existing || existing.seller_id !== user.id) return { error: "You can only edit your own items." };
    await updateItem(supabase, id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/marketplace");
  revalidatePath(`/marketplace/${id}`);
  redirect(`/marketplace/${id}`);
}

export async function setItemStatusAction(id: string, status: ItemStatus): Promise<void> {
  await requireUser(`/marketplace/${id}`);
  await setItemStatus(await createClient(), id, status);
  revalidatePath("/marketplace");
  revalidatePath(`/marketplace/${id}`);
}

export async function deleteItemAction(id: string): Promise<void> {
  await requireUser(`/marketplace/${id}`);
  await deleteItem(await createClient(), id);
  revalidatePath("/marketplace");
  redirect("/profile/me");
}

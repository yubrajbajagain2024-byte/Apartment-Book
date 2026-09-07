"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  apartmentSchema,
  createApartment,
  deleteApartment,
  flattenZodError,
  getApartment,
  setApartmentStatus,
  updateApartment,
  type ListingStatus,
} from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

const ARRAY_FIELDS = ["amenities", "images", "imageMeta", "videos"];

export async function createApartmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/apartments/new");
  const parsed = apartmentSchema.safeParse(formToObject(formData, ARRAY_FIELDS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }

  let id: string;
  try {
    const supabase = await createClient();
    const apartment = await createApartment(supabase, user.id, parsed.data);
    id = apartment.id;
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }

  revalidatePath("/");
  redirect(`/apartments/${id}?posted=${parsed.data.videos.length > 0 ? "video" : "photo"}`);
}

export async function updateApartmentAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(`/apartments/${id}/edit`);
  const parsed = apartmentSchema.safeParse(formToObject(formData, ARRAY_FIELDS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }

  try {
    const supabase = await createClient();
    const existing = await getApartment(supabase, id);
    if (!existing || existing.owner_id !== user.id) return { error: "You can only edit your own listings." };
    await updateApartment(supabase, id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }

  revalidatePath("/");
  revalidatePath(`/apartments/${id}`);
  redirect(`/apartments/${id}`);
}

export async function setApartmentStatusAction(id: string, status: ListingStatus): Promise<void> {
  await requireUser(`/apartments/${id}`);
  const supabase = await createClient();
  await setApartmentStatus(supabase, id, status);
  revalidatePath("/");
  revalidatePath(`/apartments/${id}`);
}

export async function deleteApartmentAction(id: string): Promise<void> {
  await requireUser(`/apartments/${id}`);
  const supabase = await createClient();
  await deleteApartment(supabase, id);
  revalidatePath("/");
  redirect("/profile/me");
}

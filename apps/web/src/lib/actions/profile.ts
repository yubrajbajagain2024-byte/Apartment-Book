"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createUniversity, flattenZodError, profileSchema, universitySchema, updateProfile } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/settings/profile");
  const parsed = profileSchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await updateProfile(await createClient(), user.id, {
      fullName: parsed.data.fullName,
      universityId: parsed.data.universityId ?? null,
      program: parsed.data.program ?? null,
      graduationYear: parsed.data.graduationYear ?? null,
      bio: parsed.data.bio ?? null,
      avatarUrl: parsed.data.avatarUrl ?? null,
      notifyNearbyListings: parsed.data.notifyNearbyListings,
      showActiveStatus: parsed.data.showActiveStatus,
    });
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/", "layout");
  if (formData.get("redirectTo") === "home") redirect("/");
  return { success: "Profile saved." };
}

export async function addUniversityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser("/settings/profile");
  const parsed = universitySchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { error: "Please check the university details.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await createUniversity(await createClient(), parsed.data);
  } catch (error) {
    const message = errorMessage(error);
    return { error: message.includes("duplicate") ? "That university is already in the list." : message, values: formValues(formData) };
  }
  revalidatePath("/", "layout");
  return { success: `${parsed.data.name} was added. You can now select it above.` };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createUniversity,
  deleteMyAccount,
  flattenZodError,
  getProfile,
  isProfileVisibility,
  normalizeUsername,
  profileSchema,
  universitySchema,
  updateProfile,
  usernameProblem,
  type FieldErrors,
  type ProfileSection,
  type ProfileVisibility,
} from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { profileHandle, sectionVisibility } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

const FIX_FIELDS = "Please fix the highlighted fields.";

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/settings/profile");
  const supabase = await createClient();
  const parsed = profileSchema.safeParse(formToObject(formData));
  const fieldErrors: FieldErrors = parsed.success ? {} : flattenZodError(parsed.error).fieldErrors;

  // Username and the three privacy choices are only sent when they changed, so a profile row that does not have them
  // yet (before migration 18) still saves everything else.
  const current = await getProfile(supabase, user.id).catch(() => null);
  const currentHandle = profileHandle(current) ?? "";
  const rawUsername = formData.get("username");
  const username = typeof rawUsername === "string" ? normalizeUsername(rawUsername) : null;
  if (username === "" && currentHandle) fieldErrors.username = ["Choose a username."];
  else if (username) {
    const problem = usernameProblem(username);
    if (problem) fieldErrors.username = [problem];
  }
  const before = sectionVisibility(current);
  const changed = (field: string, section: ProfileSection): ProfileVisibility | undefined => {
    const value = formData.get(field);
    return isProfileVisibility(value) && value !== before[section] ? value : undefined;
  };

  if (!parsed.success || Object.values(fieldErrors).some((messages) => messages?.length)) {
    return { error: FIX_FIELDS, fieldErrors, values: formValues(formData) };
  }
  try {
    await updateProfile(supabase, user.id, {
      fullName: parsed.data.fullName,
      universityId: parsed.data.universityId ?? null,
      program: parsed.data.program ?? null,
      graduationYear: parsed.data.graduationYear ?? null,
      bio: parsed.data.bio ?? null,
      avatarUrl: parsed.data.avatarUrl ?? null,
      notifyNearbyListings: parsed.data.notifyNearbyListings,
      showActiveStatus: parsed.data.showActiveStatus,
      username: username && username !== currentHandle ? username : undefined,
      classesVisibility: changed("classesVisibility", "classes"),
      savedVisibility: changed("savedVisibility", "saved"),
      likedVisibility: changed("likedVisibility", "liked"),
    });
  } catch (error) {
    const message = errorMessage(error);
    // "That username is taken. Try another one." and friends belong under the field.
    if (/username/i.test(message)) return { error: FIX_FIELDS, fieldErrors: { username: [message] }, values: formValues(formData) };
    return { error: message, values: formValues(formData) };
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

/** Permanently delete the signed-in user's account, then sign out. */
export async function deleteAccountAction(): Promise<void> {
  await requireUser("/settings/profile");
  const supabase = await createClient();
  await deleteMyAccount(supabase);
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}

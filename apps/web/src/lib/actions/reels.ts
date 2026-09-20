"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createReel, flattenZodError, reelSchema } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, formToObject } from "@/lib/utils";
import { formValues, type FormState } from "./types";

const ARRAY_FIELDS = ["videos"];

export async function createReelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/reels/new");
  const parsed = reelSchema.safeParse(formToObject(formData, ARRAY_FIELDS));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: flattenZodError(parsed.error).fieldErrors, values: formValues(formData) };
  }
  try {
    await createReel(await createClient(), user.id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error), values: formValues(formData) };
  }
  revalidatePath("/");
  redirect("/?tab=reels");
}

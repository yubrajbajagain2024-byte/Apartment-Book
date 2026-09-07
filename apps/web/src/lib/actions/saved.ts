"use server";

import { revalidatePath } from "next/cache";
import { toggleSaved, type SavedTargetType } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function toggleSavedAction(targetType: SavedTargetType, targetId: string): Promise<{ saved: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { saved: false, error: "Log in to save listings." };
  try {
    const supabase = await createClient();
    const saved = await toggleSaved(supabase, user.id, targetType, targetId);
    revalidatePath("/saved");
    return { saved };
  } catch {
    return { saved: false, error: "Could not update saved listings." };
  }
}

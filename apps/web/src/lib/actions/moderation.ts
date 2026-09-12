"use server";

import { revalidatePath } from "next/cache";
import { blockUser, reportContent, unblockUser, type ReportReason, type ReportTargetType } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";

export async function reportAction(targetType: ReportTargetType, targetId: string, reason: ReportReason, details?: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to report content." };
  try {
    await reportContent(await createClient(), user.id, { targetType, targetId, reason, details });
    return {};
  } catch (error) {
    return { error: errorMessage(error, "Could not send the report.") };
  }
}

export async function setBlockedAction(otherId: string, blocked: boolean): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in first." };
  try {
    const supabase = await createClient();
    if (blocked) await blockUser(supabase, user.id, otherId);
    else await unblockUser(supabase, user.id, otherId);
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return { error: errorMessage(error, "Could not update the block.") };
  }
}

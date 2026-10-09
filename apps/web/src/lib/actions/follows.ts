"use server";

import { revalidatePath } from "next/cache";
import { setFollowing, type FollowStats } from "@apartment-book/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";

/**
 * Follow or unfollow someone from their profile or a follow list. Returns the fresh numbers so the button and the
 * counts next to it agree; signed out (an expired session, the button itself sends people to log in first) the
 * browser goes to the login page and comes back to the profile.
 */
export async function setFollowingAction(followeeId: string, follow: boolean): Promise<{ error?: string; stats?: FollowStats }> {
  const user = await requireUser(`/profile/${followeeId}`);
  if (followeeId === user.id) return { error: "You cannot follow yourself." };
  try {
    const stats = await setFollowing(await createClient(), user.id, followeeId, follow);
    // Their profile shows the counts and Home → Posts has the "Following" filter; both are server-rendered.
    revalidatePath(`/profile/${followeeId}`);
    revalidatePath("/");
    return { stats };
  } catch (error) {
    return { error: errorMessage(error, follow ? "Could not follow them." : "Could not unfollow them.") };
  }
}

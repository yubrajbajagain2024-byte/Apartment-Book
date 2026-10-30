import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { getProfile, type ProfileWithUniversity } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/server";

/** The signed-in auth user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** The signed-in user's profile row (with university), or null. Cached per request. */
export const getCurrentProfile = cache(async (): Promise<ProfileWithUniversity | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  return getProfile(supabase, user.id);
});

import type { User } from "@supabase/supabase-js";
import { listReels, type Client, type ProfileWithUniversity } from "@apartment-book/shared";
import { firstParam } from "@/lib/utils";
import type { ReelsFeedProps } from "./reels-feed";

/** First page of Home → Reels. The viewer's own university by default; `?university=all` (or a specific id) overrides it. */
export async function loadReelsSection(
  supabase: Client,
  user: User | null,
  profile: ProfileWithUniversity | null,
  params: { [key: string]: string | string[] | undefined },
): Promise<ReelsFeedProps> {
  const university = firstParam(params.university);
  const picked = university && /^[0-9a-f-]{36}$/i.test(university) ? university : null;
  const universityId = university === "all" ? null : picked || profile?.university_id || null;
  const initial = await listReels(supabase, { universityId: universityId ?? undefined });
  return {
    initial,
    universityId,
    hasHomeUniversity: Boolean(profile?.university_id),
    signedIn: Boolean(user),
    currentUserId: user?.id ?? null,
    currentUser: user ? { id: user.id, name: profile?.full_name || user.email?.split("@")[0] || "You", avatarUrl: profile?.avatar_url ?? null } : null,
  };
}

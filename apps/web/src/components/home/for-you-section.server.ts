import type { User } from "@supabase/supabase-js";
import { getPostEngagementMany, getPostPreviewsMany, getSavedIds, listForYou, listUniversities, type Client, type PostEngagement, type PostPreview, type ProfileWithUniversity } from "@apartment-book/shared";
import type { ForYouFeedProps } from "./for-you-feed";
import { homeUniversityId, type HomeSearchParams } from "./posts-section.server";

/** Everything Home → For you needs for its first paint: one blended page, plus the counts and faces of the posts in it. Server only. */
export async function loadForYouSection(supabase: Client, user: User | null, profile: ProfileWithUniversity | null, params: HomeSearchParams): Promise<ForYouFeedProps> {
  const universityId = homeUniversityId(params, profile);

  const [page, savedIds, universities] = await Promise.all([
    listForYou(supabase, { universityId, page: 1 }),
    user ? getSavedIds(supabase, user.id, "post").catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    listUniversities(supabase).catch(() => []),
  ]);
  // Reels are feed posts too, so they get likes and comments here; Buzz threads carry their own score and reply count.
  const ids = page.items.flatMap((item) => (item.type === "post" ? [item.post.id] : []));
  const [engagement, previews] = await Promise.all([
    getPostEngagementMany(supabase, "post", ids).catch(() => ({}) as Record<string, PostEngagement>),
    getPostPreviewsMany(supabase, "post", ids).catch(() => ({}) as Record<string, PostPreview>),
  ]);

  return {
    initial: page.items,
    hasMore: page.hasMore,
    filters: { universityId },
    savedIds: [...savedIds],
    signedIn: Boolean(user),
    currentUserId: user?.id ?? null,
    currentUser: user && profile ? { id: user.id, name: profile.full_name, avatarUrl: profile.avatar_url } : null,
    engagement,
    previews,
    scope: { universityName: universities.find((u) => u.id === universityId)?.name ?? null, hasHomeUniversity: Boolean(profile?.university_id) },
    universityNames: Object.fromEntries(universities.map((u) => [u.id, u.name])),
  };
}

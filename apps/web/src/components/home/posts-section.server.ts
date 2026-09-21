import type { User } from "@supabase/supabase-js";
import { getPostEngagementMany, getPostPreviewsMany, getSavedIds, listFeedPosts, listUniversities, type Client, type FeedPostFilters, type PostEngagement, type PostPreview, type ProfileWithUniversity } from "@apartment-book/shared";
import { firstParam } from "@/lib/utils";
import type { PostsFeedProps } from "./posts-feed";

export type HomeSearchParams = { [key: string]: string | string[] | undefined };

/** Everything the Posts tab needs for its first paint. Server only. */
export async function loadPostsSection(supabase: Client, user: User | null, profile: ProfileWithUniversity | null, params: HomeSearchParams): Promise<PostsFeedProps> {
  const chosen = firstParam(params.university);
  // Default to the student's own university until they pick "All universities".
  // Anything that is not a university id is ignored, so a mistyped address cannot break the page.
  const picked = chosen && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chosen) ? chosen : undefined;
  const universityId = chosen === "all" ? undefined : picked || profile?.university_id || undefined;
  const filters: FeedPostFilters = { kind: "post", universityId };

  const [result, savedIds, universities] = await Promise.all([
    listFeedPosts(supabase, { ...filters, page: 1 }),
    user ? getSavedIds(supabase, user.id, "post").catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    listUniversities(supabase).catch(() => []),
  ]);
  const ids = result.data.map((p) => p.id);
  const [engagement, previews] = await Promise.all([
    getPostEngagementMany(supabase, "post", ids).catch(() => ({}) as Record<string, PostEngagement>),
    getPostPreviewsMany(supabase, "post", ids).catch(() => ({}) as Record<string, PostPreview>),
  ]);

  return {
    initial: result.data,
    totalPages: result.totalPages,
    filters,
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

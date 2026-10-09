import type { User } from "@supabase/supabase-js";
import { getPostEngagementMany, getPostPreviewsMany, getSavedIds, listFeedPosts, listUniversities, type Client, type FeedPostFilters, type PostEngagement, type PostPreview, type ProfileWithUniversity } from "@apartment-book/shared";
import { firstParam } from "@/lib/utils";
import type { PostsFeedProps } from "./posts-feed";

export type HomeSearchParams = { [key: string]: string | string[] | undefined };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which campus a Home feed shows: the student's own university until they pick "All universities" (?university=all).
 * A university id in the address wins over that; anything else is ignored, so a mistyped address cannot break the page.
 */
export function homeUniversityId(params: HomeSearchParams, profile: ProfileWithUniversity | null): string | undefined {
  const chosen = firstParam(params.university);
  if (chosen === "all") return undefined;
  return (chosen && UUID.test(chosen) ? chosen : undefined) || profile?.university_id || undefined;
}

/** Everything the Posts tab needs for its first paint. Server only. */
export async function loadPostsSection(supabase: Client, user: User | null, profile: ProfileWithUniversity | null, params: HomeSearchParams): Promise<PostsFeedProps> {
  const universityId = homeUniversityId(params, profile);
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

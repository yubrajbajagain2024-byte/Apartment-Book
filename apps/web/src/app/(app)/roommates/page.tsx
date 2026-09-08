import type { Metadata } from "next";
import { Plus, Users } from "lucide-react";
import {
  getPostEngagementMany,
  getSavedIds,
  listRoommatePosts,
  listUniversities,
  milesToKm,
  type GenderPref,
  type RoommateFilters as Filters,
  type RoommatePostType,
} from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { firstParam, numberParam } from "@/lib/utils";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RoommateFeed } from "@/components/feed/roommate-feed";
import { RoommateFilters } from "@/components/roommates/roommate-filters";

export const metadata: Metadata = { title: "Roommates" };

export default async function RoommatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const [user, profile, supabase] = await Promise.all([getCurrentUser(), getCurrentProfile(), createClient()]);

  const values = {
    q: firstParam(params.q),
    university: firstParam(params.university),
    type: firstParam(params.type),
    maxBudget: firstParam(params.maxBudget),
    gender: firstParam(params.gender),
    radius: firstParam(params.radius),
    video: firstParam(params.video),
    page: firstParam(params.page),
  };
  const universityId = values.university === "all" ? undefined : values.university || profile?.university_id || undefined;

  const filters: Filters = {
    q: values.q,
    universityId,
    postType: values.type === "has_room" || values.type === "needs_room" ? (values.type as RoommatePostType) : undefined,
    maxBudget: numberParam(params.maxBudget),
    genderPreference: values.gender ? (values.gender as GenderPref) : undefined,
    radiusKm: universityId && numberParam(params.radius) ? milesToKm(numberParam(params.radius) as number) : undefined,
    videoOnly: values.video === "1",
    page: numberParam(params.page) ?? 1,
  };

  const [universities, result, savedIds] = await Promise.all([
    listUniversities(supabase),
    listRoommatePosts(supabase, filters),
    user ? getSavedIds(supabase, user.id, "roommate") : Promise.resolve(new Set<string>()),
  ]);
  const engagement = await getPostEngagementMany(
    supabase,
    "roommate",
    result.data.map((p) => p.id),
  ).catch(() => ({}));
  const activeUniversity = universities.find((u) => u.id === universityId);
  const hasFilters = Object.entries(values).some(([key, value]) => key !== "page" && value !== undefined && value !== "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{activeUniversity ? `Roommates at ${activeUniversity.name}` : "Find a roommate"}</h1>
          <p className="text-sm text-gray-600">
            {result.count} {result.count === 1 ? "post" : "posts"} · people with a spare room and people looking for one
          </p>
        </div>
        <LinkButton href="/roommates/new">
          <Plus className="h-5 w-5" /> Create post
        </LinkButton>
      </div>

      <RoommateFilters universities={universities} values={{ ...values, university: universityId ?? "all" }} hasFilters={hasFilters} />

      {result.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No roommate posts yet"
          description={universityId ? "Try All universities, or be the first to post for your campus." : "Be the first to post."}
          action={
            <div className="flex gap-2">
              {universityId ? (
                <LinkButton href="/roommates?university=all" variant="secondary">
                  Show all universities
                </LinkButton>
              ) : null}
              <LinkButton href="/roommates/new">Create post</LinkButton>
            </div>
          }
        />
      ) : (
        <div className="mx-auto w-full max-w-[640px]">
        <RoommateFeed
          key={JSON.stringify({ ...filters, page: undefined })}
          initial={result.data}
          totalPages={result.totalPages}
          filters={{ ...filters, page: undefined }}
          savedIds={[...savedIds]}
          signedIn={Boolean(user)}
          currentUserId={user?.id ?? null}
          currentUser={user && profile ? { id: user.id, name: profile.full_name, avatarUrl: profile.avatar_url } : null}
          engagement={engagement}
        />
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, UserPlus, Users } from "lucide-react";
import { DEFAULT_PAGE_SIZE, getFollowStats, getFollowStatsMany, getProfile, isVerifiedPoster, listFollowers, listFollowing, NO_FOLLOW_STATS, type FollowListEntry, type FollowStats, type Paginated } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { numberParam } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FollowButton } from "@/components/common/follow-button";
import { FollowTabs, type FollowListKind } from "./follow-tabs";

type ListPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** What both list pages do before rendering: find the person (404 when they are gone) and read ?page=. */
export async function resolveFollowList({ params, searchParams }: ListPageProps): Promise<{ profileId: string; profileName: string; page: number }> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const profile = await getProfile(await createClient(), id);
  if (!profile) notFound();
  return { profileId: profile.id, profileName: profile.full_name, page: Math.max(1, Math.floor(numberParam(query.page) ?? 1)) };
}

/**
 * /profile/[id]/followers and /following share this body: the way back, a heading, Followers | Following tabs
 * carrying the counts, and one row per person with their own Follow button (the viewer's own row says "You").
 */
export async function FollowList({ profileId, profileName, kind, page }: { profileId: string; profileName: string; kind: FollowListKind; page: number }) {
  const supabase = await createClient();
  // A failed read shows an empty list rather than the error page, like the counts on the profile fall back to zero.
  const empty: Paginated<FollowListEntry> = { data: [], count: 0, page, pageSize: DEFAULT_PAGE_SIZE, totalPages: 1 };
  const [user, stats, result] = await Promise.all([
    getCurrentUser(),
    getFollowStats(supabase, profileId).catch(() => NO_FOLLOW_STATS),
    (kind === "followers" ? listFollowers(supabase, profileId, { page }) : listFollowing(supabase, profileId, { page })).catch(() => empty),
  ]);
  // The buttons need the viewer's relationship with each person, which is nothing signed out, so no request then.
  const ids = result.data.map((entry) => entry.profile.id).filter((id) => id !== user?.id);
  const rowStats = user && ids.length > 0 ? await getFollowStatsMany(supabase, ids).catch(() => ({}) as Record<string, FollowStats>) : {};
  const isMe = user?.id === profileId;
  const firstName = profileName.split(" ")[0];
  const pageHref = (p: number) => `/profile/${profileId}/${kind}${p > 1 ? `?page=${p}` : ""}`;

  return (
    <div className="mx-auto flex w-full max-w-[500px] flex-col gap-3">
      <Link href={`/profile/${profileId}`} className="inline-flex items-center gap-1 self-start text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to profile
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">{kind === "followers" ? `${profileName}'s followers` : `${profileName} follows`}</h1>
      <FollowTabs profileId={profileId} active={kind} followers={stats.followers} following={stats.following} />
      {result.count === 0 ? (
        kind === "followers" ? (
          <EmptyState icon={Users} title="No followers yet" description={isMe ? "When someone follows you, they show up here." : `When someone follows ${firstName}, they show up here.`} />
        ) : (
          <EmptyState icon={UserPlus} title="Not following anyone yet" description={isMe ? "Follow people from their profile and their posts show up under Home → Posts → Following." : `${firstName} has not followed anyone yet.`} />
        )
      ) : (
        <Card>
          {result.data.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-600">Nothing on this page.</p> : null}
          <ul className="divide-y divide-gray-100" data-testid="follow-list">
            {result.data.map(({ profile }) => (
              <li key={profile.id} className="flex items-center gap-3 px-4 py-3" data-testid="follow-row">
                {/* The avatar repeats the name's link, so it is skipped by keyboards and screen readers. */}
                <Link href={`/profile/${profile.id}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
                  <Avatar name={profile.full_name} src={profile.avatar_url} />
                </Link>
                <Link href={`/profile/${profile.id}`} className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold text-gray-900 hover:underline">
                  <span className="truncate">{profile.full_name}</span>
                  {isVerifiedPoster(profile) ? <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-label="Verified student" /> : null}
                </Link>
                {profile.id === user?.id ? <span className="text-sm text-gray-500">You</span> : <FollowButton userId={profile.id} initial={rowStats[profile.id] ?? NO_FOLLOW_STATS} signedIn={Boolean(user)} size="sm" />}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {result.totalPages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm text-gray-600">
          {page > 1 ? (
            <LinkButton href={pageHref(page - 1)} variant="outline" size="sm">
              Previous
            </LinkButton>
          ) : (
            <span />
          )}
          <span className="tabular-nums">
            Page {page} of {result.totalPages}
          </span>
          {page < result.totalPages ? (
            <LinkButton href={pageHref(page + 1)} variant="outline" size="sm">
              Next
            </LinkButton>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

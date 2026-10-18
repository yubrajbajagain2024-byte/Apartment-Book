import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, UserPlus, Users } from "lucide-react";
import {
  DEFAULT_PAGE_SIZE,
  followListView,
  getFollowStats,
  getFollowStatsMany,
  getProfile,
  listFollowers,
  listFollowing,
  listMutualFriends,
  MUTUAL_FRIENDS_LOGIN_PROMPT,
  MUTUAL_FRIENDS_TITLE,
  NO_FOLLOW_STATS,
  noMutualFriendsMessage,
  privateFollowListsNote,
  type Client,
  type FollowListEntry,
  type FollowStats,
  type Paginated,
  type PosterSummary,
} from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { firstNameOf } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { numberParam } from "@/lib/utils";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FollowTabs, type FollowListKind } from "./follow-tabs";
import { PersonRow } from "./person-row";

type ListPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };
type FollowListProps = { profileId: string; profileName: string; kind: FollowListKind; page: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What both list pages do before rendering: find the person (404 when they are gone) and read ?page=. */
export async function resolveFollowList({ params, searchParams }: ListPageProps): Promise<{ profileId: string; profileName: string; page: number }> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const profile = await getProfile(await createClient(), id);
  if (!profile) notFound();
  return { profileId: profile.id, profileName: profile.full_name, page: Math.max(1, Math.floor(numberParam(query.page) ?? 1)) };
}

/** The browser tab's title: the owner's "Followers" or "Following", "Mutual friends" for everyone else. */
export async function followListTitle(params: ListPageProps["params"], kind: FollowListKind): Promise<string> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  // Ids are stored in lower case; an address typed in capitals still opens the owner's own lists below.
  if (followListView(user?.id, id.toLowerCase()) !== "own") return MUTUAL_FRIENDS_TITLE;
  return kind === "followers" ? "Followers" : "Following";
}

/**
 * /profile/[id]/followers and /following share this body. Who follows whom is private, so what it shows depends on
 * who is looking (followListView): the owner gets their Followers | Following lists, anyone else signed in one list
 * behind both counts (the friends the two of them have in common), and signed out a way to log in. The database draws
 * the same line, so nothing is hidden by these pages alone.
 */
export async function FollowList(props: FollowListProps) {
  const viewerId = (await getCurrentUser())?.id ?? null;
  return followListView(viewerId, props.profileId) === "own" ? <OwnLists {...props} /> : <MutualFriends {...props} viewerId={viewerId} />;
}

/**
 * The owner's own lists, newest first: the way back, a heading, Followers | Following tabs carrying the counts, and one
 * row per person with their own Follow button.
 */
async function OwnLists({ profileId, profileName, kind, page }: FollowListProps) {
  const supabase = await createClient();
  // A failed read shows an empty list rather than the error page, like the counts on the profile fall back to zero.
  const empty: Paginated<FollowListEntry> = { data: [], count: 0, page, pageSize: DEFAULT_PAGE_SIZE, totalPages: 1 };
  const [stats, result] = await Promise.all([
    getFollowStats(supabase, profileId).catch(() => NO_FOLLOW_STATS),
    (kind === "followers" ? listFollowers(supabase, profileId, { page }) : listFollowing(supabase, profileId, { page })).catch(() => empty),
  ]);
  const people = result.data.map((entry) => entry.profile);
  const rowStats = await rowFollowStats(supabase, people);

  return (
    <div className="mx-auto flex w-full max-w-[500px] flex-col gap-3">
      <BackToProfile profileId={profileId} />
      <h1 className="text-2xl font-bold text-gray-900">{kind === "followers" ? `${profileName}'s followers` : `${profileName} follows`}</h1>
      <FollowTabs profileId={profileId} active={kind} followers={stats.followers} following={stats.following} />
      {result.count === 0 ? (
        kind === "followers" ? (
          <EmptyState icon={Users} title="No followers yet" description="When someone follows you, they show up here." />
        ) : (
          <EmptyState icon={UserPlus} title="Not following anyone yet" description="Follow people from their profile and their posts show up under Home → Posts → Following." />
        )
      ) : (
        <People people={people} viewerId={profileId} stats={rowStats} />
      )}
      <Pager page={page} totalPages={result.totalPages} hrefFor={(p) => listHref(profileId, kind, p)} />
    </div>
  );
}

/**
 * Everyone else, behind both counts: the friends (people who follow each other) they and the owner have in common, by
 * name, under a line saying the lists themselves are private. Signed out there is nobody to have friends in common
 * with, so it offers to log in and come back here.
 */
async function MutualFriends({ profileId, profileName, kind, page, viewerId }: FollowListProps & { viewerId: string | null }) {
  const supabase = await createClient();
  // Signed out there is nothing to read. A failed read (null) offers to try again, rather than the error page or an
  // empty list that may not be true.
  const result = viewerId ? await listMutualFriends(supabase, profileId, { page }).catch(() => null) : null;
  const rowStats = result ? await rowFollowStats(supabase, result.data) : {};
  const firstName = firstNameOf(profileName);
  const here = listHref(profileId, kind, page);

  let body: ReactNode;
  if (!viewerId) {
    body = <EmptyState icon={Users} title={MUTUAL_FRIENDS_LOGIN_PROMPT} action={<LinkButton href={`/login?next=${encodeURIComponent(here)}`}>Log in</LinkButton>} />;
  } else if (!result) {
    body = (
      <Card>
        <p role="alert" className="px-4 py-6 text-center text-sm text-gray-600" data-testid="mutual-friends-error">
          Could not load mutual friends right now.{" "}
          <Link href={here} className="font-semibold text-brand-700 hover:underline">
            Try again
          </Link>
        </p>
      </Card>
    );
  } else if (result.count === 0) {
    body = <EmptyState icon={Users} title="No mutual friends" description={`${noMutualFriendsMessage(firstName)}.`} />;
  } else {
    body = <People people={result.data} viewerId={viewerId} stats={rowStats} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-[500px] flex-col gap-3" data-testid="mutual-friends">
      <BackToProfile profileId={profileId} />
      <h1 className="text-2xl font-bold text-gray-900">{`${MUTUAL_FRIENDS_TITLE} with ${profileName}`}</h1>
      <p className="flex items-center gap-2 text-sm text-gray-600" data-testid="mutual-friends-note">
        <Lock className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
        {privateFollowListsNote(firstName)}
      </p>
      {body}
      {result ? <Pager page={page} totalPages={result.totalPages} hrefFor={(p) => listHref(profileId, kind, p)} /> : null}
    </div>
  );
}

/** The address of one page of a list; page 1 keeps the clean address. */
function listHref(profileId: string, kind: FollowListKind, page: number): string {
  return `/profile/${profileId}/${kind}${page > 1 ? `?page=${page}` : ""}`;
}

/** The Follow buttons need the viewer's relationship with each person: one request for the page (none for an empty one). */
function rowFollowStats(supabase: Client, people: PosterSummary[]): Promise<Record<string, FollowStats>> {
  return getFollowStatsMany(supabase, people.map((person) => person.id)).catch(() => ({}) as Record<string, FollowStats>);
}

function BackToProfile({ profileId }: { profileId: string }) {
  return (
    <Link href={`/profile/${profileId}`} className="inline-flex items-center gap-1 self-start text-sm text-gray-600 hover:text-gray-900">
      <ArrowLeft className="h-4 w-4" /> Back to profile
    </Link>
  );
}

/** One row per person, each with their own Follow button. */
function People({ people, viewerId, stats }: { people: PosterSummary[]; viewerId: string; stats: Record<string, FollowStats> }) {
  return (
    <Card>
      {people.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-600">Nothing on this page.</p> : null}
      <ul className="divide-y divide-gray-100" data-testid="follow-list">
        {people.map((person) => (
          <PersonRow key={person.id} profile={person} viewerId={viewerId} signedIn stats={stats[person.id]} testId="follow-row" />
        ))}
      </ul>
    </Card>
  );
}

/** Previous · Page n of N · Next, once a list runs over one page. */
function Pager({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (page: number) => string }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between text-sm text-gray-600">
      {page > 1 ? (
        <LinkButton href={hrefFor(page - 1)} variant="outline" size="sm">
          Previous
        </LinkButton>
      ) : (
        <span />
      )}
      <span className="tabular-nums">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <LinkButton href={hrefFor(page + 1)} variant="outline" size="sm">
          Next
        </LinkButton>
      ) : (
        <span />
      )}
    </nav>
  );
}

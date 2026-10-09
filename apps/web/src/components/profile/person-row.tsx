import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { isVerifiedPoster, NO_FOLLOW_STATS, type FollowStats, type PosterSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/ui/avatar";
import { FollowButton } from "@/components/common/follow-button";

/**
 * One person in a list (followers, following, search results): avatar and name open the profile, the verified badge
 * shows for students with a university address, and a Follow button sits on the right. The viewer's own row says "You".
 * Server-rendered; only the button is a client component.
 */
export function PersonRow({ profile, viewerId, signedIn, stats, testId = "person-row" }: { profile: PosterSummary; viewerId: string | null; signedIn: boolean; stats?: FollowStats; testId?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3" data-testid={testId}>
      {/* The avatar repeats the name's link, so it is skipped by keyboards and screen readers. */}
      <Link href={`/profile/${profile.id}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
        <Avatar name={profile.full_name} src={profile.avatar_url} />
      </Link>
      <Link href={`/profile/${profile.id}`} className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold text-gray-900 hover:underline">
        <span className="truncate">{profile.full_name}</span>
        {isVerifiedPoster(profile) ? <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-label="Verified student" /> : null}
      </Link>
      {profile.id === viewerId ? <span className="text-sm text-gray-500">You</span> : <FollowButton userId={profile.id} initial={stats ?? NO_FOLLOW_STATS} signedIn={signedIn} size="sm" />}
    </li>
  );
}

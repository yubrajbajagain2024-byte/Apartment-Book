import Link from "next/link";
import { BadgeCheck, MapPin, Plus, UserPlus } from "lucide-react";
import { compactCount, type FollowStats, type ProfileWithUniversity } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { FollowButton } from "@/components/common/follow-button";
import { MessageButton } from "@/components/common/message-button";
import { ProfileMoreMenu } from "./profile-more-menu";
import { ShareProfileButton, type ShareProfileTarget } from "./share-profile-dialog";

/** The light grey buttons (Edit profile, Share profile, Find friends). */
const GREY_BUTTON = buttonClasses({ variant: "secondary", className: "min-w-0 flex-1 px-3" });
const GREY_SQUARE = buttonClasses({ variant: "secondary", size: "icon" });

export type ProfileHeaderProps = {
  profile: Pick<ProfileWithUniversity, "id" | "full_name" | "avatar_url" | "bio" | "program" | "graduation_year" | "university">;
  /** The @handle without the @; null while the profile has none. */
  handle: string | null;
  isMe: boolean;
  viewerId: string | null;
  /** The viewer blocked this person: no Follow button, and the menu offers Unblock. */
  blocked: boolean;
  follow: FollowStats;
  /** Likes on everything they posted. */
  likes: number;
  share: ShareProfileTarget;
};

/**
 * The top of a profile, TikTok style: the photo (with a "+" to change your own), name, @handle and the QR button,
 * Following · Followers · Likes, the buttons (yours: Edit profile, Share profile, Find friends; someone else's:
 * Follow, Message, •••), bio and campus.
 */
export function ProfileHeader({ profile, handle, isMe, viewerId, blocked, follow, likes, share }: ProfileHeaderProps) {
  const verifiedDomain = profile.university?.email_domain ?? null;
  const studies = [profile.program, profile.graduation_year ? `Class of ${profile.graduation_year}` : null].filter(Boolean).join(" · ");

  return (
    <header className="flex flex-col items-center px-4 pb-5 pt-6 text-center">
      <div className="relative">
        <Avatar name={profile.full_name} src={profile.avatar_url} size="xl" className="ring-1 ring-black/5" />
        {isMe ? (
          <Link
            href="/settings/profile"
            aria-label="Change profile photo"
            title="Change profile photo"
            className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-white ring-[3px] ring-white hover:bg-brand-600"
            data-testid="profile-photo-add"
          >
            <Plus className="h-4 w-4" strokeWidth={3} />
          </Link>
        ) : null}
      </div>

      <h1 className="mt-3 flex max-w-full items-center justify-center gap-1 text-xl font-bold text-gray-900">
        <span className="min-w-0 break-words">{profile.full_name}</span>
        {verifiedDomain ? <BadgeCheck className="h-5 w-5 shrink-0 text-brand-600" aria-label={`Verified @${verifiedDomain} student`} /> : null}
      </h1>
      <div className="mt-0.5 flex max-w-full items-center justify-center gap-0.5 text-sm text-gray-600">
        {handle ? (
          <span className="truncate" data-testid="profile-username">
            @{handle}
          </span>
        ) : null}
        <ShareProfileButton target={share} variant="qr" />
      </div>

      <div className="mt-4 flex items-center justify-center" data-testid="follow-counts">
        <Stat href={`/profile/${profile.id}/following`} value={follow.following} label="Following" />
        <StatDivider />
        <Stat href={`/profile/${profile.id}/followers`} value={follow.followers} label={follow.followers === 1 ? "Follower" : "Followers"} />
        <StatDivider />
        <Stat value={likes} label={likes === 1 ? "Like" : "Likes"} />
      </div>

      <div className="mt-4 flex w-full max-w-[22rem] items-center gap-2">
        {isMe ? (
          <>
            <Link href="/settings/profile" className={GREY_BUTTON} data-testid="edit-profile">
              Edit profile
            </Link>
            <ShareProfileButton target={share} variant="button" className={GREY_BUTTON} />
            <Link href="/search" aria-label="Find friends" title="Find friends" className={GREY_SQUARE} data-testid="find-friends">
              <UserPlus className="h-5 w-5" />
            </Link>
          </>
        ) : (
          <>
            {/* Blocking them removed the follows both ways; the page re-renders with the button after an unblock. */}
            {!blocked ? <FollowButton userId={profile.id} initial={follow} signedIn={viewerId !== null} className="min-w-0 flex-1" /> : null}
            <MessageButton userId={profile.id} currentUserId={viewerId} returnTo={`/profile/${profile.id}`} tone="secondary" className="min-w-0 flex-1" />
            {viewerId ? <ProfileMoreMenu profileId={profile.id} name={profile.full_name} initialBlocked={blocked} /> : null}
          </>
        )}
      </div>

      {profile.bio ? <p className="mt-4 max-w-md whitespace-pre-line break-words text-sm text-gray-900">{profile.bio}</p> : null}
      {profile.university ? (
        <p className="mt-2 flex max-w-full items-center justify-center gap-1 text-sm text-gray-700">
          <MapPin className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
          <span className="truncate">{profile.university.name}</span>
        </p>
      ) : null}
      {studies ? <p className="mt-1 text-xs text-gray-500">{studies}</p> : null}
    </header>
  );
}

/** A number over its label; Following and Followers open their lists. The space keeps "3 Followers" readable as text. */
function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const body = (
    <>
      <span className="text-[17px] font-bold leading-tight tabular-nums text-gray-900">{compactCount(value)}</span>{" "}
      <span className="text-[13px] text-gray-500">{label}</span>
    </>
  );
  const box = "flex min-w-[5.5rem] flex-col items-center rounded-lg px-3 py-1";
  return href ? (
    <Link href={href} className={cn(box, "hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500")}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function StatDivider() {
  return <span aria-hidden="true" className="h-4 w-px bg-gray-300" />;
}

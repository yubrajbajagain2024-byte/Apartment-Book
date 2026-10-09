"use client";

import { useCallback, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserCheck, UserPlus } from "lucide-react";
import type { FollowStats } from "@apartment-book/shared";
import { setFollowingAction } from "@/lib/actions/follows";
import { Button } from "@/components/ui/button";

/**
 * Follow / Following toggle for profile headers and follow lists, optimistic like the like button. The action
 * re-renders the page with the real numbers, so a changed `initial` is adopted and the button never disagrees with
 * the counts next to it. Signed out, a tap goes to the login page and comes back here.
 */
export function FollowButton({
  userId,
  initial,
  signedIn,
  size = "md",
  className,
  onChange,
}: {
  userId: string;
  initial: FollowStats;
  signedIn: boolean;
  size?: "sm" | "md";
  className?: string;
  onChange?: (stats: FollowStats) => void;
}) {
  const [state, setState] = useState(initial);
  const incoming = [initial.followedByMe, initial.followsMe, initial.followers, initial.following].join(":");
  const [seen, setSeen] = useState(incoming);
  if (incoming !== seen) {
    setSeen(incoming);
    setState(initial);
  }
  const [optimistic, setOptimistic] = useOptimistic(state);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = useCallback(() => {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const follow = !optimistic.followedByMe;
    startTransition(async () => {
      setOptimistic({ ...optimistic, followedByMe: follow, followers: Math.max(0, optimistic.followers + (follow ? 1 : -1)) });
      const result = await setFollowingAction(userId, follow);
      if (result.stats) {
        setState(result.stats);
        onChange?.(result.stats);
      }
    });
  }, [signedIn, optimistic, setOptimistic, userId, onChange, router]);

  const following = optimistic.followedByMe;
  const Icon = following ? UserCheck : UserPlus;
  return (
    <Button type="button" variant={following ? "secondary" : "primary"} size={size} disabled={pending} aria-pressed={following} onClick={toggle} className={className} data-testid="follow-button">
      <Icon className="h-4 w-4" />
      {following ? "Following" : optimistic.followsMe ? "Follow back" : "Follow"}
    </Button>
  );
}

/** "12 posts · 3 followers · 8 following" under a profile's name; the last two open the lists. */
export function FollowCounts({ userId, stats, posts }: { userId: string; stats: FollowStats; posts?: number }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm tabular-nums text-gray-600" data-testid="follow-counts">
      {posts !== undefined ? (
        <>
          <span>
            <Count n={posts} /> {posts === 1 ? "post" : "posts"}
          </span>
          <Dot />
        </>
      ) : null}
      <Link href={`/profile/${userId}/followers`} className="hover:underline">
        <Count n={stats.followers} /> {stats.followers === 1 ? "follower" : "followers"}
      </Link>
      <Dot />
      <Link href={`/profile/${userId}/following`} className="hover:underline">
        <Count n={stats.following} /> following
      </Link>
    </p>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-semibold text-gray-900">{n}</span>;
}

function Dot() {
  return <span aria-hidden="true">·</span>;
}

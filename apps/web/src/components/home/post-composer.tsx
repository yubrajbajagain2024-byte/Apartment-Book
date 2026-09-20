import Link from "next/link";
import { Clapperboard, Images } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

const shortcut = "inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100";

/** "What's on your mind?" card on top of the Posts feed. Opens the full composer pages. */
export function PostComposer({ currentUser }: { currentUser: { id: string; name: string; avatarUrl: string | null } | null }) {
  if (!currentUser) {
    return (
      <div className="flex items-center justify-between gap-3 bg-white px-3 py-3 ring-1 ring-gray-200 sm:rounded-xl" data-testid="post-composer">
        <p className="min-w-0 text-sm text-gray-700">Share what is happening around your campus.</p>
        <Link href={`/login?next=${encodeURIComponent("/posts/new")}`} className="inline-flex h-9 shrink-0 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
          Log in to post
        </Link>
      </div>
    );
  }
  const firstName = currentUser.name.trim().split(/\s+/)[0] || "there";
  return (
    <div className="flex flex-col gap-2 bg-white px-3 pb-1.5 pt-3 ring-1 ring-gray-200 sm:rounded-xl" data-testid="post-composer">
      <div className="flex items-center gap-2.5">
        <Link href={`/profile/${currentUser.id}`} className="shrink-0">
          <Avatar name={currentUser.name} src={currentUser.avatarUrl} size="md" />
        </Link>
        <Link href="/posts/new" className="flex h-10 min-w-0 flex-1 items-center rounded-full bg-gray-100 px-4 text-[15px] text-gray-600 hover:bg-gray-200">
          <span className="truncate">What&apos;s on your mind, {firstName}?</span>
        </Link>
      </div>
      <div className="flex items-center gap-1 border-t border-gray-100 pt-1.5">
        <Link href="/posts/new" className={shortcut}>
          <Images className="h-5 w-5 text-green-600" /> Photo/Video
        </Link>
        <Link href="/reels/new" className={shortcut}>
          <Clapperboard className="h-5 w-5 text-rose-600" /> Reel
        </Link>
      </div>
    </div>
  );
}

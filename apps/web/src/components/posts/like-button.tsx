"use client";

import { useCallback, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ThumbsUp } from "lucide-react";
import type { SavedTargetType } from "@apartment-book/shared";
import { toggleLikeAction } from "@/lib/actions/engagement";
import { cn } from "@/lib/utils";

export type LikeController = { liked: boolean; likes: number; pending: boolean; toggle: () => void };

/** Optimistic like/unlike with a live count. */
export function useLikeToggle(targetType: SavedTargetType, targetId: string, initial: { liked: boolean; likes: number }, signedIn: boolean): LikeController {
  const [state, setState] = useState(initial);
  const [optimistic, setOptimistic] = useOptimistic(state);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = useCallback(() => {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    const next = !optimistic.liked;
    startTransition(async () => {
      setOptimistic({ liked: next, likes: Math.max(0, optimistic.likes + (next ? 1 : -1)) });
      const result = await toggleLikeAction(targetType, targetId, next);
      if (!result.error) setState({ liked: result.liked, likes: result.likes });
    });
  }, [signedIn, optimistic, setOptimistic, targetType, targetId, router]);

  return { liked: optimistic.liked, likes: optimistic.likes, pending, toggle };
}

export const actionButtonClasses =
  "inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-100 sm:px-2 sm:text-sm";

export function LikeButton({ controller, className }: { controller: LikeController; className?: string }) {
  return (
    <button
      type="button"
      onClick={controller.toggle}
      disabled={controller.pending}
      aria-pressed={controller.liked}
      aria-label={controller.liked ? "Unlike" : "Like"}
      className={cn(actionButtonClasses, controller.liked && "text-brand-600", className)}
    >
      <ThumbsUp className={cn("h-5 w-5 shrink-0", controller.liked && "fill-current")} />
      <span>{controller.liked ? "Liked" : "Like"}</span>
      {controller.likes > 0 ? <span className="tabular-nums text-gray-500">{controller.likes}</span> : null}
    </button>
  );
}

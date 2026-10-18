"use client";

import { useCallback, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import type { PostTargetType } from "@apartment-book/shared";
import { toggleSavedAction } from "@/lib/actions/saved";
import { cn } from "@/lib/utils";

export type SaveController = {
  saved: boolean;
  pending: boolean;
  signedIn: boolean;
  toggle: () => void;
};

/** Optimistic save/unsave state shared by the bookmark button and double-tap. */
export function useSaveToggle(targetType: PostTargetType, targetId: string, initialSaved: boolean, signedIn: boolean): SaveController {
  const [saved, setSaved] = useState(initialSaved);
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [pending, startTransition] = useTransition();

  const toggle = useCallback(() => {
    if (!signedIn) return;
    startTransition(async () => {
      setOptimistic(!optimistic);
      const result = await toggleSavedAction(targetType, targetId);
      if (!result.error) setSaved(result.saved);
    });
  }, [signedIn, optimistic, setOptimistic, targetType, targetId]);

  return { saved: optimistic, pending, signedIn, toggle };
}

export function SaveToggleButton({ controller, size = "md", className }: { controller: SaveController; size?: "sm" | "md"; className?: string }) {
  // Small is the round button over a photo (a soft white disc, the bookmark filling with ink once saved); medium is the
  // full button on a detail page, a hairline until saved and ink after.
  const classes = cn(
    "ab-press inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-60",
    size === "sm"
      ? cn("h-8 w-8 rounded-full bg-white/90 text-gray-900 shadow-card backdrop-blur hover:bg-white", controller.saved && "text-gray-900")
      : cn("h-11 rounded-[10px] px-5 text-sm", controller.saved ? "bg-gray-900 text-white hover:bg-gray-800" : "bg-transparent text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"),
    className,
  );

  if (!controller.signedIn) {
    return (
      <Link href="/login" className={classes} aria-label="Save">
        <Bookmark className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {size === "md" ? "Save" : null}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      disabled={controller.pending}
      aria-pressed={controller.saved}
      aria-label={controller.saved ? "Saved" : "Save"}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        controller.toggle();
      }}
    >
      <Bookmark className={cn("h-[18px] w-[18px]", controller.saved && "fill-current")} strokeWidth={1.75} />
      {size === "md" ? (controller.saved ? "Saved" : "Save") : null}
    </button>
  );
}

/** Standalone bookmark button (detail pages). */
export function SaveButton({
  targetType,
  targetId,
  initialSaved,
  signedIn,
  size = "md",
  className,
}: {
  targetType: PostTargetType;
  targetId: string;
  initialSaved: boolean;
  signedIn: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const controller = useSaveToggle(targetType, targetId, initialSaved, signedIn);
  return <SaveToggleButton controller={controller} size={size} className={className} />;
}

/** Instagram-style burst shown over a photo after a double tap. Re-mount (change key) to replay. */
export function SaveBurst({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <Bookmark className="ab-burst h-24 w-24 fill-white text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]" />
    </span>
  );
}

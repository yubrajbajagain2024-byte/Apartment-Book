"use client";

import { useCallback, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import type { SavedTargetType } from "@apartment-book/shared";
import { toggleSavedAction } from "@/lib/actions/saved";
import { cn } from "@/lib/utils";

export type SaveController = {
  saved: boolean;
  pending: boolean;
  signedIn: boolean;
  toggle: () => void;
};

/** Optimistic save/unsave state shared by the bookmark button and double-tap. */
export function useSaveToggle(targetType: SavedTargetType, targetId: string, initialSaved: boolean, signedIn: boolean): SaveController {
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
  const classes = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors",
    size === "sm" ? "h-8 w-8" : "h-10 px-4 text-sm",
    controller.saved ? "bg-brand-50 text-brand-700 hover:bg-brand-100" : "bg-gray-200 text-gray-800 hover:bg-gray-300",
    className,
  );

  if (!controller.signedIn) {
    return (
      <Link href="/login" className={classes} aria-label="Save">
        <Bookmark className="h-5 w-5" />
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
      <Bookmark className={cn("h-5 w-5", controller.saved && "fill-current")} />
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
  targetType: SavedTargetType;
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

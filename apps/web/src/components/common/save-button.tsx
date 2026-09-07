"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import type { SavedTargetType } from "@apartment-book/shared";
import { toggleSavedAction } from "@/lib/actions/saved";
import { cn } from "@/lib/utils";

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
  const [saved, setSaved] = useState(initialSaved);
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [pending, startTransition] = useTransition();

  const classes = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors",
    size === "sm" ? "h-8 w-8" : "h-10 px-4 text-sm",
    optimistic ? "bg-brand-50 text-brand-700 hover:bg-brand-100" : "bg-gray-200 text-gray-800 hover:bg-gray-300",
    className,
  );

  if (!signedIn) {
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
      disabled={pending}
      aria-pressed={optimistic}
      aria-label={optimistic ? "Saved" : "Save"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => {
          setOptimistic(!optimistic);
          const result = await toggleSavedAction(targetType, targetId);
          if (!result.error) setSaved(result.saved);
        });
      }}
    >
      <Bookmark className={cn("h-5 w-5", optimistic && "fill-current")} />
      {size === "md" ? (optimistic ? "Saved" : "Save") : null}
    </button>
  );
}

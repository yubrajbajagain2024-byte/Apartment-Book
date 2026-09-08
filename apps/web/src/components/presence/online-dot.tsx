"use client";

import { cn } from "@/lib/utils";
import { useIsOnline } from "./presence-provider";

/** Green dot on an avatar's corner when that user is online. Wrap the avatar in a `relative` element. */
export function OnlineDot({ userId, size = "md", className }: { userId: string; size?: "sm" | "md"; className?: string }) {
  const online = useIsOnline(userId);
  if (!online) return null;
  return (
    <span
      aria-label="Active now"
      role="img"
      data-testid="online-dot"
      className={cn("absolute rounded-full bg-green-500 ring-2 ring-white", size === "sm" ? "-bottom-0 -right-0 h-2.5 w-2.5" : "bottom-0 right-0 h-3 w-3", className)}
    />
  );
}

"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import type { SharedPost } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { ShareDialog, useShareDialog } from "./share-dialog";

/** Native share sheet where available, otherwise copies the link. `copied` is true for a moment after a copy. */
export function useShare(path: string, title: string): { share: () => Promise<boolean>; copied: boolean } {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return false;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      return true;
    } catch {
      return false; /* user cancelled */
    }
  }
  return { share, copied };
}

/**
 * `compact` hides the label on phones so five actions fit in one row. With a `sharedPost` snapshot the button opens the
 * share sheet (send to friends, copy link); without one it falls back to the system share sheet or copying the link.
 */
export function ShareButton({
  path,
  title,
  className,
  compact,
  sharedPost,
  currentUserId,
}: {
  path: string;
  title: string;
  className?: string;
  compact?: boolean;
  /** What a friend receives in the chat; enables sending to friends. */
  sharedPost?: SharedPost;
  currentUserId?: string | null;
}) {
  const { share, copied } = useShare(path, title);
  const dialog = useShareDialog(path);
  const classes = cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-gray-800 hover:bg-gray-100", className);

  if (sharedPost) {
    return (
      <>
        <button type="button" onClick={dialog.show} aria-label="Share" className={classes}>
          <Share2 className="h-5 w-5 shrink-0" />
          <span className={cn(compact && "hidden sm:inline")}>Share</span>
        </button>
        <ShareDialog sharedPost={sharedPost} url={dialog.url} open={dialog.open} onClose={dialog.hide} currentUser={currentUserId ? { id: currentUserId } : null} />
      </>
    );
  }

  return (
    <button type="button" onClick={share} aria-label="Share" className={classes}>
      {copied ? <Check className="h-5 w-5 shrink-0 text-brand-600" /> : <Share2 className="h-5 w-5 shrink-0" />}
      <span className={cn(compact && !copied && "hidden sm:inline")}>{copied ? "Copied" : "Share"}</span>
    </button>
  );
}

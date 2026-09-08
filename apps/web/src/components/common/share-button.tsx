"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Native share sheet where available, otherwise copies the link. */
/** `compact` hides the label on phones so five actions fit in one row. */
export function ShareButton({ path, title, className, compact }: { path: string; title: string; className?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* user cancelled */
    }
  }
  return (
    <button type="button" onClick={share} aria-label="Share" className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-gray-800 hover:bg-gray-100", className)}>
      {copied ? <Check className="h-5 w-5 shrink-0 text-brand-600" /> : <Share2 className="h-5 w-5 shrink-0" />}
      <span className={cn(compact && !copied && "hidden sm:inline")}>{copied ? "Copied" : "Share"}</span>
    </button>
  );
}

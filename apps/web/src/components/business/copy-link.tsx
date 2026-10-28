"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { bizButton } from "./ui";

/**
 * A link to copy rather than open: the business's public profile, which a business account cannot browse itself (the
 * student site sends it back to the portal). Students and anyone signed out open it.
 */
export function CopyLink({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this link", url);
        }
      }}
      className={bizButton({ variant: "secondary" })}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : label}
    </button>
  );
}

"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { PortalLink } from "@/components/business/portal-base";
import { bizButton, Panel } from "@/components/business/ui";

/** A portal page that failed: say so plainly, offer to try again (retry re-fetches the page) or go home. */
export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Panel className="mx-auto flex max-w-lg flex-col items-center px-8 py-14 text-center" role="alert">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-biz-ink">Something went wrong</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-biz-ink-3">{error.message || "This page could not be loaded."} Nothing you saved is lost.</p>
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={() => retry()} className={bizButton({ variant: "primary" })}>
          <RotateCw className="h-4 w-4" /> Try again
        </button>
        <PortalLink href="/" className={bizButton({ variant: "ghost" })}>
          Home
        </PortalLink>
      </div>
    </Panel>
  );
}

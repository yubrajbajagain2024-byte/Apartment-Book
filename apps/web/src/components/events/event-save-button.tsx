"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark } from "lucide-react";
import { toggleEventSaveAction } from "@/lib/actions/events";
import { cn } from "@/lib/utils";

/**
 * The bookmark on an event card and on the event's page: it flips at once and the action settles it (the server
 * re-renders the page with the real state). Signed out, a tap goes to the login page and comes back here.
 */
export function EventSaveButton({ eventId, saved, signedIn, withLabel = false, className }: { eventId: string; saved: boolean; signedIn: boolean; withLabel?: boolean; className?: string }) {
  const [on, setOn] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setOn(saved);
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function toggle() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const next = !on;
    setOn(next);
    setError(null);
    start(async () => {
      const result = await toggleEventSaveAction(eventId);
      if (result.error) {
        setOn(!next);
        setError(result.error);
      } else setOn(result.saved);
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={on}
        aria-label={on ? "Saved" : "Save"}
        title={error ?? undefined}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-[color,background-color,scale] duration-150 motion-safe:active:scale-95",
          on ? "text-brand-700 hover:bg-brand-50" : "text-gray-700 hover:bg-gray-100",
          className,
        )}
      >
        <Bookmark className={cn("h-5 w-5 shrink-0", on && "fill-current")} />
        {withLabel ? <span>{on ? "Saved" : "Save"}</span> : null}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}

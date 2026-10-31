"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Plus } from "lucide-react";
import { toggleOrganizationFollowAction } from "@/lib/actions/events";
import { Button } from "@/components/ui/button";

/**
 * Follow / Following for a club, department or organization. Following lifts its events in For you; nothing is sent to
 * the organization. Optimistic like the people Follow button; signed out, a tap goes to the login page and comes back.
 */
export function OrganizationFollowButton({ organizationId, following, signedIn, size = "sm", className }: { organizationId: string; following: boolean; signedIn: boolean; size?: "sm" | "md"; className?: string }) {
  const [on, setOn] = useState(following);
  const [seen, setSeen] = useState(following);
  if (seen !== following) {
    setSeen(following);
    setOn(following);
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
      const result = await toggleOrganizationFollowAction(organizationId);
      if (result.error) {
        setOn(!next);
        setError(result.error);
      } else setOn(result.following);
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" variant={on ? "secondary" : "primary"} size={size} disabled={pending} aria-pressed={on} onClick={toggle} className={className}>
        {on ? <BellRing className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {on ? "Following" : "Follow"}
      </Button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}

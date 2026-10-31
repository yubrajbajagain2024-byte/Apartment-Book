"use client";

import { useEffect } from "react";
import { recordEventClickAction } from "@/lib/actions/events";

/** Counts one open of an event per signed-in viewer per day (the database keeps it to that); signed out it does nothing. */
export function EventOpenTracker({ eventId, signedIn }: { eventId: string; signedIn: boolean }) {
  useEffect(() => {
    if (!signedIn) return;
    recordEventClickAction(eventId, "open").catch(() => {});
  }, [eventId, signedIn]);
  return null;
}

/** A link that counts the tap (the registration link, the calendar's event page) before the new tab opens. */
export function CountedLink({ eventId, kind, signedIn, href, className, children }: { eventId: string; kind: "register" | "share"; signedIn: boolean; href: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => {
        if (signedIn) recordEventClickAction(eventId, kind).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}

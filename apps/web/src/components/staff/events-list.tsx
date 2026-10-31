"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { BadgeCheck, CalendarX2 } from "lucide-react";
import { categoryLabel, eventWhen } from "@apartment-book/shared";
import { setEventStatusAction } from "@/lib/staff/actions";
import type { ConsoleEvent } from "@/lib/staff/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNow } from "@/components/staff/live";
import { EmptyBox, Pill, type Tone } from "@/components/staff/parts";

const STATUS_TONE: Record<ConsoleEvent["status"], Tone> = { scheduled: "green", cancelled: "red", pending: "amber", hidden: "gray" };

/**
 * The events themselves, with Hide / Cancel / Restore per row and an optional note for the audit row. Hiding sticks
 * through the sync; cancelling a feed's event lasts until the calendar lists it again. Times are shown on the staff
 * member's own clock (the console is not a campus page).
 */
export function EventsConsoleList({ events }: { events: ConsoleEvent[] }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  // The console ticks like the queue does, so "Today" and "Tomorrow" stay right on a page left open.
  const nowMs = useNow(60_000);

  function act(id: string, status: "scheduled" | "cancelled" | "hidden") {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    start(async () => {
      const res = await setEventStatusAction({ id, status, note: notes[id] });
      if (!res.ok) setErrors((e) => ({ ...e, [id]: res.error }));
      else setNotes((n) => ({ ...n, [id]: "" }));
      setBusy(null);
    });
  }

  if (events.length === 0) return <EmptyBox icon={CalendarX2} title="No events match." />;

  return (
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      {events.map((e) => {
        const rowBusy = pending && busy === e.id;
        return (
          <li key={e.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/events/${e.id}`} className="text-sm font-semibold text-gray-900 hover:underline">
                {e.title}
              </Link>
              <Pill tone={STATUS_TONE[e.status]}>{e.status}</Pill>
              <Pill variant="outline">{e.source === "feed" ? "feed" : "organization"}</Pill>
              <Pill variant="outline" tone="blue">
                {categoryLabel(e.category)}
              </Pill>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
              <span>{eventWhen(e, timeZone, nowMs)}</span>
              {e.location ? <span>{e.location}</span> : null}
              <span>{e.university_name}</span>
              {e.organization_name ? (
                <span className="inline-flex items-center gap-1">
                  {e.organization_name}
                  {e.organization_verified ? <BadgeCheck className="h-3 w-3 text-brand-600" aria-label="verified" /> : null}
                </span>
              ) : e.feed_name ? (
                <span>feed: {e.feed_name}</span>
              ) : null}
              <span>
                {e.save_count} saves · {e.click_count} clicks
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={notes[e.id] ?? ""} onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))} placeholder="Note for the audit log (optional)" className="h-8 min-w-48 flex-1 text-xs" maxLength={2000} />
              {e.status !== "scheduled" && e.status !== "pending" ? (
                <Button type="button" variant="outline" size="sm" disabled={rowBusy} onClick={() => act(e.id, "scheduled")}>
                  Restore
                </Button>
              ) : null}
              {e.status === "scheduled" ? (
                <Button type="button" variant="outline" size="sm" disabled={rowBusy} onClick={() => act(e.id, "cancelled")}>
                  Cancel
                </Button>
              ) : null}
              {e.status !== "hidden" ? (
                <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" disabled={rowBusy} onClick={() => act(e.id, "hidden")}>
                  Hide
                </Button>
              ) : null}
            </div>
            {errors[e.id] ? <p className="text-xs text-red-600">{errors[e.id]}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

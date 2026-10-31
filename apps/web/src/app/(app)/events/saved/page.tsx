import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Bookmark } from "lucide-react";
import { getUniversityTimeZone, listSavedEvents } from "@apartment-book/shared";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCard } from "@/components/events/event-card";

export const metadata: Metadata = { title: "Saved events" };

/** The student's bookmarked events, the most recently saved first; past ones stay until they take the bookmark back. */
export default async function SavedEventsPage() {
  const user = await requireUser("/events/saved");
  const [supabase, profile] = await Promise.all([createClient(), getCurrentProfile()]);
  const [events, timeZone] = await Promise.all([listSavedEvents(supabase, user.id), getUniversityTimeZone(supabase, profile?.university_id)]);
  const nowMs = requestNow();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link href="/events" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">Saved events</h1>
      {events.length === 0 ? (
        <EmptyState icon={Bookmark} title="Nothing saved yet" description="Tap the bookmark on any event to keep it here." />
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={e.id}>
              <EventCard event={e} timeZone={timeZone ?? "America/Chicago"} nowMs={nowMs} saved signedIn />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

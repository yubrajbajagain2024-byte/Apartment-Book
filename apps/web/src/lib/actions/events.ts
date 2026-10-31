"use server";

import { revalidatePath } from "next/cache";
import { recordEventClick, toggleEventSave, toggleOrganizationFollow } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bookmark an event or take the bookmark back; the Events pages and the event's own page are server-rendered, so they re-render. */
export async function toggleEventSaveAction(eventId: string): Promise<{ saved: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { saved: false, error: "Log in to save events." };
  if (!UUID.test(eventId)) return { saved: false, error: "That event is not available." };
  try {
    const saved = await toggleEventSave(await createClient(), user.id, eventId);
    revalidatePath("/events");
    revalidatePath("/events/saved");
    revalidatePath(`/events/${eventId}`);
    return { saved };
  } catch {
    return { saved: false, error: "Could not update your saved events." };
  }
}

/** Follow an organization or stop; the For you ranking reads follows, so the Events pages re-render. */
export async function toggleOrganizationFollowAction(organizationId: string): Promise<{ following: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { following: false, error: "Log in to follow organizations." };
  if (!UUID.test(organizationId)) return { following: false, error: "That organization is not available." };
  try {
    const following = await toggleOrganizationFollow(await createClient(), user.id, organizationId);
    revalidatePath("/events");
    revalidatePath(`/organizations/${organizationId}`);
    return { following };
  } catch {
    return { following: false, error: "Could not update the follow." };
  }
}

/** Counts an open, a registration tap or a share for the ranking; signed out it counts nothing, and it never fails the page. */
export async function recordEventClickAction(eventId: string, kind: "open" | "register" | "share"): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !UUID.test(eventId)) return;
  await recordEventClick(await createClient(), eventId, kind);
}

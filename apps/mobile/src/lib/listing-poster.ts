import { useEffect, useSyncExternalStore } from "react";
import { ANONYMOUS_POSTER, myAnonymousListings, type PosterSummary } from "@apartment-book/shared";
import { supabase } from "./supabase";

/**
 * Who posted a roommate post or a Marketplace item, as the apps show it. An anonymous listing's row has no poster at
 * all (the database keeps it apart, readable by the poster alone), so it reads "Anonymous" with no photo and no profile
 * to open; its poster recognises it as theirs through useMyAnonymousListings().
 */
export type ListingPoster = { id: string; name: string; avatarUrl: string | null; verified: boolean; anonymous: boolean };

export function listingPoster(person: PosterSummary | null | undefined): ListingPoster {
  if (!person) return { id: ANONYMOUS_POSTER.id, name: ANONYMOUS_POSTER.name, avatarUrl: null, verified: false, anonymous: true };
  return { id: person.id, name: person.full_name, avatarUrl: person.avatar_url, verified: Boolean(person.university?.email_domain), anonymous: false };
}

type Mine = { userId: string; roommate: Set<string>; item: Set<string> };
let mine: Mine | null = null;
let loading: string | null = null;
const listeners = new Set<() => void>();
const emit = (next: Mine) => {
  mine = next;
  listeners.forEach((l) => l());
};

/** Reads the signed-in person's anonymous listings (again), e.g. once the app is opened. */
export async function loadMyAnonymousListings(userId: string): Promise<void> {
  if (loading === userId) return;
  loading = userId;
  try {
    const { roommate, item } = await myAnonymousListings(supabase);
    emit({ userId, roommate: new Set([...(mine?.userId === userId ? mine.roommate : []), ...roommate]), item: new Set([...(mine?.userId === userId ? mine.item : []), ...item]) });
  } finally {
    loading = null;
  }
}

/** A listing just posted anonymously by `userId`: theirs at once, before anything is read again. */
export function markMyAnonymousListing(userId: string, type: "roommate" | "item", id: string) {
  const base = mine?.userId === userId ? mine : { userId, roommate: new Set<string>(), item: new Set<string>() };
  emit({ ...base, [type]: new Set([...base[type], id]) });
}

/** Whether the signed-in person posted this anonymous listing: `(type, id) => boolean`, current as they post. */
export function useMyAnonymousListings(userId: string | null | undefined): (type: string, id: string) => boolean {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => mine,
    () => mine,
  );
  useEffect(() => {
    if (userId && current?.userId !== userId) void loadMyAnonymousListings(userId);
  }, [userId, current?.userId]);
  return (type, id) => Boolean(userId && current?.userId === userId && (type === "roommate" ? current.roommate.has(id) : type === "item" ? current.item.has(id) : false));
}

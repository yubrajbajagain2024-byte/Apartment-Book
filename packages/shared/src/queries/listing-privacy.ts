import { DEFAULT_LISTING_AUDIENCE, type ListingAudience } from "../constants";
import type { Client } from "../types/models";

/**
 * Anonymous listings and listing audiences (20261105000000_anonymous_listings.sql): what the create flow writes, and how
 * the apps tell their own anonymous listings apart (the rows show no poster, to their poster as to everyone).
 */
export const LISTING_PRIVACY_UNAVAILABLE = "Posting anonymously and choosing who sees a listing arrive with the next update. Post it under your name, for everyone, to share it now.";

/**
 * The listing flow's two choices as columns, only where they differ from a plain listing: one without them inserts the
 * same row as before the migration, so posting keeps working on a database that does not have it yet.
 */
export function listingPrivacyColumns(input: { isAnonymous?: boolean; audience?: ListingAudience }) {
  return {
    ...(input.isAnonymous ? { is_anonymous: true } : {}),
    ...(input.audience && input.audience !== DEFAULT_LISTING_AUDIENCE ? { audience: input.audience } : {}),
  };
}

/** A write refused because the database has no such column yet (PostgREST's schema cache, or Postgres itself). */
export function missingPrivacyColumns(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

const support = new WeakMap<Client, Promise<boolean>>();

/** Whether this database keeps anonymous listings and audiences. Asked once per client: a select that reads no rows. */
export function listingPrivacyAvailable(supabase: Client): Promise<boolean> {
  let known = support.get(supabase);
  if (!known) {
    known = Promise.resolve(supabase.from("items").select("is_anonymous, audience").limit(0)).then(
      ({ error }) => !error,
      () => false,
    );
    // A network failure is not an answer: ask again next time.
    known.then((ok) => {
      if (!ok) support.delete(supabase);
    });
    support.set(supabase, known);
  }
  return known;
}

/**
 * The signed-in person's own anonymous listings, by kind: only they can read these rows. Empty when signed out or on a
 * database before the migration.
 */
export async function myAnonymousListings(supabase: Client): Promise<{ roommate: string[]; item: string[] }> {
  try {
    const { data, error } = await supabase.from("anonymous_listing_owners").select("roommate_post_id, item_id");
    if (error || !data) return { roommate: [], item: [] };
    return {
      roommate: data.map((r) => r.roommate_post_id).filter((id): id is string => Boolean(id)),
      item: data.map((r) => r.item_id).filter((id): id is string => Boolean(id)),
    };
  } catch {
    return { roommate: [], item: [] };
  }
}

/** Whether `userId` posted this roommate post or item, anonymously or not (an anonymous one's row names nobody). */
export async function isMyListing(
  supabase: Client,
  userId: string,
  type: "roommate" | "item",
  row: { id: string; is_anonymous?: boolean; author_id?: string | null; seller_id?: string | null },
): Promise<boolean> {
  const poster = type === "roommate" ? row.author_id : row.seller_id;
  if (poster) return poster === userId;
  if (!row.is_anonymous) return false;
  return (await myAnonymousListings(supabase))[type].includes(row.id);
}

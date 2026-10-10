import type { FeedMedia, FeedPostWithAuthor, ProfileClass, ProfileSection, ProfileTile, ProfileVisibility } from "./types/models";

// -----------------------------------------------------------------------------
// Who can see Classes, Saved and Liked
// -----------------------------------------------------------------------------
export const PROFILE_VISIBILITIES: ProfileVisibility[] = ["public", "friends", "private"];
export const PROFILE_VISIBILITY_OPTIONS: { value: ProfileVisibility; label: string; description: string }[] = [
  { value: "public", label: "Everyone", description: "Anyone on CampConnect" },
  { value: "friends", label: "Friends", description: "People you follow who follow you back" },
  { value: "private", label: "Only me", description: "Nobody else can see it" },
];
export const PROFILE_SECTIONS: ProfileSection[] = ["classes", "saved", "liked"];
/** What each tab holds, in the words of the settings and the lock messages. */
export const PROFILE_SECTION_NOUNS: Record<ProfileSection, string> = { classes: "classes", saved: "saved posts", liked: "liked posts" };
/** The profile column behind each setting. */
export const PROFILE_VISIBILITY_COLUMNS = { classes: "classes_visibility", saved: "saved_visibility", liked: "liked_visibility" } as const;

export function isProfileVisibility(value: unknown): value is ProfileVisibility {
  return value === "public" || value === "friends" || value === "private";
}

export function visibilityLabel(value: ProfileVisibility): string {
  return PROFILE_VISIBILITY_OPTIONS.find((o) => o.value === value)?.label ?? "Only me";
}

/** The owner's own line above a tab: "Only you can see your saved posts". */
export function ownSectionNote(section: ProfileSection, value: ProfileVisibility): string {
  const noun = PROFILE_SECTION_NOUNS[section];
  if (value === "public") return `Everyone can see your ${noun}`;
  if (value === "friends") return `Your friends can see your ${noun}`;
  return `Only you can see your ${noun}`;
}

/** What a visitor reads on a tab they may not open: "Only Sunil can see their saved posts". */
export function lockedSectionMessage(section: ProfileSection, value: ProfileVisibility, firstName: string): string {
  const noun = PROFILE_SECTION_NOUNS[section];
  const name = firstName.trim() || "This person";
  if (value === "friends") return `Only ${name}'s friends can see their ${noun}`;
  return `Only ${name} can see their ${noun}`;
}

// -----------------------------------------------------------------------------
// Semesters
// -----------------------------------------------------------------------------
const SEASONS = ["Spring", "Summer", "Fall"] as const;
const TERM = /^(Spring|Summer|Fall|Winter) (\d{4})$/;

/** January to May is Spring, June and July Summer, August to December Fall. */
export function currentTerm(date: Date = new Date()): string {
  const month = date.getMonth();
  const season = month <= 4 ? "Spring" : month <= 6 ? "Summer" : "Fall";
  return `${season} ${date.getFullYear()}`;
}

/** Sorts terms in time order: Spring 2026 < Summer 2026 < Fall 2026 < Winter 2026 < Spring 2027. */
export function termSortKey(term: string): number {
  const m = TERM.exec(term);
  if (!m) return 0;
  const order = m[1] === "Spring" ? 1 : m[1] === "Summer" ? 2 : m[1] === "Fall" ? 3 : 4;
  return Number(m[2]) * 10 + order;
}

/** The term `delta` steps away (Winter is skipped: it is a short session, not a semester). */
export function shiftTerm(term: string, delta: number): string {
  const m = TERM.exec(term);
  if (!m) return term;
  let index = Math.max(0, SEASONS.indexOf(m[1] as (typeof SEASONS)[number]));
  let year = Number(m[2]);
  for (let step = 0; step < Math.abs(delta); step++) {
    index += delta > 0 ? 1 : -1;
    if (index > 2) {
      index = 0;
      year += 1;
    } else if (index < 0) {
      index = 2;
      year -= 1;
    }
  }
  return `${SEASONS[index]} ${year}`;
}

/** The terms someone usually picks from: this one first, then the next and the previous one. */
export function pickableTerms(date: Date = new Date()): string[] {
  const now = currentTerm(date);
  return [now, shiftTerm(now, 1), shiftTerm(now, -1)];
}

/** Classes grouped by term: the current term first, then the rest newest first; classes in the order they were added. */
export function groupClassesByTerm(classes: ProfileClass[], date: Date = new Date()): { term: string; current: boolean; classes: ProfileClass[] }[] {
  const now = currentTerm(date);
  const groups = new Map<string, ProfileClass[]>();
  for (const c of classes) groups.set(c.term, [...(groups.get(c.term) ?? []), c]);
  return [...groups.entries()]
    .map(([term, list]) => ({ term, current: term === now, classes: [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
    .sort((a, b) => (a.current === b.current ? termSortKey(b.term) - termSortKey(a.term) : a.current ? -1 : 1));
}

/** "cs3358 " becomes "CS 3358", the way the database stores it. */
export function normalizeClassCode(input: string): string {
  return input.trim().replace(/\s+/g, " ").toUpperCase().replace(/^([A-Z&]+)(\d)/, "$1 $2");
}

/** Why a class code would be refused, or null. Mirrors the database check. */
export function classCodeProblem(input: string): string | null {
  const code = normalizeClassCode(input);
  if (code.length < 2 || code.length > 16) return "Class codes are 2 to 16 characters, like CS 3358.";
  if (!/^[A-Z0-9][A-Z0-9 .&-]*[A-Z0-9]$/.test(code)) return "Use letters and numbers, like CS 3358.";
  return null;
}

// -----------------------------------------------------------------------------
// Usernames
// -----------------------------------------------------------------------------
export const USERNAME_RULES = "3 to 30 characters: letters, numbers, dots and underscores, starting and ending with a letter or number.";

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

/** Why a username would be refused, or null. Mirrors the database check (taken names are only known there). */
export function usernameProblem(input: string): string | null {
  const name = normalizeUsername(input);
  if (!/^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/.test(name) || /[._]{2}/.test(name)) return `Usernames are ${USERNAME_RULES}`;
  return null;
}

// -----------------------------------------------------------------------------
// Grid tiles
// -----------------------------------------------------------------------------
const LISTING_BASES = { apartment: "/apartments", roommate: "/roommates", item: "/marketplace" } as const;

function firstImage(media: FeedMedia[]): { url: string | null; isVideo: boolean } {
  const first = media[0];
  if (!first) return { url: null, isVideo: false };
  return first.type === "photo" ? { url: first.url, isVideo: false } : { url: first.poster ?? null, isVideo: true };
}

/** A post or reel as a grid square. Pass the media the app already builds for it (listingMedia). */
export function tileFromFeedPost(post: Pick<FeedPostWithAuthor, "id" | "kind" | "body" | "pinned_at">, media: FeedMedia[], views: number | null = null): ProfileTile {
  const reel = post.kind === "reel";
  const { url, isVideo } = firstImage(media);
  const text = post.body?.trim() ? post.body.trim() : null;
  return {
    key: `post:${post.id}`,
    type: reel ? "reel" : "post",
    id: post.id,
    href: `/posts/${post.id}`,
    imageUrl: url,
    text,
    isVideo: reel || isVideo,
    multiPhoto: media.length > 1,
    pinned: Boolean(post.pinned_at),
    views,
  };
}

/** An apartment, roommate post or marketplace item as a grid square or a Listings card. */
export function tileFromListing(type: keyof typeof LISTING_BASES, row: { id: string; title: string }, media: FeedMedia[]): ProfileTile {
  const { url, isVideo } = firstImage(media);
  return {
    key: `${type}:${row.id}`,
    type,
    id: row.id,
    href: `${LISTING_BASES[type]}/${row.id}`,
    imageUrl: url,
    text: row.title?.trim() || null,
    isVideo,
    multiPhoto: media.length > 1,
    pinned: false,
    views: null,
  };
}

/** Pinned first (the most recently pinned on top), then newest. */
export function sortPinnedFirst<T extends { pinned_at: string | null; created_at: string }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => {
    if (a.pinned_at && b.pinned_at) return b.pinned_at.localeCompare(a.pinned_at);
    if (a.pinned_at || b.pinned_at) return a.pinned_at ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

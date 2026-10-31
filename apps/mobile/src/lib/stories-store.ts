import { useEffect, useSyncExternalStore } from "react";
import { groupStories, listStories, listStoryMutes, setStoryMuted as saveStoryMuted, type Story, type StoryGroup } from "@apartment-book/shared";
import { supabase } from "./supabase";

/**
 * The stories the person may see, read once for the whole app (Home's tray and the full-screen viewer share it), with
 * the viewer's own marks of what has been watched, so a ring greys out the moment its stories were seen rather than on
 * the next load. Reloaded when stale (a minute, checked every half minute while the tray is on screen), after a story of
 * your own is shared (markStoriesStale) and on Home's pull to refresh. A story that passes its 24 hours while the app is
 * open leaves the tray at the next check. What may be seen is the database's decision (migration 58): this only orders
 * what it sent.
 *
 * The people whose stories this person has muted (migration 62) stay out of the tray (`groups`), but their stories are
 * still here (`allGroups`): a story card in a chat, or their own profile, can still open one.
 */
let stories: Story[] = [];
let allGroups: StoryGroup[] = [];
let groups: StoryGroup[] = [];
let muted: ReadonlySet<string> = new Set();
let loadedFor: string | null = null;
let loadedAt = 0;
let version = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const STALE_MS = 60_000;
const TICK_MS = 30_000;

function emit() {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The tray's groups from `stories`: everyone's, then without the muted people (your own always stays). */
function regroup(now?: number): void {
  allGroups = groupStories(stories, loadedFor, now);
  groups = muted.size === 0 ? allGroups : allGroups.filter((g) => g.mine || !muted.has(g.author.id));
}

export function getStoryGroups(): StoryGroup[] {
  return groups;
}

export async function refreshStories(meId: string): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // The mutes are a filter on top: if they cannot be read, the last ones known stay in force.
      const [fresh, mutes] = await Promise.all([listStories(supabase, meId), listStoryMutes(supabase, meId).catch(() => null)]);
      stories = fresh;
      if (mutes) muted = new Set(mutes);
      loadedFor = meId;
      regroup();
      loadedAt = Date.now();
      emit();
    } catch {
      // What is shown stays; the next look tries again.
      loadedAt = Date.now() - STALE_MS + 10_000;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** A story of your own went out (or away): the tray reads again at its next look. */
export function markStoriesStale(): void {
  loadedAt = 0;
  emit();
}

/** The viewer showed this story: its ring greys at once, and the viewer starts after it next time. */
export function noteStorySeen(storyId: string): void {
  const i = stories.findIndex((s) => s.id === storyId);
  if (i < 0 || stories[i]!.seen) return;
  stories = stories.map((s) => (s.id === storyId ? { ...s, seen: true } : s));
  regroup();
  emit();
}

/** A story of your own was deleted: gone from the tray at once. */
export function noteStoryDeleted(storyId: string): void {
  stories = stories.filter((s) => s.id !== storyId);
  regroup();
  emit();
}

/** The heart on a story changed (or went back after the server said no): the viewer shows it on the next look too. */
export function noteStoryLiked(storyId: string, liked: boolean): void {
  if (!stories.some((s) => s.id === storyId && s.liked !== liked)) return;
  stories = stories.map((s) => (s.id === storyId ? { ...s, liked } : s));
  regroup();
  emit();
}

/** You blocked this person: their stories leave at once (the database stops sending them on the next load). */
export function noteStoryAuthorBlocked(authorId: string): void {
  stories = stories.filter((s) => s.author.id !== authorId);
  regroup();
  loadedAt = 0;
  emit();
}

/**
 * The group a story viewer opened by id should show: the person's, by their id or by one of their stories' ids (a
 * story card in a chat names the story). Muted people's stories are found too: only the tray leaves them out.
 */
export function findStoryGroup(id: string): StoryGroup | null {
  return allGroups.find((g) => g.author.id === id || g.stories.some((s) => s.id === id)) ?? null;
}

/** Whether this person's stories are muted (the tray leaves them out). */
export function useStoryMuted(authorId: string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => Boolean(authorId && muted.has(authorId)), () => Boolean(authorId && muted.has(authorId)));
}

/**
 * Mute or unmute someone's stories: the tray changes at once and goes back if the server says no (the error is thrown
 * for the caller to show). Muting never tells the other person.
 */
export async function setStoryMuted(meId: string, authorId: string, mute: boolean): Promise<void> {
  const before = muted;
  const next = new Set(muted);
  if (mute) next.add(authorId);
  else next.delete(authorId);
  muted = next;
  regroup();
  emit();
  try {
    await saveStoryMuted(supabase, meId, authorId, mute);
  } catch (e) {
    muted = before;
    regroup();
    emit();
    throw e;
  }
}

/** Stories past their 24 hours leave the tray (groupStories drops them); nothing changes when none has. */
function dropExpired(): void {
  const now = Date.now();
  if (!stories.some((s) => Date.parse(s.expiresAt) <= now)) return;
  stories = stories.filter((s) => Date.parse(s.expiresAt) > now);
  regroup(now);
  emit();
}

export function useStoryGroups(): StoryGroup[] {
  return useSyncExternalStore(subscribe, () => groups, () => groups);
}

/** The tray's stories: loaded while `active` whenever they are stale, kept between visits. */
export function useStories(meId: string | null, active: boolean): StoryGroup[] {
  const v = useSyncExternalStore(subscribe, () => version, () => version);
  useEffect(() => {
    if (!meId || !active) return;
    const look = () => {
      dropExpired();
      if (loadedFor !== meId || Date.now() - loadedAt > STALE_MS) void refreshStories(meId);
    };
    look();
    // While the tray is on screen, expired stories leave it and new ones arrive without a pull.
    const timer = setInterval(look, TICK_MS);
    return () => clearInterval(timer);
    // `v` re-runs the check after markStoriesStale().
  }, [meId, active, v]);
  return useStoryGroups();
}

/**
 * The tray hands the viewer the groups it shows and where it was tapped, so the viewer opens on them at once and keeps
 * their order while it is open (new stories wait for the next look at the tray).
 */
let handed: { groups: StoryGroup[]; index: number } | null = null;
export function handStories(list: StoryGroup[], index: number): void {
  handed = { groups: list, index };
}
export function takeStories(): { groups: StoryGroup[]; index: number } | null {
  const h = handed;
  handed = null;
  return h;
}

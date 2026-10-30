import { useEffect, useSyncExternalStore } from "react";
import { groupStories, listStories, type Story, type StoryGroup } from "@apartment-book/shared";
import { supabase } from "./supabase";

/**
 * The stories the person may see, read once for the whole app (Home's tray and the full-screen viewer share it), with
 * the viewer's own marks of what has been watched, so a ring greys out the moment its stories were seen rather than on
 * the next load. Reloaded when stale (a minute), after a story of your own is shared (markStoriesStale) and on pull to
 * refresh. What may be seen is the database's decision (migration 58): this only orders what it sent.
 */
let stories: Story[] = [];
let groups: StoryGroup[] = [];
let loadedFor: string | null = null;
let loadedAt = 0;
let version = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const STALE_MS = 60_000;

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

export function getStoryGroups(): StoryGroup[] {
  return groups;
}

export async function refreshStories(meId: string): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fresh = await listStories(supabase, meId);
      stories = fresh;
      groups = groupStories(stories, meId);
      loadedFor = meId;
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
  groups = groupStories(stories, loadedFor);
  emit();
}

/** A story of your own was deleted: gone from the tray at once. */
export function noteStoryDeleted(storyId: string): void {
  stories = stories.filter((s) => s.id !== storyId);
  groups = groupStories(stories, loadedFor);
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
    if (loadedFor !== meId || Date.now() - loadedAt > STALE_MS) void refreshStories(meId);
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

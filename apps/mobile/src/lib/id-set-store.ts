import { useEffect, useSyncExternalStore } from "react";
import type { Client } from "@apartment-book/shared";
import { supabase } from "./supabase";

/**
 * A set of ids that is the signed-in person's own (the events they saved, the organizations they follow), read once for
 * the whole app and flipped optimistically: every card, row and details screen reads the same set, so a bookmark
 * tapped in a list is already filled when the event opens, with no prop drilling and no second request. Loaded the
 * first time a screen asks while someone is signed in, emptied when they sign out, put back as it was if a flip fails.
 */
export type IdSetStore = {
  /** The set as it is now; subscribes the caller and loads it for `userId` on first use. Signed out: empty. */
  useIds: (userId: string | null) => ReadonlySet<string>;
  has: (id: string) => boolean;
  /** Flips one id at once and asks the database; resolves to the state the database kept. */
  toggle: (userId: string, id: string) => Promise<boolean>;
  reload: (userId: string) => Promise<void>;
};

const EMPTY: ReadonlySet<string> = new Set();

export function createIdSetStore(load: (client: Client, userId: string) => Promise<Set<string>>, toggleRemote: (client: Client, userId: string, id: string) => Promise<boolean>): IdSetStore {
  let ids: ReadonlySet<string> = EMPTY;
  let loadedFor: string | null = null;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };
  // A new Set each time, so useSyncExternalStore sees a change.
  const set = (next: ReadonlySet<string>) => {
    ids = next;
    listeners.forEach((l) => l());
  };
  const reload = (userId: string): Promise<void> => {
    if (inflight && loadedFor === userId) return inflight;
    loadedFor = userId;
    inflight = load(supabase, userId)
      .then((fresh) => {
        if (loadedFor === userId) set(fresh);
      })
      .catch(() => {
        // What is shown stays empty; the next screen asks again.
        if (loadedFor === userId) loadedFor = null;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  return {
    useIds(userId) {
      useEffect(() => {
        if (!userId) {
          if (loadedFor !== null) {
            loadedFor = null;
            set(EMPTY);
          }
          return;
        }
        if (loadedFor !== userId) void reload(userId);
      }, [userId]);
      return useSyncExternalStore(subscribe, () => ids, () => ids);
    },
    has: (id) => ids.has(id),
    async toggle(userId, id) {
      const before = ids;
      const next = new Set(before);
      const on = !next.has(id);
      if (on) next.add(id);
      else next.delete(id);
      set(next);
      try {
        const kept = await toggleRemote(supabase, userId, id);
        if (kept !== on) {
          const fixed = new Set(ids);
          if (kept) fixed.add(id);
          else fixed.delete(id);
          set(fixed);
        }
        return kept;
      } catch (e) {
        set(before);
        throw e;
      }
    },
    reload,
  };
}

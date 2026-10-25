import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { createPresenceStore, onBlocksChanged, type OnlineUser, type PresenceStatus, type PresenceStore } from "@apartment-book/shared";
import { currentPresence, endPresence, setCurrentPresence } from "./presence-store";
import { supabase } from "./supabase";
import { useSession } from "./session";

const EMPTY: ReadonlyMap<string, OnlineUser> = new Map();
const Ctx = createContext<PresenceStore | null>(null);

/**
 * Joins the private presence channel while signed in, unless the user hides their active status: then the database
 * neither shows them to anyone nor shows them anyone, so there is no store at all. The store stamps the user's
 * last-active time as it starts and every minute while the app is in front. Going to the background (the home screen,
 * another app, a call, Android's photo picker) stamps it once more and stops showing the user online at once, while
 * the app can still say so (no timer runs once it is in the background), though they keep hearing who else is; coming
 * back shows them again once a stamp is in. A glance at Notification or Control Center (iOS's "inactive") is not
 * leaving.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useSession();
  const key = profile && profile.show_active_status ? `${profile.id}|${profile.full_name}|${profile.avatar_url ?? ""}` : null;
  // The store a new one replaces (another account signed in over it) ends after this render, not during it: ending it
  // tells every avatar following it at once, and React lets no other component change while this one renders.
  const replaced = useRef<PresenceStore | null>(null);
  const store = useMemo(() => {
    if (!key || !profile) return null;
    const current = currentPresence();
    if (current && current.userId === profile.id && current.store.getStatus() !== "ended") return current.store;
    if (current) replaced.current = current.store;
    const s = createPresenceStore(supabase, { id: profile.id, full_name: profile.full_name, avatar_url: profile.avatar_url });
    setCurrentPresence({ userId: profile.id, store: s });
    // Started in the background (by a notification, say): it listens, but shows the user online only once they open the app.
    if (AppState.currentState === "background") s.pause();
    s.start();
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useLayoutEffect(() => {
    const old = replaced.current;
    replaced.current = null;
    if (old && old !== store) void old.stop();
  }, [store]);
  useEffect(() => {
    if (!key) endPresence();
  }, [key]);
  useEffect(() => {
    if (!store) return;
    // AppState.currentState is typed as any string, though it is always one of AppStateStatus's.
    const follow = (state: AppStateStatus | string | null | undefined) => {
      if (state === "active") store.resume();
      // On a phone, at once. (The web build follows the browser tab, whose timers keep running: a short grace.)
      else if (state === "background") store.pause({ leaveNow: Platform.OS !== "web" });
    };
    // In step with the app as it is now (it may have moved since the store was made), then with every change.
    follow(AppState.currentState);
    const sub = AppState.addEventListener("change", follow);
    // A block or unblock here: leave them out of (or bring them back into) who is online at once.
    const offBlocks = onBlocksChanged(() => store.refreshBlocks());
    // The status turned out hidden (turned off on another device): read the profile again, so Settings shows it off
    // and this store goes.
    let wasHidden = store.getStatus() === "hidden";
    const offStatus = store.subscribe(() => {
      const hidden = store.getStatus() === "hidden";
      if (hidden && !wasHidden) void refreshProfile();
      wasHidden = hidden;
    });
    // The store ends when the session seems gone. Should it come back for the same user (renewed after all, or signed in
    // again), start again. (Outside the callback: auth calls inside it would wait on themselves.)
    const mine = currentPresence();
    const userId = mine && mine.store === store ? mine.userId : null;
    const {
      data: { subscription: offAuth },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event !== "TOKEN_REFRESHED" && event !== "SIGNED_IN") || !userId || session?.user.id !== userId) return;
      setTimeout(() => {
        if (store.getStatus() === "ended" && currentPresence()?.store === store) store.start();
      }, 0);
    });
    return () => {
      sub.remove();
      offBlocks();
      offStatus();
      offAuth.unsubscribe();
    };
  }, [store, refreshProfile]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

const noop = () => () => {};
/** Everyone online now (you included), except people blocked either way with you. */
export function useOnlineUsers(): ReadonlyMap<string, OnlineUser> {
  const store = useContext(Ctx);
  return useSyncExternalStore(store?.subscribe ?? noop, store ? store.getSnapshot : () => EMPTY, () => EMPTY);
}
export function useIsOnline(userId: string | null | undefined): boolean {
  return Boolean(userId && useOnlineUsers().has(userId));
}

/**
 * Whether who is online is known right now (PresenceStore.isReady): false with no store (signed out, or the user hides
 * their own status), before the first sync, while the channel is down, and after coming back to the app from a while
 * away until that return is confirmed. Until it is true, show no "Active now" or last-active time at all.
 */
export function usePresenceReady(): boolean {
  const store = useContext(Ctx);
  return useSyncExternalStore(store?.subscribe ?? noop, store ? store.isReady : () => false, () => false);
}

/** PresenceStore.getStatus(), or null with no store at all (signed out, or the user hides their own status). */
export function usePresenceStatus(): PresenceStatus | null {
  const store = useContext(Ctx);
  return useSyncExternalStore(store?.subscribe ?? noop, store ? store.getStatus : () => null, () => null);
}

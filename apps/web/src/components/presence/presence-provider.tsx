"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createPresenceStore, onBlocksChanged, type OnlineUser, type PresenceStatus, type PresenceStore, type ProfileSummary } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";
import { createClient, ensureRealtimeAuth } from "@/lib/supabase/client";

const EMPTY: ReadonlyMap<string, OnlineUser> = new Map();
const PresenceContext = createContext<PresenceStore | null>(null);
/** pagehide right after the tab was hidden is the visible tab being closed; later, it is a background tab going away. */
const PAGEHIDE_VISIBLE_SLACK_MS = 1500;

// One store per signed-in user for the life of the page. Kept outside React so Strict Mode's double effects and route
// changes never re-join the channel (a re-created channel with the same topic would collide with the old one), and so it
// keeps following the page while no provider is mounted (a 404 or an error page replaces the app's layout).
let store: { userId: string; presence: PresenceStore; detach: () => void } | null = null;

function storeFor(me: ProfileSummary): PresenceStore {
  // A store whose session ended (signed out in another tab, say) is replaced: this is a new sign-in.
  if (store && store.userId === me.id && store.presence.getStatus() !== "ended") return store.presence;
  endStore();
  const supabase = createClient();
  // The store stamps the last-active time itself (touch_activity): when it starts, every minute while the tab is in
  // front, and as the tab goes to the background.
  const presence = createPresenceStore(supabase, { id: me.id, full_name: me.full_name, avatar_url: me.avatar_url });
  store = { userId: me.id, presence, detach: followPage(supabase, presence, me.id) };
  // The channel is private, so the realtime socket has to carry the user's token before it joins.
  ensureRealtimeAuth(supabase).then((authed) => {
    if (authed && store?.presence === presence) presence.start();
  });
  return presence;
}

/** Leave the channel (others see it at once), stop the heartbeat and every listener. */
function endStore(): void {
  const s = store;
  store = null;
  if (!s) return;
  s.detach();
  void s.presence.stop();
}

/**
 * Signing out: stamp the time once more, then stop appearing online at once and stop the heartbeat. Call it before the
 * session goes (the Log out button does).
 */
export function stopPresence(): void {
  store?.presence.pause();
  endStore();
}

/**
 * Phones and tablets (a touch screen, no mouse): their browsers stop a hidden page's timers almost at once, so a grace
 * before leaving would last until the server dropped the silent connection.
 */
function timersStopWhenHidden(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

/**
 * For the store's whole life (not a component's): a tab in the background does not count as active, so while the page
 * is hidden the store stops appearing online (after a short grace on a computer, at once on a phone or tablet or when
 * the browser freezes the page, stamping the time as it goes) and stamps nothing more; shown again, it appears and
 * stamps again. Closing or leaving a page the person was looking at stamps a last time, with a request that outlives
 * the page; closing a tab that sat in the background does not (it was not activity). The session ending in this tab,
 * or coming back after the store took it for gone, and a block or unblock, are passed on too. Returns the cleanup.
 */
function followPage(supabase: ReturnType<typeof createClient>, presence: PresenceStore, userId: string): () => void {
  // pagehide cannot wait for getSession(), so the latest token is kept at hand.
  let accessToken: string | null = null;
  let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    accessToken = session?.access_token ?? null;
    if (event === "SIGNED_OUT" && store?.presence === presence) endStore();
    else if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session?.user.id === userId) {
      // The store ends when the session seems gone; it is back for the same person: start again, once the realtime
      // socket carries the token (outside the callback: auth calls inside it would wait on themselves).
      setTimeout(() => {
        if (store?.presence !== presence || presence.getStatus() !== "ended") return;
        void ensureRealtimeAuth(supabase).then((authed) => {
          if (authed && store?.presence === presence && presence.getStatus() === "ended") presence.start();
        });
      }, 0);
    }
  });
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      presence.pause({ leaveNow: timersStopWhenHidden() });
    } else {
      hiddenAt = null;
      presence.resume();
    }
  };
  // Chrome freezes a page long in the background (or one it needs the memory of): no timer runs after this.
  const onFreeze = () => presence.pause({ leaveNow: true });
  const onPageHide = () => {
    if (!accessToken || (hiddenAt !== null && Date.now() - hiddenAt > PAGEHIDE_VISIBLE_SLACK_MS)) return;
    const { url, anonKey } = getSupabaseEnv();
    // Best effort: nothing waits for the answer.
    fetch(`${url}/rest/v1/rpc/touch_activity`, {
      method: "POST",
      keepalive: true,
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  };
  const offBlocks = onBlocksChanged(() => presence.refreshBlocks());
  onVisibilityChange();
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("freeze", onFreeze);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    subscription.unsubscribe();
    offBlocks();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("freeze", onFreeze);
    window.removeEventListener("pagehide", onPageHide);
  };
}

/**
 * Joins the private presence channel for the signed-in user (unless they hide their active status, and then they see
 * nobody's either), and stops appearing online while the tab is in the background.
 */
export function PresenceProvider({ me, children }: { me: (ProfileSummary & { show_active_status: boolean }) | null; children: ReactNode }) {
  // Browser only: the store lives as long as the page.
  const presence = useMemo(() => (typeof window !== "undefined" && me && me.show_active_status ? storeFor(me) : null), [me]);
  useEffect(() => {
    if (!me?.show_active_status) endStore();
  }, [me]);
  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>;
}

const noop = () => () => {};

/**
 * Everyone currently online (including you), except people blocked either way with you. Empty when signed out or
 * hidden, before presence first syncs, and a few seconds after the connection drops.
 */
export function useOnlineUsers(): ReadonlyMap<string, OnlineUser> {
  const presence = useContext(PresenceContext);
  return useSyncExternalStore(presence?.subscribe ?? noop, presence ? presence.getSnapshot : () => EMPTY, () => EMPTY);
}

export function useIsOnline(userId: string | null | undefined): boolean {
  const users = useOnlineUsers();
  return Boolean(userId && users.has(userId));
}

/**
 * Whether who is online is known right now (PresenceStore.isReady). False before the first sync, while the connection
 * is down, for a moment after the tab comes back from a while away, and always when signed out or hiding your own
 * status. Until it is true, show no activity status at all rather than a guess.
 */
export function usePresenceReady(): boolean {
  const presence = useContext(PresenceContext);
  return useSyncExternalStore(presence?.subscribe ?? noop, presence ? presence.isReady : () => false, () => false);
}

/** PresenceStore.getStatus(), or null with no store (signed out, or hiding your own status). */
export function usePresenceStatus(): PresenceStatus | null {
  const presence = useContext(PresenceContext);
  return useSyncExternalStore(presence?.subscribe ?? noop, presence ? presence.getStatus : () => null, () => null);
}

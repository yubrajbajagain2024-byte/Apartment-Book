"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createPresenceStore, touchPresence, type OnlineUser, type PresenceStore, type ProfileSummary } from "@apartment-book/shared";
import { createClient, ensureRealtimeAuth } from "@/lib/supabase/client";

const EMPTY: ReadonlyMap<string, OnlineUser> = new Map();
const PresenceContext = createContext<PresenceStore | null>(null);

// One store per signed-in user for the life of the page. Kept outside React so
// Strict Mode's double effects and route changes never re-join the channel
// (a re-created channel with the same topic would collide with the old one).
let store: { userId: string; presence: PresenceStore } | null = null;

function storeFor(me: ProfileSummary): PresenceStore {
  if (store && store.userId === me.id) return store.presence;
  if (store) void store.presence.stop();
  const supabase = createClient();
  const presence = createPresenceStore(supabase, me, { heartbeat: touchPresence });
  store = { userId: me.id, presence };
  ensureRealtimeAuth(supabase).then((authed) => {
    if (authed && store?.presence === presence) presence.start();
  });
  return presence;
}

/** Joins the "online" presence channel for the signed-in user (unless they hide their active status). */
export function PresenceProvider({ me, children }: { me: (ProfileSummary & { show_active_status: boolean }) | null; children: ReactNode }) {
  const presence = useMemo(() => (me && me.show_active_status ? storeFor(me) : null), [me]);
  useEffect(() => {
    if (!me?.show_active_status && store) {
      void store.presence.stop();
      store = null;
    }
  }, [me]);
  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>;
}

const noop = () => () => {};

/** Everyone currently online (including you). Empty when signed out or hidden. */
export function useOnlineUsers(): ReadonlyMap<string, OnlineUser> {
  const presence = useContext(PresenceContext);
  return useSyncExternalStore(presence?.subscribe ?? noop, presence ? presence.getSnapshot : () => EMPTY, () => EMPTY);
}

export function useIsOnline(userId: string | null | undefined): boolean {
  const users = useOnlineUsers();
  return Boolean(userId && users.has(userId));
}

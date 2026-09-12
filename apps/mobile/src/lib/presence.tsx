import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createPresenceStore, touchPresence, type OnlineUser, type PresenceStore } from "@apartment-book/shared";
import { supabase } from "./supabase";
import { useSession } from "./session";

const EMPTY: ReadonlyMap<string, OnlineUser> = new Map();
const Ctx = createContext<PresenceStore | null>(null);
let current: { userId: string; store: PresenceStore } | null = null;

/** Joins the shared "online" presence channel while signed in (unless the user hides their active status). */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  const key = profile && profile.show_active_status ? `${profile.id}|${profile.full_name}|${profile.avatar_url ?? ""}` : null;
  const store = useMemo(() => {
    if (!key || !profile) return null;
    if (current && current.userId === profile.id) return current.store;
    if (current) void current.store.stop();
    const s = createPresenceStore(supabase, { id: profile.id, full_name: profile.full_name, avatar_url: profile.avatar_url }, { heartbeat: touchPresence });
    current = { userId: profile.id, store: s };
    s.start();
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!key && current) {
      void current.store.stop();
      current = null;
    }
  }, [key]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

const noop = () => () => {};
export function useOnlineUsers(): ReadonlyMap<string, OnlineUser> {
  const store = useContext(Ctx);
  return useSyncExternalStore(store?.subscribe ?? noop, store ? store.getSnapshot : () => EMPTY, () => EMPTY);
}
export function useIsOnline(userId: string | null | undefined): boolean {
  return Boolean(userId && useOnlineUsers().has(userId));
}

import type { Client, OnlineUser, ProfileSummary } from "../types/models";

/** Everyone signed in shares this presence topic, so each client sees who else is connected. */
export const ONLINE_CHANNEL = "online";
/** How often an open app stamps `profiles.last_seen_at`. */
export const PRESENCE_HEARTBEAT_MS = 2 * 60 * 1000;

export type PresenceStore = {
  /** Current online users by id (excluding nobody; filter yourself out in the UI). */
  getSnapshot: () => ReadonlyMap<string, OnlineUser>;
  subscribe: (listener: () => void) => () => void;
  /** Join the channel and start the heartbeat. Idempotent. */
  start: () => void;
  /** Leave the channel. */
  stop: () => Promise<void>;
};

type Tracked = { user_id: string; full_name: string; avatar_url: string | null; online_at: string };

/**
 * Framework-agnostic presence store (works with React's useSyncExternalStore and
 * in React Native). Call `start()` after the client has a session, since the
 * realtime socket must carry the user's token.
 */
export function createPresenceStore(supabase: Client, me: ProfileSummary, opts: { heartbeat?: (supabase: Client) => Promise<void> } = {}): PresenceStore {
  let users: ReadonlyMap<string, OnlineUser> = new Map();
  const listeners = new Set<() => void>();
  let channel: ReturnType<Client["channel"]> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const emit = () => listeners.forEach((l) => l());
  const sync = () => {
    if (!channel) return;
    const next = new Map<string, OnlineUser>();
    const state = channel.presenceState<Tracked>();
    for (const metas of Object.values(state)) {
      for (const meta of metas) {
        if (!meta.user_id) continue;
        const existing = next.get(meta.user_id);
        if (!existing || existing.onlineAt > meta.online_at) {
          next.set(meta.user_id, { id: meta.user_id, full_name: meta.full_name, avatar_url: meta.avatar_url, onlineAt: meta.online_at });
        }
      }
    }
    users = next;
    emit();
  };

  return {
    getSnapshot: () => users,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (channel) return;
      channel = supabase.channel(ONLINE_CHANNEL, { config: { presence: { key: me.id } } });
      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe(async (status) => {
          if (status !== "SUBSCRIBED" || !channel) return;
          const tracked: Tracked = { user_id: me.id, full_name: me.full_name, avatar_url: me.avatar_url, online_at: new Date().toISOString() };
          await channel.track(tracked);
        });
      if (opts.heartbeat) {
        const beat = () => opts.heartbeat?.(supabase).catch(() => {});
        beat();
        timer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
      }
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      const c = channel;
      channel = null;
      users = new Map();
      emit();
      if (c) await supabase.removeChannel(c);
    },
  };
}

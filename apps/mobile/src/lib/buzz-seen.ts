import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * When you last opened each Buzz thread, so the thread can mark the replies that arrived since ("New"). Kept on this
 * phone only, per account, for the most recent threads; nothing here reaches the server, so it says nothing about who
 * reads what.
 */

const keyFor = (userId: string) => `unibuzz.buzz-seen.${userId}`;
/** Threads remembered per account: the oldest visits go first. */
const KEEP = 300;

const cache = new Map<string, Record<string, number>>();

async function read(userId: string): Promise<Record<string, number>> {
  const held = cache.get(userId);
  if (held) return held;
  let seen: Record<string, number> = {};
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") seen = parsed as Record<string, number>;
  } catch {
    // Unreadable: start again (the markers are a convenience).
  }
  cache.set(userId, seen);
  return seen;
}

/** When you last opened the thread (ms), or null the first time. */
export async function threadLastSeen(userId: string, threadId: string): Promise<number | null> {
  const at = (await read(userId))[threadId];
  return typeof at === "number" ? at : null;
}

/** Notes that you have the thread open now. */
export async function markThreadSeen(userId: string, threadId: string, at = Date.now()): Promise<void> {
  const seen = { ...(await read(userId)), [threadId]: at };
  const ids = Object.keys(seen);
  if (ids.length > KEEP) for (const id of ids.sort((a, b) => seen[a]! - seen[b]!).slice(0, ids.length - KEEP)) delete seen[id];
  cache.set(userId, seen);
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(seen));
  } catch {
    // Not saved: the next visit marks a little more as new.
  }
}

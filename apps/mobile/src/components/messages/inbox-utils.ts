import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { searchMyMessages, type ConversationSummary, type MessageWithSender } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";

/** The choices of the inbox's "All ⌄" pill. */
export type InboxFilter = "all" | "unread" | "groups";

/** Whether a chat belongs under the filter: every chat, those with unread messages, or group chats. */
export function inFilter(c: Pick<ConversationSummary, "type" | "unreadCount">, filter: InboxFilter): boolean {
  if (filter === "unread") return c.unreadCount > 0;
  if (filter === "groups") return c.type === "group";
  return true;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** X's short times for the inbox: "now", "5m", "3h", "2d", then the date ("7 Sep", or "7 Sep 2025" in another year). */
export function inboxTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const seconds = Math.max(0, (now - t) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  const d = new Date(t);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** A clock for relative times, ticking every half minute while `active` (the screen is focused), so "now" becomes "1m". */
export function useNow(active: boolean, every = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [active, every]);
  return now;
}

/** Lower case without accents, so "jose" finds "José" the way people type names. */
export function fold(s: string): string {
  const lower = s.toLowerCase();
  try {
    return lower.normalize("NFD").replace(/[̀-ͯ]/g, "");
  } catch {
    return lower;
  }
}

const words = (s: string) => s.split(/[\s\-_.]+/).filter(Boolean);

/** 0 = the name starts with it (or one of its words does), 1 = the name contains it, 2 = the @username does, 3 = a group member's name or @username does. */
function matchRank(c: ConversationSummary, q: string, usernameOf: (id: string) => string | null): number | null {
  const handleOnly = q.startsWith("@");
  const handle = q.replace(/^@+/, "");
  if (!handleOnly) {
    const title = fold(c.title);
    if (title.startsWith(q) || words(title).some((w) => w.startsWith(q))) return 0;
    if (title.includes(q)) return 1;
  }
  if (!handle) return null;
  if (c.type !== "group") {
    for (const m of c.otherMembers) {
      const username = usernameOf(m.id);
      if (username && fold(username).includes(handle)) return 2;
    }
    return null;
  }
  for (const m of c.otherMembers) {
    if (!handleOnly && fold(m.full_name).includes(q)) return 3;
    const username = usernameOf(m.id);
    if (username && fold(username).includes(handle)) return 3;
  }
  return null;
}

/**
 * The chats a search finds: direct chats by the other person's name or @username, groups by their title or a member's
 * name or @username. Best matches first (the name starting with the words), then the inbox order (newest activity).
 */
export function matchConversations(conversations: ConversationSummary[], query: string, usernameOf: (id: string) => string | null): ConversationSummary[] {
  const q = fold(query.trim());
  if (!q) return [];
  const found: { c: ConversationSummary; rank: number; i: number }[] = [];
  conversations.forEach((c, i) => {
    const rank = matchRank(c, q, usernameOf);
    if (rank !== null) found.push({ c, rank, i });
  });
  found.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return found.map((f) => f.c);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A message's text split around what the search found (any case), for showing the matches in bold. Long texts start a
 * few words before the first match, after "…", so the match is on screen in a two-line row.
 */
export function highlightParts(text: string, query: string, lead = 24): { text: string; match: boolean }[] {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  const q = query.trim();
  if (!q || !flat) return flat ? [{ text: flat, match: false }] : [];
  const source = escapeRegExp(q).replace(/\s+/g, "\\s+");
  // Separate patterns: matchAll starts a global pattern where its lastIndex was left, so exec() must not share it.
  const first = new RegExp(source, "i").exec(flat);
  if (!first) return [{ text: flat, match: false }];
  const pattern = new RegExp(source, "gi");
  let from = 0;
  if (first.index > lead) {
    from = first.index - lead;
    // Start on a word when one begins between there and the match.
    const space = flat.indexOf(" ", from);
    if (space !== -1 && space < first.index) from = space + 1;
  }
  const shown = flat.slice(from);
  const parts: { text: string; match: boolean }[] = from > 0 ? [{ text: "…", match: false }] : [];
  let last = 0;
  for (const m of shown.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (m[0].length === 0) break;
    if (at > last) parts.push({ text: shown.slice(last, at), match: false });
    parts.push({ text: m[0], match: true });
    last = at + m[0].length;
  }
  if (last < shown.length) parts.push({ text: shown.slice(last), match: false });
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------------
// @usernames. Chat members come with their name and photo only, so the handles are read once per app session, one
// request per 100 new people, and every screen that shows them re-renders when they arrive.
// ---------------------------------------------------------------------------------------------------------------------

const usernames = new Map<string, string>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getVersion = () => version;

function loadUsernames(ids: string[]) {
  const missing = ids.filter((id) => id && !asked.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    for (const id of chunk) asked.add(id);
    // A failed request forgets the ids, so the next screen that needs them asks again.
    const forget = () => chunk.forEach((id) => asked.delete(id));
    supabase
      .from("profiles")
      .select("id, username")
      .in("id", chunk)
      .then(({ data, error }) => {
        if (error) return forget();
        for (const row of data ?? []) if (row.username) usernames.set(row.id, row.username);
        version++;
        for (const listener of listeners) listener();
      }, forget);
  }
}

/** The @username (without "@") of each of these people, or null until it has loaded. */
export function useUsernames(ids: string[]): (id: string | null | undefined) => string | null {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  useEffect(() => {
    if (key) loadUsernames(key.split(","));
  }, [key]);
  // A new function whenever handles arrive, so memoized rows that take a handle re-render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((id: string | null | undefined) => (id ? (usernames.get(id) ?? null) : null), [v]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Message search across all my chats.
// ---------------------------------------------------------------------------------------------------------------------

export type MessageSearch = {
  /** The words these rows were found for (they can lag behind the box while the next search runs). */
  query: string;
  rows: MessageWithSender[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
};

type SearchState = Omit<MessageSearch, "retry">;
const IDLE: SearchState = { query: "", rows: [], loading: false, failed: false };

/**
 * Messages in any of my chats whose text contains `text`, newest first, searched 300 ms after typing stops. The rows of
 * the previous search stay up while the next one runs, so the list does not flash on every keystroke.
 */
export function useMessageSearch(text: string, enabled: boolean): MessageSearch {
  const q = text.trim();
  const active = enabled && q.length > 0;
  const [state, setState] = useState<SearchState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) {
      setState(IDLE);
      return;
    }
    let alive = true;
    setState((s) => (s.loading && !s.failed ? s : { ...s, loading: true, failed: false }));
    const timer = setTimeout(() => {
      searchMyMessages(supabase, q, { limit: 30 }).then(
        (rows) => {
          if (alive) setState({ query: q, rows, loading: false, failed: false });
        },
        () => {
          if (alive) setState({ query: q, rows: [], loading: false, failed: true });
        },
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, active, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { listConversationShared, signMessageMedia, type SharedContentKind, type SharedItem } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";

/** Messages per page: a message with three photos gives three squares, so a page can hold more items than this. */
const PAGE_SIZE = 30;
/** A page can come back with nothing the app can show (a "link" the reader rejects); at most this many are skipped in a row. */
const MAX_EMPTY_HOPS = 3;
/** Signed URLs last an hour. One older than this is signed again before a video plays or a file opens from it. */
const STALE_MS = 50 * 60 * 1000;

/** One tab of a chat's Shared section (Media, Files or Links), paged newest first. */
export type SharedTab = {
  items: SharedItem[];
  /** Where the next page starts (the last message's time), or null after the last page. */
  next: string | null;
  /** idle: not asked for yet. loading: the first page is on its way. ready: a page arrived. error: the first page failed. */
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
};

const IDLE: SharedTab = { items: [], next: null, status: "idle", error: null, loadingMore: false, moreError: null };
const KINDS: readonly SharedContentKind[] = ["media", "files", "links"];
const idleTabs = (): Record<SharedContentKind, SharedTab> => ({ media: IDLE, files: IDLE, links: IDLE });

/**
 * What to tell people when something from migration 20 fails. PGRST202 means the database does not have the function yet
 * (the migration has not reached it); anything else is most likely the connection. Database messages are not shown: they
 * name functions and tables, which helps nobody reading a phone.
 */
export function sharedErrorText(e: unknown, fallback: string): string {
  const code = e && typeof e === "object" && "code" in e ? (e as { code?: unknown }).code : undefined;
  if (code === "PGRST202") return "This isn't available yet. Try again later.";
  return fallback;
}

/** The storage paths behind a page's items (photos, videos and files sent as attachments; website photos need no signing). */
function pathsOf(items: SharedItem[]): string[] {
  return items.flatMap((item) => (item.attachment ? [item.attachment.path] : []));
}

/**
 * A chat's Media, Files and Links, each loaded the first time its tab opens (`ensure`) and paged with `loadMore`, plus a
 * signed URL for every attachment on the loaded pages (`urls`, path -> URL). Show photos with a cache key equal to the
 * path, so a URL signed again later does not download the picture again. `freshUrls` returns URLs that are good for a
 * while yet, signing again any that are missing or about to expire: use it right before playing a video or opening a file.
 */
export function useSharedContent(conversationId: string) {
  const [tabs, setTabs] = useState<Record<SharedContentKind, SharedTab>>(idleTabs);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const urlsRef = useRef<Record<string, string>>({});
  const signedAt = useRef(new Map<string, number>());
  // Bumped whenever a tab starts again, so an answer to an older request is dropped.
  const seq = useRef<Record<SharedContentKind, number>>({ media: 0, files: 0, links: 0 });
  // Set from the moment a next page is asked for, so two scroll events in one frame never fetch the same page twice.
  const moreBusy = useRef<Record<SharedContentKind, boolean>>({ media: false, files: false, links: false });
  // Set once a tab's first page has been asked for, so opening it twice before the next render loads it once.
  const requested = useRef<Record<SharedContentKind, boolean>>({ media: false, files: false, links: false });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const patch = useCallback((kind: SharedContentKind, change: Partial<SharedTab> | ((tab: SharedTab) => Partial<SharedTab>)) => {
    setTabs((prev) => ({ ...prev, [kind]: { ...prev[kind], ...(typeof change === "function" ? change(prev[kind]) : change) } }));
  }, []);

  /** Signs the paths that have no URL yet, or one about to expire. Never throws: a square without a URL stays blank. */
  const sign = useCallback(async (paths: string[]) => {
    const now = Date.now();
    const wanted = [...new Set(paths)].filter((p) => !urlsRef.current[p] || now - (signedAt.current.get(p) ?? 0) > STALE_MS);
    if (wanted.length === 0) return;
    try {
      const fresh = await signMessageMedia(supabase, wanted);
      const at = Date.now();
      for (const path of Object.keys(fresh)) signedAt.current.set(path, at);
      urlsRef.current = { ...urlsRef.current, ...fresh };
      if (alive.current) setUrls(urlsRef.current);
    } catch {
      // Left unsigned; the next page or a tap tries again.
    }
  }, []);

  const fetchPage = useCallback(
    async (kind: SharedContentKind, before: string | null) => {
      let page = await listConversationShared(supabase, conversationId, { kind, before, limit: PAGE_SIZE });
      for (let hop = 0; hop < MAX_EMPTY_HOPS && page.items.length === 0 && page.next; hop++) {
        page = await listConversationShared(supabase, conversationId, { kind, before: page.next, limit: PAGE_SIZE });
      }
      return page;
    },
    [conversationId],
  );

  /** The first page of a tab. `keep` leaves the current items up while it loads (pull to refresh). */
  const loadFirst = useCallback(
    async (kind: SharedContentKind, keep = false) => {
      const id = ++seq.current[kind];
      requested.current[kind] = true;
      moreBusy.current[kind] = false;
      patch(kind, keep ? { loadingMore: false, moreError: null } : { ...IDLE, status: "loading" });
      try {
        const page = await fetchPage(kind, null);
        if (!alive.current || id !== seq.current[kind]) return;
        patch(kind, { items: page.items, next: page.next, status: "ready", error: null, moreError: null });
        void sign(pathsOf(page.items));
      } catch (e) {
        if (!alive.current || id !== seq.current[kind]) return;
        // A pull to refresh that fails leaves what was already showing.
        if (keep && tabsRef.current[kind].status === "ready") return;
        patch(kind, { status: "error", error: sharedErrorText(e, "Couldn't load this. Check your connection and try again."), items: [], next: null });
      }
    },
    [fetchPage, patch, sign],
  );

  /** Opens a tab for the first time: loads its first page unless it has one (or one is on its way). */
  const ensure = useCallback(
    (kind: SharedContentKind) => {
      if (!requested.current[kind]) void loadFirst(kind);
    },
    [loadFirst],
  );

  /**
   * The next page of a tab, when there is one and none is on its way. After a failure only Retry (`again`) asks once
   * more: scrolling does not, or a list that keeps reaching its end would keep failing in a loop while offline.
   */
  const loadMore = useCallback(
    async (kind: SharedContentKind, again = false) => {
      const tab = tabsRef.current[kind];
      if (tab.status !== "ready" || !tab.next || moreBusy.current[kind] || (tab.moreError && !again)) return;
      moreBusy.current[kind] = true;
      const id = seq.current[kind];
      const before = tab.next;
      patch(kind, { loadingMore: true, moreError: null });
      try {
        const page = await fetchPage(kind, before);
        if (!alive.current || id !== seq.current[kind]) return;
        patch(kind, (cur) => ({ items: [...cur.items, ...page.items], next: page.next, loadingMore: false }));
        void sign(pathsOf(page.items));
      } catch (e) {
        if (!alive.current || id !== seq.current[kind]) return;
        patch(kind, { loadingMore: false, moreError: sharedErrorText(e, "Couldn't load more. Check your connection and try again.") });
      } finally {
        if (id === seq.current[kind]) moreBusy.current[kind] = false;
      }
    },
    [fetchPage, patch, sign],
  );

  /** Tries again whatever failed last on a tab: its first page, or the next one. */
  const retry = useCallback(
    (kind: SharedContentKind) => {
      const tab = tabsRef.current[kind];
      if (tab.status === "error") void loadFirst(kind);
      else if (tab.moreError) void loadMore(kind, true);
    },
    [loadFirst, loadMore],
  );

  /** Pull to refresh: the open tab reloads its first page in place; the others start again when they are next opened. */
  const refresh = useCallback(
    async (kind: SharedContentKind) => {
      for (const other of KINDS) {
        if (other === kind) continue;
        seq.current[other]++;
        moreBusy.current[other] = false;
        requested.current[other] = false;
        patch(other, IDLE);
      }
      await loadFirst(kind, tabsRef.current[kind].status === "ready");
    },
    [loadFirst, patch],
  );

  /** URLs for these paths that will last a while yet (path -> URL); paths that could not be signed are left out. */
  const freshUrls = useCallback(
    async (paths: string[]): Promise<Record<string, string>> => {
      await sign(paths);
      const out: Record<string, string> = {};
      for (const path of paths) if (urlsRef.current[path]) out[path] = urlsRef.current[path];
      return out;
    },
    [sign],
  );

  return { tabs, urls, ensure, loadMore, retry, refresh, freshUrls };
}

/** "youtube.com" from "https://www.youtube.com/watch?v=…": the site a link goes to, without "www.". */
export function linkHost(url: string): string {
  const match = /^https?:\/\/(?:[^@/?#\s]*@)?([^/?#:\s]+)/i.exec(url);
  return match ? match[1].toLowerCase().replace(/^www\./, "") : url;
}

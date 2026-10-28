import { useCallback, useSyncExternalStore } from "react";
import type { Buzz, BuzzCategory, BuzzFeedMeta, BuzzFeedSort, BuzzGateState, BuzzPollDuration, BuzzPostingStatus, BuzzReply, BuzzReplySort, BuzzScope, BuzzTopWindow, HomeSection } from "@apartment-book/shared";
import { supabase } from "./supabase";

/**
 * Everything Buzz keeps while the app runs, in memory only (UniVerse's Buzz zustand store, safety L4): the feed's sort,
 * window and scope, the cold-start banner, the composer's draft, reply drafts, folds opened with "Tap to view", the
 * search, the guidelines gate and the posting status, the items every Buzz screen shows (one copy per id, so a vote on a
 * card shows on its thread and back) and the toast. Nothing here is ever written to AsyncStorage or SecureStore, and all
 * of it is wiped the moment the session ends (sign-out, an expired session, or another account signing in): see the
 * auth listener at the bottom.
 */

type Item = Buzz | BuzzReply;
type Listener = () => void;

/* ───────────────────────────── a tiny store ───────────────────────────── */

function createStore<T>(initial: () => T) {
  let state = initial();
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(next: Partial<T> | ((s: T) => Partial<T>)) {
      const patch = typeof next === "function" ? next(state) : next;
      let changed = false;
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (!Object.is(state[key], patch[key])) changed = true;
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    reset() {
      state = initial();
      listeners.forEach((l) => l());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/* ───────────────────────────── UI state ───────────────────────────── */

/** A photo in the composer: already uploaded to the anonymous folder (see buzz-photos.ts). */
export type DraftPhoto = { url: string; width: number | null; height: number | null; blur: string | null };
/** A video in the composer: uploaded to Mux and ready; nothing in it points at its uploader. */
export type DraftVideo = { playbackId: string; posterUrl: string | null; width: number | null; height: number | null; durationSeconds: number | null };

export type BuzzDraft = {
  title: string;
  text: string;
  /** The feed the buzz goes to: the one the composer was opened on, until the person picks the other. */
  scope: BuzzScope;
  /** What it is about (BUZZ_CATEGORIES), or none. */
  category: BuzzCategory | null;
  images: DraftPhoto[];
  video: DraftVideo | null;
  pollOn: boolean;
  options: string[];
  durationDays: BuzzPollDuration;
  promptId: string | null;
  /** An answer to the prompt: a reply in the prompt's thread (the default), or a buzz of its own titled with the prompt. */
  promptMode: "thread" | "own";
};

export const EMPTY_DRAFT: BuzzDraft = { title: "", text: "", scope: "campus", category: null, images: [], video: null, pollOn: false, options: ["", ""], durationDays: 3, promptId: null, promptMode: "thread" };

export type ReplyDraft = { text: string; parentId: string | null };

export type GateStatus = "unknown" | "loading" | "accepted" | "required" | "error";

export type BuzzToast = { id: number; text: string; title?: string; tone: "info" | "success" | "error"; duration: number };

/** What the composer was asked to open with from outside the Buzz page (the create menu, an old link). */
export type ComposerRequest = { promptId?: string | null };

type FeedCacheEntry = { ids: string[]; nextOffset: number | null; rankAt: string | null; at: number };

type UiState = {
  sort: BuzzFeedSort;
  window: BuzzTopWindow;
  scope: BuzzScope;
  /** The campus feed came back empty on its first page and the pane moved to Global: the banner shows until dismissed. */
  coldStart: boolean;
  coldStartDismissed: boolean;
  /** The last Home section that was not Buzz: the gate's "Not now" goes back there. */
  previousSection: HomeSection;
  composerRequest: ComposerRequest | null;
  search: { q: string; scope: BuzzScope; sort: "new" | "top" };
  /** How a thread orders its replies (Best, New, Old): the last choice, for every thread this session. */
  replySort: BuzzReplySort;
  /** Folded items the viewer opened with "Tap to view" this session. */
  revealed: Readonly<Record<string, true>>;
  draft: BuzzDraft;
  replyDrafts: Readonly<Record<string, ReplyDraft>>;
  gate: { status: GateStatus; error: string | null };
  posting: { value: BuzzPostingStatus | null; at: number };
  meta: Readonly<Partial<Record<BuzzScope, { value: BuzzFeedMeta; at: number }>>>;
  /** The viewer's campus as the last meta said it ({ name, shortName }), for "Search Texas State buzz". */
  campus: BuzzFeedMeta["campus"];
  feeds: Readonly<Record<string, FeedCacheEntry>>;
  toast: BuzzToast | null;
};

const initialUi = (): UiState => ({
  sort: "hot",
  window: "day",
  scope: "campus",
  coldStart: false,
  coldStartDismissed: false,
  previousSection: "foryou",
  composerRequest: null,
  search: { q: "", scope: "campus", sort: "new" },
  replySort: "best",
  revealed: {},
  draft: EMPTY_DRAFT,
  replyDrafts: {},
  gate: { status: "unknown", error: null },
  posting: { value: null, at: 0 },
  meta: {},
  campus: null,
  feeds: {},
  toast: null,
});

const ui = createStore(initialUi);

export type BuzzUiState = UiState;

/** Reads one slice of the Buzz state; re-renders only when that slice changes (keep selectors to stored values, not new objects). */
export function useBuzzState<T>(select: (s: UiState) => T): T {
  const get = useCallback(() => select(ui.get()), [select]);
  return useSyncExternalStore(ui.subscribe, get, get);
}

export function getBuzzState(): UiState {
  return ui.get();
}

export const buzzState = {
  setSort: (sort: BuzzFeedSort) => ui.set({ sort }),
  setWindow: (window: BuzzTopWindow) => ui.set({ window }),
  /** The feed's scope. `coldStart`: moved there because the campus feed is still empty (the banner shows). */
  setScope: (scope: BuzzScope, opts?: { coldStart?: boolean }) => ui.set({ scope, coldStart: opts?.coldStart ?? false }),
  dismissColdStart: () => ui.set({ coldStartDismissed: true, coldStart: false }),
  setPreviousSection: (previousSection: HomeSection) => ui.set({ previousSection }),
  requestComposer: (request: ComposerRequest) => ui.set({ composerRequest: request }),
  takeComposerRequest(): ComposerRequest | null {
    const r = ui.get().composerRequest;
    if (r) ui.set({ composerRequest: null });
    return r;
  },
  setSearch: (patch: Partial<UiState["search"]>) => ui.set((s) => ({ search: { ...s.search, ...patch } })),
  setReplySort: (replySort: BuzzReplySort) => ui.set({ replySort }),
  reveal: (id: string) => ui.set((s) => (s.revealed[id] ? {} : { revealed: { ...s.revealed, [id]: true } })),
  setDraft: (patch: Partial<BuzzDraft>) => ui.set((s) => ({ draft: { ...s.draft, ...patch } })),
  clearDraft: () => ui.set({ draft: EMPTY_DRAFT }),
  /** A fresh draft takes the feed it is opened on; one already in progress keeps the feed it chose (UniVerse's openComposer). */
  prepareDraft(scope: BuzzScope, prefill?: Partial<BuzzDraft>) {
    ui.set((s) => {
      const d = s.draft;
      const fresh = !d.title && !d.text && d.images.length === 0 && !d.video && !d.pollOn;
      const base = fresh ? { ...d, scope } : d;
      return { draft: prefill ? { ...base, ...prefill } : base };
    });
  },
  setReplyDraft(threadId: string, draft: ReplyDraft | null) {
    ui.set((s) => {
      const next = { ...s.replyDrafts };
      if (draft && (draft.text || draft.parentId)) next[threadId] = draft;
      else delete next[threadId];
      return { replyDrafts: next };
    });
  },
  setGate: (status: GateStatus, error: string | null = null) => ui.set((s) => (s.gate.status === status && s.gate.error === error ? {} : { gate: { status, error } })),
  setPosting: (value: BuzzPostingStatus | null) => ui.set({ posting: { value, at: value ? Date.now() : 0 } }),
  setMeta(scope: BuzzScope, value: BuzzFeedMeta) {
    ui.set((s) => ({ meta: { ...s.meta, [scope]: { value, at: Date.now() } }, campus: value.campus ?? s.campus }));
  },
  /** Asks for a feed's meta again (an answer changed the prompt's thread and its count). */
  dropMeta(scope: BuzzScope) {
    ui.set((s) => {
      const held = s.meta[scope];
      return held ? { meta: { ...s.meta, [scope]: { ...held, at: 0 } } } : {};
    });
  },
  setFeed(key: string, entry: Omit<FeedCacheEntry, "at">) {
    ui.set((s) => ({ feeds: { ...s.feeds, [key]: { ...entry, at: Date.now() } } }));
  },
  /** Every cached feed goes stale (a new buzz, a deletion): each list reloads the next time it shows. */
  dropFeeds: () => ui.set({ feeds: {} }),
  /** A short note at the bottom of whichever Buzz screen is on top. */
  toast(text: string, opts?: { tone?: BuzzToast["tone"]; title?: string; duration?: number }) {
    ui.set({ toast: { id: Date.now() + Math.random(), text, title: opts?.title, tone: opts?.tone ?? "info", duration: opts?.duration ?? 3200 } });
  },
  dismissToast: (id: number) => ui.set((s) => (s.toast?.id === id ? { toast: null } : {})),
};

/** The cache key of one feed (search results are not cached). */
export function feedKey(scope: BuzzScope, sort: BuzzFeedSort, window: BuzzTopWindow): string {
  return `${scope}:${sort}:${sort === "top" ? window : "-"}`;
}

/* ───────────────────────────── items ───────────────────────────── */

/**
 * One copy of every buzz and reply the screens have loaded, by id. Lists keep ids; each row reads its item here, so a
 * vote, a poll vote or a fold redraws only the rows showing that item, wherever they are (feed, search, thread, mine).
 */
const items = new Map<string, Item>();
const itemListeners = new Map<string, Set<Listener>>();
/** Items with a vote on its way to the server: a list reloading meanwhile keeps the vote on screen (see voteOnBuzz). */
const pendingVotes = new Set<string>();

function notifyItem(id: string) {
  itemListeners.get(id)?.forEach((l) => l());
}

export function getBuzzItem<T extends Item = Item>(id: string): T | undefined {
  return items.get(id) as T | undefined;
}

/** Puts freshly loaded items in place of the copies held (a vote still on its way keeps showing). */
export function putBuzzItems(list: readonly Item[]): void {
  for (const fresh of list) {
    const held = items.get(fresh.id);
    const next = held && pendingVotes.has(fresh.id) ? { ...fresh, score: held.score, myVote: held.myVote } : fresh;
    if (held && sameItem(held, next)) continue;
    items.set(fresh.id, next as Item);
    notifyItem(fresh.id);
  }
}

export function patchBuzzItem(id: string, patch: Partial<Buzz> | Partial<BuzzReply> | ((item: Item) => Item)): void {
  const held = items.get(id);
  if (!held) return;
  const next = typeof patch === "function" ? patch(held) : ({ ...held, ...patch } as Item);
  if (next === held) return;
  items.set(id, next);
  notifyItem(id);
}

export function markVotePending(id: string, pending: boolean): void {
  if (pending) pendingVotes.add(id);
  else pendingVotes.delete(id);
}

/** Every held reply of a thread (for "Hide this anon in this thread", which folds all of that alias's replies). */
export function heldReplies(threadId: string): BuzzReply[] {
  const out: BuzzReply[] = [];
  items.forEach((it) => {
    if (it.kind === "reply" && it.threadId === threadId) out.push(it);
  });
  return out;
}

function sameItem(a: Item, b: Item): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The item with this id as the store holds it; re-renders when that item changes. */
export function useBuzzItem<T extends Item = Item>(id: string | null | undefined): T | undefined {
  const subscribe = useCallback(
    (listener: Listener) => {
      if (!id) return () => {};
      let set = itemListeners.get(id);
      if (!set) {
        set = new Set();
        itemListeners.set(id, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) itemListeners.delete(id);
      };
    },
    [id],
  );
  const get = useCallback(() => (id ? (items.get(id) as T | undefined) : undefined), [id]);
  return useSyncExternalStore(subscribe, get, get);
}

/* ───────────────────────────── events ───────────────────────────── */

/**
 * What one screen tells the others: an item is gone for this viewer (hidden, reported, deleted), the lists should load
 * again (a new buzz or reply of their own), or the session ended. Carries ids only, never anything about people.
 */
export type BuzzEvent =
  | { type: "removed"; id: string; threadId: string }
  | { type: "refresh"; scope?: BuzzScope }
  | { type: "thread"; threadId: string }
  | { type: "reset" };

const eventListeners = new Set<(e: BuzzEvent) => void>();

export function onBuzzEvent(listener: (e: BuzzEvent) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

export function emitBuzzEvent(e: BuzzEvent): void {
  if (e.type === "removed") {
    // Gone for this viewer: no cached feed may bring it back.
    ui.set((s) => {
      let touched = false;
      const feeds: Record<string, FeedCacheEntry> = {};
      for (const [key, entry] of Object.entries(s.feeds)) {
        if (entry.ids.includes(e.id)) {
          touched = true;
          feeds[key] = { ...entry, ids: entry.ids.filter((x) => x !== e.id) };
        } else feeds[key] = entry;
      }
      return touched ? { feeds } : {};
    });
  }
  eventListeners.forEach((l) => l(e));
}

/* ───────────────────────────── the end of a session ───────────────────────────── */

/** Wipes every bit of Buzz state (UI, drafts, folds, search, items, caches). */
export function resetBuzzState(): void {
  ui.reset();
  items.clear();
  pendingVotes.clear();
  itemListeners.forEach((set) => set.forEach((l) => l()));
  emitBuzzEvent({ type: "reset" });
}

/**
 * The account Buzz state belongs to. Signing out (from Profile or Settings, or a session that cannot be renewed) and
 * another account signing in both wipe it, before anything else can show it. The listener only touches local state:
 * auth calls inside it would wait on themselves.
 */
let owner: string | null = null;
supabase.auth.onAuthStateChange((event, session) => {
  const id = session?.user.id ?? null;
  if (event === "SIGNED_OUT" || (owner !== null && id !== null && id !== owner)) resetBuzzState();
  if (event === "SIGNED_OUT") owner = null;
  else if (id) owner = id;
});

/** The gate state as the server last said it. */
export function gateFromServer(state: BuzzGateState): GateStatus {
  return state.accepted ? "accepted" : "required";
}

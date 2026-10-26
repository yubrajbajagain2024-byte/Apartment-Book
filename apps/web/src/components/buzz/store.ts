"use client";

/**
 * Buzz UI state for the website (UniVerse's `features/buzz/store.ts`, without zustand): sort / window / scope, the
 * cold-start banner, the composer and its draft, folds the viewer opened, reply drafts and the search.
 *
 * MEMORY ONLY, on purpose: nothing here (or anywhere in Buzz) touches localStorage, sessionStorage or IndexedDB, so a
 * draft can never outlive the tab. Everything belongs to one signed-in account: `bindBuzzOwner()` (called by every
 * Buzz screen before it reads anything) wipes the lot — this store, the query cache, toasts and open sheets — as soon
 * as a different account, or nobody, is signed in. That is the website's "logout wipes every Buzz state".
 *
 * Server rendering never writes here: actions only run in event handlers and effects, and the server snapshot is the
 * pristine initial state, so one visitor's state can never reach another's render.
 */
import { useSyncExternalStore } from "react";
import type { BuzzFeedSort, BuzzPollDuration, BuzzScope, BuzzTopWindow, HomeSection } from "@apartment-book/shared";

/* ───────────────────────────── a tiny store ───────────────────────────── */

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
  readonly initial: T;
}

export function createStore<T extends object>(make: () => T): Store<T> {
  const initial = make();
  let state = make();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    initial,
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      emit();
    },
    reset() {
      state = make();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe to a slice. The selector must return something stable (a primitive or an object already in the state). */
export function useStore<T, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.initial),
  );
}

/* ───────────────────────────── the Buzz UI state ───────────────────────────── */

export interface DraftPhoto {
  url: string;
  width: number | null;
  height: number | null;
  blur: string | null;
}

/** A video that finished uploading and processing; `previewUrl` is a local object URL for the composer only. */
export interface DraftVideo {
  playbackId: string;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  previewUrl: string | null;
}

export interface ComposerDraft {
  title: string;
  text: string;
  /** Which feed the buzz goes to. A fresh draft takes the feed it was opened on. */
  scope: BuzzScope;
  images: DraftPhoto[];
  video: DraftVideo | null;
  pollOn: boolean;
  options: string[];
  durationDays: BuzzPollDuration;
  promptId: string | null;
}

export const EMPTY_DRAFT: ComposerDraft = {
  title: "",
  text: "",
  scope: "campus",
  images: [],
  video: null,
  pollOn: false,
  options: ["", ""],
  durationDays: 3,
  promptId: null,
};

export interface ReplyDraft {
  text: string;
  parentId: string | null;
}

export interface BuzzSearchState {
  q: string;
  scope: BuzzScope;
  sort: Extract<BuzzFeedSort, "new" | "top">;
}

export interface BuzzUiState {
  sort: BuzzFeedSort;
  window: BuzzTopWindow;
  scope: BuzzScope;
  /** The campus feed came back empty on the first Hot page, so the feed moved to Global (banner until dismissed). */
  coldStart: boolean;
  coldStartDismissed: boolean;
  composerOpen: boolean;
  draft: ComposerDraft;
  /** Community-collapsed / hidden-anon items the viewer tapped open this session. */
  revealed: Record<string, true>;
  replyDrafts: Record<string, ReplyDraft>;
  /** Kept for the session, so "back" from a thread lands on the same results. */
  search: BuzzSearchState;
}

export const buzzUi = createStore<BuzzUiState>(() => ({
  sort: "hot",
  window: "day",
  scope: "campus",
  coldStart: false,
  coldStartDismissed: false,
  composerOpen: false,
  draft: EMPTY_DRAFT,
  revealed: {},
  replyDrafts: {},
  search: { q: "", scope: "campus", sort: "new" },
}));

export function useBuzzUi<S>(selector: (s: BuzzUiState) => S): S {
  return useStore(buzzUi, selector);
}

function isFresh(d: ComposerDraft): boolean {
  return !d.title && !d.text && d.images.length === 0 && !d.video && !d.pollOn;
}

export const buzzActions = {
  setSort: (sort: BuzzFeedSort) => buzzUi.set({ sort }),
  setWindow: (window: BuzzTopWindow) => buzzUi.set({ window }),
  setScope: (scope: BuzzScope, opts?: { coldStart?: boolean }) => buzzUi.set({ scope, coldStart: opts?.coldStart ?? false, coldStartDismissed: false }),
  dismissColdStart: () => buzzUi.set({ coldStartDismissed: true }),
  /** A fresh draft takes the feed it was opened on; a draft in progress keeps the feed it chose. */
  openComposer: (prefill?: Partial<ComposerDraft>) =>
    buzzUi.set((s) => {
      const base = isFresh(s.draft) ? { ...s.draft, scope: s.scope } : s.draft;
      return { composerOpen: true, draft: prefill ? { ...base, ...prefill } : base };
    }),
  closeComposer: () => buzzUi.set({ composerOpen: false }),
  setDraft: (patch: Partial<ComposerDraft>) => buzzUi.set((s) => ({ draft: { ...s.draft, ...patch } })),
  clearDraft: () =>
    buzzUi.set((s) => {
      if (s.draft.video?.previewUrl) URL.revokeObjectURL(s.draft.video.previewUrl);
      return { draft: EMPTY_DRAFT };
    }),
  reveal: (id: string) => buzzUi.set((s) => ({ revealed: { ...s.revealed, [id]: true } })),
  setSearch: (patch: Partial<BuzzSearchState>) => buzzUi.set((s) => ({ search: { ...s.search, ...patch } })),
  setReplyDraft: (threadId: string, draft: ReplyDraft | null) =>
    buzzUi.set((s) => {
      const next = { ...s.replyDrafts };
      if (draft) next[threadId] = draft;
      else delete next[threadId];
      return { replyDrafts: next };
    }),
};

/* ───────────────────────────── the previous Home tab ───────────────────────────── */

/**
 * The last Home tab that was not Buzz, for the gate's "Not now". Not account data (it is a tab name), so it is kept
 * across owners.
 */
let previousHomeTab: HomeSection = "foryou";
export function rememberHomeTab(tab: HomeSection): void {
  if (tab !== "buzz") previousHomeTab = tab;
}
export function lastNonBuzzHomeTab(): HomeSection {
  return previousHomeTab;
}

/* ───────────────────────────── owner ───────────────────────────── */

const resetters = new Set<() => void>();
/** Other Buzz modules (query cache, toasts, sheets) register what to wipe when the account changes. */
export function onBuzzOwnerChange(reset: () => void): void {
  resetters.add(reset);
}

/** Whose Buzz state this tab holds: a user id, null (signed out) or undefined (no Buzz screen has run yet). */
export const buzzOwner = createStore<{ owner: string | null | undefined }>(() => ({ owner: undefined }));

/**
 * Bind the Buzz state to the signed-in account (its user id, or null). A change of account — signing out included —
 * wipes everything first. Called from `BuzzOwnerGate`'s layout effect, never during render.
 */
export function bindBuzzOwner(next: string | null): void {
  const current = buzzOwner.get().owner;
  if (current === next) return;
  if (current !== undefined) {
    buzzUi.reset();
    resetters.forEach((r) => r());
  }
  buzzOwner.set({ owner: next });
}

export function useBuzzOwner(): string | null | undefined {
  return useStore(buzzOwner, (s) => s.owner);
}

/**
 * Wipe every Buzz state right now (drafts, folds, search, cached Buzz data, toasts, open sheets). For the sign-out
 * button: without it the wipe happens when the next Buzz screen binds another account (or none), which already keeps
 * the previous account's Buzz out of sight, but this also clears it from memory at once.
 */
export function resetBuzzState(): void {
  buzzUi.reset();
  resetters.forEach((r) => r());
  buzzOwner.set({ owner: undefined });
}

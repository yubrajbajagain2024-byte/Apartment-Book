"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { signMessageMedia } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";

/*
 * Signed addresses for chat files (the message-media bucket is private), shared by every chat on the page. Components
 * name the files they show with useSignedMedia(). Everything asked for in the same moment goes out as one request, and
 * the same address is handed out until shortly before it runs out, so the browser's cache keeps working. The files of
 * an open chat are signed again before that happens.
 */

/** How long a signed address lasts, in seconds. */
const TTL_SECONDS = 60 * 60;
/** Sign again this long before an address runs out, so a link or a video never starts on a dead one. */
const RENEW_BEFORE_MS = 5 * 60 * 1000;
/** A file that could not be signed (deleted, offline, or the bucket is missing) is asked about again after this long. */
const RETRY_MS = 2 * 60 * 1000;

export type SignedFile = {
  /** The signed address, or null when the file could not be signed. */
  url: string | null;
  /** When `url` stops working (ms since the epoch). */
  expiresAt: number;
  /** When to sign the file again. */
  renewAt: number;
};

/** Signed files by storage path. */
export type SignedFiles = Readonly<Record<string, SignedFile>>;

const EMPTY: SignedFiles = {};
let files: SignedFiles = EMPTY;
const listeners = new Set<() => void>();
/** How many mounted components show each path: only those are kept fresh. */
const inUse = new Map<string, number>();
const inflight = new Set<string>();
let queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let renewTimer: ReturnType<typeof setTimeout> | null = null;
let watching = false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => files;
const getServerSnapshot = () => EMPTY;

function isDue(path: string, now: number): boolean {
  if (!path || inflight.has(path)) return false;
  const file = files[path];
  return !file || file.renewAt <= now;
}

/** Sign the files that need it: new ones, ones about to run out, and failed ones whose retry time has come. */
function requestSignedMedia(paths: Iterable<string>): void {
  const now = Date.now();
  for (const path of paths) if (isDue(path, now)) queued.add(path);
  if (queued.size === 0 || flushTimer) return;
  // Everything asked for in the same moment (every message of a page mounting together) goes out as one request.
  flushTimer = setTimeout(() => void flush(), 0);
}

async function flush(): Promise<void> {
  flushTimer = null;
  const paths = [...queued].filter((path) => !inflight.has(path));
  queued = new Set();
  if (paths.length === 0) return;
  for (const path of paths) inflight.add(path);
  const startedAt = Date.now();
  let urls: Record<string, string> | null = null;
  try {
    urls = await signMessageMedia(createClient(), paths, TTL_SECONDS);
  } catch {
    urls = null;
  }
  const now = Date.now();
  const next: Record<string, SignedFile> = { ...files };
  for (const path of paths) {
    inflight.delete(path);
    const url = urls?.[path];
    if (url) {
      // Counted from before the request, so an address is never thought to live longer than it does.
      const expiresAt = startedAt + TTL_SECONDS * 1000;
      next[path] = { url, expiresAt, renewAt: expiresAt - RENEW_BEFORE_MS };
    } else {
      // Not signed this time: an address that still works is kept until the retry.
      const previous = files[path];
      const kept = previous?.url && previous.expiresAt > now ? previous : null;
      next[path] = { url: kept?.url ?? null, expiresAt: kept?.expiresAt ?? 0, renewAt: now + RETRY_MS };
    }
  }
  files = next;
  for (const listener of listeners) listener();
  scheduleRenewal();
}

/**
 * Sign again whatever in an open chat is due. Also run when the tab comes back: a laptop that slept past the hour has
 * dead addresses and a timer that has not caught up.
 */
function renewDue(): void {
  requestSignedMedia(inUse.keys());
  scheduleRenewal();
}

function onVisible(): void {
  if (document.visibilityState === "visible") renewDue();
}

/** One timer for the whole page, set for the first file in an open chat that is due again. */
function scheduleRenewal(): void {
  if (renewTimer) clearTimeout(renewTimer);
  renewTimer = null;
  let due = Infinity;
  for (const path of inUse.keys()) {
    if (inflight.has(path) || queued.has(path)) continue;
    due = Math.min(due, files[path]?.renewAt ?? Infinity);
  }
  if (due === Infinity) return;
  renewTimer = setTimeout(renewDue, Math.max(1000, due - Date.now()));
}

function retain(paths: string[]): () => void {
  for (const path of paths) inUse.set(path, (inUse.get(path) ?? 0) + 1);
  if (!watching) {
    watching = true;
    window.addEventListener("focus", renewDue);
    document.addEventListener("visibilitychange", onVisible);
  }
  requestSignedMedia(paths);
  scheduleRenewal();
  return () => {
    for (const path of paths) {
      const count = (inUse.get(path) ?? 1) - 1;
      if (count > 0) inUse.set(path, count);
      else inUse.delete(path);
    }
  };
}

/** Signed addresses for these storage paths, kept fresh while the calling component is mounted. Read one with `files[path]`. */
export function useSignedMedia(paths: readonly string[]): SignedFiles {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const key = JSON.stringify(paths);
  useEffect(() => {
    const list = JSON.parse(key) as string[];
    return list.length > 0 ? retain(list) : undefined;
  }, [key]);
  return all;
}

/**
 * Which address an <img> or <video> should load a file from. Once one has loaded it stays, even after the file is
 * signed again: a fresh signed URL is a different URL to the browser, which would download the file again. When an
 * address that has run out fails (a laptop asleep past the hour), the file is signed again and the new address tried;
 * meanwhile the file is `waiting`. When a fresh one fails, the browser cannot show the file (a HEIC photo in Chrome, a
 * video it cannot play) or it is gone, and it is `broken` until the file's next address.
 */
export function useStableSource(path: string, file: SignedFile | undefined) {
  const url = file?.url ?? null;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ src: string; ranOut: boolean } | null>(null);
  const src = loadedSrc ?? url;
  const failed = src !== null && failure?.src === src;
  return {
    src,
    loaded: src !== null && src === loadedSrc,
    waiting: failed && failure.ranOut,
    broken: failed && !failure.ranOut,
    onLoad: () => {
      if (src) setLoadedSrc(src);
    },
    onError: () => {
      setLoadedSrc(null);
      // An older address ran out (a video still streaming from it): the current one is tried next.
      if (!src || src !== url) return;
      const ranOut = !file || file.expiresAt - Date.now() <= RENEW_BEFORE_MS;
      setFailure({ src, ranOut });
      if (ranOut) requestSignedMedia([path]);
    },
  };
}

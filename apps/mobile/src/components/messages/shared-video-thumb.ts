import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { createVideoPlayer, type VideoThumbnail } from "expo-video";

/**
 * Still frames for the video squares of a chat's Media grid. Chat videos have no poster, so the first frame is read from
 * the file itself: one throwaway player at a time (never one per square), muted and never played, released as soon as
 * the frame is out. Frames are kept by storage path for the rest of the session (a signed URL changes, the file does not),
 * at most MAX_KEPT of them. A square that scrolls away before its turn drops out of the queue. The web build has no
 * frame grabbing, so its squares keep the plain dark tile with the play mark.
 */
const SUPPORTED = Platform.OS === "ios" || Platform.OS === "android";
const MAX_KEPT = 60;
/** A frame that takes longer than this (a slow connection) is given up on, so the queue keeps moving. */
const TIMEOUT_MS = 15000;
/** The frame is drawn in a square about a third of the screen wide; this is plenty for that and keeps memory low. */
const MAX_SIDE = 360;

/** path -> frame, or null when none could be made (the square keeps its plain tile). */
const frames = new Map<string, VideoThumbnail | null>();
const waiting = new Map<string, Set<() => void>>();
const queue: { key: string; uri: string }[] = [];
const queued = new Set<string>();
let running = false;

function remember(key: string, frame: VideoThumbnail | null) {
  frames.delete(key);
  frames.set(key, frame);
  while (frames.size > MAX_KEPT) {
    const oldest = frames.keys().next().value;
    if (oldest === undefined) break;
    frames.delete(oldest);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function grabFrame(uri: string): Promise<VideoThumbnail | null> {
  let player: ReturnType<typeof createVideoPlayer> | null = null;
  try {
    // Muted and never played, so it never takes the audio from music the person is listening to.
    player = createVideoPlayer(null);
    player.muted = true;
    const p = player;
    const [frame] = await withTimeout(
      (async () => {
        await p.replaceAsync({ uri });
        return p.generateThumbnailsAsync([0], { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE });
      })(),
      TIMEOUT_MS,
    );
    return frame ?? null;
  } catch {
    return null;
  } finally {
    try {
      player?.release();
    } catch {
      // Already released.
    }
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      queued.delete(job.key);
      // Made meanwhile, or nobody is showing that square any more.
      if (frames.has(job.key) || !waiting.get(job.key)?.size) continue;
      const frame = await grabFrame(job.uri);
      remember(job.key, frame);
      waiting.get(job.key)?.forEach((notify) => notify());
    }
  } finally {
    running = false;
  }
}

/**
 * The first frame of a chat video, for its square in the Media grid: null until it is ready, and for good when it cannot
 * be made (or on the web). `key` is the attachment's storage path, `uri` a signed URL for it. A square keeps its frame
 * while it is on screen even after the session store lets it go.
 */
export function useVideoFrame(key: string | null | undefined, uri: string | null | undefined): VideoThumbnail | null {
  const [shown, setShown] = useState<{ key: string; frame: VideoThumbnail | null } | null>(() => (key && frames.has(key) ? { key, frame: frames.get(key) ?? null } : null));
  useEffect(() => {
    if (!key) return;
    const show = () => {
      const frame = frames.get(key) ?? null;
      setShown((prev) => (prev?.key === key && prev.frame === frame ? prev : { key, frame }));
    };
    if (frames.has(key)) {
      show();
      return;
    }
    if (!SUPPORTED || !uri) return;
    let listeners = waiting.get(key);
    if (!listeners) {
      listeners = new Set();
      waiting.set(key, listeners);
    }
    const set = listeners;
    set.add(show);
    if (!queued.has(key)) {
      queued.add(key);
      queue.push({ key, uri });
    }
    void pump();
    return () => {
      set.delete(show);
      if (set.size === 0 && waiting.get(key) === set) waiting.delete(key);
    };
  }, [key, uri]);
  return key && shown?.key === key ? shown.frame : null;
}

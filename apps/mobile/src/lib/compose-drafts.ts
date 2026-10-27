import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { localId, type ComposeMedia, type ComposeState } from "./compose-store";

/**
 * Drafts from the create flow, kept on this phone only (like TikTok's): the session's words and settings in storage,
 * one list per account, and copies of its photos and videos in the app's documents folder (the camera's shots and the
 * editor's results live in a cache iOS may empty). Paths are kept relative to that folder, which iOS can move between
 * app updates.
 */
export type Draft = { id: string; savedAt: number; state: ComposeState };

type StoredMedia = Omit<ComposeMedia, "uri" | "originalUri" | "baseUri" | "thumbUri"> & { uri: string; originalUri: string; baseUri: string; thumbUri: string | null };
type StoredDraft = { id: string; savedAt: number; state: Omit<ComposeState, "media"> & { media: StoredMedia[] } };

const ROOT = `${FileSystem.documentDirectory ?? ""}compose-drafts/`;
const keyFor = (userId: string) => `unibuzz.compose-drafts.${userId}`;

/** The drafts of the signed-in account, newest first, as last read: what the camera's Drafts button counts. */
let cache: { userId: string; drafts: Draft[] } | null = null;
const listeners = new Set<() => void>();
function setCache(next: { userId: string; drafts: Draft[] }) {
  cache = next;
  listeners.forEach((l) => l());
}

const absolute = (path: string | null) => (path && !path.includes("://") ? `${ROOT}${path}` : path);

function fromStored(d: StoredDraft): Draft {
  return {
    id: d.id,
    savedAt: d.savedAt,
    state: {
      ...d.state,
      draftId: d.id,
      adding: false,
      media: d.state.media.map((m) => ({ ...m, uri: absolute(m.uri) ?? m.uri, originalUri: absolute(m.originalUri) ?? m.originalUri, baseUri: absolute(m.baseUri) ?? m.baseUri, thumbUri: absolute(m.thumbUri) })),
    },
  };
}

async function readStored(userId: string): Promise<StoredDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    const list = raw ? (JSON.parse(raw) as StoredDraft[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeStored(userId: string, list: StoredDraft[]) {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(list));
  setCache({ userId, drafts: list.map(fromStored).sort((a, b) => b.savedAt - a.savedAt) });
}

export async function listDrafts(userId: string): Promise<Draft[]> {
  const list = (await readStored(userId)).map(fromStored).sort((a, b) => b.savedAt - a.savedAt);
  setCache({ userId, drafts: list });
  return list;
}

/** Copies `uri` into the draft's folder (once per distinct file) and returns its path there. */
async function keep(uri: string | null, folder: string, copied: Map<string, string>): Promise<string | null> {
  if (!uri) return null;
  // A photo library address (ph://) stays valid as it is; only files are copied.
  if (!uri.startsWith("file://")) return uri;
  const known = copied.get(uri);
  if (known) return known;
  // Already one of this draft's own files: keep it where it is.
  if (uri.startsWith(`${ROOT}${folder}`)) {
    const rel = uri.slice(ROOT.length);
    copied.set(uri, rel);
    return rel;
  }
  const ext = (uri.split("?")[0].split(".").pop() ?? "jpg").toLowerCase().slice(0, 5);
  const rel = `${folder}${localId("f")}.${ext}`;
  await FileSystem.copyAsync({ from: uri, to: `${ROOT}${rel}` });
  copied.set(uri, rel);
  return rel;
}

/** Saves the session as a draft (replacing the one it was opened from) and returns its id. */
export async function saveDraft(userId: string, s: ComposeState): Promise<string> {
  const id = s.draftId ?? localId("d");
  const folder = `${id}/`;
  await FileSystem.makeDirectoryAsync(`${ROOT}${folder}`, { intermediates: true }).catch(() => {});
  const copied = new Map<string, string>();
  const media: StoredMedia[] = [];
  for (const m of s.media) {
    const uri = (await keep(m.uri, folder, copied)) as string;
    media.push({ ...m, uri, originalUri: (await keep(m.originalUri, folder, copied)) as string, baseUri: (await keep(m.baseUri, folder, copied)) as string, thumbUri: await keep(m.thumbUri, folder, copied) });
  }
  // Files an earlier save of this draft kept and this one no longer needs.
  const used = new Set([...copied.values()].map((rel) => rel.slice(folder.length)));
  const present = await FileSystem.readDirectoryAsync(`${ROOT}${folder}`).catch(() => [] as string[]);
  await Promise.all(present.filter((name) => !used.has(name)).map((name) => FileSystem.deleteAsync(`${ROOT}${folder}${name}`, { idempotent: true })));

  const { draftId: _draftId, adding: _adding, ...rest } = s;
  const stored: StoredDraft = { id, savedAt: Date.now(), state: { ...rest, draftId: id, adding: false, media } };
  const list = (await readStored(userId)).filter((d) => d.id !== id);
  await writeStored(userId, [stored, ...list]);
  return id;
}

export async function deleteDraft(userId: string, id: string): Promise<void> {
  await FileSystem.deleteAsync(`${ROOT}${id}/`, { idempotent: true }).catch(() => {});
  await writeStored(userId, (await readStored(userId)).filter((d) => d.id !== id));
}

/** The account's drafts, read once and kept current as drafts are saved and deleted. */
export function useDrafts(userId: string | null | undefined): Draft[] {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => cache,
    () => cache,
  );
  useEffect(() => {
    if (userId && current?.userId !== userId) void listDrafts(userId);
  }, [userId, current?.userId]);
  return userId && current?.userId === userId ? current.drafts : NONE;
}

const NONE: Draft[] = [];

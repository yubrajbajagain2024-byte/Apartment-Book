import "server-only";
/**
 * Minimal Mux Video REST client for the media worker (server only). Same shape as the
 * website's client, plus playback-id management for hiding and restoring videos.
 */
const MUX_API = "https://api.mux.com";

export class MuxError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MuxError";
  }
}

export function muxConfigured(): boolean {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

function authHeader(): string {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) throw new Error("Mux is not configured: set MUX_TOKEN_ID and MUX_TOKEN_SECRET.");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function mux<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${MUX_API}${path}`, {
    method,
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { messages?: string[]; type?: string } };
  if (!res.ok) throw new MuxError(`Mux ${method} ${path} failed (${res.status}): ${json.error?.messages?.join("; ") ?? json.error?.type ?? "unknown error"}`, res.status);
  return json.data as T;
}

export type MuxPlaybackId = { id: string; policy: "public" | "signed" };
export type MuxAsset = { id: string; status: "preparing" | "ready" | "errored"; playback_ids?: MuxPlaybackId[] };

export function getAsset(id: string): Promise<MuxAsset> {
  return mux<MuxAsset>("GET", `/video/v1/assets/${encodeURIComponent(id)}`);
}

export function deleteAsset(id: string): Promise<void> {
  return mux<void>("DELETE", `/video/v1/assets/${encodeURIComponent(id)}`);
}

export function deletePlaybackId(assetId: string, playbackId: string): Promise<void> {
  return mux<void>("DELETE", `/video/v1/assets/${encodeURIComponent(assetId)}/playback-ids/${encodeURIComponent(playbackId)}`);
}

export function createPlaybackId(assetId: string, policy: "public" | "signed" = "public"): Promise<MuxPlaybackId> {
  return mux<MuxPlaybackId>("POST", `/video/v1/assets/${encodeURIComponent(assetId)}/playback-ids`, { policy });
}

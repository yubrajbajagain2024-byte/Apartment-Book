/**
 * Minimal Mux Video REST client (server only). Uses the access token from the
 * environment; never import this from client components.
 */
const MUX_API = "https://api.mux.com";

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
  if (!res.ok) throw new Error(`Mux ${method} ${path} failed (${res.status}): ${json.error?.messages?.join("; ") ?? json.error?.type ?? "unknown error"}`);
  return json.data as T;
}

export type MuxUpload = { id: string; url: string; status: "waiting" | "asset_created" | "errored" | "cancelled" | "timed_out"; asset_id?: string; error?: { type: string; message: string } };
export type MuxAsset = {
  id: string;
  status: "preparing" | "ready" | "errored";
  playback_ids?: { id: string; policy: "public" | "signed" }[];
  duration?: number;
  aspect_ratio?: string;
  max_stored_resolution?: string;
  tracks?: { type: string; max_width?: number; max_height?: number }[];
  errors?: { type: string; messages: string[] };
  passthrough?: string;
};

/** A direct-upload URL the browser (or app) PUTs the file to. */
export function createDirectUpload(input: { corsOrigin: string; passthrough: string }): Promise<MuxUpload> {
  return mux<MuxUpload>("POST", "/video/v1/uploads", {
    cors_origin: input.corsOrigin,
    timeout: 3600,
    new_asset_settings: {
      playback_policy: ["public"],
      video_quality: "plus",
      max_resolution_tier: "2160p",
      passthrough: input.passthrough,
    },
  });
}

export function getUpload(id: string): Promise<MuxUpload> {
  return mux<MuxUpload>("GET", `/video/v1/uploads/${id}`);
}

export function getAsset(id: string): Promise<MuxAsset> {
  return mux<MuxAsset>("GET", `/video/v1/assets/${id}`);
}

export function deleteAsset(id: string): Promise<void> {
  return mux<void>("DELETE", `/video/v1/assets/${id}`);
}

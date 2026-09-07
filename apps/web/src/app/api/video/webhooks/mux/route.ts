import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { muxPosterUrl, type Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Optional: Mux calls this when an asset is ready, so listings update without
 * polling. Needs MUX_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY. Without
 * them the status endpoint (polling) keeps everything working.
 */
export async function POST(request: Request) {
  const secret = process.env.MUX_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !serviceKey) return NextResponse.json({ error: "Webhook not configured" }, { status: 501 });

  const raw = await request.text();
  const signature = request.headers.get("mux-signature") ?? "";
  const timestamp = signature.match(/t=(\d+)/)?.[1];
  const v1 = signature.match(/v1=([a-f0-9]+)/)?.[1];
  if (!timestamp || !v1) return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  if (expected.length !== v1.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  const event = JSON.parse(raw) as { type: string; data: { id: string; passthrough?: string; status?: string; playback_ids?: { id: string; policy: string }[]; duration?: number; aspect_ratio?: string; tracks?: { type: string; max_width?: number; max_height?: number }[]; errors?: { messages?: string[] } } };
  const mediaId = event.data.passthrough;
  if (!mediaId) return NextResponse.json({ ok: true });

  const { url } = getSupabaseEnv();
  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
  if (event.type === "video.asset.ready") {
    const playback = event.data.playback_ids?.find((p) => p.policy === "public")?.id ?? null;
    const video = event.data.tracks?.find((t) => t.type === "video");
    await admin.from("media").update({
      status: playback ? "ready" : "processing",
      provider_asset_id: event.data.id,
      playback_id: playback,
      duration_seconds: event.data.duration ?? null,
      width: video?.max_width ?? null,
      height: video?.max_height ?? null,
      aspect_ratio: event.data.aspect_ratio ?? null,
      poster_url: playback ? muxPosterUrl(playback) : null,
    }).eq("id", mediaId);
  } else if (event.type === "video.asset.errored") {
    await admin.from("media").update({ status: "failed", provider_asset_id: event.data.id, error: event.data.errors?.messages?.join("; ") ?? "Processing failed" }).eq("id", mediaId);
  } else if (event.type === "video.asset.created" || event.type === "video.upload.asset_created") {
    await admin.from("media").update({ status: "processing", provider_asset_id: event.data.id }).eq("id", mediaId);
  }
  return NextResponse.json({ ok: true });
}

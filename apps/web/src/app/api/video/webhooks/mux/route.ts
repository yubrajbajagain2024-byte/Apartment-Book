import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { MAX_VIDEO_DURATION_SECONDS, muxPosterUrl, muxSignatureFresh, parseMuxSignature, videoTooLong } from "@apartment-book/shared";
import { deleteAsset } from "@/lib/mux";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Optional: Mux calls this when an asset is ready, so listings update without
 * polling. Needs MUX_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY. Without
 * them the status endpoint (polling) keeps everything working.
 *
 * Only a request Mux signed in the last few minutes counts: the signature
 * covers its time and its body, and an older one is refused as a replay.
 */
export async function POST(request: Request) {
  const secret = process.env.MUX_WEBHOOK_SECRET;
  const admin = createAdminClient();
  if (!secret || !admin) return NextResponse.json({ error: "Webhook not configured" }, { status: 501 });

  const raw = await request.text();
  const signed = parseMuxSignature(request.headers.get("mux-signature"));
  if (!signed) return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  if (!muxSignatureFresh(signed.timestamp, Math.floor(Date.now() / 1000))) return NextResponse.json({ error: "Stale signature" }, { status: 400 });
  const expected = Buffer.from(createHmac("sha256", secret).update(`${signed.timestamp}.${raw}`).digest("hex"));
  const valid = signed.signatures.some((v1) => {
    const given = Buffer.from(v1);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) return NextResponse.json({ error: "Bad signature" }, { status: 400 });

  let event: { type: string; data: { id: string; asset_id?: string; passthrough?: string; status?: string; playback_ids?: { id: string; policy: string }[]; duration?: number; aspect_ratio?: string; tracks?: { type: string; max_width?: number; max_height?: number }[]; errors?: { messages?: string[] } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  const mediaId = event.data?.passthrough;
  if (!mediaId) return NextResponse.json({ ok: true });

  if (event.type === "video.asset.ready") {
    if (videoTooLong(event.data.duration)) {
      // Longer than anyone may upload: gone at the provider, refused here (the database refuses it too).
      await deleteAsset(event.data.id).catch(() => {});
      await admin.from("media").update({ status: "failed", provider_asset_id: event.data.id, error: `Videos can be ${MAX_VIDEO_DURATION_SECONDS / 60} minutes at most.` }).eq("id", mediaId);
      return NextResponse.json({ ok: true });
    }
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
  } else if (event.type === "video.asset.created") {
    await admin.from("media").update({ status: "processing", provider_asset_id: event.data.id }).eq("id", mediaId);
  } else if (event.type === "video.upload.asset_created" && event.data.asset_id) {
    // An upload event: its id is the upload's, the asset's is asset_id.
    await admin.from("media").update({ status: "processing", provider_asset_id: event.data.asset_id }).eq("id", mediaId);
  }
  return NextResponse.json({ ok: true });
}

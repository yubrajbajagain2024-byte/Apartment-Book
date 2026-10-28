import { NextResponse } from "next/server";
import { createMediaRecord, MAX_VIDEO_SIZE_BYTES } from "@apartment-book/shared";
import { getSiteUrl } from "@/lib/env";
import { createDirectUpload } from "@/lib/mux";
import { getRequestUser } from "@/lib/request-user";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Start a video upload. Returns a direct-upload URL: the file goes straight
 * from the browser or app to the video provider, never through our server.
 * Body: { sizeBytes?: number, fileName?: string }. A declared size must be a
 * real one under the cap (older app builds send none when the picker does not
 * know it). What bounds an upload on the server is the database: uploads per
 * person a day, and the video's length once the provider has measured it
 * (migration 51; the provider's webhook and the status check enforce it too).
 */
export async function POST(request: Request) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: "Sign in to upload videos" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { sizeBytes?: unknown; fileName?: string };
  let size: number | null = null;
  if (body.sizeBytes !== undefined && body.sizeBytes !== null) {
    if (typeof body.sizeBytes !== "number" || !Number.isFinite(body.sizeBytes) || body.sizeBytes <= 0) {
      return NextResponse.json({ error: "Choose a video file to upload" }, { status: 400 });
    }
    size = Math.floor(body.sizeBytes);
    if (size > MAX_VIDEO_SIZE_BYTES) return NextResponse.json({ error: "Videos must be 2 GB or smaller" }, { status: 413 });
  }
  // The provider's ids are the server's to write (migration 51): without the service key, uploads cannot start.
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Video uploads are not available right now" }, { status: 503 });
  try {
    const media = await createMediaRecord(auth.supabase, { ownerId: auth.user.id, provider: "mux", providerUploadId: null, sizeBytes: size });
    const origin = request.headers.get("origin") ?? getSiteUrl();
    const upload = await createDirectUpload({ corsOrigin: origin, passthrough: media.id });
    const { error } = await admin.from("media").update({ provider_upload_id: upload.id }).eq("id", media.id);
    if (error) throw error;
    return NextResponse.json({ mediaId: media.id, uploadId: upload.id, uploadUrl: upload.url });
  } catch (error) {
    if ((error as { hint?: string } | null)?.hint === "RATE_LIMITED") {
      return NextResponse.json({ error: (error as { message: string }).message }, { status: 429 });
    }
    const message = error instanceof Error ? error.message : "Could not start the upload";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

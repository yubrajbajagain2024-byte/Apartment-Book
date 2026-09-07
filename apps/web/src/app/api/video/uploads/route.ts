import { NextResponse } from "next/server";
import { createMediaRecord, MAX_VIDEO_SIZE_BYTES } from "@apartment-book/shared";
import { getSiteUrl } from "@/lib/env";
import { createDirectUpload } from "@/lib/mux";
import { getRequestUser } from "@/lib/request-user";

/**
 * Start a video upload. Returns a direct-upload URL: the file goes straight
 * from the browser or app to the video provider, never through our server.
 * Body: { sizeBytes?: number, fileName?: string }
 */
export async function POST(request: Request) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: "Sign in to upload videos" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { sizeBytes?: number; fileName?: string };
  if (body.sizeBytes && body.sizeBytes > MAX_VIDEO_SIZE_BYTES) {
    return NextResponse.json({ error: "Videos must be 2 GB or smaller" }, { status: 413 });
  }

  try {
    const media = await createMediaRecord(auth.supabase, { ownerId: auth.user.id, provider: "mux", providerUploadId: "pending", sizeBytes: body.sizeBytes ?? null });
    const origin = request.headers.get("origin") ?? getSiteUrl();
    const upload = await createDirectUpload({ corsOrigin: origin, passthrough: media.id });
    await auth.supabase.from("media").update({ provider_upload_id: upload.id }).eq("id", media.id);
    return NextResponse.json({ mediaId: media.id, uploadId: upload.id, uploadUrl: upload.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the upload";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

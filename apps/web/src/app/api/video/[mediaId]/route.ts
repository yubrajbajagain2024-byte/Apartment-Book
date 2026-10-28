import { NextResponse } from "next/server";
import { getMedia } from "@apartment-book/shared";
import { getRequestUser } from "@/lib/request-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncMediaStatus } from "@/lib/video-status";

/** Current state of a video (polled after upload until it is ready). */
export async function GET(request: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const media = await getMedia(auth.supabase, mediaId).catch(() => null);
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    // The owner's poll asks the provider; the answer is written with the service role (migration 55).
    const admin = media.owner_id === auth.user.id ? createAdminClient() : null;
    const synced = admin ? await syncMediaStatus(admin, media) : media;
    return NextResponse.json({ media: synced });
  } catch (error) {
    return NextResponse.json({ media, warning: error instanceof Error ? error.message : "status check failed" });
  }
}

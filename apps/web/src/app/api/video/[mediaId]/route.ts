import { NextResponse } from "next/server";
import { getMedia } from "@apartment-book/shared";
import { getRequestUser } from "@/lib/request-user";
import { syncMediaStatus } from "@/lib/video-status";

/** Current state of a video (polled after upload until it is ready). */
export async function GET(request: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const media = await getMedia(auth.supabase, mediaId).catch(() => null);
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const synced = media.owner_id === auth.user.id ? await syncMediaStatus(auth.supabase, media) : media;
    return NextResponse.json({ media: synced });
  } catch (error) {
    return NextResponse.json({ media, warning: error instanceof Error ? error.message : "status check failed" });
  }
}

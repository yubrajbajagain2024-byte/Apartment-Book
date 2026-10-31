import { NextResponse, type NextRequest } from "next/server";
import { syncEventFeeds } from "@/lib/events-server/sync";

export const dynamic = "force-dynamic";
/** Several calendars with a 20 s timeout each, three at a time: within the minute a Hobby function gets. */
export const maxDuration = 60;

/**
 * The scheduled feed sync (vercel.json's cron). Vercel sends `Authorization: Bearer <CRON_SECRET>`; nothing else may
 * run it, and without the secret set the route does nothing at all. Staff have "Sync now" in the console instead.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const feeds = await syncEventFeeds();
    return NextResponse.json({ ok: true, synced: feeds.length, feeds });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}

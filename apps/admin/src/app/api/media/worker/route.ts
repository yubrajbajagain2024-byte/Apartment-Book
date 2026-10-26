import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { mediaWorkerEnabled } from "@/lib/env";
import { runMediaWorker } from "@/lib/media-worker";

/**
 * The retry sweep. Vercel's cron (apps/admin/vercel.json) calls GET with
 * `Authorization: Bearer <CRON_SECRET>`; anything else needs the same header.
 * Without CRON_SECRET the endpoint is off. Staff can also run the worker from the
 * Media page, and every hide/restore/delete runs it right away.
 */
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!mediaWorkerEnabled()) return NextResponse.json({ error: "The media worker is switched off (MEDIA_WORKER_ENABLED is not true)" }, { status: 503 });
  const summary = await runMediaWorker({ limit: 100, budgetMs: 45_000 });
  return NextResponse.json(summary);
}

export { handle as GET, handle as POST };

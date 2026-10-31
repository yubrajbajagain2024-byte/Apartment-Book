import "server-only";
import {
  EVENT_SYNC_DAYS_AHEAD,
  EVENT_SYNC_DAYS_BACK,
  applyFeedSyncPlan,
  listFeedEventsForSync,
  listFeedsToSync,
  parseIcs,
  parseRss,
  planFeedSync,
  recordFeedSync,
  type Client,
  type FeedToSync,
} from "@apartment-book/shared";
import { getSiteUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/** What one feed's sync came to, for the console and the cron's log. */
export type FeedSyncSummary = {
  id: string;
  name: string;
  status: "ok" | "unchanged" | "error";
  inserted: number;
  updated: number;
  cancelled: number;
  duplicates: number;
  itemsSeen: number;
  error: string | null;
};

/** A calendar bigger than this is not a campus calendar; a slower one is not worth holding a function for. */
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** Feeds synced at once: gentle on the calendars and within the route's time limit when a few are slow. */
const CONCURRENCY = 3;
const DAY_MS = 86_400_000;

type Fetched = { status: 304 } | { status: 200; text: string; etag: string | null };

/** The feed's text, or 304 when the calendar says nothing changed since the etag we kept. */
async function fetchFeed(feed: FeedToSync): Promise<Fetched> {
  if (!/^https:\/\//i.test(feed.url)) throw new Error("A feed must be an https address.");
  const headers: Record<string, string> = {
    "User-Agent": `UniBuzz-Events/1.0 (+${getSiteUrl()})`,
    Accept: feed.kind === "ics" ? "text/calendar, text/plain;q=0.9, */*;q=0.5" : "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
  };
  if (feed.etag) headers["If-None-Match"] = feed.etag;
  const res = await fetch(feed.url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (res.status === 304) return { status: 304 };
  if (!res.ok) throw new Error(`The calendar answered HTTP ${res.status}.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("The calendar is larger than 5 MB.");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new Error("The calendar is larger than 5 MB.");
  return { status: 200, text: new TextDecoder("utf-8").decode(bytes), etag: res.headers.get("etag") };
}

async function syncOne(admin: Client, feed: FeedToSync, nowMs: number): Promise<FeedSyncSummary> {
  const summary: FeedSyncSummary = { id: feed.id, name: feed.name, status: "ok", inserted: 0, updated: 0, cancelled: 0, duplicates: 0, itemsSeen: 0, error: null };
  try {
    const fetched = await fetchFeed(feed);
    if (fetched.status === 304) {
      summary.status = "unchanged";
      await recordFeedSync(admin, feed.id, { status: "unchanged" });
      console.info(`[events-sync] ${feed.name}: unchanged`);
      return summary;
    }
    const windowStart = nowMs - EVENT_SYNC_DAYS_BACK * DAY_MS;
    const windowEnd = nowMs + EVENT_SYNC_DAYS_AHEAD * DAY_MS;
    const parsed = feed.kind === "ics" ? parseIcs(fetched.text, { defaultTimeZone: feed.timezone, windowStart, windowEnd }) : parseRss(fetched.text, { windowStart, windowEnd });
    summary.itemsSeen = parsed.length;
    const existing = await listFeedEventsForSync(admin, feed.id, new Date(windowStart).toISOString());
    const plan = planFeedSync(parsed, existing, feed, nowMs);
    const result = await applyFeedSyncPlan(admin, feed, plan);
    Object.assign(summary, result);
    await recordFeedSync(admin, feed.id, { status: "ok", etag: fetched.etag, itemsSeen: parsed.length });
    console.info(`[events-sync] ${feed.name}: ${parsed.length} items, +${result.inserted} ~${result.updated} -${result.cancelled} (${result.duplicates} duplicates)`);
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    summary.status = "error";
    summary.error = message;
    console.warn(`[events-sync] ${feed.name}: ${message}`);
    await recordFeedSync(admin, feed.id, { status: "error", error: message }).catch(() => undefined);
  }
  return summary;
}

/**
 * Reads every enabled calendar feed (or the one named) and brings its events up to date: new ones in, changed ones
 * changed, cancelled ones marked, ones the calendar dropped marked cancelled too. Runs with the service role, from the
 * cron route and the console's "Sync now" alone. One feed's failure is recorded on that feed and never stops the rest.
 */
export async function syncEventFeeds(opts: { feedId?: string } = {}): Promise<FeedSyncSummary[]> {
  const admin = createAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set: the feed sync runs on the server alone.");
  const feeds = await listFeedsToSync(admin, { feedId: opts.feedId, includeDisabled: Boolean(opts.feedId) });
  const nowMs = Date.now();
  const out: FeedSyncSummary[] = [];
  for (let i = 0; i < feeds.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(feeds.slice(i, i + CONCURRENCY).map((f) => syncOne(admin, f, nowMs)))));
  }
  return out;
}

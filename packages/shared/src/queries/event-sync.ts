import type { ExistingFeedEvent, FeedForSync, FeedSyncPlan } from "../events/sync";
import { titleKeyOf } from "../events/sync";
import type { Client, EventFeed, TablesUpdate } from "../types/models";

/**
 * The reads and writes of the feed sync. They run with the service role (event_feeds is closed to the API roles and
 * feed events have no author), from the website's server (apps/web/src/lib/events-server) and nowhere else.
 */

export type FeedToSync = FeedForSync & Pick<EventFeed, "name" | "url" | "kind" | "etag" | "enabled" | "last_synced_at"> & { timezone: string };

/** Every enabled feed with its campus's time zone, the longest unsynced first. */
export async function listFeedsToSync(admin: Client, opts: { feedId?: string; includeDisabled?: boolean } = {}): Promise<FeedToSync[]> {
  let query = admin.from("event_feeds").select("id, university_id, organization_id, default_category, name, url, kind, etag, enabled, last_synced_at, university:universities!event_feeds_university_id_fkey(timezone)").order("last_synced_at", { ascending: true, nullsFirst: true });
  if (opts.feedId) query = query.eq("id", opts.feedId);
  else if (!opts.includeDisabled) query = query.eq("enabled", true);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as (Omit<FeedToSync, "timezone"> & { university: { timezone: string } | { timezone: string }[] | null })[]).map((f) => {
    const u = Array.isArray(f.university) ? f.university[0] : f.university;
    const { university: _u, ...rest } = f;
    return { ...rest, timezone: u?.timezone ?? "America/Chicago" };
  });
}

/** A feed's events from `fromIso` on (no upper bound: a row beyond the window must not be inserted twice). */
export async function listFeedEventsForSync(admin: Client, feedId: string, fromIso: string): Promise<ExistingFeedEvent[]> {
  const { data, error } = await admin.from("events").select("id, external_uid, title, description, starts_at, ends_at, all_day, location, category, registration_url, status").eq("feed_id", feedId).or(`starts_at.gte.${fromIso},ends_at.gte.${fromIso}`).limit(5000);
  if (error) throw error;
  return (data ?? []).filter((r): r is typeof r & { external_uid: string } => r.external_uid !== null);
}

export type FeedSyncResult = { inserted: number; updated: number; cancelled: number; duplicates: number };

/**
 * Applies a plan. Before inserting, an event with the same title at the same moment on the same campus that another
 * feed or an organization already lists is left out: one row per real event, whichever calendar said it first.
 */
export async function applyFeedSyncPlan(admin: Client, feed: FeedForSync, plan: FeedSyncPlan): Promise<FeedSyncResult> {
  const result: FeedSyncResult = { inserted: 0, updated: 0, cancelled: 0, duplicates: 0 };
  if (plan.inserts.length > 0) {
    const keys = [...new Set(plan.inserts.map((i) => titleKeyOf(i.title)))];
    const starts = [...new Set(plan.inserts.map((i) => i.starts_at))];
    const { data: others, error } = await admin.from("events").select("title_key, starts_at, feed_id").eq("university_id", feed.university_id).in("title_key", keys).in("starts_at", starts);
    if (error) throw error;
    const taken = new Set((others ?? []).filter((o) => o.feed_id !== feed.id).map((o) => `${o.title_key}|${Date.parse(o.starts_at)}`));
    const fresh = plan.inserts.filter((i) => !taken.has(`${titleKeyOf(i.title)}|${Date.parse(i.starts_at)}`));
    result.duplicates = plan.inserts.length - fresh.length;
    for (let i = 0; i < fresh.length; i += 100) {
      const { error: e } = await admin.from("events").insert(fresh.slice(i, i + 100));
      if (e) throw e;
      result.inserted += Math.min(100, fresh.length - i);
    }
  }
  for (const u of plan.updates) {
    const { error } = await admin.from("events").update(u.patch).eq("id", u.id);
    if (error) throw error;
    result.updated++;
  }
  if (plan.cancelIds.length > 0) {
    const { error } = await admin.from("events").update({ status: "cancelled" }).in("id", plan.cancelIds);
    if (error) throw error;
    result.cancelled = plan.cancelIds.length;
  }
  return result;
}

/** What the console shows about the last sync of a feed. */
export async function recordFeedSync(admin: Client, feedId: string, outcome: { status: "ok" | "unchanged" | "error"; error?: string | null; etag?: string | null; itemsSeen?: number }): Promise<void> {
  const patch: TablesUpdate<"event_feeds"> = { last_synced_at: new Date().toISOString(), last_status: outcome.status, last_error: outcome.error ?? null };
  if (outcome.etag !== undefined) patch.etag = outcome.etag;
  if (outcome.itemsSeen !== undefined) patch.items_seen = outcome.itemsSeen;
  const { error } = await admin.from("event_feeds").update(patch).eq("id", feedId);
  if (error) throw error;
}

import type { EventCategory } from "../constants";
import { categoryFromText, isEventCategory } from "./category";
import type { ParsedEvent } from "./ics";

/** The feed being synced, as event_feeds has it. */
export type FeedForSync = { id: string; university_id: string; organization_id: string | null; default_category: string };

/** A feed's event as the database has it now: what the plan compares against. */
export type ExistingFeedEvent = {
  id: string;
  external_uid: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  category: string;
  registration_url: string | null;
  status: string;
};

/** A feed event's columns as the sync writes them. */
export type FeedEventWrite = {
  university_id: string;
  organization_id: string | null;
  feed_id: string;
  external_uid: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  category: EventCategory;
  registration_url: string | null;
  source: "feed";
  status: "scheduled" | "cancelled";
};

export type FeedSyncPlan = {
  inserts: FeedEventWrite[];
  updates: { id: string; patch: Partial<FeedEventWrite> }[];
  /** Future events the feed no longer lists: marked cancelled, never deleted (someone may have saved one). */
  cancelIds: string[];
  unchanged: number;
};

/** The same normalisation as events.title_key in the database, for the duplicate check across feeds. */
export function titleKeyOf(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

const same = (a: string | null, b: string | null) => (a ?? null) === (b ?? null);
const sameInstant = (a: string | null, b: string | null) => (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);

/**
 * What a sync changes: new items inserted, changed ones updated column by column, items the feed dropped (still ahead)
 * cancelled. A row staff hid keeps its status whatever the feed says; a row the feed cancels and later restores is
 * scheduled again. The duplicate check against other feeds and organizations is the applier's (it needs the database).
 */
export function planFeedSync(parsed: ParsedEvent[], existing: ExistingFeedEvent[], feed: FeedForSync, nowMs: number): FeedSyncPlan {
  const fallback: EventCategory = isEventCategory(feed.default_category) ? feed.default_category : "other";
  const byUid = new Map(existing.map((e) => [e.external_uid, e]));
  const seen = new Set<string>();
  const plan: FeedSyncPlan = { inserts: [], updates: [], cancelIds: [], unchanged: 0 };
  for (const p of parsed) {
    if (seen.has(p.uid)) continue;
    seen.add(p.uid);
    const want: FeedEventWrite = {
      university_id: feed.university_id,
      organization_id: feed.organization_id,
      feed_id: feed.id,
      external_uid: p.uid,
      title: p.title,
      description: p.description,
      starts_at: p.startsAt,
      ends_at: p.endsAt,
      all_day: p.allDay,
      location: p.location,
      category: categoryFromText(p.categories, p.title, fallback),
      registration_url: p.url,
      source: "feed",
      status: p.cancelled ? "cancelled" : "scheduled",
    };
    const have = byUid.get(p.uid);
    if (!have) {
      plan.inserts.push(want);
      continue;
    }
    const patch: Partial<FeedEventWrite> = {};
    if (have.title !== want.title) patch.title = want.title;
    if (!same(have.description, want.description)) patch.description = want.description;
    if (!sameInstant(have.starts_at, want.starts_at)) patch.starts_at = want.starts_at;
    if (!sameInstant(have.ends_at, want.ends_at)) patch.ends_at = want.ends_at;
    if (have.all_day !== want.all_day) patch.all_day = want.all_day;
    if (!same(have.location, want.location)) patch.location = want.location;
    if (have.category !== want.category) patch.category = want.category;
    if (!same(have.registration_url, want.registration_url)) patch.registration_url = want.registration_url;
    if (have.status !== "hidden" && have.status !== want.status) patch.status = want.status;
    if (Object.keys(patch).length > 0) plan.updates.push({ id: have.id, patch });
    else plan.unchanged++;
  }
  for (const e of existing) {
    if (seen.has(e.external_uid)) continue;
    if (e.status === "scheduled" && Date.parse(e.starts_at) >= nowMs) plan.cancelIds.push(e.id);
  }
  return plan;
}

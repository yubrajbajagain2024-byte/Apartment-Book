// Activity status, Messenger style (migration 22): what a direct chat shows under the other person's name. Pure helpers
// only: no queries and no runtime imports, so the unit tests can load this file directly. Who is online comes from the
// presence store, and last-active times from getActivityStatusMany() (both in queries/presence.ts).

/** How often an open chat redraws its activity line, so "Active 5 min ago" keeps counting. */
export const ACTIVITY_LABEL_REFRESH_MS = 30 * 1000;
/**
 * How often an open chat asks again for the other person's time: someone active without appearing in presence (an old
 * build, a blocked websocket) keeps stamping, and "Active now" needs a recent stamp (see activityLine).
 */
export const ACTIVITY_REFETCH_MS = 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A time up to this far ahead of the device's clock is clock skew and reads "Active 1 min ago". Further ahead, nothing. */
const CLOCK_SKEW_MS = 5 * MINUTE;

/** What activity_status() says about one person: their last-active time, to the minute, and whether it is recent. */
export type ActivityStatus = {
  /** Null for someone who shares a chat with you but has not written to you: you may see "Active now", not when. */
  lastActiveAt: string | null;
  /** Within about two minutes of the server's clock: an app in front stamps every minute, so someone online has one. */
  recent: boolean;
};

/**
 * When someone who is not online now was last active: "Active 1 min ago" to "Active 59 min ago", "Active 1 hour ago",
 * "Active 3 hours ago" (up to a day), then by this device's calendar: "Active yesterday" for the day before today, and
 * "Active 2 days ago" and up for earlier dates. Never "0 min": anything under a minute, or a little ahead of this
 * device's clock, reads "Active 1 min ago". Null when there is nothing trustworthy to say: no time, one that does not
 * parse, or one too far ahead to be clock skew.
 */
export function activityLabel(lastActiveAt: string | null | undefined, now: Date | number = Date.now()): string | null {
  if (!lastActiveAt) return null;
  const nowMs = typeof now === "number" ? now : now.getTime();
  const at = Date.parse(lastActiveAt);
  const ago = nowMs - at;
  if (!Number.isFinite(ago) || ago < -CLOCK_SKEW_MS) return null;
  if (ago < HOUR) return `Active ${Math.max(1, Math.floor(ago / MINUTE))} min ago`;
  // "Yesterday" is a date, not a span: 47 hours ago on a Wednesday morning was Monday. (A day 25 hours long, when the
  // clocks go back, can leave a full day on the same date: then it is still hours.)
  const days = ago < DAY ? 0 : datesApart(at, nowMs);
  if (days < 1) {
    const hours = Math.floor(ago / HOUR);
    return `Active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  return days === 1 ? "Active yesterday" : `Active ${days} days ago`;
}

/** How many dates on this device's calendar lie between two moments (0 for the same date, 1 for the day before). */
function datesApart(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
}

/** The line under a direct chat's name: "Active now" (shown with the green dot) or when they were last active. */
export type ActivityLine = { label: string; online: boolean };

/**
 * What a direct chat shows under the other person's name, or null for nothing at all.
 *   * ready: the presence store's isReady(). Until presence is known, nothing: no "Active now" or "Active 5 min ago"
 *     guessed for someone who may have come online or left meanwhile.
 *   * activity: what getActivityStatusMany() says about them. The database leaves out everyone you may not see (they
 *     hide their status, you hide yours, you are blocked either way, or you share no chat), so without it there is
 *     nothing to show, not even "Active now": presence knows nothing about those rules. Its time is null for someone
 *     who has not written to you: then "Active now" or nothing.
 *   * online: presence has them online now.
 * "Active now" needs presence and a recent time both. Anyone on the channel can claim presence for anyone, while only
 * the person's own app stamps their time, every minute in front; so when the two disagree, the time is what is shown.
 */
export function activityLine(
  status: { ready: boolean; online: boolean; activity: ActivityStatus | null | undefined },
  now: Date | number = Date.now(),
): ActivityLine | null {
  const { activity } = status;
  if (!status.ready || !activity) return null;
  if (status.online && activity.recent) return { label: "Active now", online: true };
  const label = activityLabel(activity.lastActiveAt, now);
  return label ? { label, online: false } : null;
}

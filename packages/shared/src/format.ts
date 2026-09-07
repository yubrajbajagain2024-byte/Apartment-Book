import { formatPrice } from "./utils";
import { format, formatDistanceToNowStrict, isThisYear, isToday, isYesterday } from "date-fns";

/** "3 minutes ago", "2 days ago" … */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

/** "7 Sep 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return format(new Date(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
}

/** Short timestamp for chat bubbles: 14:05, Yesterday 14:05, 3 Mar 14:05, 3 Mar 2025 14:05 */
export function formatMessageTime(iso: string): string {
  try {
    const date = new Date(iso);
    if (isToday(date)) return format(date, "HH:mm");
    if (isYesterday(date)) return `Yesterday ${format(date, "HH:mm")}`;
    if (isThisYear(date)) return format(date, "d MMM HH:mm");
    return format(date, "d MMM yyyy HH:mm");
  } catch {
    return "";
  }
}

/** "Today", "Yesterday" or "Mon, 3 Mar" for chat day separators. */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, isThisYear(date) ? "EEE, d MMM" : "EEE, d MMM yyyy");
}

/** True when two timestamps fall on the same calendar day (device timezone). */
export function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** True when the timestamp is within the last `hours` hours (default 48). */
export function isRecent(iso: string | null | undefined, hours = 48): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < hours * 60 * 60 * 1000;
}

/** "$500 – $700", "Up to $700", "From $500" or null when no budget is given. */
export function budgetLabel(post: { budget_min: number | null; budget_max: number | null; currency: string }): string | null {
  if (post.budget_min !== null && post.budget_max !== null) {
    return `${formatPrice(post.budget_min, post.currency)} – ${formatPrice(post.budget_max, post.currency)}`;
  }
  if (post.budget_max !== null) return `Up to ${formatPrice(post.budget_max, post.currency)}`;
  if (post.budget_min !== null) return `From ${formatPrice(post.budget_min, post.currency)}`;
  return null;
}

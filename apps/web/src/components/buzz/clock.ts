"use client";

/**
 * Time for Buzz: one shared clock (ticks every 30 s while something shows a time) and UniVerse's formats.
 * Buzz times are already floored to the minute by the server; nothing here adds precision.
 */
import { useSyncExternalStore } from "react";

let now = Date.now();
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  now = Date.now();
  subscribers.forEach((s) => s());
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  if (!timer) {
    // Waking up after a while: start from the real time, not the last tick.
    now = Date.now();
    timer = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
  }
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

/** The current time, re-rendering every 30 s. Use it instead of Date.now() in render. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const clockTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const weekdayMonthDay = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

/** "now", "5m", "3h", "2d", then "Sep 30" ("Sep 30, 2025" in another year). */
export function buzzTimeAgo(ts: number, at: number): string {
  const diff = at - ts;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  const d = new Date(ts);
  return d.getFullYear() === new Date(at).getFullYear() ? monthDay.format(d) : monthDayYear.format(d);
}

/** "Today · 3:45 PM", "Yesterday · 9:00 AM", "Sat, Mar 4 · 3:45 PM". */
export function buzzDayTime(ts: number, at: number): string {
  const d = new Date(ts);
  const ref = new Date(at);
  const time = clockTime.format(d);
  const sameDay = (x: Date, y: Date) => x.toDateString() === y.toDateString();
  if (sameDay(d, ref)) return `Today · ${time}`;
  if (sameDay(d, new Date(at - DAY))) return `Yesterday · ${time}`;
  if (sameDay(d, new Date(at + DAY))) return `Tomorrow · ${time}`;
  return `${weekdayMonthDay.format(d)} · ${time}`;
}

/** "Oct 23, 2026". */
export function buzzDate(ts: number): string {
  return monthDayYear.format(new Date(ts));
}

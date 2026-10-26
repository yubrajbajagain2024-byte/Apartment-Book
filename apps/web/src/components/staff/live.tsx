"use client";

import { useEffect, useState } from "react";
import { useHydrated } from "@/lib/hooks";
import { ago, slaText } from "@/lib/staff/format";
import { Pill } from "./parts";

/** The current time, re-read every `ms` so countdowns move. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** "SLA 4h" / "SLA overdue 2d", ticking. Nothing for closed items. */
export function SlaChip({ dueAt, closed, p0 }: { dueAt: number; closed: boolean; p0: boolean }) {
  const now = useNow();
  const hydrated = useHydrated();
  if (closed || !hydrated) return null;
  const { text, overdue } = slaText(dueAt, now);
  return <Pill tone={overdue ? "red" : p0 ? "amber" : "gray"}>{text}</Pill>;
}

/** "12m ago", after hydration (the server's clock and the browser's may disagree). */
export function Ago({ ms, className }: { ms: number; className?: string }) {
  const hydrated = useHydrated();
  const now = useNow(60_000);
  return (
    <time dateTime={new Date(ms).toISOString()} className={className} suppressHydrationWarning>
      {hydrated ? ago(ms, now) : ago(ms, ms)}
    </time>
  );
}

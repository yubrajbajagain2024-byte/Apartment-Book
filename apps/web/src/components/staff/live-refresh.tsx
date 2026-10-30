"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Radio, RefreshCw } from "lucide-react";
import { useHydrated } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const KEY = "console-live";
const EVERY_MS = 30_000;

// The choice, kept per browser: read with useSyncExternalStore so the server's render (on) and the browser's agree.
const listeners = new Set<() => void>();
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
const readLive = () => window.localStorage.getItem(KEY) !== "off";

/**
 * "Live": the page asks the database again every 30 seconds while it is in front (never in a background tab), so the
 * numbers move as students use the apps. On by default; the choice is kept per browser. "Refresh" asks once.
 */
export function LiveRefresh({ generatedAt }: { generatedAt: number }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const live = useSyncExternalStore(subscribe, readLive, () => true);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!live) return;
    const tick = () => {
      if (document.visibilityState === "visible") start(() => router.refresh());
    };
    const id = window.setInterval(tick, EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - generatedAt > EVERY_MS) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, router, generatedAt]);

  const toggle = () => {
    window.localStorage.setItem(KEY, live ? "off" : "on");
    listeners.forEach((l) => l());
  };

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={live}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-medium ring-1 ring-inset",
          live ? "bg-green-50 text-green-800 ring-green-300" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
        )}
      >
        <Radio className={cn("h-3.5 w-3.5", live && "motion-safe:animate-pulse")} aria-hidden />
        {live ? "Live" : "Paused"}
      </button>
      <button
        type="button"
        onClick={() => start(() => router.refresh())}
        disabled={pending}
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-60"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", pending && "motion-safe:animate-spin")} aria-hidden />
        Refresh
      </button>
      <span aria-live="polite" suppressHydrationWarning>
        {hydrated ? `Updated ${new Date(generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : null}
      </span>
    </div>
  );
}

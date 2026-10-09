"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SectionTab } from "./section-tabs";

/**
 * A touch that starts on one of these never changes tab: things you type in, players with their own controls, and
 * things with a sideways gesture of their own (multi-photo carousels, photo rails and the map mark themselves
 * data-no-swipe; feed videos do not).
 */
const KEEP_STILL = "[data-no-swipe], input, textarea, select, video[controls], [role='dialog'], [contenteditable='true']";
/** Movement before the gesture counts as sideways at all; a vertical move this long drops it (the page is scrolling). */
const LOCK_PX = 12;
/** A slow drag commits at this distance; a flick (faster than FLICK_SPEED px/ms) already at FLICK_PX. */
const COMMIT_PX = 70;
const FLICK_PX = 24;
const FLICK_SPEED = 0.6;
/** The body follows the finger with resistance, never further than this, and leaves a little further when a swipe commits. */
const DRAG_MAX = 48;
const LEAVE_PX = 56;

type Gesture = { x: number; y: number; dx: number; lock: "none" | "x" | "y"; samples: { x: number; t: number }[] };

/** Something between the touched element and the wrapper scrolls sideways (topic pills, say) and keeps the gesture for itself. */
function scrollsSideways(from: Element, upTo: HTMLElement): boolean {
  for (let el: Element | null = from; el && el !== upTo; el = el.parentElement) {
    const { overflowX } = getComputedStyle(el);
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

/** The tab a finger moving by dx leads to: left (dx < 0) is the next tab, right the previous one; none past the ends. */
function neighbour<V extends string>(sections: readonly SectionTab<V>[], section: V, dx: number): V | null {
  const index = sections.findIndex((s) => s.value === section);
  return sections[index + (dx < 0 ? 1 : -1)]?.value ?? null;
}

/**
 * Wraps the body of a section (not the tabs): on a touch screen a sideways swipe moves to the neighbouring tab, like
 * TikTok. Touch only, and nothing moves until the finger has clearly gone sideways, so scrolling the feed is left
 * alone. The body follows the finger a little, then slides out while the next section loads. Home and Housing share
 * it; the neighbours are the given sections in order, with no wrap-around.
 */
export function SectionSwipe<V extends string>({ sections, section, hrefFor, className, children }: { sections: readonly SectionTab<V>[]; section: V; hrefFor: (section: V) => string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  // Read when a swipe commits rather than listed as a dependency: the wrappers hand over a fresh arrow on every
  // render, and re-binding the listeners for that would drop a gesture in progress.
  const hrefForRef = useRef(hrefFor);
  useEffect(() => {
    hrefForRef.current = hrefFor;
  });

  // The new section has arrived: show it where it belongs, without animating the way back.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    leaving.current = false;
    el.style.transition = "none";
    el.style.transform = "";
    el.style.opacity = "";
  }, [section]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let gesture: Gesture | null = null;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const move = (x: number, fade?: number, ms?: number) => {
      el.style.transition = ms && !still ? `transform ${ms}ms ease-out, opacity ${ms}ms ease-out` : "none";
      // "" rather than translateX(0): any transform would make the wrapper the containing block of the fixed menus and sheets inside it.
      el.style.transform = x ? `translateX(${x}px)` : "";
      el.style.opacity = fade === undefined ? "" : String(fade);
    };

    const start = (e: TouchEvent) => {
      gesture = null;
      if (leaving.current || e.touches.length !== 1) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest(KEEP_STILL) || scrollsSideways(target, el)) return;
      const t = e.touches[0];
      gesture = { x: t.clientX, y: t.clientY, dx: 0, lock: "none", samples: [{ x: t.clientX, t: e.timeStamp }] };
    };
    const drag = (e: TouchEvent) => {
      const g = gesture;
      if (!g || g.lock === "y") return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (g.lock === "none") {
        // Vertical wins: the page is scrolling.
        if (Math.abs(dy) > LOCK_PX && Math.abs(dy) > Math.abs(dx)) {
          g.lock = "y";
          return;
        }
        if (Math.abs(dx) <= LOCK_PX || Math.abs(dx) <= 1.5 * Math.abs(dy)) return;
        g.lock = "x";
      }
      g.dx = dx;
      // Only the last ~100ms say how fast the finger was going when it let go.
      g.samples.push({ x: t.clientX, t: e.timeStamp });
      while (g.samples.length > 1 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();
      // Resistance: a third of the finger's travel, a sixth when there is no tab in that direction.
      move(Math.max(-DRAG_MAX, Math.min(DRAG_MAX, dx / (neighbour(sections, section, dx) ? 3 : 6))));
    };
    const end = () => {
      const g = gesture;
      gesture = null;
      if (!g || g.lock !== "x") return;
      const first = g.samples[0];
      const last = g.samples[g.samples.length - 1];
      // Signed: a flick back towards where the finger started is a change of mind, not a faster swipe.
      const velocity = (last.x - first.x) / Math.max(1, last.t - first.t);
      const flick = Math.abs(velocity) > FLICK_SPEED && Math.sign(velocity) === Math.sign(g.dx) && Math.abs(g.dx) >= FLICK_PX;
      const to = neighbour(sections, section, g.dx);
      if (to && (Math.abs(g.dx) >= COMMIT_PX || flick)) {
        leaving.current = true;
        move(g.dx < 0 ? -LEAVE_PX : LEAVE_PX, 0.6, 180);
        router.push(hrefForRef.current(to), { scroll: false });
      } else {
        move(0, undefined, 220);
      }
    };
    const cancel = () => {
      if (gesture?.lock === "x") move(0, undefined, 220);
      gesture = null;
    };

    // Passive: the browser keeps scrolling vertically on its own (touch-action: pan-y); only the sideways part is ours.
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", drag, { passive: true });
    el.addEventListener("touchend", end, { passive: true });
    el.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", drag);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", cancel);
    };
  }, [sections, section, router]);

  return (
    // min-h: a swipe on the empty space under a short feed counts too. pinch-zoom stays with the browser: the site is zoomable everywhere else.
    <div ref={ref} style={{ touchAction: "pan-y pinch-zoom" }} className={cn("min-h-[50dvh]", className)} data-testid="section-swipe">
      {children}
    </div>
  );
}

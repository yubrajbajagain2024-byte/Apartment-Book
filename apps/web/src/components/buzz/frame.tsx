"use client";

/**
 * The frame of a Buzz page on the website (thread, search, My buzzes): a Phosphor column under the site header —
 * edge to edge on a phone, the 500px content column on a wider screen — with UniVerse's compact header (back, title,
 * actions, an optional sticky row under it) and an optional footer that sticks above the phone's tab bar.
 */
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton, T } from "./ui";

type NavigationEntries = { entries(): { url: string | null }[]; currentEntry: { index: number } | null };

/** True when the page before this one in the tab is on this site, so "back" lands where the person came from. */
function canGoBack(): boolean {
  try {
    const nav = (window as unknown as { navigation?: NavigationEntries }).navigation;
    if (nav?.currentEntry) {
      const index = nav.currentEntry.index;
      const before = index > 0 ? nav.entries()[index - 1]?.url : null;
      return Boolean(before) && new URL(before as string).origin === window.location.origin;
    }
  } catch {
    // No Navigation API: fall through.
  }
  return window.history.length > 1;
}

export function useBuzzBack(fallback: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (canGoBack()) router.back();
    else router.push(fallback);
  }, [router, fallback]);
}

/** Below the site's sticky header (h-14). */
export const HEADER_TOP = "top-14";

export function BuzzPageHeader({ title, subtitle, onBack, actions, below }: { title: ReactNode; subtitle?: ReactNode; onBack(): void; actions?: ReactNode; below?: ReactNode }) {
  return (
    <div className={cn("sticky z-20 border-b border-incog-line-subtle bg-incog-canvas/90 backdrop-blur-xl sm:rounded-t-[20px]", HEADER_TOP)}>
      <div className="flex h-[52px] items-center px-2">
        <IconButton icon={ChevronLeft} aria-label="Back" onClick={onBack} />
        <div className="min-w-0 flex-1 pl-1">
          <h1 className={cn("truncate text-incog-ink", T.title3)}>{title}</h1>
          {subtitle ? <p className={cn("-mt-0.5 truncate text-incog-ink-3", T.caption)}>{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center">{actions}</div>
      </div>
      {below ? <div className="px-4 pt-1 pb-3">{below}</div> : null}
    </div>
  );
}

/**
 * Classes for the root of a Buzz page (`BuzzSurface className`): it fills the screen from the site header down, takes
 * back the page padding around it, and on a phone runs under the tab bar (the footer spacer keeps the last line clear).
 */
export const PAGE_FRAME = cn(
  "-mx-3 -mt-4 -mb-24 flex min-h-[calc(100dvh-57px)] flex-col md:-mb-8",
  "sm:mx-auto sm:mt-0 sm:w-full sm:max-w-[500px] sm:min-h-[calc(100dvh-73px)] sm:rounded-t-[20px] sm:border-x sm:border-t sm:border-incog-line",
);

/* ───────────────────────────── the phone's tab bar ───────────────────────────── */

/**
 * The site's bottom tab bar (components/layout/bottom-nav.tsx: fixed, aria-label "Main", hidden from md up) covers the
 * bottom of the page on a phone. Its real height (safe area included) is measured, so the reply bar sits exactly on
 * it and the last card clears it; 0 when it is hidden. null on the server (the CSS fallbacks apply).
 */
let tabBar = 0;
const tabBarListeners = new Set<() => void>();
let tabBarObserver: ResizeObserver | null = null;

function measureTabBar(): void {
  const nav = document.querySelector<HTMLElement>('nav.fixed[aria-label="Main"]');
  const h = nav && getComputedStyle(nav).display !== "none" ? Math.round(nav.getBoundingClientRect().height * 2) / 2 : 0;
  if (h === tabBar) return;
  tabBar = h;
  tabBarListeners.forEach((l) => l());
}

function subscribeTabBar(listener: () => void): () => void {
  tabBarListeners.add(listener);
  if (!tabBarObserver) {
    tabBarObserver = new ResizeObserver(measureTabBar);
    const nav = document.querySelector<HTMLElement>('nav.fixed[aria-label="Main"]');
    if (nav) tabBarObserver.observe(nav);
    window.addEventListener("resize", measureTabBar);
    measureTabBar();
  }
  return () => {
    tabBarListeners.delete(listener);
    if (tabBarListeners.size === 0 && tabBarObserver) {
      tabBarObserver.disconnect();
      tabBarObserver = null;
      window.removeEventListener("resize", measureTabBar);
    }
  };
}

export function useTabBarHeight(): number | null {
  return useSyncExternalStore(
    subscribeTabBar,
    () => tabBar,
    () => null,
  );
}

/**
 * Sticky bottom bar (the reply bar): right on top of the phone's tab bar, at the bottom on a desktop. Its background
 * runs on under the tab bar, so no rounding gap can ever show the replies scrolling behind it.
 */
export function BuzzPageFooter({ children, className }: { children: ReactNode; className?: string }) {
  const bar = useTabBarHeight();
  return (
    <div
      style={bar === null ? undefined : { bottom: bar }}
      className={cn(
        "sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 mt-auto border-t border-incog-line-subtle bg-incog-canvas md:bottom-0",
        "after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-incog-canvas",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The room the phone's tab bar takes (it is fixed over the page); nothing on desktop. */
export function TabBarSpacer() {
  const bar = useTabBarHeight();
  return <div aria-hidden="true" style={bar === null ? undefined : { height: bar }} className="h-[calc(3.75rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" />;
}

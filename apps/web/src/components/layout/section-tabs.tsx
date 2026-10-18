"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const BAR = "h-[3px] w-6 rounded-full bg-brand-600";
const BAR_WIDTH = 24;

/** One tab of a section bar; the value is what hrefFor receives and the tail of the link's test id. */
export type SectionTab<V extends string> = { readonly value: V; readonly label: string };

/**
 * TikTok-style top tabs with one underline that slides to the active tab. Sticks right under the navbar. Home
 * (For you | Buzz | Posts | Reels) and Housing (Apartments | Roommates) share it: the tabs are plain links, so the
 * server renders the chosen section and the bar only has to look right while that loads.
 */
export function SectionTabs<V extends string>({
  sections,
  active,
  hrefFor,
  label,
  testIdPrefix,
  className,
}: {
  sections: readonly SectionTab<V>[];
  active: V;
  /** The link of a tab; the caller carries whatever should survive the change of tab (the campus switch, say). */
  hrefFor: (section: V) => string;
  /** The nav's aria-label, e.g. "Home sections"; the browser checks find the bar by it. */
  label: string;
  /** Each link is data-testid="<prefix>-<value>". */
  testIdPrefix: string;
  className?: string;
}) {
  // The tapped tab lights up straight away while the server renders that section.
  const [tapped, setTapped] = useState<V | null>(null);
  const [seen, setSeen] = useState(active);
  if (seen !== active) {
    setSeen(active);
    setTapped(null);
  }
  const shown = tapped ?? active;
  const listRef = useRef<HTMLUListElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<Partial<Record<V, HTMLLIElement | null>>>({});

  // The underline is placed by hand rather than through state. The server cannot measure, so until the first
  // measurement the active tab draws its own static bar in the same spot (nothing jumps while hydrating); measuring
  // marks the list data-measured, which swaps that for the sliding bar. Coming out of display:none, that first
  // placement is not animated; every later one slides.
  useLayoutEffect(() => {
    const place = () => {
      const tab = tabRefs.current[shown];
      if (!tab || !barRef.current || !listRef.current) return;
      barRef.current.style.transform = `translateX(${tab.offsetLeft + tab.offsetWidth / 2 - BAR_WIDTH / 2}px)`;
      listRef.current.dataset.measured = "";
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [shown]);

  return (
    <nav aria-label={label} className={cn("sticky top-14 z-30 -mx-3 border-b border-gray-200 bg-white/95 backdrop-blur sm:mx-0 sm:w-full sm:max-w-[500px] sm:self-center sm:rounded-xl sm:border-b-0 sm:ring-1 sm:ring-gray-200", className)}>
      {/* gap-7 rather than gap-8: Home's four tabs have to sit next to each other on a 390px phone. */}
      <ul ref={listRef} className="group/tabs relative flex items-stretch justify-center gap-7">
        {sections.map((section) => {
          const current = section.value === shown;
          return (
            <li
              key={section.value}
              ref={(el) => {
                tabRefs.current[section.value] = el;
              }}
            >
              <Link
                href={hrefFor(section.value)}
                scroll={false}
                onClick={() => setTapped(section.value)}
                aria-current={current ? "page" : undefined}
                className={cn("relative flex h-11 items-center px-1 text-[15px] transition-colors", current ? "font-bold text-gray-900" : "font-medium text-gray-500 hover:text-gray-800")}
                data-testid={`${testIdPrefix}-${section.value}`}
              >
                {section.label}
                {current ? <span aria-hidden="true" className={cn("absolute inset-x-0 bottom-1 mx-auto group-data-[measured]/tabs:hidden", BAR)} /> : null}
              </Link>
            </li>
          );
        })}
        <span ref={barRef} aria-hidden="true" className={cn("pointer-events-none absolute bottom-1 left-0 hidden transition-transform duration-[220ms] ease-out motion-reduce:transition-none group-data-[measured]/tabs:block", BAR)} />
      </ul>
    </nav>
  );
}

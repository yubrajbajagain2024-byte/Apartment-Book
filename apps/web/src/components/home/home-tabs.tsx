"use client";

import { useState } from "react";
import Link from "next/link";
import { DEFAULT_HOME_SECTION, HOME_SECTIONS, type HomeSection } from "@apartment-book/shared";
import { cn } from "@/lib/utils";

/** Where a Home tab lives. The default tab keeps the clean "/" address. `all` carries "All universities" from tab to tab. */
export function homeTabHref(section: HomeSection, all = false): string {
  const params = new URLSearchParams();
  if (section !== DEFAULT_HOME_SECTION) params.set("tab", section);
  if (all) params.set("university", "all");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/** TikTok-style top tabs: Reels | Buzz | Posts. Sticks right under the navbar. */
export function HomeTabs({ active, all }: { active: HomeSection; all?: boolean }) {
  // The tapped tab lights up straight away while the server renders that section.
  const [tapped, setTapped] = useState<HomeSection | null>(null);
  const [seen, setSeen] = useState(active);
  if (seen !== active) {
    setSeen(active);
    setTapped(null);
  }
  const shown = tapped ?? active;
  return (
    <nav aria-label="Home sections" className="sticky top-14 z-30 -mx-3 border-b border-gray-200 bg-white/95 backdrop-blur sm:mx-0 sm:w-full sm:max-w-[500px] sm:self-center sm:rounded-xl sm:border-b-0 sm:ring-1 sm:ring-gray-200">
      <ul className="flex items-stretch justify-center gap-8">
        {HOME_SECTIONS.map((section) => {
          const current = section.value === shown;
          return (
            <li key={section.value}>
              <Link
                href={homeTabHref(section.value, all)}
                scroll={false}
                onClick={() => setTapped(section.value)}
                aria-current={current ? "page" : undefined}
                className={cn("relative flex h-11 items-center px-1 text-[15px] transition-colors", current ? "font-bold text-gray-900" : "font-medium text-gray-500 hover:text-gray-800")}
                data-testid={`home-tab-${section.value}`}
              >
                {section.label}
                <span aria-hidden="true" className={cn("absolute inset-x-0 bottom-1 mx-auto h-[3px] w-6 rounded-full", current ? "bg-brand-600" : "bg-transparent")} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

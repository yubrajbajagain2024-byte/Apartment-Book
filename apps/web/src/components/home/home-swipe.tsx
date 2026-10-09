"use client";

import type { ReactNode } from "react";
import { HOME_SECTIONS, homeSectionHref, type HomeSection } from "@apartment-book/shared";
import { SectionSwipe } from "@/components/layout/section-swipe";

/**
 * On a touch screen, swiping the body of a Home section sideways moves to the neighbouring tab (see SectionSwipe).
 * A client wrapper because the Home page is a Server Component and cannot hand SectionSwipe its hrefFor function.
 */
export function HomeSwipe({ section, all, children }: { section: HomeSection; all?: boolean; children: ReactNode }) {
  return (
    <SectionSwipe sections={HOME_SECTIONS} section={section} hrefFor={(s) => homeSectionHref(s, { university: all ? "all" : undefined })}>
      {children}
    </SectionSwipe>
  );
}

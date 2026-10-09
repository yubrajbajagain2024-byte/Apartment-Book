"use client";

import type { ReactNode } from "react";
import { HOUSING_SECTIONS, housingSectionHref, type HousingSection } from "@apartment-book/shared";
import { SectionSwipe } from "@/components/layout/section-swipe";

/**
 * On a touch screen, swiping the body of a Housing page sideways moves to the other half (Apartments <-> Roommates);
 * see SectionSwipe. A client wrapper because the list pages are Server Components and cannot hand SectionSwipe its
 * hrefFor function.
 */
export function HousingSwipe({ section, all, className, children }: { section: HousingSection; all?: boolean; className?: string; children: ReactNode }) {
  return (
    <SectionSwipe sections={HOUSING_SECTIONS} section={section} hrefFor={(s) => housingSectionHref(s, { university: all ? "all" : undefined })} className={className}>
      {children}
    </SectionSwipe>
  );
}

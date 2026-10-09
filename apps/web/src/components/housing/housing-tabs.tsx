"use client";

import { HOUSING_SECTIONS, housingSectionHref, type HousingSection } from "@apartment-book/shared";
import { SectionTabs } from "@/components/layout/section-tabs";

/**
 * Apartments | Roommates: the two halves of the Housing tab, sticky under the navbar like the Home tabs. Each half
 * keeps its own address, so only the "All universities" switch travels to the other one; a chosen campus falls back
 * to the student's own there.
 */
export function HousingTabs({ active, all }: { active: HousingSection; all?: boolean }) {
  // -mt-4: flush under the navbar on phones like Home (the page has 16px of top padding); on sm+ the bar floats as a pill.
  return <SectionTabs sections={HOUSING_SECTIONS} active={active} hrefFor={(s) => housingSectionHref(s, { university: all ? "all" : undefined })} label="Housing sections" testIdPrefix="housing-tab" className="-mt-4 sm:mt-0" />;
}

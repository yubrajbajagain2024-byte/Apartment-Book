"use client";

import { HOME_TABS, homeSectionHref, type HomeSection } from "@apartment-book/shared";
import { SectionTabs } from "@/components/layout/section-tabs";

/** TikTok-style top tabs of Home: For you | Buzz (Posts and Reels keep their addresses but have no tab). `all` carries "All universities" from tab to tab. */
export function HomeTabs({ active, all }: { active: HomeSection; all?: boolean }) {
  return <SectionTabs sections={HOME_TABS} active={active} hrefFor={(s) => homeSectionHref(s, { university: all ? "all" : undefined })} label="Home sections" testIdPrefix="home-tab" />;
}

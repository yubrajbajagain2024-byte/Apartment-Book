"use client";

import { useEffect } from "react";
import { HOME_TABS, homeSectionHref, type HomeSection } from "@apartment-book/shared";
import { SectionTabs } from "@/components/layout/section-tabs";
import { rememberHomeTab } from "@/components/buzz/store";

/**
 * While Buzz is the active tab its label carries UniVerse's small mask glyph (lime on a Phosphor disc, so it reads on
 * the white tab row). Drawn with CSS on the tab's own link, so the shared tab bar stays as it is.
 */
const MASK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23c5f53b' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 11c-1.5 0-2.5.5-3 2'/%3E%3Cpath d='M4 6a2 2 0 0 0-2 2v4a5 5 0 0 0 5 5 8 8 0 0 1 5 2 8 8 0 0 1 5-2 5 5 0 0 0 5-5V8a2 2 0 0 0-2-2h-3a8 8 0 0 0-5 2 8 8 0 0 0-5-2z'/%3E%3Cpath d='M6 11c1.5 0 2.5.5 3 2'/%3E%3C/svg%3E";
// In the gap left of the label (absolute), so the tabs and the sliding underline never move when it appears.
const BUZZ_TAB_GLYPH = `a[data-testid="home-tab-buzz"][aria-current="page"]::before{content:"";position:absolute;right:100%;top:50%;width:18px;height:18px;margin-top:-9px;border-radius:9999px;background:#151b16 url("${MASK}") center/12px no-repeat}`;

/** TikTok-style top tabs of Home: Orbit | Buzz | Reels (Posts keeps its address but has no tab). `all` carries "All universities" from tab to tab. */
export function HomeTabs({ active, all }: { active: HomeSection; all?: boolean }) {
  // Buzz's guidelines gate sends "Not now" back to the last tab that was not Buzz.
  useEffect(() => {
    rememberHomeTab(active);
  }, [active]);
  return (
    <>
      <style>{BUZZ_TAB_GLYPH}</style>
      <SectionTabs sections={HOME_TABS} active={active} hrefFor={(s) => homeSectionHref(s, { university: all ? "all" : undefined })} label="Home sections" testIdPrefix="home-tab" />
    </>
  );
}

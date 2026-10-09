"use client";

import { SectionTabs } from "@/components/layout/section-tabs";

/** The two lists a profile has. */
export type FollowListKind = "followers" | "following";

/** Followers (n) | Following (n) of one profile, with Home's sliding underline. A client component so the links can be built here. */
export function FollowTabs({ profileId, active, followers, following }: { profileId: string; active: FollowListKind; followers: number; following: number }) {
  const sections = [
    { value: "followers", label: `Followers (${followers})` },
    { value: "following", label: `Following (${following})` },
  ] as const;
  return <SectionTabs sections={sections} active={active} hrefFor={(kind) => `/profile/${profileId}/${kind}`} label="Follow lists" testIdPrefix="follow-tab" />;
}

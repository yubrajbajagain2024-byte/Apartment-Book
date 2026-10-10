"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, Clapperboard, GraduationCap, Grid3x3, Heart, Lock, type LucideIcon } from "lucide-react";
import { PROFILE_TABS, profileTabHref, type ProfileTab } from "@/lib/profile";
import { cn } from "@/lib/utils";

const TAB_META: Record<ProfileTab, { label: string; icon: LucideIcon }> = {
  posts: { label: "Posts", icon: Grid3x3 },
  classes: { label: "Classes", icon: GraduationCap },
  reels: { label: "Reels", icon: Clapperboard },
  saved: { label: "Saved", icon: Bookmark },
  liked: { label: "Liked", icon: Heart },
};

/** The element the tabs control; the page renders the chosen tab into it. */
export const PROFILE_PANEL_ID = "profile-panel";

/**
 * TikTok's row of icon tabs under the profile header: Posts, Classes, Reels, Saved, Liked. They are links (?tab=…), so
 * the server renders the chosen tab; the tapped one lights up straight away while it loads. A small lock marks Classes,
 * Saved and Liked when the owner keeps them from everyone, or when the visitor may not open them.
 */
export function ProfileTabs({
  profileId,
  active,
  locks,
}: {
  profileId: string;
  active: ProfileTab;
  /** Tabs that wear the lock, with what it means for the screen reader ("Only me", "Friends", "locked"). */
  locks: Partial<Record<ProfileTab, string>>;
}) {
  const [tapped, setTapped] = useState<ProfileTab | null>(null);
  const [seen, setSeen] = useState(active);
  if (seen !== active) {
    setSeen(active);
    setTapped(null);
  }
  const shown = tapped ?? active;

  return (
    <div role="tablist" aria-label="Profile" className="sticky top-14 z-20 grid grid-cols-5 border-b border-gray-200 bg-white" data-testid="profile-tabs">
      {PROFILE_TABS.map((tab) => {
        const { label, icon: Icon } = TAB_META[tab];
        const selected = tab === shown;
        const lock = locks[tab];
        return (
          <Link
            key={tab}
            id={`profile-tab-${tab}`}
            href={profileTabHref(profileId, tab)}
            scroll={false}
            role="tab"
            aria-selected={selected}
            aria-controls={PROFILE_PANEL_ID}
            aria-label={lock ? `${label} (${lock})` : label}
            onClick={() => setTapped(tab)}
            className={cn(
              "relative flex h-12 items-center justify-center gap-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
              selected ? "text-gray-900" : "text-gray-400 hover:text-gray-700",
            )}
            data-testid={`profile-tab-${tab}`}
          >
            <span className="relative">
              <Icon className="h-[22px] w-[22px]" strokeWidth={selected ? 2.25 : 2} aria-hidden="true" />
              {lock ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white" data-testid="profile-tab-lock">
                  <Lock className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
                </span>
              ) : null}
            </span>
            <span className="hidden sm:inline" aria-hidden="true">
              {label}
            </span>
            {selected ? <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-gray-900 sm:inset-x-5" /> : null}
          </Link>
        );
      })}
    </div>
  );
}

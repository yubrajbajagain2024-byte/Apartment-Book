import { PROFILE_DEFAULT_VISIBILITY, PROFILE_SECTIONS, sectionVisibilityOf, type Profile, type ProfileSection, type ProfileVisibility } from "@apartment-book/shared";

/** The profile tabs, in the order the bar shows them. Posts is the default. */
export const PROFILE_TABS = ["posts", "classes", "reels", "saved", "liked", "listings"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function isProfileTab(value: unknown): value is ProfileTab {
  return typeof value === "string" && (PROFILE_TABS as readonly string[]).includes(value);
}

/** The address of one tab of a profile. */
export function profileTabHref(profileId: string, tab: ProfileTab): string {
  return `/profile/${profileId}?tab=${tab}`;
}

/** What the database gives a new profile, used while a row has no setting yet (read before the migration that added it). */
export const DEFAULT_SECTION_VISIBILITY: Record<ProfileSection, ProfileVisibility> = PROFILE_DEFAULT_VISIBILITY;

type VisibilityColumns = Partial<Pick<Profile, "classes_visibility" | "saved_visibility" | "liked_visibility" | "listings_visibility">>;

/** Who can see Classes, Saved, Liked and Listings, narrowed from the profile row's text columns. */
export function sectionVisibility(profile: VisibilityColumns | null | undefined): Record<ProfileSection, ProfileVisibility> {
  return Object.fromEntries(PROFILE_SECTIONS.map((section) => [section, sectionVisibilityOf(profile, section)])) as Record<ProfileSection, ProfileVisibility>;
}

/** A tab whose owner chooses who sees it. */
export function isSectionTab(tab: ProfileTab): tab is ProfileSection {
  return (PROFILE_SECTIONS as readonly string[]).includes(tab);
}

/** The @handle without the @, or null while the row has none (read before migration 18). */
export function profileHandle(profile: { username?: string | null } | null | undefined): string | null {
  const name = profile?.username;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** "Sunil" from "Sunil Sherpa", for "Only Sunil can see their saved posts". */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

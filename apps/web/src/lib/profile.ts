import { isProfileVisibility, type Profile, type ProfileSection, type ProfileVisibility } from "@apartment-book/shared";

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

/** What the database gives a new profile, used while a row has no setting yet (read before migration 18). */
export const DEFAULT_SECTION_VISIBILITY: Record<ProfileSection, ProfileVisibility> = { classes: "friends", saved: "private", liked: "public" };

type VisibilityColumns = Partial<Pick<Profile, "classes_visibility" | "saved_visibility" | "liked_visibility">>;

/** Who can see Classes, Saved and Liked, narrowed from the profile row's text columns. */
export function sectionVisibility(profile: VisibilityColumns | null | undefined): Record<ProfileSection, ProfileVisibility> {
  const pick = (value: unknown, fallback: ProfileVisibility) => (isProfileVisibility(value) ? value : fallback);
  return {
    classes: pick(profile?.classes_visibility, DEFAULT_SECTION_VISIBILITY.classes),
    saved: pick(profile?.saved_visibility, DEFAULT_SECTION_VISIBILITY.saved),
    liked: pick(profile?.liked_visibility, DEFAULT_SECTION_VISIBILITY.liked),
  };
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

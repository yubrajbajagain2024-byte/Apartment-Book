import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, Clapperboard, Grid3x3, Heart, Lock, Store, type LucideIcon } from "lucide-react";
import {
  getFollowStats,
  getProfile,
  getProfileSectionAccess,
  getProfileStats,
  groupClassesByTerm,
  isBlocked,
  ITEM_STATUSES,
  LISTING_STATUSES,
  listApartmentsByOwner,
  listingMedia,
  listItemsBySeller,
  listProfileClasses,
  listProfileLiked,
  listProfileListings,
  listProfilePostTiles,
  listProfileSaved,
  listRoommatePostsByAuthor,
  lockedSectionMessage,
  NO_FOLLOW_STATS,
  pickableTerms,
  PROFILE_SECTIONS,
  tileFromListing,
  visibilityLabel,
  type Client,
  type ProfileSectionAccess,
  type ProfileStats,
  type ProfileTile,
} from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { getSiteUrl } from "@/lib/env";
import { firstNameOf, isProfileTab, profileHandle, profileTabHref, sectionVisibility, type ProfileTab } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { errorMessage, firstParam } from "@/lib/utils";
import { LinkButton } from "@/components/ui/button";
import { ListingsGrid, type ProfileListing } from "@/components/profile/listings-grid";
import { ProfileClasses } from "@/components/profile/profile-classes";
import { ProfileGrid } from "@/components/profile/profile-grid";
import { ProfileHeader } from "@/components/profile/profile-header";
import { PROFILE_PANEL_ID, ProfileTabs } from "@/components/profile/profile-tabs";
import type { ShareProfileTarget } from "@/components/profile/share-profile-dialog";
import { VisibilityControl } from "@/components/profile/visibility-control";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PROFILE_STATS: ProfileStats = { posts: 0, reels: 0, likesReceived: 0 };
/** Owners may always open their own tabs. */
const OWNER_ACCESS: ProfileSectionAccess = { classes: true, saved: true, liked: true };
/** What the database says when someone's Saved or Liked setting keeps the reader out. */
const PRIVATE_LIST = "This list is private.";
/** Saved and Liked drop what the reader may no longer see, so a page can come back empty with more behind it. */
const MAX_EMPTY_HOPS = 3;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const profile = UUID.test(id) ? await getProfile(await createClient(), id).catch(() => null) : null;
  if (!profile) return { title: "Profile" };
  const handle = profileHandle(profile);
  return { title: handle ? `${profile.full_name} (@${handle})` : profile.full_name, description: profile.bio?.slice(0, 160) || undefined };
}

/** One tab's first page, or why there is none. */
type GridTab = { status: "ready"; tiles: ProfileTile[]; hasMore: boolean; next: string | null } | { status: "locked" } | { status: "error" };

async function loadPostGrid(supabase: Client, userId: string, kind: "post" | "reel"): Promise<GridTab> {
  try {
    const page = await listProfilePostTiles(supabase, userId, kind);
    return { status: "ready", tiles: page.tiles, hasMore: page.hasMore, next: null };
  } catch {
    return { status: "error" };
  }
}

async function loadListGrid(supabase: Client, userId: string, section: "saved" | "liked", allowed: boolean | null): Promise<GridTab> {
  if (allowed === false) return { status: "locked" };
  const list = section === "saved" ? listProfileSaved : listProfileLiked;
  try {
    let page = await list(supabase, userId);
    // An empty page with a cursor is not the end: look a few pages on, as the app does. The cursor goes back unchanged.
    for (let hop = 0; hop < MAX_EMPTY_HOPS && page.tiles.length === 0 && page.next !== null; hop++) page = await list(supabase, userId, { before: page.next });
    return { status: "ready", tiles: page.tiles, hasMore: page.next !== null, next: page.next };
  } catch (error) {
    return errorMessage(error).includes(PRIVATE_LIST) ? { status: "locked" } : { status: "error" };
  }
}

function statusLabel(statuses: readonly { value: string; label: string }[], value: string): string {
  return statuses.find((s) => s.value === value)?.label ?? value;
}

/**
 * The Listings tab. Visitors see what is live; the owner also sees what is rented, sold or found (marked so), because
 * this is where they find those again to reopen them.
 */
async function loadListings(supabase: Client, userId: string, isMe: boolean): Promise<ProfileListing[]> {
  if (!isMe) return (await listProfileListings(supabase, userId)).map((tile) => ({ tile, status: null }));
  const [apartments, roommates, items] = await Promise.all([
    listApartmentsByOwner(supabase, userId, { includeInactive: true }),
    listRoommatePostsByAuthor(supabase, userId, { includeInactive: true }),
    listItemsBySeller(supabase, userId, { includeInactive: true }),
  ]);
  const dated: { at: string; card: ProfileListing }[] = [
    ...apartments.map((a) => ({
      at: a.created_at,
      card: { tile: tileFromListing("apartment", a, listingMedia(a.images, a.image_meta, a.videos)), status: a.status === "active" ? null : statusLabel(LISTING_STATUSES, a.status) },
    })),
    ...roommates.map((r) => ({
      at: r.created_at,
      card: { tile: tileFromListing("roommate", r, listingMedia(r.images, r.image_meta, r.videos)), status: r.is_active ? null : "Found" },
    })),
    ...items.map((i) => ({
      at: i.created_at,
      card: { tile: tileFromListing("item", i, listingMedia(i.images, i.image_meta)), status: i.status === "available" ? null : statusLabel(ITEM_STATUSES, i.status) },
    })),
  ];
  // Live ones first, newest first within each group.
  return dated.sort((a, b) => Number(a.card.status !== null) - Number(b.card.status !== null) || b.at.localeCompare(a.at)).map((d) => d.card);
}

/**
 * /profile/[id], TikTok style: photo, name, @handle and QR, Following · Followers · Likes, the main buttons, bio and
 * campus, then Posts | Classes | Reels | Saved | Liked | Listings as tabs (?tab=…). Only the chosen tab's first page is
 * read here. Anything that fails to load falls back (zeros, a line in the tab), so the header always renders.
 */
export default async function ProfilePage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const requested = firstParam(query.tab);
  const tab: ProfileTab = isProfileTab(requested) ? requested : "posts";
  const supabase = await createClient();
  const [profile, user] = await Promise.all([getProfile(supabase, id), getCurrentUser()]);
  if (!profile) notFound();

  const isMe = user?.id === profile.id;
  const firstName = firstNameOf(profile.full_name);
  const handle = profileHandle(profile);
  const visibility = sectionVisibility(profile);
  const postKind = tab === "posts" ? "post" : tab === "reels" ? "reel" : null;

  const [blocked, follow, stats, access, classes, listings, postTab] = await Promise.all([
    user && !isMe ? isBlocked(supabase, user.id, profile.id).catch(() => false) : Promise.resolve(false),
    getFollowStats(supabase, profile.id).catch(() => NO_FOLLOW_STATS),
    getProfileStats(supabase, profile.id).catch(() => NO_PROFILE_STATS),
    // Unknown (null) when the check fails: no lock badges then, and the tab finds out for itself.
    isMe ? Promise.resolve<ProfileSectionAccess | null>(OWNER_ACCESS) : getProfileSectionAccess(supabase, profile.id).catch(() => null),
    // Classes and listings are read on their own tabs only; null means the read failed. Row-level security returns no
    // classes when the reader may not see them.
    tab === "classes" ? listProfileClasses(supabase, profile.id).catch(() => null) : Promise.resolve(null),
    tab === "listings" ? loadListings(supabase, profile.id, isMe).catch(() => null) : Promise.resolve(null),
    postKind ? loadPostGrid(supabase, profile.id, postKind) : Promise.resolve(null),
  ]);
  const listTab = tab === "saved" || tab === "liked" ? await loadListGrid(supabase, profile.id, tab, access ? access[tab] : null) : null;

  const now = new Date();
  const groups = classes ? groupClassesByTerm(classes, now) : [];
  const locks: Partial<Record<ProfileTab, string>> = {};
  for (const section of PROFILE_SECTIONS) {
    if (isMe) {
      if (visibility[section] !== "public") locks[section] = visibilityLabel(visibility[section]);
    } else if (access && !access[section]) {
      locks[section] = "locked";
    }
  }
  const share: ShareProfileTarget = { url: `${getSiteUrl()}/profile/${profile.id}`, name: profile.full_name, username: handle, avatarUrl: profile.avatar_url, isMe };

  let panel: ReactNode;
  if (tab === "posts" || tab === "reels") {
    const noun = tab === "posts" ? "posts" : "reels";
    if (!postTab || postTab.status !== "ready") {
      panel = <TabError what={noun} href={profileTabHref(profile.id, tab)} />;
    } else if (postTab.tiles.length === 0) {
      panel =
        tab === "posts" ? (
          isMe ? (
            <TabEmpty icon={Grid3x3} title="Share your first post" action={<LinkButton href="/posts/new">Create post</LinkButton>} />
          ) : (
            <TabEmpty icon={Grid3x3} title="No posts yet" />
          )
        ) : (
          <TabEmpty icon={Clapperboard} title="No reels yet" action={isMe ? <LinkButton href="/reels/new" variant="secondary">Create reel</LinkButton> : undefined} />
        );
    } else {
      panel = <ProfileGrid key={`${profile.id}:${tab}`} userId={profile.id} kind={tab === "posts" ? "post" : "reel"} initialTiles={postTab.tiles} initialHasMore={postTab.hasMore} />;
    }
  } else if (tab === "classes") {
    panel = (
      <>
        {isMe ? <VisibilityControl key="classes" section="classes" value={visibility.classes} /> : null}
        {!isMe && access?.classes === false ? (
          <LockedTab message={lockedSectionMessage("classes", visibility.classes, firstName)} />
        ) : classes === null ? (
          <TabError what="classes" href={profileTabHref(profile.id, tab)} />
        ) : (
          <ProfileClasses isOwner={isMe} groups={groups} terms={pickableTerms(now)} />
        )}
      </>
    );
  } else if (tab === "listings") {
    panel =
      listings === null ? (
        <TabError what="listings" href={profileTabHref(profile.id, tab)} />
      ) : listings.length === 0 ? (
        <TabEmpty icon={Store} title="No listings yet" />
      ) : (
        <ListingsGrid listings={listings} />
      );
  } else {
    const list = listTab ?? { status: "error" as const };
    panel = (
      <>
        {/* Keyed by tab, so the shown choice, an error or an open menu stays with its own tab. */}
        {isMe ? <VisibilityControl key={tab} section={tab} value={visibility[tab]} /> : null}
        {list.status === "locked" ? (
          <LockedTab message={lockedSectionMessage(tab, visibility[tab], firstName)} />
        ) : list.status === "error" ? (
          <TabError what={tab === "saved" ? "saved posts" : "liked posts"} href={profileTabHref(profile.id, tab)} />
        ) : list.tiles.length === 0 && list.next === null ? (
          tab === "saved" ? (
            <TabEmpty icon={Bookmark} title="Nothing saved yet" />
          ) : (
            <TabEmpty icon={Heart} title="No liked posts yet" />
          )
        ) : (
          <ProfileGrid key={`${profile.id}:${tab}`} userId={profile.id} kind={tab} initialTiles={list.tiles} initialHasMore={list.hasMore} initialNext={list.next} emptyText={tab === "saved" ? "Nothing saved yet" : "No liked posts yet"} />
        )}
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Edge to edge on phones like the app; a white card in the middle of wider screens (its bottom padding keeps the
          grid's square corners inside the rounded ones, so nothing needs overflow-hidden and menus are never clipped). */}
      <div className="-mx-3 -mt-4 bg-white pb-1 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:pb-4 sm:shadow-sm sm:ring-1 sm:ring-gray-200" data-testid="profile">
        <ProfileHeader
          profile={profile}
          handle={handle}
          isMe={isMe}
          viewerId={user?.id ?? null}
          blocked={blocked}
          follow={follow}
          likes={stats.likesReceived}
          share={share}
        />

        <ProfileTabs profileId={profile.id} active={tab} locks={locks} />
        <div role="tabpanel" id={PROFILE_PANEL_ID} aria-labelledby={`profile-tab-${tab}`} className="min-h-[16rem]">
          {panel}
        </div>
      </div>
    </div>
  );
}

function TabEmpty({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" data-testid="profile-empty">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-700">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-base font-semibold text-gray-900">{title}</p>
      {action}
    </div>
  );
}

/** A tab the visitor may not open: "Only Sunil can see their saved posts". */
function LockedTab({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" data-testid="profile-locked">
      <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-gray-900 text-gray-900">
        <Lock className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="max-w-xs text-sm font-semibold text-gray-900">{message}</p>
    </div>
  );
}

function TabError({ what, href }: { what: string; href: string }) {
  return (
    <p role="alert" className="px-6 py-14 text-center text-sm text-gray-600" data-testid="profile-tab-error">
      Could not load {what} right now.{" "}
      <Link href={href} scroll={false} className="font-semibold text-brand-700 hover:underline">
        Try again
      </Link>
    </p>
  );
}

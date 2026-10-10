import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, Linking, RefreshControl, Text, View, useWindowDimensions, type ListRenderItem } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  blockUser,
  getFollowStats,
  getOrCreateDirectConversation,
  getProfile,
  getProfileSectionAccess,
  getProfileStats,
  isBlocked,
  isProfileVisibility,
  listProfileClasses,
  listProfileLiked,
  listProfileListings,
  listProfilePostTiles,
  listProfileSaved,
  lockedSectionMessage,
  NO_FOLLOW_STATS,
  ownSectionNote,
  PROFILE_SECTION_NOUNS,
  PROFILE_VISIBILITY_COLUMNS,
  reportContent,
  REPORT_REASONS,
  setPostPinned,
  setProfileVisibility,
  unblockUser,
  type FollowStats,
  type ProfileClass,
  type ProfileSection,
  type ProfileSectionAccess,
  type ProfileStats,
  type ProfileTile,
  type ProfileVisibility,
  type ProfileWithUniversity,
  type ReportReason,
} from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { FollowButton } from "@/components/follow-button";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { hapticTap } from "@/lib/haptics";
import { errorText, useQuery } from "@/lib/hooks";
import { emitPostPinned, onPostPinned, onPostRemoved } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useChangeAvatar } from "@/lib/use-change-avatar";
import { ClassesSection } from "./classes-section";
import { HeaderButton, HeaderIconButton, PROFILE_BUTTON_HEIGHT, ProfileHeader, ProfileTopBar, profileHandle } from "./profile-header";
import { ProfileTabs, type ProfileTabKey } from "./profile-tabs";
import { ListingGridTile, ProfileGridTile, useOpenTile } from "./profile-tile";
import { ShareProfileSheet } from "./share-profile-sheet";
import { useTileGrid, type GridCursor, type GridPage, type TileGrid } from "./use-tile-grid";
import { LockedNotice, VisibilityRow } from "./visibility-row";

/** Space between the squares of the grid, across and down. */
const GAP = 1.5;
const NO_TILES: ProfileTile[] = [];
const OWNER_ACCESS: ProfileSectionAccess = { classes: true, saved: true, liked: true };
const NO_PROFILE_STATS: ProfileStats = { posts: 0, reels: 0, likesReceived: 0 };
/** The database's defaults, for a profile read before the settings existed. */
const DEFAULT_VISIBILITY: Record<ProfileSection, ProfileVisibility> = { classes: "friends", saved: "private", liked: "public" };
/** What each tab holds, for "Could not load …". */
const TAB_NOUNS: Record<ProfileTabKey, string> = { posts: "posts", classes: "classes", reels: "reels", saved: PROFILE_SECTION_NOUNS.saved, liked: PROFILE_SECTION_NOUNS.liked, listings: "listings" };

/** The tabs that show squares: all but Classes. Listings is a single page; the others load more as you scroll. */
type GridTab = Exclude<ProfileTabKey, "classes">;

/** The tabs with a who-can-see setting. Posts, Reels and Listings are for everyone. */
const isSection = (tab: ProfileTabKey): tab is ProfileSection => tab === "classes" || tab === "saved" || tab === "liked";

function visibilityOf(profile: ProfileWithUniversity, section: ProfileSection): ProfileVisibility {
  const value: unknown = profile[PROFILE_VISIBILITY_COLUMNS[section]];
  return isProfileVisibility(value) ? value : DEFAULT_VISIBILITY[section];
}

async function postTiles(userId: string, kind: "post" | "reel", cursor: GridCursor | null): Promise<GridPage> {
  const page = typeof cursor === "number" ? cursor : 1;
  const result = await listProfilePostTiles(supabase, userId, kind, page);
  return { tiles: result.tiles, next: result.hasMore ? page + 1 : null };
}

/** Someone's live apartments, roommate posts and items for sale, newest first, all at once: a single page. */
async function listingTiles(userId: string): Promise<GridPage> {
  return { tiles: await listProfileListings(supabase, userId), next: null };
}

const before = (cursor: GridCursor | null) => (typeof cursor === "string" ? cursor : null);

/** "This list is private." says something; anything else (a dropped connection, a missing table) becomes one plain line. */
function loadErrorText(message: string, tab: ProfileTabKey): string {
  return /private/i.test(message) ? message : `Could not load ${TAB_NOUNS[tab]}.`;
}

/**
 * A pinned square moves to the front (the latest pin first, as the server orders them); an unpinned one goes back behind
 * the pinned ones until the next reload puts it in its place. `reorder` is false for Saved and Liked, which keep their order.
 */
function repin(tiles: ProfileTile[], id: string, pinned: boolean, reorder: boolean): ProfileTile[] {
  const at = tiles.findIndex((t) => t.id === id && (t.type === "post" || t.type === "reel"));
  if (at < 0 || tiles[at].pinned === pinned) return tiles;
  const tile = { ...tiles[at], pinned };
  if (!reorder) return tiles.map((t, i) => (i === at ? tile : t));
  const rest = tiles.filter((_, i) => i !== at);
  if (pinned) return [tile, ...rest];
  const loose = rest.findIndex((t) => !t.pinned);
  const to = loose < 0 ? rest.length : loose;
  return [...rest.slice(0, to), tile, ...rest.slice(to)];
}

function dropPost(id: string) {
  return (tiles: ProfileTile[]) => (tiles.some((t) => t.id === id) ? tiles.filter((t) => !(t.id === id && (t.type === "post" || t.type === "reel"))) : tiles);
}

function RowGap() {
  return <View style={{ height: GAP }} />;
}

/**
 * A whole profile, yours or someone else's, as one list (TikTok's profile): the header (photo, name, @username, Following |
 * Followers | Likes, the buttons, bio and university), the tabs Posts | Classes | Reels | Saved | Liked | Listings, then the
 * open tab: its squares three to a row, loading more as you scroll, or for Classes the classes by semester (where the owner
 * adds them). Listings (apartments, roommate posts and items for sale) come all at once. Classes, Saved and Liked follow the
 * owner's settings: the owner sees who can see each (and changes it there), a visitor without access sees a lock; Posts,
 * Reels and Listings are public.
 *
 * `topBar` is the Profile tab, which draws its own bar (Find friends, your name with the account sheet, the menu); on a
 * stacked screen the navigation header shows the name instead. Everything that needs migration 18 (likes received, classes,
 * Saved and Liked, the grids) fails on its own: the header still shows, with zeros, and the tab says what could not load.
 */
export function ProfileView({ userId, topBar = false }: { userId: string; topBar?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { user, profile: myProfile, refreshProfile, signOut } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const show = useActionSheet();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [listWidth, setListWidth] = useState(windowWidth);
  const openTile = useOpenTile();
  const avatar = useChangeAvatar({ save: true });
  const viewerId = user?.id ?? null;
  const own = viewerId === userId;
  const needLogin = useCallback(() => router.push("/(auth)/login"), [router]);

  // Your own profile follows the session's copy, which Settings and the photo button refresh.
  const profileQ = useQuery(() => getProfile(supabase, userId), [userId]);
  const profile = (own ? myProfile : null) ?? profileQ.data;
  // "Followed by me" is the viewer's: signing in or out loads it again. The first answer gates the screen, so the button never flips from Follow to Following.
  const followQ = useQuery(() => getFollowStats(supabase, userId), [userId, viewerId]);
  const statsQ = useQuery(() => getProfileStats(supabase, userId).catch(() => NO_PROFILE_STATS), [userId, viewerId]);
  const accessQ = useQuery(() => (own ? Promise.resolve(OWNER_ACCESS) : getProfileSectionAccess(supabase, userId)), [userId, viewerId, own]);
  // The database hides classes the reader may not see (the list just comes back empty), so they load again whenever that
  // access changes: following each other, a block.
  const classesOpen = own || accessQ.data?.classes === true;
  const classesQ = useQuery(() => listProfileClasses(supabase, userId), [userId, viewerId, classesOpen]);
  const blockedQ = useQuery(() => (viewerId && !own ? isBlocked(supabase, viewerId, userId) : Promise.resolve(false)), [viewerId, userId, own]);

  const access = own ? OWNER_ACCESS : accessQ.data;
  const canSee = (section: ProfileSection) => own || access?.[section] === true;

  // Tabs load the first time they are opened and keep their squares after that.
  const [tab, setTab] = useState<ProfileTabKey>("posts");
  const [visited, setVisited] = useState<ReadonlySet<ProfileTabKey>>(() => new Set<ProfileTabKey>(["posts"]));
  function selectTab(next: ProfileTabKey) {
    if (next === tab) return;
    hapticTap();
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  }

  const resetKey = `${userId}:${viewerId ?? "guest"}`;
  const posts = useTileGrid((c) => postTiles(userId, "post", c), { resetKey, enabled: visited.has("posts") });
  const reels = useTileGrid((c) => postTiles(userId, "reel", c), { resetKey, enabled: visited.has("reels") });
  const saved = useTileGrid((c) => listProfileSaved(supabase, userId, { before: before(c) }), { resetKey, enabled: visited.has("saved") && canSee("saved") });
  const liked = useTileGrid((c) => listProfileLiked(supabase, userId, { before: before(c) }), { resetKey, enabled: visited.has("liked") && canSee("liked") });
  // Listings are public, so they need no access check, and come as a single page.
  const listings = useTileGrid(() => listingTiles(userId), { resetKey, enabled: visited.has("listings") });
  const grids: Record<GridTab, TileGrid> = { posts, reels, saved, liked, listings };
  const grid = tab === "classes" ? null : grids[tab];

  // A pin or a delete anywhere in the app (the post screen, Home) moves or drops the square here too.
  const { update: updatePosts } = posts;
  const { update: updateReels } = reels;
  const { update: updateSaved } = saved;
  const { update: updateLiked } = liked;
  // Posts and Reels come in pages by position, so a square that moved or went would make the next page skip a post: after
  // the instant change, the grid that had it loads again from the first page (on your own profile a pin reloads both when
  // neither had it yet). Saved and Liked page by a cursor, which a pin or a delete does not move.
  const reloadPaged = useRef<(id: string, pin: boolean) => void>(() => {});
  useEffect(() => {
    reloadPaged.current = (id, pin) => {
      const held = [posts, reels].filter((g) => g.tiles.some((t) => t.id === id));
      for (const g of held.length > 0 ? held : pin && own ? [posts, reels] : []) void g.refresh();
    };
  });
  useEffect(() => {
    const offPin = onPostPinned((id, pinned) => {
      updatePosts((t) => repin(t, id, pinned, true));
      updateReels((t) => repin(t, id, pinned, true));
      updateSaved((t) => repin(t, id, pinned, false));
      updateLiked((t) => repin(t, id, pinned, false));
      reloadPaged.current(id, true);
    });
    const offRemoved = onPostRemoved((id) => {
      for (const update of [updatePosts, updateReels, updateSaved, updateLiked]) update(dropPost(id));
      reloadPaged.current(id, false);
    });
    return () => {
      offPin();
      offRemoved();
    };
  }, [updatePosts, updateReels, updateSaved, updateLiked]);

  // Owner only: who can see Classes, Saved and Liked. The choice shows at once and goes back if the server says no.
  const [pendingVisibility, setPendingVisibility] = useState<Partial<Record<ProfileSection, ProfileVisibility>>>({});
  const [savingVisibility, setSavingVisibility] = useState<ProfileSection | null>(null);
  const visibility = (section: ProfileSection): ProfileVisibility => pendingVisibility[section] ?? (profile ? visibilityOf(profile, section) : DEFAULT_VISIBILITY[section]);
  const forget = (section: ProfileSection) =>
    setPendingVisibility((p) => {
      const next = { ...p };
      delete next[section];
      return next;
    });
  async function changeVisibility(section: ProfileSection, value: ProfileVisibility) {
    if (!own) return;
    setPendingVisibility((p) => ({ ...p, [section]: value }));
    setSavingVisibility(section);
    try {
      await setProfileVisibility(supabase, userId, section, value);
      hapticTap();
      await Promise.all([refreshProfile(), profileQ.refresh()]);
    } catch (e) {
      Alert.alert("Could not change who can see this", errorText(e));
    } finally {
      forget(section);
      setSavingVisibility(null);
    }
  }

  const updateClasses = useCallback((fn: (classes: ProfileClass[]) => ProfileClass[]) => classesQ.setData((prev) => fn(prev ?? [])), [classesQ.setData]);

  /** Your own posts and reels: hold a square for Pin to profile / Unpin from profile. */
  const pinMenu = useCallback(
    (tile: ProfileTile) => {
      const pin = !tile.pinned;
      hapticTap();
      show([
        {
          label: pin ? "Pin to profile" : "Unpin from profile",
          icon: pin ? "pin-outline" : "pin",
          onPress: () =>
            void setPostPinned(supabase, tile.id, pin)
              .then(() => emitPostPinned(tile.id, pin))
              .catch((e) => Alert.alert(pin ? "Could not pin" : "Could not unpin", errorText(e))),
        },
      ]);
    },
    [show],
  );

  const [sharing, setSharing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const list = useRef<FlatList<ProfileTile>>(null);
  /** Where the tabs end, so opening the add-class form can scroll the tab's top (and the form) near the top of the screen. */
  const headerHeight = useRef(0);
  async function refreshAll() {
    setRefreshing(true);
    try {
      await Promise.all([
        own ? refreshProfile() : Promise.resolve(),
        profileQ.refresh(),
        followQ.refresh(),
        statsQ.refresh(),
        accessQ.refresh(),
        classesQ.refresh(),
        blockedQ.refresh(),
        ...Object.values(grids).map((g) => g.refresh()),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  // Back on this screen (a post published, someone followed, a listing added): the numbers, a one-page grid and the Listings
  // (once that tab has been opened, even while another tab shows) reload quietly.
  const onFocusAgain = useRef<() => void>(() => {});
  useEffect(() => {
    onFocusAgain.current = () => {
      void followQ.refresh();
      void statsQ.refresh();
      if (!own) void accessQ.refresh();
      grid?.quietRefresh();
      if (grid !== listings) listings.quietRefresh();
    };
  });
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) onFocusAgain.current();
      focusedBefore.current = true;
    }, []),
  );

  // A stacked profile shows the person's name in the navigation header, like TikTok.
  const name = profile?.full_name ?? "";
  useEffect(() => {
    if (!topBar && name) navigation.setOptions({ title: name });
  }, [topBar, name, navigation]);

  const firstName = name.trim().split(/\s+/)[0] ?? "";
  const blocked = Boolean(blockedQ.data);

  function accountSheet() {
    show([{ label: "Log out", icon: "log-out-outline", destructive: true, onPress: () => void signOut() }], user?.email ?? undefined);
  }
  function menu() {
    show([
      { label: "Settings and privacy", icon: "settings-outline", onPress: () => router.push("/settings") },
      { label: "Saved", icon: "bookmark-outline", onPress: () => router.push("/saved") },
      { label: "Privacy policy", icon: "shield-checkmark-outline", onPress: () => void Linking.openURL(`${SITE_URL}/privacy`) },
      { label: "Terms of use", icon: "document-text-outline", onPress: () => void Linking.openURL(`${SITE_URL}/terms`) },
      { label: "Log out", icon: "log-out-outline", destructive: true, onPress: () => void signOut() },
    ]);
  }
  async function changePhoto() {
    if (await avatar.change()) void profileQ.refresh();
  }

  async function message() {
    if (!user) return needLogin();
    try {
      const conv = await getOrCreateDirectConversation(supabase, userId);
      router.push({ pathname: "/messages/[id]", params: { id: conv } });
    } catch (e) {
      Alert.alert("Message", errorText(e, "Could not open the chat. Try again."));
    }
  }
  /** The Follow button moves the counts above with it. Following each other makes you friends, who may open more (Classes by default). */
  function followChanged(stats: FollowStats) {
    followQ.setData(stats);
    // Heard for the guess and again once the server has answered: the last read wins, so access ends up as the server has it.
    void accessQ.refresh();
  }
  function afterBlockChange() {
    void blockedQ.refresh();
    void followQ.refresh();
    void statsQ.refresh();
    // A block closes Classes, Saved and Liked both ways and unblocking can open them again; Classes reload with the access.
    void accessQ.refresh();
  }
  function more() {
    if (!user) return needLogin();
    const me = user.id;
    show([
      {
        label: blocked ? "Unblock" : "Block",
        icon: "ban-outline",
        destructive: !blocked,
        onPress: () => {
          if (blocked) return void unblockUser(supabase, me, userId).then(afterBlockChange, (e) => Alert.alert("Could not unblock", errorText(e)));
          // Blocking removes follows both ways on the server, so the counts and the Follow button reload with the block state.
          Alert.alert(`Block ${name}?`, "They won't be able to message you, and you won't see each other's posts.", [
            { text: "Cancel", style: "cancel" },
            { text: "Block", style: "destructive", onPress: () => void blockUser(supabase, me, userId).then(afterBlockChange, (e) => Alert.alert("Could not block", errorText(e))) },
          ]);
        },
      },
      {
        label: "Report",
        icon: "flag-outline",
        destructive: true,
        onPress: () =>
          show(
            REPORT_REASONS.map((r) => ({
              label: r.label,
              onPress: () => {
                reportContent(supabase, me, { targetType: "profile", targetId: userId, reason: r.value as ReportReason }).catch(() => {});
                Alert.alert("Thanks", "Our team will review this profile.");
              },
            })),
            "Why are you reporting this person?",
          ),
      },
    ]);
  }

  const bar = topBar ? <ProfileTopBar name={name} topInset={insets.top} onFindFriends={() => router.push("/search")} onAccount={accountSheet} onMenu={menu} /> : null;

  if (!profile || (followQ.loading && !followQ.data && !followQ.error)) {
    let body: ReactNode = <Loading />;
    if (!profile && !profileQ.loading) {
      body = profileQ.error ? (
        <View style={{ padding: space.lg }}>
          <ErrorBanner message="Could not load this profile." onRetry={() => void profileQ.refresh()} />
        </View>
      ) : (
        <EmptyState icon="person-outline" title="Profile not found" />
      );
    }
    return (
      <View style={styles.screen}>
        {bar}
        {body}
      </View>
    );
  }

  const handle = profileHandle(profile);
  const classes = classesQ.data;
  const tileWidth = (listWidth - GAP * 2) / 3;
  const pinnable = own && (tab === "posts" || tab === "reels");

  // The lock on a tab: your own when not everyone can see it, someone else's when you may not open it.
  const locks: Partial<Record<ProfileTabKey, string>> = {};
  for (const section of ["classes", "saved", "liked"] as const) {
    const value = visibility(section);
    if (own && value !== "public") locks[section] = ownSectionNote(section, value);
    if (!own && access && !access[section]) locks[section] = lockedSectionMessage(section, value, firstName);
  }

  const actions = own ? (
    <>
      <HeaderButton title="Edit profile" onPress={() => router.push("/settings")} />
      <HeaderButton title="Share profile" onPress={() => setSharing(true)} />
      <HeaderIconButton icon="person-add-outline" label="Find friends" onPress={() => router.push("/search")} />
    </>
  ) : (
    <>
      {/* A block forbids following on the server, so the button goes while "Blocked" shows. onChange keeps the counts above in step with the button. */}
      {!blocked ? <FollowButton targetId={userId} stats={followQ.data ?? undefined} userId={viewerId} onNeedLogin={needLogin} onChange={followChanged} style={styles.follow} /> : null}
      <HeaderButton title={blocked ? "Blocked" : "Message"} onPress={() => void message()} disabled={blocked} />
      <HeaderIconButton icon="ellipsis-horizontal" label="More" onPress={more} />
    </>
  );

  const header = (
    <View onLayout={(e) => (headerHeight.current = e.nativeEvent.layout.height)}>
      <ProfileHeader
        profile={profile}
        own={own}
        follow={followQ.data ?? NO_FOLLOW_STATS}
        likes={statsQ.data?.likesReceived ?? 0}
        onOpenFollows={(kind) => router.push({ pathname: "/follows/[id]", params: { id: userId, kind, name } })}
        onShowQr={() => setSharing(true)}
        onChangePhoto={own ? () => void changePhoto() : undefined}
        changingPhoto={avatar.busy}
        actions={actions}
      />
      <ProfileTabs active={tab} onSelect={selectTab} locks={locks} />
      {own && isSection(tab) ? <VisibilityRow section={tab} value={visibility(tab)} busy={savingVisibility === tab} onChange={(v) => void changeVisibility(tab, v)} /> : null}
    </View>
  );

  // Listings show their kind and title on the square (as on the website); the other tabs keep TikTok's plain squares.
  const renderTile: ListRenderItem<ProfileTile> = ({ item }) =>
    tab === "listings" ? <ListingGridTile tile={item} width={tileWidth} onOpen={openTile} /> : <ProfileGridTile tile={item} width={tileWidth} onOpen={openTile} onLongPress={pinnable ? pinMenu : undefined} />;

  return (
    <View style={styles.screen}>
      {bar}
      <FlatList
        ref={list}
        data={grid ? grid.tiles : NO_TILES}
        numColumns={3}
        keyExtractor={(t) => t.key}
        renderItem={renderTile}
        columnWrapperStyle={styles.gridRow}
        ItemSeparatorComponent={RowGap}
        ListHeaderComponent={header}
        ListFooterComponent={footer()}
        onEndReached={() => void grid?.loadMore()}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} />}
        onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: (topBar ? 0 : insets.bottom) + space.xl }}
        style={styles.list}
      />
      <ShareProfileSheet visible={sharing} onClose={() => setSharing(false)} profileId={userId} name={name} username={handle} avatarUrl={profile.avatar_url} own={own} />
    </View>
  );

  /**
   * Under the tabs and the grid: the Classes list, a lock, a spinner, an empty tab, an error, or "loading more". Called as a
   * function, not mounted as a component of its own, so the add-class form keeps its text and focus across renders.
   */
  function footer(): ReactElement | null {
    const spinner = <ActivityIndicator style={styles.spinner} color={colors.brand} />;
    const retryAccess = () => {
      void accessQ.refresh();
      void classesQ.refresh();
    };
    if (isSection(tab) && !own) {
      if (!access) return accessQ.error ? <ErrorLine message={loadErrorText(accessQ.error, tab)} onRetry={retryAccess} /> : spinner;
      if (!access[tab]) return <LockedNotice message={lockedSectionMessage(tab, visibility(tab), firstName)} />;
    }
    if (tab === "classes") {
      if (!classes) return classesQ.error ? <ErrorLine message={loadErrorText(classesQ.error, "classes")} onRetry={() => void classesQ.refresh()} /> : spinner;
      return <ClassesSection own={own} userId={userId} classes={classes} onChange={updateClasses} onOpenForm={() => list.current?.scrollToOffset({ offset: Math.max(0, headerHeight.current - 120), animated: true })} />;
    }
    if (!grid) return null;
    if (grid.status !== "ready") return spinner;
    if (grid.tiles.length === 0) return grid.error ? <ErrorLine message={loadErrorText(grid.error, tab)} onRetry={() => void grid.refresh()} /> : <TabEmpty tab={tab} own={own} />;
    if (grid.error) return <ErrorLine message={loadErrorText(grid.error, tab)} onRetry={() => void grid.refresh()} />;
    if (grid.loadingMore) return spinner;
    if (grid.moreError) return <ErrorLine message={`Could not load more ${TAB_NOUNS[tab]}.`} onRetry={() => void grid.loadMore()} />;
    return null;
  }
}

function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.errorLine}>
      <ErrorBanner message={message} onRetry={onRetry} />
    </View>
  );
}

/** An empty tab: your own Posts and Reels offer to make the first one. */
function TabEmpty({ tab, own }: { tab: GridTab; own: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const copy: Record<GridTab, { icon: keyof typeof Ionicons.glyphMap; title: string; action?: { title: string; href: "/create/post" | "/create/reel" } }> = {
    posts: own ? { icon: "grid-outline", title: "Share your first post", action: { title: "Create post", href: "/create/post" } } : { icon: "grid-outline", title: "No posts yet" },
    reels: own ? { icon: "film-outline", title: "No reels yet", action: { title: "Create reel", href: "/create/reel" } } : { icon: "film-outline", title: "No reels yet" },
    saved: { icon: "bookmark-outline", title: "Nothing saved yet" },
    liked: { icon: "heart-outline", title: "No liked posts yet" },
    listings: { icon: "storefront-outline", title: "No listings yet" },
  };
  const { icon, title, action } = copy[tab];
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.text} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {action ? <Button title={action.title} icon="add" onPress={() => router.push(action.href)} style={styles.emptyAction} /> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The profile is a screen: white in light, pure black in dark, and so are its bars (the Profile tab's top bar, a stacked
  // profile's navigation header), which use colors.bar.
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1, backgroundColor: colors.bg },
  gridRow: { gap: GAP },
  follow: { flex: 1, minHeight: PROFILE_BUTTON_HEIGHT, height: PROFILE_BUTTON_HEIGHT, borderRadius: radius.sm },
  spinner: { paddingVertical: space.xl },
  errorLine: { padding: space.lg },
  empty: { alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingVertical: 40 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: colors.text, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" },
  emptyAction: { minWidth: 160 },
}));

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Linking,
  Platform,
  RefreshControl,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from "react-native";
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
import { useFollow } from "@/components/follow-button";
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
import { PROFILE_TABS, ProfileTabs, type ProfileTabKey } from "./profile-tabs";
import { ListingGridTile, ProfileGridTile, useOpenTile } from "./profile-tile";
import { ShareProfileSheet } from "./share-profile-sheet";
import { useTileGrid, type GridCursor, type GridPage, type TileGrid } from "./use-tile-grid";
import { LockedNotice, VisibilityRow } from "./visibility-row";

/** Space between the squares of the grid, across and down. */
const GAP = 1.5;
/** Between the header and the tabs row: part of the header, so it goes up with it. */
const TABS_GAP = 14;
const NO_TILES: ProfileTile[] = [];
const OWNER_ACCESS: ProfileSectionAccess = { classes: true, saved: true, liked: true };
const NO_PROFILE_STATS: ProfileStats = { posts: 0, reels: 0, likesReceived: 0 };
/** The database's defaults, for a profile read before the settings existed. */
const DEFAULT_VISIBILITY: Record<ProfileSection, ProfileVisibility> = { classes: "friends", saved: "private", liked: "public" };
/** What each tab holds, for "Could not load …". */
const TAB_NOUNS: Record<ProfileTabKey, string> = { posts: "posts", classes: "classes", reels: "reels", saved: PROFILE_SECTION_NOUNS.saved, liked: PROFILE_SECTION_NOUNS.liked, listings: "listings" };

/** The tabs that show squares: all but Classes. Listings is a single page; the others load more as you scroll. */
type GridTab = Exclude<ProfileTabKey, "classes">;

/** Page i of the pager is PROFILE_TABS[i]; the profile opens on Posts. */
const PAGE_COUNT = PROFILE_TABS.length;
const TAB_INDEX = Object.fromEntries(PROFILE_TABS.map((t, i) => [t.key, i])) as Record<ProfileTabKey, number>;
const START_PAGE = TAB_INDEX.posts;

/** The page a horizontal offset shows (the nearest one). */
function pageAt(x: number, pageWidth: number): number {
  return Math.min(PAGE_COUNT - 1, Math.max(0, Math.round(x / Math.max(1, pageWidth))));
}

/**
 * A page is mounted (and its squares load) once it is within two pages of the open one, or the pager slides past it on
 * the way to a tapped tab, and stays mounted after that: every page from `from` to `to`, and two either side of `to`.
 * Two, not one: a quick second swipe that catches the pager mid-glide then still finds the next page (and its copy of
 * the header) already there.
 */
function withPages(pages: ReadonlySet<number>, from: number, to: number): ReadonlySet<number> {
  const first = Math.max(0, Math.min(from, to - 2));
  const last = Math.min(PAGE_COUNT - 1, Math.max(from, to + 2));
  let next: Set<number> | null = null;
  for (let i = first; i <= last; i++) {
    if (pages.has(i)) continue;
    next ??= new Set(pages);
    next.add(i);
  }
  return next ?? pages;
}

/**
 * The page a released swipe takes the pager to. iOS says where it will stop; Android gives no target, only the finger's
 * speed (the other way round from the offset), so there a flick goes on to the next page its way and a slow release to
 * the nearest one.
 */
function landingPage({ contentOffset, targetContentOffset, velocity }: NativeScrollEvent, pageWidth: number): number {
  if (targetContentOffset) return pageAt(targetContentOffset.x, pageWidth);
  const speed = (Platform.OS === "android" ? -1 : 1) * (velocity?.x ?? 0);
  if (Math.abs(speed) < 0.2) return pageAt(contentOffset.x, pageWidth);
  const exact = contentOffset.x / Math.max(1, pageWidth);
  return Math.min(PAGE_COUNT - 1, Math.max(0, speed > 0 ? Math.ceil(exact) : Math.floor(exact)));
}

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

const tileKey = (tile: ProfileTile) => tile.key;

/** A callback that keeps its identity for good but always runs the latest `fn`, so the memoized pages are not re-rendered for it. */
function useStableCallback<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/** Scrolls one page's list without re-rendering it. */
type PageScroller = { scrollTo: (y: number, animated: boolean) => void };

/** What every page shares with the pager: the same object for the profile's whole life. */
type PagerLink = {
  /** The pager's offset, on the UI thread: each page's copy of the header moves against it, so it stays still on screen. */
  scrollX: Animated.Value;
  /** Each page's vertical offset, written by the page's own list on the UI thread; the tabs row reads them. */
  scrollYs: readonly Animated.Value[];
  /** Where page i is: as its scroll events last said, or where `sync` put it. A page mounted later opens there. */
  offsetOf: (index: number) => number;
  attach: (index: number, scroller: PageScroller | null) => void;
  /** Every scroll event of page i, on the JS side. Bookkeeping only: never state. */
  track: (index: number, y: number) => void;
  /** A finger started scrolling page i up or down: no swipe is going on. */
  dragStart: (index: number) => void;
  /** Page i stopped: a drag ended, or its momentum did. */
  settle: (index: number, y: number) => void;
  /** Pull to refresh on page i. */
  refresh: (index: number) => void;
  /** Page i's copy of the header was laid out: the open page's gives the header its height. */
  measureHeader: (index: number, height: number) => void;
};

/**
 * The horizontal pager of a profile (one page per tab) and the tabs row over it, TikTok and Instagram style.
 *
 * Every page is its own vertical list, and each starts with its own copy of the header (see PageTop): a drag or a pull
 * anywhere on the header scrolls the page under the finger, natively. The copies are held still on screen while the pages
 * slide, so during a swipe the two pages' copies sit on top of each other and read as one header. Only the tabs row is
 * over the pages: it sits under the header (`tuck`, the header's height, from the top) and moves with the page the pager
 * shows. Every page writes its offset to its own Animated.Value on the UI thread (`scrollYs`); the row reads each one
 * weighted 1 on its own page and 0 a page away, by the pager's offset, also on the UI thread. At rest that is exactly the
 * open page's offset: the row goes up with the header until it reaches the top, where it stays, and down with a pull to
 * refresh. Nothing here sets React state while a finger is down or a page glides: the open tab is committed when the
 * pager settles, or at once on a tab tap.
 *
 * The pages are kept in step so the header never jumps: when the open page stops and when a swipe starts, the other
 * pages are scrolled (without animation) to where the header leaves them. While the header is partly showing every page
 * goes to the open page's offset; once it is tucked away a page above the tuck point goes to it, and a page further
 * down keeps its place.
 */
function useProfilePager({ pageWidth, tuck, onRefresh, onHeaderHeight }: { pageWidth: number; tuck: number; onRefresh: (index: number) => void; onHeaderHeight: (height: number) => void }) {
  const pager = useRef<ScrollView>(null);
  /** The pager's offset on the native side: the tab underline, the tabs row's choice of page and the header copies follow it. */
  const [scrollX] = useState(() => new Animated.Value(START_PAGE * pageWidth));
  const [scrollYs] = useState(() => PROFILE_TABS.map(() => new Animated.Value(0)));
  const offsets = useRef<number[]>(PROFILE_TABS.map(() => 0));
  const scrollers = useRef<(PageScroller | null)[]>(PROFILE_TABS.map(() => null));
  const [active, setActive] = useState(START_PAGE);
  const activeRef = useRef(START_PAGE);
  const [mounted, setMounted] = useState(() => withPages(new Set<number>(), START_PAGE, START_PAGE));
  /** From the start of a swipe until the pager settles: the page under the finger may not be the open one. */
  const swiping = useRef(false);
  /** Where a released swipe is taking the pager, until it gets there (`commit`); null while it is not gliding to a page. */
  const heading = useRef<number | null>(null);
  const latest = useRef({ pageWidth, tuck, onRefresh, onHeaderHeight });
  useEffect(() => {
    latest.current = { pageWidth, tuck, onRefresh, onHeaderHeight };
  });

  const sync = useCallback(
    (from: number) => {
      const point = latest.current.tuck;
      const y = offsets.current[from] ?? 0;
      const tucked = point > 0 && y >= point - 0.5;
      for (let i = 0; i < PAGE_COUNT; i++) {
        if (i === from) continue;
        const now = offsets.current[i] ?? 0;
        const target = tucked ? Math.max(now, point) : Math.max(0, y);
        if (Math.abs(target - now) < 0.5) continue;
        offsets.current[i] = target;
        const scroller = scrollers.current[i];
        if (scroller) scroller.scrollTo(target, false);
        // Not mounted yet: no list drives its value, so it is set here (the tabs row reads it) and the page opens there.
        else scrollYs[i].setValue(target);
      }
    },
    [scrollYs],
  );

  /** Page `open` is the open one now; `from` is where the pager comes from on a tab tap (every page between mounts). */
  const commit = useCallback(
    (open: number, from: number = open) => {
      swiping.current = false;
      heading.current = null;
      if (open !== activeRef.current) {
        activeRef.current = open;
        setActive(open);
        setMounted((prev) => withPages(prev, from, open));
      }
      sync(open);
    },
    [sync],
  );

  /**
   * A tab tap: the tab opens at once and the pager scrolls there (animated). False when the tab is open and the pager
   * rests on it: nothing to do. While a released swipe still glides away from the open tab, a tap on that tab brings the
   * pager back.
   */
  const select = useCallback(
    (open: number) => {
      const from = activeRef.current;
      if (open === from && heading.current === null && !swiping.current) return false;
      // The tabs row sits outside every page, so no scroll view closes the keyboard for this tap: the Add class field on
      // the Classes page would keep it (and the typing) while another tab shows.
      Keyboard.dismiss();
      // A flick just before the tap leaves the open page gliding. A scroll without animation to where its last scroll event
      // put it halts the glide, so the pages are put in step from where it really stops, and the tabs row does not wobble
      // as the pager leaves it.
      scrollers.current[from]?.scrollTo(offsets.current[from] ?? 0, false);
      sync(from);
      // Every page the pager slides past and the target's neighbours mount in this commit, before the slide: none goes by blank.
      commit(open, from);
      pager.current?.scrollTo({ x: open * latest.current.pageWidth, animated: true });
      return true;
    },
    [sync, commit],
  );

  const link = useMemo<PagerLink>(
    () => ({
      scrollX,
      scrollYs,
      offsetOf: (index) => offsets.current[index] ?? 0,
      attach: (index, scroller) => {
        scrollers.current[index] = scroller;
      },
      track: (index, y) => {
        offsets.current[index] = y;
      },
      dragStart: () => {
        swiping.current = false;
      },
      settle: (index, y) => {
        offsets.current[index] = y;
        if (swiping.current) return;
        if (index === activeRef.current) sync(index);
        // Another page stopped while the pager is not on its way to a page: a glide the tab tap could not halt (Android),
        // or a page `sync` moved. It goes (back) in step with the open page; a page already in step stays where it is.
        else if (heading.current === null) sync(activeRef.current);
      },
      refresh: (index) => latest.current.onRefresh(index),
      measureHeader: (index, height) => {
        if (index === activeRef.current && height > 0) latest.current.onHeaderHeight(height);
      },
    }),
    [scrollX, scrollYs, sync],
  );

  // No JS listener: the underline, the tabs row and the copies of the header follow the pager on the UI thread alone.
  const onPagerScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true }), [scrollX]);
  const onPagerDragBegin = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const inView = pageAt(e.nativeEvent.contentOffset.x, latest.current.pageWidth);
      // A quick second swipe caught the pager before it settled (no onMomentumScrollEnd came): the page it reached opens
      // now, so its neighbours are there for this swipe. Otherwise the open page leads the others into step.
      if (inView !== activeRef.current) commit(inView);
      else sync(inView);
      heading.current = null;
      swiping.current = true;
    },
    [sync, commit],
  );
  const onPagerDragEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, targetContentOffset } = e.nativeEvent;
      const width = latest.current.pageWidth;
      // Let go right on a page: no momentum follows (so no onMomentumScrollEnd), the pager has settled already.
      const onPage = width > 0 && Math.abs(contentOffset.x - Math.round(contentOffset.x / width) * width) < 1;
      if (onPage && targetContentOffset && Math.abs(targetContentOffset.x - contentOffset.x) < 1) return commit(pageAt(contentOffset.x, width));
      // It glides on to a page and commits when it gets there; until then the open tab is not at rest (see `select`).
      heading.current = landingPage(e.nativeEvent, width);
    },
    [commit],
  );
  const onPagerSettle = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => commit(pageAt(e.nativeEvent.contentOffset.x, latest.current.pageWidth)), [commit]);
  /** The open page in view when the pager is first laid out (and if its width ever changes). */
  const onPagerLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0 && activeRef.current !== 0) pager.current?.scrollTo({ x: activeRef.current * width, animated: false });
  }, []);

  // The open page's offset, on the UI thread: page i weighs 1 when the pager rests on it and 0 a page away. While the
  // header partly shows the pages are in step, so a swipe mixes equal offsets and the row stays under both copies.
  const openOffset = useMemo(() => {
    const width = Math.max(1, pageWidth);
    let sum: Animated.AnimatedInterpolation<number> | null = null;
    for (let i = 0; i < PAGE_COUNT; i++) {
      const weight = scrollX.interpolate<number>({ inputRange: [(i - 1) * width, i * width, (i + 1) * width], outputRange: [0, 1, 0], extrapolate: "clamp" });
      const term = Animated.multiply<number>(scrollYs[i], weight);
      sum = sum ? Animated.add<number>(sum, term) : term;
    }
    return sum as Animated.AnimatedInterpolation<number>;
  }, [scrollX, scrollYs, pageWidth]);
  // The tabs row's top: the header's height minus the open page's offset, never above the top (it sticks there), and lower
  // with a pull (negative offsets). The height comes in through an Animated.Value, so a new height (a bio loading, the
  // follow state) moves the row at once without rebuilding the native graph, which would wait for the next scroll event.
  const [tuckValue] = useState(() => new Animated.Value(Math.max(0, tuck)));
  useEffect(() => {
    tuckValue.setValue(Math.max(0, tuck));
  }, [tuck, tuckValue]);
  const tabsShift = useMemo(
    () => Animated.subtract<number>(tuckValue, openOffset).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp", extrapolateRight: "extend" }),
    [tuckValue, openOffset],
  );

  return { pager, scrollX, link, active, mounted, select, onPagerScroll, onPagerDragBegin, onPagerDragEnd, onPagerSettle, onPagerLayout, tabsShift };
}

/** What a visitor may see of Classes, Saved or Liked: still asking, could not ask, a lock, or the tab itself. */
type Gate = "open" | "loading" | "error" | "locked";

/** The layout and scroll wiring every page gets from the profile. */
type PageFrame = {
  index: number;
  link: PagerLink;
  /** The open page: the only one the status bar's scroll-to-top reaches. */
  active: boolean;
  /** The header (everything above the tabs row), the same element for every page: each page starts with its own copy. */
  header: ReactElement | null;
  /** The pager's width: page i is i widths along, and its copy of the header moves back by as much as the pager does. */
  pageWidth: number;
  /** Room under the copy of the header for the tabs row, which stays over the pages. */
  tabsHeight: number;
  /** How far a page scrolls before the header has gone and only the tabs row is left: the header's height. */
  tuck: number;
  /** The page's height + `tuck`: every page can scroll far enough to tuck the header away. */
  minHeight: number;
  bottomPad: number;
  refreshing: boolean;
};

/**
 * The scroll wiring a page's list needs, the same objects from one render to the next. `scrollTo` moves the list (it must
 * keep its identity): the pager uses it to keep the pages in step.
 */
function usePageScroll({ index, link, minHeight, bottomPad }: PageFrame, scrollTo: (y: number, animated: boolean) => void) {
  useEffect(() => {
    link.attach(index, { scrollTo });
    return () => link.attach(index, null);
  }, [link, index, scrollTo]);
  // Where the other pages are when it mounts (see `sync`). Set once: a new object would move the list back there.
  const [contentOffset] = useState(() => ({ x: 0, y: link.offsetOf(index) }));
  // The offset goes to the tabs row on the UI thread; the listener only notes it on the JS side.
  const onScroll = useMemo(
    () =>
      Animated.event<NativeScrollEvent>([{ nativeEvent: { contentOffset: { y: link.scrollYs[index] } } }], {
        useNativeDriver: true,
        listener: (e) => link.track(index, e.nativeEvent.contentOffset.y),
      }),
    [link, index],
  );
  const onDragStart = useCallback(() => link.dragStart(index), [link, index]);
  const onSettle = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => link.settle(index, e.nativeEvent.contentOffset.y), [link, index]);
  const onRefresh = useCallback(() => link.refresh(index), [link, index]);
  // In case the first `contentOffset` did not take (the list had no size yet): once it has one, the list goes there.
  const placed = useRef(false);
  const onContentSizeChange = useCallback(() => {
    if (placed.current) return;
    placed.current = true;
    const y = link.offsetOf(index);
    if (y !== 0) scrollTo(y, false);
  }, [link, index, scrollTo]);
  const contentStyle = useMemo(() => ({ minHeight, paddingBottom: bottomPad }), [minHeight, bottomPad]);
  return { contentOffset, onScroll, onDragStart, onSettle, onRefresh, onContentSizeChange, contentStyle };
}

/**
 * The top of every page: the page's own copy of the header, so a drag or a pull that starts anywhere on it scrolls this
 * page (and its buttons still take taps), then room for the tabs row, which stays over the pages.
 *
 * The copy is held still on screen while the pages slide sideways: it moves against its page by exactly as much as the
 * pager does (translateX = scrollX - index * pageWidth, on the UI thread), so during a swipe the two pages' copies sit on
 * top of each other and read as one fixed header, each page clipping its own. At rest the open page's copy is right on
 * its page; the others are off screen with theirs. The open page's copy gives the header its height (`measureHeader`).
 */
const PageTop = memo(function PageTop({ index, link, header, pageWidth, tabsHeight }: Pick<PageFrame, "index" | "link" | "header" | "pageWidth" | "tabsHeight">) {
  const styles = useStyles();
  const hold = useMemo(
    () => ({ transform: [{ translateX: link.scrollX.interpolate({ inputRange: [0, 1], outputRange: [-index * pageWidth, 1 - index * pageWidth], extrapolate: "extend" }) }] }),
    [link, index, pageWidth],
  );
  const onLayout = useCallback((e: LayoutChangeEvent) => link.measureHeader(index, e.nativeEvent.layout.height), [link, index]);
  return (
    <>
      <Animated.View onLayout={onLayout} style={[styles.headerCopy, hold]}>
        {header}
      </Animated.View>
      <View style={{ height: tabsHeight }} />
    </>
  );
});

type TilesPageProps = PageFrame & {
  tab: GridTab;
  grid: TileGrid;
  own: boolean;
  tileWidth: number;
  onOpen: (tile: ProfileTile) => void;
  /** Your own Posts and Reels: hold a square for Pin to profile. */
  onPin?: (tile: ProfileTile) => void;
  gate: Gate;
  gateMessage: string;
  onRetryGate: () => void;
  /** Your own Saved and Liked: who can see them, in a line at the top of the page. */
  visibility?: ProfileVisibility;
  savingVisibility: boolean;
  onChangeVisibility: (section: ProfileSection, value: ProfileVisibility) => void;
};

/**
 * Posts, Reels, Saved, Liked or Listings: the squares three to a row, loading more as you scroll, and under them a lock,
 * a spinner, an empty tab, an error or "loading more". Listings show their kind and title on the square (as on the
 * website); the other tabs keep TikTok's plain squares.
 */
const TilesPage = memo(function TilesPage(props: TilesPageProps) {
  const { index, link, header, pageWidth, tabsHeight, active, refreshing, tab, grid, own, tileWidth, onOpen, onPin, gate, gateMessage, onRetryGate, visibility, savingVisibility, onChangeVisibility } = props;
  const styles = useStyles();
  const colors = useColors();
  const list = useRef<Animated.FlatList<ProfileTile>>(null);
  const scrollTo = useCallback((y: number, animated: boolean) => list.current?.scrollToOffset({ offset: y, animated }), []);
  const scroll = usePageScroll(props, scrollTo);

  const renderTile = useCallback<ListRenderItem<ProfileTile>>(
    ({ item }) => (tab === "listings" ? <ListingGridTile tile={item} width={tileWidth} onOpen={onOpen} /> : <ProfileGridTile tile={item} width={tileWidth} onOpen={onOpen} onLongPress={onPin} />),
    [tab, tileWidth, onOpen, onPin],
  );

  const section = tab === "saved" || tab === "liked" ? tab : null;
  // The header and the room for the tabs, then (your own Saved and Liked) who can see the tab.
  const top = (
    <>
      <PageTop index={index} link={link} header={header} pageWidth={pageWidth} tabsHeight={tabsHeight} />
      {own && section && visibility ? <VisibilityRow section={section} value={visibility} busy={savingVisibility} onChange={(v) => onChangeVisibility(section, v)} /> : null}
    </>
  );

  const spinner = <ActivityIndicator style={styles.spinner} color={colors.brand} />;
  let footer: ReactElement | null = null;
  if (gate === "error") footer = <ErrorLine message={gateMessage} onRetry={onRetryGate} />;
  else if (gate === "loading") footer = spinner;
  else if (gate === "locked") footer = <LockedNotice message={gateMessage} />;
  else if (grid.status !== "ready") footer = spinner;
  else if (grid.tiles.length === 0) footer = grid.error ? <ErrorLine message={loadErrorText(grid.error, tab)} onRetry={() => void grid.refresh()} /> : <TabEmpty tab={tab} own={own} />;
  else if (grid.error) footer = <ErrorLine message={loadErrorText(grid.error, tab)} onRetry={() => void grid.refresh()} />;
  else if (grid.loadingMore) footer = spinner;
  else if (grid.moreError) footer = <ErrorLine message={`Could not load more ${TAB_NOUNS[tab]}.`} onRetry={() => void grid.loadMore()} />;

  return (
    <Animated.FlatList
      ref={list}
      testID={`profile-page-${tab}`}
      data={gate === "open" ? grid.tiles : NO_TILES}
      numColumns={3}
      keyExtractor={tileKey}
      renderItem={renderTile}
      columnWrapperStyle={styles.gridRow}
      ItemSeparatorComponent={RowGap}
      ListHeaderComponent={top}
      ListFooterComponent={footer}
      onEndReached={() => void grid.loadMore()}
      onEndReachedThreshold={0.6}
      onScroll={scroll.onScroll}
      scrollEventThrottle={16}
      onScrollBeginDrag={scroll.onDragStart}
      onScrollEndDrag={scroll.onSettle}
      onMomentumScrollEnd={scroll.onSettle}
      onScrollToTop={scroll.onSettle}
      onContentSizeChange={scroll.onContentSizeChange}
      contentOffset={scroll.contentOffset}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={scroll.onRefresh} />}
      scrollsToTop={active}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={scroll.contentStyle}
      style={styles.page}
    />
  );
});

type ClassesPageProps = PageFrame & {
  own: boolean;
  userId: string;
  classes: ProfileClass[] | null;
  error: string | null;
  onRetry: () => void;
  onChange: (fn: (classes: ProfileClass[]) => ProfileClass[]) => void;
  gate: Gate;
  gateMessage: string;
  onRetryGate: () => void;
  /** Your own Classes: who can see them, in a line at the top of the page. */
  visibility?: ProfileVisibility;
  savingVisibility: boolean;
  onChangeVisibility: (section: ProfileSection, value: ProfileVisibility) => void;
};

/**
 * The Classes tab: the classes by semester, where the owner adds them, or a lock, a spinner or an error. A page of its
 * own, so the add-class form keeps its text and focus across renders and swipes.
 */
const ClassesPage = memo(function ClassesPage(props: ClassesPageProps) {
  const { index, link, header, pageWidth, tabsHeight, active, refreshing, tuck, own, userId, classes, error, onRetry, onChange, gate, gateMessage, onRetryGate, visibility, savingVisibility, onChangeVisibility } = props;
  const styles = useStyles();
  const colors = useColors();
  const scroller = useRef<ScrollView>(null);
  const scrollTo = useCallback((y: number, animated: boolean) => scroller.current?.scrollTo({ y, animated }), []);
  const scroll = usePageScroll(props, scrollTo);

  const spinner = <ActivityIndicator style={styles.spinner} color={colors.brand} />;
  let body: ReactElement;
  if (gate === "error") body = <ErrorLine message={gateMessage} onRetry={onRetryGate} />;
  else if (gate === "loading") body = spinner;
  else if (gate === "locked") body = <LockedNotice message={gateMessage} />;
  else if (!classes) body = error ? <ErrorLine message={loadErrorText(error, "classes")} onRetry={onRetry} /> : spinner;
  // Opening the add-class form tucks the header away: the form comes up under the tabs row, clear of the keyboard.
  else body = <ClassesSection own={own} userId={userId} classes={classes} onChange={onChange} onOpenForm={() => scroller.current?.scrollTo({ y: tuck, animated: true })} />;

  return (
    <Animated.ScrollView
      ref={scroller}
      testID="profile-page-classes"
      onScroll={scroll.onScroll}
      scrollEventThrottle={16}
      onScrollBeginDrag={scroll.onDragStart}
      onScrollEndDrag={scroll.onSettle}
      onMomentumScrollEnd={scroll.onSettle}
      onScrollToTop={scroll.onSettle}
      onContentSizeChange={scroll.onContentSizeChange}
      contentOffset={scroll.contentOffset}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={scroll.onRefresh} />}
      scrollsToTop={active}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={scroll.contentStyle}
      style={styles.page}
    >
      {/* One child, so the animated scroll view keeps its native wiring across renders. */}
      <View>
        <PageTop index={index} link={link} header={header} pageWidth={pageWidth} tabsHeight={tabsHeight} />
        {own && visibility ? <VisibilityRow section="classes" value={visibility} busy={savingVisibility} onChange={(v) => onChangeVisibility("classes", v)} /> : null}
        {body}
      </View>
    </Animated.ScrollView>
  );
});

/**
 * A whole profile, yours or someone else's, TikTok and Instagram style: the header (photo, name, @username, Following |
 * Followers | Likes, the buttons, bio and university) tops every page of a horizontal pager with one page per tab, and the
 * tabs Posts | Classes | Reels | Saved | Liked | Listings stay over the pages. Swipe between the tabs (no haptic) or tap one
 * (a light tap). Each page keeps its own scroll position: the header scrolls up with the open page (a drag on it scrolls
 * the page too) until only the tabs row is left at the top.
 * A grid page shows its squares three to a row, loading more as you scroll; Classes shows the classes by semester (where
 * the owner adds them). Listings (apartments, roommate posts and items for sale) come all at once. Classes, Saved and Liked
 * follow the owner's settings: the owner sees who can see each (and changes it there), a visitor without access sees a
 * lock; Posts, Reels and Listings are public. A page loads once it is open or next to the open one.
 *
 * `topBar` is the Profile tab, which draws its own bar (Find friends, your name with the account sheet, the menu); on a
 * stacked screen the navigation header shows the name instead. Everything that needs migration 18 (likes received, classes,
 * Saved and Liked, the grids) fails on its own: the header still shows, with zeros, and the tab says what could not load.
 */
export function ProfileView({ userId, topBar = false }: { userId: string; topBar?: boolean }) {
  const styles = useStyles();
  const { user, profile: myProfile, refreshProfile, signOut } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const show = useActionSheet();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
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

  // The pager fills the space under the top bar. The tabs row over it is measured first (every page leaves room for it
  // under its copy of the header), then the header, from the open page's copy: the row sits right under it, and its height
  // is how far a page scrolls before only the row is left.
  const [body, setBody] = useState(() => ({ width: windowWidth, height: 0 }));
  const [tabsHeight, setTabsHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const tuck = headerHeight;
  /** The page whose pull started the refresh: only its spinner shows. */
  const [refreshingPage, setRefreshingPage] = useState<number | null>(null);
  const { pager, scrollX, link, active, mounted, select, onPagerScroll, onPagerDragBegin, onPagerDragEnd, onPagerSettle, onPagerLayout, tabsShift } = useProfilePager({
    pageWidth: body.width,
    tuck,
    onRefresh: (index) => void refreshAll(index),
    onHeaderHeight: (height) => setHeaderHeight((h) => (h === height ? h : height)),
  });
  const tab = PROFILE_TABS[active].key;

  /** A tap moves the pager to the tab with a light tap; a swipe settles there on its own, without one. */
  function selectTab(next: ProfileTabKey) {
    if (select(TAB_INDEX[next])) hapticTap();
  }

  // A grid loads once its page is open or next to the open one, and keeps its squares after that.
  const resetKey = `${userId}:${viewerId ?? "guest"}`;
  const posts = useTileGrid((c) => postTiles(userId, "post", c), { resetKey, enabled: mounted.has(TAB_INDEX.posts) });
  const reels = useTileGrid((c) => postTiles(userId, "reel", c), { resetKey, enabled: mounted.has(TAB_INDEX.reels) });
  const saved = useTileGrid((c) => listProfileSaved(supabase, userId, { before: before(c) }), { resetKey, enabled: mounted.has(TAB_INDEX.saved) && canSee("saved") });
  const liked = useTileGrid((c) => listProfileLiked(supabase, userId, { before: before(c) }), { resetKey, enabled: mounted.has(TAB_INDEX.liked) && canSee("liked") });
  // Listings are public, so they need no access check, and come as a single page.
  const listings = useTileGrid(() => listingTiles(userId), { resetKey, enabled: mounted.has(TAB_INDEX.listings) });
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
  // The same functions for every render, so a page re-renders only for its own data.
  const onChangeVisibility = useStableCallback((section: ProfileSection, value: ProfileVisibility) => void changeVisibility(section, value));
  const retryAccess = useStableCallback(() => {
    void accessQ.refresh();
    void classesQ.refresh();
  });
  const retryClasses = useStableCallback(() => void classesQ.refresh());

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
  /** Pull to refresh on any page reloads the whole profile: the header's numbers, the access, the classes and every grid. */
  async function refreshAll(index: number) {
    setRefreshingPage(index);
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
      setRefreshingPage((p) => (p === index ? null : p));
    }
  }

  // Back on this screen (a post published, someone followed, a listing added): the numbers, a one-page grid and the Listings
  // (once that tab has loaded, even while another tab shows) reload quietly.
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

  // The header is the same element from one render to the next: its buttons keep their functions for good (each runs the
  // latest code), so the memoized pages, which each show a copy of it, re-render only when something on it changes. The
  // Follow state lives here, once, so every copy shows the same button, busy or not. The button reads the profile's own
  // stats, like the counts above it (every state the tap takes goes there too), so it is right from the first frame; while
  // a tap is on its way it shows the tap's guess.
  const onOpenFollows = useStableCallback((kind: "followers" | "following") => router.push({ pathname: "/follows/[id]", params: { id: userId, kind, name } }));
  const onShare = useStableCallback(() => setSharing(true));
  const onChangePhoto = useStableCallback(() => void changePhoto());
  const onEditProfile = useStableCallback(() => router.push("/settings"));
  const onFindFriends = useStableCallback(() => router.push("/search"));
  const onMessage = useStableCallback(() => void message());
  const onMore = useStableCallback(more);
  const onFollowChange = useStableCallback(followChanged);
  const follow = useFollow(userId, followQ.data ?? undefined, viewerId, needLogin, onFollowChange);
  const onToggleFollow = useStableCallback(() => void follow.toggle());
  const followPending = follow.pending;
  const followShown = followPending ? follow : (followQ.data ?? follow);
  const followedByMe = followShown.followedByMe;
  const followLabel = followedByMe ? "Following" : followShown.followsMe ? "Follow back" : "Follow";
  const actions = useMemo(
    () =>
      own ? (
        <>
          <HeaderButton title="Edit profile" onPress={onEditProfile} />
          <HeaderButton title="Share profile" onPress={onShare} />
          <HeaderIconButton icon="person-add-outline" label="Find friends" onPress={onFindFriends} />
        </>
      ) : (
        <>
          {/* A block forbids following on the server, so the button goes while "Blocked" shows. The counts above move with the button. */}
          {!blocked ? (
            <Button
              title={followLabel}
              variant={followedByMe ? "secondary" : "primary"}
              icon={followedByMe ? "checkmark" : "person-add-outline"}
              accessibilityLabel={followLabel}
              accessibilityState={{ selected: followedByMe }}
              disabled={followPending}
              onPress={onToggleFollow}
              style={styles.follow}
            />
          ) : null}
          <HeaderButton title={blocked ? "Blocked" : "Message"} onPress={onMessage} disabled={blocked} />
          <HeaderIconButton icon="ellipsis-horizontal" label="More" onPress={onMore} />
        </>
      ),
    [own, blocked, followLabel, followedByMe, followPending, styles.follow, onEditProfile, onShare, onFindFriends, onToggleFollow, onMessage, onMore],
  );
  const followStats = followQ.data ?? NO_FOLLOW_STATS;
  const likes = statsQ.data?.likesReceived ?? 0;
  const changingPhoto = avatar.busy;
  const header = useMemo(
    () =>
      profile ? (
        <ProfileHeader
          profile={profile}
          own={own}
          follow={followStats}
          likes={likes}
          onOpenFollows={onOpenFollows}
          onShowQr={onShare}
          onChangePhoto={own ? onChangePhoto : undefined}
          changingPhoto={changingPhoto}
          actions={actions}
        />
      ) : null,
    [profile, own, followStats, likes, onOpenFollows, onShare, onChangePhoto, changingPhoto, actions],
  );

  const bar = topBar ? <ProfileTopBar name={name} topInset={insets.top} onFindFriends={() => router.push("/search")} onAccount={accountSheet} onMenu={menu} /> : null;

  if (!profile || (followQ.loading && !followQ.data && !followQ.error)) {
    let content: ReactNode = <Loading />;
    if (!profile && !profileQ.loading) {
      content = profileQ.error ? (
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
        {content}
      </View>
    );
  }

  const handle = profileHandle(profile);
  const tileWidth = (body.width - GAP * 2) / 3;
  const bottomPad = (topBar ? 0 : insets.bottom) + space.xl;
  // The pages wait for the space's size and the tabs row's (each leaves room for the row). Nothing shows until the open
  // page's copy of the header is measured too, so the row never shows out of place.
  const ready = body.height > 0 && tabsHeight > 0;
  const shown = ready && headerHeight > 0;

  // The lock on a tab: your own when not everyone can see it, someone else's when you may not open it.
  const locks: Partial<Record<ProfileTabKey, string>> = {};
  for (const section of ["classes", "saved", "liked"] as const) {
    const value = visibility(section);
    if (own && value !== "public") locks[section] = ownSectionNote(section, value);
    if (!own && access && !access[section]) locks[section] = lockedSectionMessage(section, value, firstName);
  }

  /** A visitor's way into Classes, Saved or Liked: the access is still loading, failed to load, or says no. */
  function gateOf(section: ProfileSection): [Gate, string] {
    if (own) return ["open", ""];
    if (!access) return accessQ.error ? ["error", loadErrorText(accessQ.error, section)] : ["loading", ""];
    if (!access[section]) return ["locked", lockedSectionMessage(section, visibility(section), firstName)];
    return ["open", ""];
  }

  function renderPage(key: ProfileTabKey, index: number): ReactNode {
    const frame: PageFrame = { index, link, active: index === active, header, pageWidth: body.width, tabsHeight, tuck, minHeight: body.height + tuck, bottomPad, refreshing: refreshingPage === index };
    if (key === "classes") {
      const [gate, gateMessage] = gateOf("classes");
      return (
        <ClassesPage
          {...frame}
          own={own}
          userId={userId}
          classes={classesQ.data}
          error={classesQ.error}
          onRetry={retryClasses}
          onChange={updateClasses}
          gate={gate}
          gateMessage={gateMessage}
          onRetryGate={retryAccess}
          visibility={own ? visibility("classes") : undefined}
          savingVisibility={savingVisibility === "classes"}
          onChangeVisibility={onChangeVisibility}
        />
      );
    }
    const section = key === "saved" || key === "liked" ? key : null;
    const [gate, gateMessage]: [Gate, string] = section ? gateOf(section) : ["open", ""];
    return (
      <TilesPage
        {...frame}
        tab={key}
        grid={grids[key]}
        own={own}
        tileWidth={tileWidth}
        onOpen={openTile}
        onPin={own && (key === "posts" || key === "reels") ? pinMenu : undefined}
        gate={gate}
        gateMessage={gateMessage}
        onRetryGate={retryAccess}
        visibility={own && section ? visibility(section) : undefined}
        savingVisibility={section !== null && savingVisibility === section}
        onChangeVisibility={onChangeVisibility}
      />
    );
  }

  return (
    <View style={styles.screen}>
      {bar}
      <View
        style={styles.body}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          // A zero size (a screen being hidden) is ignored, so the pages stay mounted where they are.
          if (width > 0 && height > 0) setBody((b) => (b.width === width && b.height === height ? b : { width, height }));
        }}
      >
        {ready ? (
          <Animated.ScrollView
            ref={pager}
            testID="profile-pager"
            horizontal
            pagingEnabled
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            scrollsToTop={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            // While a pull-to-refresh spinner shows, that page sits lower than the others, so a swipe would split the header.
            scrollEnabled={refreshingPage === null}
            scrollEventThrottle={16}
            onScroll={onPagerScroll}
            onScrollBeginDrag={onPagerDragBegin}
            onScrollEndDrag={onPagerDragEnd}
            onMomentumScrollEnd={onPagerSettle}
            onLayout={onPagerLayout}
            style={[styles.pager, !shown && styles.hidden]}
          >
            {/* One child, so the animated scroll view keeps its native wiring across renders. */}
            <View style={styles.pages}>
              {PROFILE_TABS.map((t, i) => (
                <View
                  key={t.key}
                  // Always a view of its own: the hiding below changes on every commit and would otherwise flatten the page
                  // into its parent and back, moving its list each time.
                  collapsable={false}
                  style={{ width: body.width, height: body.height }}
                  // Only the open page is read out: every page has a copy of the header, and the tabs row is over them all.
                  accessibilityElementsHidden={i !== active}
                  importantForAccessibility={i === active ? "auto" : "no-hide-descendants"}
                >
                  {mounted.has(i) ? renderPage(t.key, i) : null}
                </View>
              ))}
            </View>
          </Animated.ScrollView>
        ) : null}
        {/* The tabs row stays over the pages: right under the header, then at the top once the header has gone, and down with a pull. */}
        <Animated.View pointerEvents="box-none" style={[styles.tabs, { top: 0, transform: [{ translateY: tabsShift }] }, !shown && styles.hidden]}>
          <ProfileTabs
            active={tab}
            onSelect={selectTab}
            locks={locks}
            scrollX={scrollX}
            pageWidth={body.width}
            onLayout={(e) => {
              const height = e.nativeEvent.layout.height;
              if (height > 0) setTabsHeight((h) => (h === height ? h : height));
            }}
          />
        </Animated.View>
      </View>
      <ShareProfileSheet visible={sharing} onClose={() => setSharing(false)} profileId={userId} name={name} username={handle} avatarUrl={profile.avatar_url} own={own} />
    </View>
  );
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
  // The pages and the tabs row over them.
  body: { flex: 1, overflow: "hidden", backgroundColor: colors.bg },
  pager: { flex: 1, backgroundColor: colors.bg },
  pages: { flexDirection: "row" },
  page: { flex: 1, backgroundColor: colors.bg },
  // A page's copy of the header, with the gap above the tabs row.
  headerCopy: { paddingBottom: TABS_GAP },
  // The row itself is opaque (the screen's colour): the squares scroll up under it.
  tabs: { position: "absolute", left: 0, right: 0 },
  // For the frame or two before the header is measured.
  hidden: { opacity: 0 },
  gridRow: { gap: GAP },
  follow: { flex: 1, minHeight: PROFILE_BUTTON_HEIGHT, height: PROFILE_BUTTON_HEIGHT, borderRadius: radius.sm },
  spinner: { paddingVertical: space.xl },
  errorLine: { padding: space.lg },
  empty: { alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingVertical: 40 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: colors.text, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" },
  emptyAction: { minWidth: 160 },
}));

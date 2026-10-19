import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from "react-native";
import { Image } from "expo-image";
import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getFeedPost, getPostEngagement, isSaved, listReels, REELS_PAGE_SIZE, type PostEngagement, type PostTargetType, type Reel } from "@apartment-book/shared";
import { campusSegments, ScopeToggle, type ScopeSegment } from "@/components/home/home-top-tabs";
import { ReelCommentsSheet } from "@/components/home/reel-comments-sheet";
import { ShareSheetProvider } from "@/components/share-sheet";
import { aspectOf, photoFloor, photoLayout, photoTop, ReelItem, surfaceOf, wholeVideo, type ViewerSurface } from "@/components/home/reel-item";
import { markReelsStale } from "@/components/home/reels-section";
import { hapticTap } from "@/lib/haptics";
import { useHomeScope } from "@/lib/home-scope";
import { errorText } from "@/lib/hooks";
import { emitPostEngagement, emitPostRemoved, emitPostSlide } from "@/lib/posts-events";
import { dropHanded, entryOf, loadViewerItems, peekHanded, posterAt, viewerItemFromPost, viewerItemFromReel, viewerKey, type ViewerEntry, type ViewerItem, type ViewerOrigin, type ViewerSource } from "@/lib/reel-viewer";
import { useReduceMotion } from "@/lib/accessibility";
import { ViewerChromeContext, ViewerClockContext, ViewerClosingContext, ViewerZoomContext, type ViewerClocks } from "@/lib/viewer-chrome";
import { returnPlayer } from "@/lib/video-handoff";
import { videosMuted } from "@/lib/video-sound";
import { usePageSwipe, ViewerSwipeContext, type ViewerSwipe } from "@/lib/viewer-swipe";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { auroraGradient, textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";
import { GlassIconButton } from "@/components/glass";

/** Breathing room between the status bar and the top row, as on Home's bar. */
const TOP_GAP = 8;
/** The one row over the top of the video: Back at the left, the Campus | Global toggle in the middle, the reel's sound button at the right. */
const ROW = 44;
/** The sound button ReelItem draws: a 36pt disc, 10pt under the inset it is given. */
const MUTE_SIZE = 36;
const MUTE_OFFSET = 10;
/** The "Add comment…" bar at the bottom of every page: the pill's height, the gap above it, and the least it keeps from the screen's bottom edge. */
const COMMENT_BAR = 48;
const COMMENT_BAR_GAP = 10;
const COMMENT_BAR_BOTTOM = 12;
/** How many pages ahead (and one behind) a post known only by its id is loaded. */
const LOAD_AHEAD = 3;
/** The zoom open: critically damped (it never overshoots the screen's edges), about 0.4s. */
const ZOOM_IN = { damping: 32, stiffness: 270, mass: 1, overshootClamping: true };
/**
 * The zoom closed: quick off the mark and braking evenly all the way down, so it stops on the picture it came from in the
 * frame it seems to arrive. A curve with a long soft tail (iOS's 0.32, 0.72, 0, 1) leaves the page creeping the last few
 * points for a fifth of a second, where its scaled copy of the picture shows softer than the feed's own and shimmers.
 */
const ZOOM_OUT_MS = 300;
const ZOOM_OUT_CURVE = [0.3, 0.7, 0.45, 1] as const;
/**
 * Closing onto the tapped picture, the page fades out over the feed's own during the zoom's last HAND_OVER_MS, as it
 * covers its last few pixels (under 10): the same picture, but the page's is a scaled copy, a little softer (expo-image
 * filters trilinearly, blending in a half-size mipmap once scaled down). So the crisp one has taken over by the time it
 * stops: never a soft one standing still, then a pop.
 */
const HAND_OVER_MS = 50;
/** Most of the fade comes last, where the two pictures are a pixel or less apart: no ghost of one beside the other. */
const HAND_OVER = { duration: HAND_OVER_MS, easing: Easing.in(Easing.cubic) };
/** Device pixels per point: the opening's edges sit on whole pixels (see frameStyle). */
const PIXEL = PixelRatio.get();

/** A position on the screen's pixel grid, as layout rounds every edge. */
function onPixel(v: number): number {
  "worklet";
  return Math.round(v * PIXEL) / PIXEL;
}
/**
 * The longest the zoom open waits for its page to draw the tapped picture: usually a frame or two (it is the feed's own),
 * and the feed's live picture shows meanwhile, so a late one costs a moment, never a black frame.
 */
const PICTURE_WAIT_MS = 350;
/** The longest a page loaded by its id keeps its stand-in while its own first picture loads into memory. */
const PREFETCH_WAIT_MS = 600;
/** The longest the stand-in stays over the loaded page waiting for it to draw its picture. */
const STAND_IN_MAX_MS = 1500;

/** What a page shows first: its first slide's photo, or its video's poster and very first frame (see VideoSlide). */
function firstPictures(item: ViewerItem): string[] {
  const m = item.media[0];
  if (!m) return [];
  if (m.type === "photo") return [m.url];
  return m.poster ? [m.poster, posterAt(m.poster, 0)] : [];
}
/**
 * A page pulled sideways (the swipe back) follows the finger and, by a full page's width, has shrunk by this share and
 * rounded its corners to this radius (by a fifth of the way), the screen behind showing more and more round it.
 */
const PULL_SHRINK = 0.32;
const PULL_RADIUS = 36;
const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

function mergeUnique(current: ViewerEntry[], incoming: ViewerEntry[]): ViewerEntry[] {
  const seen = new Set(current.map((e) => e.key));
  return [...current, ...incoming.filter((e) => !seen.has(e.key))];
}

/** "post:id" → ["post", "id"]. */
function splitKey(key: string): [PostTargetType, string] {
  const sep = key.indexOf(":");
  return [key.slice(0, sep) as PostTargetType, key.slice(sep + 1)];
}

/**
 * The full-screen viewer, TikTok style, for every reel and every post with photos or videos: a video fills the screen
 * edge to edge, a photo sits whole at the top on the theme's own colour with its words below it (see ReelItem), and a
 * swipe up moves on. A reel goes on into the Reels feed (listReels: posted reels and
 * listing tours, page by page, behind the one that was opened); a post from a list (For you, a profile grid, Saved) goes
 * on through that list, as the source hands it over (see openViewer). A post's photos and videos swipe sideways on
 * their page. Over every page, one row at the top: Back at the left, the Campus | Global toggle in the middle while the
 * Reels feed is running (the same choice as Home's, see useHomeScope: picking the other one keeps the page on screen and
 * the ones already seen, and the reels after it come from the new choice) and a video's sound button at the right. At
 * the bottom, the creator's name, the words and the rail (like, comments, share, save, "…") that ReelItem draws for every
 * page, and under them an "Add comment…" bar that opens the comments straight into typing. Likes, saves and comments
 * made here reach the row the viewer was opened from (emitPostEngagement), and a post deleted here leaves the feeds too.
 * Handed-over pages show at once; a post known only by its id (a profile square, a chat card) loads as it comes near,
 * its picture standing in meanwhile; opened from a link, the post is fetched first.
 */
export default function ReelViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const { user, profile } = useSession();
  const colors = useColors();
  const { isDark } = useAppTheme();
  const styles = useStyles();
  const [scope, setScope] = useHomeScope();
  // Your own university or every one, as on Home; someone without a university sees everything.
  const universityId = scope.campus === "all" || !profile?.university_id ? undefined : profile.university_id;
  const universityRef = useRef(universityId);
  universityRef.current = universityId;
  const userId = user?.id ?? null;

  /** What the opener handed over (read once): the pages, the one tapped and what comes after them. A link hands over nothing. */
  const [handed] = useState<ViewerSource | null>(() => peekHanded(id));
  useEffect(() => () => dropHanded(id), [id]);
  // Whatever happens, a feed's player handed over here goes back to the feed as the viewer goes: on a real unmount only,
  // never on the cleanup a fast refresh runs as well (expo-modules-core's own trick), which would give it back twice.
  const refreshing = useRef(false);
  useMemo(() => {
    refreshing.current = true;
  }, []);
  useEffect(() => {
    refreshing.current = false;
    return () => {
      if (!refreshing.current) handed?.entries.forEach((e) => e.player && returnPlayer(e.player));
    };
  }, [handed]);
  /** After the last page: the Reels feed, the opener's next pages, or nothing. */
  const then = handed?.then ?? "reels";
  const reelsMode = then === "reels";
  /** A list that follows the Campus | Global choice (For you): the toggle shows, and a change swaps what comes next. */
  const rescope = typeof then === "object" ? then.rescope : undefined;
  const scoped = reelsMode || Boolean(rescope);
  /** The list's next pages, swapped for the other campus's after a change of choice. */
  const listMore = useRef(typeof then === "object" ? then.more : null);
  const startIndex = handed ? Math.max(0, Math.min(handed.index, handed.entries.length - 1)) : 0;

  // The window's height from the first frame (the viewer fills it), so the page is drawn before the zoom starts; the
  // layout below corrects it if the screen turns out different.
  const [height, setHeight] = useState(() => Math.round(windowHeight));
  /** The pages: what was handed over, then whatever follows. Null until the first one is known. */
  const [entries, setEntries] = useState<ViewerEntry[] | null>(() => (handed ? handed.entries : null));
  /** The post opened from a link is not there any more (deleted, or nothing to show full screen). */
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [visible, setVisible] = useState(startIndex);
  const visibleRef = useRef(startIndex);
  /** 1 while the page on screen is the one the viewer opened on: read by the swipe close on the UI thread. */
  const onStartPage = useSharedValue(1);
  const [commentsKey, setCommentsKey] = useState<string | null>(null);
  /** The comments were opened from the "Add comment…" bar: the sheet comes up with the keyboard. */
  const [commentsTyping, setCommentsTyping] = useState(false);
  const listRef = useRef<FlatList<ViewerEntry>>(null);
  /** The slide each page is on (a post's photos and videos) and what it sits on, as its page reports them. */
  const [shown, setShown] = useState<Record<string, { slide: number; surface: ViewerSurface }>>({});
  const onSlideChange = useCallback(
    (key: string, slide: number, surface: ViewerSurface) => setShown((prev) => (prev[key]?.slide === slide && prev[key]?.surface === surface ? prev : { ...prev, [key]: { slide, surface } })),
    [],
  );
  /** Bumped when the feed starts over (another campus choice): answers to older requests are dropped. */
  const seq = useRef(0);
  const offset = useRef(0);
  const done = useRef(then === "end");
  const busy = useRef(false);
  const feedStarted = useRef(false);

  // Opened from a link, with nothing handed over: fetch the post, its counts and whether it is saved.
  useEffect(() => {
    if (entries !== null) return;
    let alive = true;
    setError(null);
    setGone(false);
    (async () => {
      try {
        const post = await getFeedPost(supabase, id);
        if (!alive) return;
        if (!post) return setGone(true);
        const [engagement, saved] = await Promise.all([getPostEngagement(supabase, "post", id).catch(() => NO_ENGAGEMENT), userId ? isSaved(supabase, userId, "post", id).catch(() => false) : Promise.resolve(false)]);
        if (!alive) return;
        const item = viewerItemFromPost(post, engagement, saved);
        if (item) setEntries([entryOf(item)]);
        else setGone(true);
      } catch (e) {
        if (alive) setError(errorText(e, "Could not load this post. Check your connection and try again."));
      }
    })();
    return () => {
      alive = false;
    };
    // `retry` runs it again after a failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, entries === null, retry, userId]);

  /**
   * The pages after the last one: the next page of the Reels feed (the page opened first is skipped when the feed reaches
   * it), or the opener's next pages. Nothing once that runs dry, or for a list that simply ends.
   */
  const loadMore = useCallback(async () => {
    if (busy.current || done.current || then === "end") return;
    const run = seq.current;
    busy.current = true;
    setLoadingMore(true);
    setMoreError(false);
    try {
      let next: ViewerEntry[];
      if (then === "reels") {
        const page = await listReels(supabase, { universityId: universityRef.current, limit: REELS_PAGE_SIZE, offset: offset.current });
        if (run !== seq.current) return;
        offset.current += REELS_PAGE_SIZE;
        if (page.length < REELS_PAGE_SIZE) done.current = true;
        next = page.map((reel: Reel) => entryOf(viewerItemFromReel(reel)));
      } else {
        const more = listMore.current;
        next = more ? await more() : [];
        if (run !== seq.current) return;
        if (next.length === 0) done.current = true;
      }
      setEntries((prev) => mergeUnique(prev ?? [], next));
    } catch {
      // The row at the bottom offers a retry; reaching the end again does not hammer a dead connection.
      if (run === seq.current) setMoreError(true);
    } finally {
      if (run === seq.current) {
        busy.current = false;
        setLoadingMore(false);
      }
    }
  }, [then]);

  // The other campus choice: the page on screen and the ones already seen stay put (nothing moves under the finger);
  // what comes after them is the new choice's feed, from its start (the Reels feed, or For you's).
  const scopedFor = useRef(universityId);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    if (scopedFor.current === universityId) return;
    scopedFor.current = universityId;
    if (reelsMode && !feedStarted.current) return;
    if (!reelsMode && !rescope) return;
    seq.current += 1;
    busy.current = false;
    done.current = false;
    offset.current = 0;
    setLoadingMore(false);
    setMoreError(false);
    const kept = (entriesRef.current ?? []).slice(0, visibleRef.current + 1);
    if (rescope) listMore.current = rescope(universityId, new Set(kept.map((e) => e.id)));
    setEntries((prev) => (prev ? prev.slice(0, visibleRef.current + 1) : prev));
    void loadMore();
  }, [universityId, reelsMode, rescope, loadMore]);

  // Posts known only by their id (a profile square, a chat card) load a few pages ahead of the finger, and one behind.
  const loadingIds = useRef(new Set<string>());
  useEffect(() => {
    if (!entries) return;
    const want = entries.slice(Math.max(0, visible - 1), visible + LOAD_AHEAD + 1).filter((e) => !e.item && !e.gone && !loadingIds.current.has(e.id));
    if (want.length === 0) return;
    const ids = want.map((e) => e.id);
    ids.forEach((i) => loadingIds.current.add(i));
    loadViewerItems(ids, userId).then(
      async (found) => {
        // The picture standing in stays until the page's own first picture is in memory (a moment at most), so the page
        // that takes its place draws that picture in its very first frame instead of a black one.
        const pictures = Object.values(found).flatMap((item) => (item ? firstPictures(item) : []));
        if (pictures.length > 0) await Promise.race([Image.prefetch(pictures, "memory-disk").catch(() => false), new Promise((resolve) => setTimeout(resolve, PREFETCH_WAIT_MS))]);
        setEntries((prev) => prev?.map((e) => (e.item || !ids.includes(e.id) ? e : found[e.id] ? { ...e, item: found[e.id] } : { ...e, gone: true })) ?? prev);
      },
      () => {
        // Asked again the next time the finger comes this way.
        ids.forEach((i) => loadingIds.current.delete(i));
      },
    );
  }, [entries, visible, userId]);

  // Leaving for another screen (a profile, a chat, login) closes the comments sheet so it never floats over that screen.
  useEffect(() => {
    if (!focused) setCommentsKey(null);
  }, [focused]);

  const onPatch = useCallback((key: string, patch: Partial<Reel>) => {
    setEntries((prev) => (prev ? prev.map((e) => (e.key === key && e.item ? { ...e, item: { ...e.item, ...patch } } : e)) : prev));
    // The row this page was opened from, and its own screen, follow along.
    const [type, targetId] = splitKey(key);
    emitPostEngagement(type, targetId, { likes: patch.likes, comments: patch.comments, likedByMe: patch.likedByMe, saved: patch.savedByMe });
  }, []);
  const onRemoved = useCallback((key: string) => {
    // A feed's own player handed over with it stops: its row is going too, and it is released once given back.
    try {
      entriesRef.current?.find((e) => e.key === key)?.player?.pause();
    } catch {
      // Already released.
    }
    setEntries((prev) => (prev ? prev.filter((e) => e.key !== key) : prev));
    // A post or posted reel is a feed post that For you lists as well; listing tours live only in the Reels feed.
    const [type, targetId] = splitKey(key);
    if (type === "post") {
      emitPostRemoved(targetId);
      markReelsStale();
    }
  }, []);
  const onOpenComments = useCallback((item: ViewerItem, typing = false) => {
    setCommentsTyping(typing);
    setCommentsKey(viewerKey(item));
  }, []);
  const commentsItem = commentsKey ? (entries?.find((e) => e.key === commentsKey)?.item ?? null) : null;
  const onCommentCount = useCallback(
    (delta: number) => {
      if (!commentsKey || !commentsItem) return;
      onPatch(commentsKey, { comments: Math.max(0, commentsItem.comments + delta) });
    },
    [commentsKey, commentsItem, onPatch],
  );

  /**
   * The page the viewer opened on, by its key: its place in the list can shift (a post deleted above it), and the way
   * back (the zoom into the tapped picture, the video handed back) must still be that post's. Opened from a link, the
   * first page.
   */
  const [startKey] = useState<string | null>(() => handed?.entries[startIndex]?.key ?? null);
  const isStartAt = useCallback((i: number) => (startKey ? entriesRef.current?.[i]?.key === startKey : i === startIndex), [startKey, startIndex]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index !== null);
    if (first && first.index !== null) {
      visibleRef.current = first.index;
      onStartPage.value = isStartAt(first.index) ? 1 : 0;
      setVisible(first.index);
    }
  }).current;

  const leave = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/(tabs)")), [router]);

  // The top row: Back and the toggle, under the status bar. A page's own content (a photo) starts below it.
  const rowTop = insets.top + TOP_GAP;
  const contentTop = rowTop + ROW;
  // The comment bar's pill sits this far up from the screen's bottom edge; the name and the rail stay above the bar.
  const barBottom = Math.max(insets.bottom, COMMENT_BAR_BOTTOM);
  const barHeight = barBottom + COMMENT_BAR + COMMENT_BAR_GAP;
  /**
   * What a page shows now: a photo on the theme's own colour ("page"), or a video, a photo as tall as the screen or a
   * page still loading ("media"). As its page reports it, or, before it has, as its slide's recorded shape says.
   */
  const surfaceAt = (index: number): ViewerSurface => {
    const entry = entries?.[index];
    const item = entry?.item;
    if (!entry || !item) return "media";
    const reported = shown[entry.key];
    if (reported) return reported.surface;
    const m = item.media[Math.max(0, Math.min(item.media.length - 1, entry.slide ?? 0))];
    return surfaceOf(m, m ? aspectOf(m) : null, width, height, photoTop(contentTop, item.media.length), photoFloor(height, barHeight));
  };
  /**
   * The page under the top row and the status bar: their colours follow it (dark over a video, the theme's over a
   * photo), changing as a page's edge passes under them rather than when the swipe ends.
   */
  const [under, setUnder] = useState(startIndex);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.max(0, Math.floor((e.nativeEvent.contentOffset.y + rowTop + ROW / 2) / Math.max(height, 1)));
      setUnder((prev) => (prev === i ? prev : i));
    },
    [rowTop, height],
  );

  /*
   * The zoom: the page grows out of the picture that was tapped (its frame on screen, `origin`) to fill the screen, the
   * screen behind fading to the page's colour as it goes (black behind a video, the theme's behind a photo), and shrinks
   * back into it on the way out. Without an origin (a link, a saved row) it opens from a slightly smaller, faded copy of
   * itself in the middle. The page stays full size inside the opening, scaled so its picture matches the tapped one, so
   * what grows is the same picture, never a stretched one. The words, the rail and the buttons fade in once it has opened
   * (ViewerChromeContext) and out before it closes.
   */
  const reduceMotion = useReduceMotion();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [origin] = useState<ViewerOrigin | null>(() => handed?.origin ?? null);
  const fallback = useMemo<ViewerOrigin>(() => ({ x: screenW * 0.06, y: screenH * 0.06, width: screenW * 0.88, height: screenH * 0.88, radius: 28 }), [screenW, screenH]);
  /**
   * The picture on the tapped page that grows out of the tapped one, in page points: a photo sits in its own shape (at
   * the top, see photoLayout), so the page lines up on that photo; a video, on the whole of it, past the page's sides
   * where it fills a tall screen (see wholeVideo): the feed shows a vertical video's full width, so the opening starts on
   * that very picture, at its size, and only then opens up onto the screen's crop. It follows the page's slide, so
   * closing lands on the photo or video showing then.
   */
  const startEntry = (startKey ? entries?.find((e) => e.key === startKey) : entries?.[startIndex]) ?? null;
  const startItem = startEntry?.item ?? null;
  const startSlide = startEntry ? (shown[startEntry.key]?.slide ?? startEntry.slide ?? 0) : 0;
  const focus = useMemo(() => {
    const m = startItem?.media[startSlide];
    if (startItem && m?.type === "video") {
      const v = wholeVideo(aspectOf(m), screenW, screenH);
      return { y: v.top + v.height / 2, width: v.width, height: v.height };
    }
    const aspect = m && m.type === "photo" ? aspectOf(m) : null;
    if (!startItem || aspect === null) return { y: screenH / 2, width: screenW, height: screenH };
    const { place } = photoLayout(aspect, screenW, screenH, photoTop(contentTop, startItem.media.length), photoFloor(screenH, barHeight));
    return { y: place.top + place.height / 2, width: place.width, height: place.height };
  }, [startItem, startSlide, screenW, screenH, contentTop, barHeight]);
  // The post the viewer was opened from keeps its feed row on the same photo as the page (it is hidden behind it), so a
  // swipe back uncovers that photo, and the page lands on it.
  useEffect(() => {
    if (startItem?.sourceType === "post" && startItem.media.length > 1) emitPostSlide(startItem.sourceId, startSlide);
  }, [startItem, startSlide]);
  const focusY = useSharedValue(focus.y);
  const focusW = useSharedValue(focus.width);
  const focusH = useSharedValue(focus.height);
  useEffect(() => {
    focusY.value = focus.y;
    focusW.value = focus.width;
    focusH.value = focus.height;
  }, [focus, focusY, focusW, focusH]);
  /** 0 at the tapped picture (or the faded copy), 1 full screen. */
  const open = useSharedValue(reduceMotion ? 1 : 0);
  /** 1 while the zoom runs to or from the tapped picture, 0 for the faded copy. */
  const toOrigin = useSharedValue(origin ? 1 : 0);
  /** How far the swipe back has pulled the page sideways, in points (either way). */
  const drag = useSharedValue(0);
  const chrome = useSharedValue(reduceMotion ? 1 : 0);
  /**
   * 1 while the page zooms open or closed (see ViewerZoomContext). A shared value, set on the thread each zoom starts
   * on, so what it changes (a carousel's video showing whole) is there in the zoom's very first frame.
   */
  const zoomUI = useSharedValue(reduceMotion ? 0 : 1);
  /** The viewer has started to close (see ViewerClosingContext). */
  const [closingNow, setClosingNow] = useState(false);
  /**
   * The zoom open has finished. Until then only the page opened on has its player and frost: the pages around it get
   * theirs once it has opened, so the first frames draw quickly and the zoom starts (and runs) unhurried.
   */
  const [opened, setOpened] = useState(reduceMotion);
  const zoomOpened = useCallback(() => {
    // Not once a close has begun (it can be handled before this call, queued as the open settled).
    if (closing.current) return;
    setOpened(true);
  }, []);
  // The Reels feed loads as soon as the first page has opened (a new page of reels arriving mid-zoom would only weigh on
  // it), so the first swipe up has somewhere to go. A list's next pages wait until its end comes near (onEndReached).
  useEffect(() => {
    if (!reelsMode || entries === null || feedStarted.current || !opened) return;
    feedStarted.current = true;
    void loadMore();
  }, [reelsMode, entries, loadMore, opened]);
  /** The list's end came near while the page was still zooming open: its next pages load once it has. */
  const endPending = useRef(false);
  useEffect(() => {
    if (!opened || !endPending.current) return;
    endPending.current = false;
    void loadMore();
  }, [opened, loadMore]);
  /**
   * Whether the page can be seen at all (1) or not (0). Opened from a picture, it waits unseen until the zoom starts
   * (the screen still shows the tapped picture itself, the feed's own), which is once it has drawn that picture
   * (onStartShown): the zoom never opens on a black frame or a photo still fading in. A moment at most: PICTURE_WAIT_MS.
   * Unseen again by the time the zoom closed lands: faded out over the feed's own picture in its last moment (HAND_OVER_MS).
   */
  const seen = useSharedValue(reduceMotion || origin === null ? 1 : 0);
  const zoomStarted = useRef(reduceMotion);
  const startZoom = useCallback(() => {
    if (zoomStarted.current) return;
    zoomStarted.current = true;
    seen.value = 1;
    open.value = withSpring(1, ZOOM_IN, (finished) => {
      if (!finished) return;
      zoomUI.value = 0;
      runOnJS(zoomOpened)();
    });
    chrome.value = withDelay(170, withTiming(1, { duration: 200 }));
  }, [seen, open, chrome, zoomUI, zoomOpened]);
  useEffect(() => {
    if (reduceMotion) return;
    // Without a picture to open from, a frame after the page is first drawn: it fades in from a smaller copy of itself.
    if (origin === null) {
      const frame = requestAnimationFrame(startZoom);
      return () => cancelAnimationFrame(frame);
    }
    const wait = setTimeout(startZoom, PICTURE_WAIT_MS);
    return () => clearTimeout(wait);
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** The page the viewer opened on has drawn its picture: the zoom starts from it on the next frame. */
  const onStartShown = useCallback(() => {
    requestAnimationFrame(startZoom);
  }, [startZoom]);
  /**
   * Pages that stood in with their post's picture while it loaded (a grid square, a chat card): that picture stays over
   * the page, the same view all along, until the page has drawn its own (`drawnPages`), so the swap never shows a frame
   * of neither. A new image view takes a frame to draw even an image already in memory.
   */
  const stoodIn = useRef(new Set<string>());
  const [drawnPages, setDrawnPages] = useState<ReadonlySet<string>>(() => new Set());
  const onPageDrawn = useCallback((key: string) => setDrawnPages((prev) => (prev.has(key) ? prev : new Set(prev).add(key))), []);
  /**
   * Where the opening starts (and lands): the tapped picture, less what a floating bar of the feed covers of it (see
   * OpeningBand). The bar stays drawn over that part, as it was, and the opening grows over it; a corner cut by a bar is
   * square. The page inside still lines up on the whole picture.
   */
  const opening = useMemo(() => {
    if (!origin) return null;
    const top = Math.max(origin.y, origin.clip?.top ?? -Infinity);
    const bottom = Math.min(origin.y + origin.height, origin.clip?.bottom ?? Infinity);
    if (!(bottom - top > 1)) return { x: origin.x, y: origin.y, width: origin.width, height: origin.height, topRadius: origin.radius, bottomRadius: origin.radius };
    return {
      x: origin.x,
      y: top,
      width: origin.width,
      height: bottom - top,
      topRadius: top > origin.y + 0.5 ? 0 : origin.radius,
      bottomRadius: bottom < origin.y + origin.height - 0.5 ? 0 : origin.radius,
    };
  }, [origin]);
  const frameStyle = useAnimatedStyle(() => {
    const t = open.value;
    const zoomed = toOrigin.value === 1 && opening !== null;
    const from = zoomed ? opening! : { ...fallback, topRadius: fallback.radius, bottomRadius: fallback.radius };
    const pulled = Math.min(Math.abs(drag.value) / screenW, 1);
    const pullRadius = Math.min(pulled * 5, 1) * PULL_RADIUS;
    const topRadius = from.topRadius * (1 - t) + pullRadius;
    const bottomRadius = from.bottomRadius * (1 - t) + pullRadius;
    // Its edges on whole pixels, where layout would round them anyway, and the page inside is placed from these very edges
    // (see pageStyle): rounded behind its back, the opening would nudge the picture up to half a pixel either way each
    // frame, a jitter that shows as shimmer while it moves slowly.
    const left = onPixel(from.x * (1 - t));
    const top = onPixel(from.y * (1 - t));
    return {
      left,
      top,
      width: onPixel(from.x * (1 - t) + from.width + (screenW - from.width) * t) - left,
      height: onPixel(from.y * (1 - t) + from.height + (screenH - from.height) * t) - top,
      borderTopLeftRadius: topRadius,
      borderTopRightRadius: topRadius,
      borderBottomLeftRadius: bottomRadius,
      borderBottomRightRadius: bottomRadius,
      opacity: (zoomed ? 1 : t) * seen.value,
      transform: [{ translateX: drag.value }, { scale: 1 - pulled * PULL_SHRINK }],
    };
  });
  const pageStyle = useAnimatedStyle(() => {
    const t = open.value;
    const zoomed = toOrigin.value === 1 && origin !== null && opening !== null;
    // The picture's frame on screen, and the opening's (the same, unless a bar covers part of the picture).
    const from = zoomed ? origin! : fallback;
    const frame = zoomed ? opening! : fallback;
    // At the start the page's picture covers the tapped one, centred on it, so it keeps its size and crop while the
    // opening grows round it; at the end the page is the screen. A photo at the top of its page is that picture.
    const fw = zoomed ? focusW.value : screenW;
    const fh = zoomed ? focusH.value : screenH;
    const fy = zoomed ? focusY.value : screenH / 2;
    const start = Math.max(from.width / fw, from.height / fh);
    const scale = start + (1 - start) * t;
    const anchor = fy + (screenH / 2 - fy) * t;
    // The page's point `anchor` sits on the middle of the picture's frame as it grows to the screen, measured from the
    // opening's corner (the page's own origin), on its pixel as frameStyle puts it.
    const midX = (from.x + from.width / 2) * (1 - t) + (screenW / 2) * t - onPixel(frame.x * (1 - t));
    const midY = (from.y + from.height / 2) * (1 - t) + (screenH / 2) * t - onPixel(frame.y * (1 - t));
    return { transform: [{ translateX: midX - screenW / 2 }, { translateY: midY - screenH / 2 - scale * (anchor - screenH / 2) }, { scale }] };
  });
  // A page pulled sideways uncovers the screen it was opened from, and sheds its words and buttons on the way.
  const backdropStyle = useAnimatedStyle(() => ({ opacity: open.value * (1 - Math.min((Math.abs(drag.value) / screenW) * 1.8, 1)) }));
  const chromeShown = useDerivedValue(() => chrome.value * (1 - Math.min(Math.abs(drag.value) / (screenW * 0.25), 1)));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeShown.value }));

  /** How far each page's videos have got (see ViewerClockContext), by "key#slide". */
  const clocks = useRef(new Map<string, () => number>());
  const clockApi = useMemo<ViewerClocks>(
    () => ({
      set: (key, slide, read) => {
        if (read) clocks.current.set(`${key}#${slide}`, read);
        else clocks.current.delete(`${key}#${slide}`);
      },
    }),
    [],
  );
  /**
   * As the viewer closes, the post it was opened from takes its video back in step. The feed's own player (iOS) is the
   * very one playing here: it only has to be running, so it is moving as it shrinks back (or as the page it hides behind
   * fades) rather than frozen until the viewer has gone; no time goes back, which could only make it seek. A video the
   * viewer played with its own player hands back the time it has got to instead, and the row goes on from there.
   */
  const handBack = useCallback(() => {
    if (!startEntry || !startItem) return;
    const borrowed = startEntry.player;
    // Only while the page (and so the row, which follows it) is still on the slide that player is for: moved on to another
    // of the post's slides, that one is what goes back, with the time its video has got to.
    const borrowedSlide = Math.max(0, Math.min(startItem.media.length - 1, startEntry.slide ?? 0));
    if (borrowed && startSlide === borrowedSlide) {
      try {
        // With the sound as it is now: a sound change made while no page held it never reached it.
        if (borrowed.muted !== videosMuted()) borrowed.muted = videosMuted();
        if (!borrowed.playing) borrowed.play();
      } catch {
        // Released by its row in the meantime: nothing to hand back.
      }
      return;
    }
    if (startItem.sourceType !== "post") return;
    const time = clocks.current.get(`${startEntry.key}#${startSlide}`)?.();
    if (typeof time === "number" && Number.isFinite(time)) emitPostSlide(startItem.sourceId, startSlide, time);
  }, [startEntry, startItem, startSlide]);

  /**
   * Leaves once the page is out of sight. The zoom closed lands exactly on the tapped picture, which the feed is still
   * drawing live underneath, and the page has faded out over it in the zoom's last moment (`seen`, HAND_OVER_MS), so
   * nothing visible changes. Only two frames later (the hidden page surely on screen by then, not just set) does the
   * viewer really go: the copy of the screen that react-native-screens keeps up while a modal goes away is then
   * see-through, and the feed's video plays on in it instead of a frozen frame that then skips ahead.
   */
  const afterLanding = useCallback((go: () => void) => {
    requestAnimationFrame(() => requestAnimationFrame(() => go()));
  }, []);

  /** Zooms closed (into the tapped picture when that page is still the one on screen), then runs `done`. */
  const closing = useRef(false);
  /** The same, set on whichever thread a close starts: the swipe's starts on the UI thread (see swipeClose). */
  const closingUI = useSharedValue(0);
  const closeThen = useCallback(
    (done: () => void) => {
      if (closing.current || closingUI.value) return;
      closing.current = true;
      closingUI.value = 1;
      // A zoom open still waiting for its picture never starts now: it would undo this one.
      zoomStarted.current = true;
      handBack();
      setClosingNow(true);
      const land = () => afterLanding(done);
      if (reduceMotion) {
        // The backdrop goes with the page: the feed is what shows, not a frame of the page's colour.
        seen.value = 0;
        open.value = 0;
        return land();
      }
      zoomUI.value = 1;
      const home = origin !== null && isStartAt(visibleRef.current);
      toOrigin.value = home ? 1 : 0;
      chrome.value = withTiming(0, { duration: 110 });
      drag.value = withTiming(0, { duration: ZOOM_OUT_MS });
      open.value = withTiming(0, { duration: ZOOM_OUT_MS, easing: Easing.bezier(...ZOOM_OUT_CURVE) }, (finished) => {
        if (!finished) return;
        seen.value = 0;
        runOnJS(land)();
      });
      // Onto the tapped picture, the feed's own takes over in the last moment (anywhere else the page fades out as it goes).
      if (home) seen.value = withDelay(ZOOM_OUT_MS - HAND_OVER_MS, withTiming(0, HAND_OVER));
    },
    [reduceMotion, origin, isStartAt, toOrigin, chrome, drag, open, seen, zoomUI, handBack, afterLanding],
  );
  // Every way out (Back, a link elsewhere, Android's back button) zooms closed first, then really leaves.
  const navigation = useNavigation();
  const leaving = useRef(false);
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (e) => {
        if (leaving.current) return;
        e.preventDefault();
        closeThen(() => {
          // A swipe close that began in the same moment may have left already.
          if (leaving.current) return;
          leaving.current = true;
          navigation.dispatch(e.data.action);
        });
      }),
    [navigation, closeThen],
  );
  /** The JS half of a swipe close: the video goes back to the feed playing, and the pages learn the viewer is closing. */
  const swipeClosing = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    zoomStarted.current = true;
    handBack();
    setClosingNow(true);
  }, [handBack]);
  const swipeLeave = useCallback(
    () =>
      afterLanding(() => {
        if (leaving.current) return;
        leaving.current = true;
        leave();
      }),
    [afterLanding, leave],
  );
  const hasOrigin = origin !== null;
  /**
   * The swipe back (see usePageSwipe): the modal has no system back swipe, so each page pulls itself sideways with the
   * finger, either way. Let go past the point of no return, it goes on from where the finger left it: the page it was
   * opened on shrinks back into the post it was opened from, which is right where it was in the feed; any other page goes
   * on out the way it was swiped, fading; then the viewer really leaves. A worklet, run by the swipe on the UI thread the
   * moment the finger lets go, so the page carries on with no pause whatever the JS thread is doing; only what JS has to
   * do waits for it.
   */
  const swipeClose = useCallback(
    (velocityX: number) => {
      "worklet";
      if (closingUI.value) return;
      closingUI.value = 1;
      runOnJS(swipeClosing)();
      if (reduceMotion) {
        seen.value = 0;
        open.value = 0;
        runOnJS(swipeLeave)();
        return;
      }
      zoomUI.value = 1;
      const home = hasOrigin && onStartPage.value === 1;
      toOrigin.value = home ? 1 : 0;
      chrome.value = withTiming(0, { duration: 110 });
      const easing = Easing.bezier(...ZOOM_OUT_CURVE);
      const away = Math.sign(drag.value || velocityX || 1) * screenW;
      drag.value = withTiming(home ? 0 : away, { duration: ZOOM_OUT_MS, easing });
      open.value = withTiming(0, { duration: ZOOM_OUT_MS, easing }, (finished) => {
        if (!finished) return;
        seen.value = 0;
        runOnJS(swipeLeave)();
      });
      if (home) seen.value = withDelay(ZOOM_OUT_MS - HAND_OVER_MS, withTiming(0, HAND_OVER));
    },
    [closingUI, swipeClosing, reduceMotion, seen, zoomUI, swipeLeave, hasOrigin, onStartPage, toOrigin, chrome, drag, screenW, open],
  );
  const swipeBack = useMemo<ViewerSwipe>(() => ({ drag, close: swipeClose }), [drag, swipeClose]);

  // Campus (when the person has a university) and Global; one choice alone is no toggle. Only the campus is chosen here:
  // Following belongs to Posts and is left as it is. Only for the Reels feed and For you: a list (a profile's posts) is what it is.
  const segments = campusSegments(profile);
  const chosen: ScopeSegment["key"] = profile?.university_id && scope.campus === "mine" ? "mine" : "all";
  function choose(key: ScopeSegment["key"]) {
    if (key === chosen || key === "following") return;
    setScope({ campus: key });
    hapticTap();
  }

  // The sound button sits centred in the top row, at the other end from Back.
  const muteInset = rowTop + (ROW - MUTE_SIZE) / 2 - MUTE_OFFSET;

  // Everything the pages read besides their own entry: a change re-renders them.
  const listExtra = useMemo(() => ({ visible, focused, opened, closingNow, drawnPages, height, width, muteInset, contentTop, barBottom, shown }), [visible, focused, opened, closingNow, drawnPages, height, width, muteInset, contentTop, barBottom, shown]);
  /** The top row and the status bar take the colours of the page under them; the screen behind, those of the page on screen. */
  const topOnPage = surfaceAt(under) === "page";
  /**
   * The top row's light style, over a photo's white page only. In dark mode every page is black behind it, so it keeps
   * one style throughout and never changes under the finger.
   */
  const lightTop = topOnPage && !isDark;
  const shownOnPage = surfaceAt(visible) === "page";

  let body = null;
  if (height > 0 && entries && entries.length > 0) {
    body = (
      <FlatList
        ref={listRef}
        data={entries}
        // Not trimmed to its pages: the zoom's opening is what trims them, so it can open on a whole video (see wholeVideo).
        style={{ width, height, overflow: "visible" }}
        keyExtractor={(e) => e.key}
        initialScrollIndex={Math.min(startIndex, entries.length - 1)}
        renderItem={({ item: entry, index }) => {
          if (!entry.item) stoodIn.current.add(entry.key);
          const standing = !entry.item || (stoodIn.current.has(entry.key) && !drawnPages.has(entry.key));
          return (
            <View style={{ width, height }}>
              {entry.item ? (
                <>
                  <ReelItem
                    key="page"
                    reel={entry.item}
                    width={width}
                    height={height}
                    topInset={muteInset}
                    contentTop={contentTop}
                    bottomInset={barHeight}
                    near={index === visible || (opened && index - visible >= -1 && index - visible <= 2)}
                    playing={focused && index === visible && !(closingNow && !isStartAt(index))}
                    onPatch={onPatch}
                    onOpenComments={onOpenComments}
                    onRemoved={onRemoved}
                    initialSlide={entry.slide}
                    startAt={entry.startAt}
                    borrowed={entry.player}
                    onSlideChange={onSlideChange}
                    onShown={isStartAt(index) ? onStartShown : undefined}
                    onDrawn={stoodIn.current.has(entry.key) ? onPageDrawn : undefined}
                    standIn={stoodIn.current.has(entry.key) ? (entry.thumb ?? undefined) : undefined}
                    pictures={opened || index === visible}
                  />
                  {/* "Add comment…" under the name and the rail, like Instagram's: a tap opens the comments with the keyboard up.
                      Dark glass over a video; on a photo's page, the theme's own text field. */}
                  <Animated.View key="comment" pointerEvents="box-none" style={[styles.commentBar, { bottom: barBottom }, chromeStyle]}>
                    <Pressable onPress={() => onOpenComments(entry.item!, true)} style={({ pressed }) => [styles.commentInput, surfaceAt(index) === "page" && styles.commentInputPage, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Add comment" accessibilityHint="Opens the comments, ready to type">
                      <Text style={[styles.commentPlaceholder, surfaceAt(index) === "page" && styles.commentPlaceholderPage]}>Add comment…</Text>
                    </Pressable>
                  </Animated.View>
                </>
              ) : null}
              {standing ? <PendingPage key="stand-in" entry={entry} width={width} height={height} over={Boolean(entry.item)} pictures={opened || index === visible} onShown={isStartAt(index) ? onStartShown : undefined} giveWay={() => onPageDrawn(entry.key)} /> : null}
            </View>
          );
        }}
        extraData={listExtra}
        pagingEnabled
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
        // Two pages ahead are laid out (and their videos loaded, see `near`) before a swipe reaches them: a quick run of
        // swipes never lands on an empty page or a video still starting.
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReached={() => {
          if (moreError) return;
          if (opened) void loadMore();
          else endPending.current = true;
        }}
        onEndReachedThreshold={2}
        scrollsToTop={false}
      />
    );
  } else if (entries && entries.length === 0) {
    // The only page here was deleted.
    body = (
      <View style={styles.centered}>
        <Icon name="film-outline" size={48} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>Nothing more to see</Text>
        <Pressable onPress={leave} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  } else if (gone) {
    body = (
      <View style={styles.centered}>
        <Icon name="film-outline" size={48} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>This post is no longer available</Text>
        <Pressable onPress={leave} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.centered}>
        <Icon name="cloud-offline-outline" size={44} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>The post did not load</Text>
        <Text style={styles.stateBody}>{error}</Text>
        <Pressable onPress={() => setRetry((n) => n + 1)} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.onMedia} size="large" />
      </View>
    );
  }

  const onLast = entries !== null && visible >= entries.length - 1;
  return (
    <GestureHandlerRootView style={styles.fill}>
    {/* The viewer's own share sheet: iOS presents a sheet from the screen on top, and the one in the root layout sits under
        this modal screen, where it could never appear. */}
    <ShareSheetProvider>
      <ViewerStatusBar open={open} style={topOnPage && !isDark ? "dark" : "light"} show={focused} />
      {/* The screen behind fades to the page's colour as the page opens over it: black behind a video, the theme's behind a photo. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, shownOnPage && styles.backdropPage, backdropStyle]} />
      {/* The opening the page grows through, and the full-size page inside it. */}
      <Animated.View style={[styles.opening, frameStyle]}>
        <Animated.View style={[{ width: screenW, height: screenH }, pageStyle]}>
    <ViewerChromeContext.Provider value={chromeShown}>
    <ViewerZoomContext.Provider value={zoomUI}>
    <ViewerClosingContext.Provider value={closingNow}>
    <ViewerSwipeContext.Provider value={swipeBack}>
    <ViewerClockContext.Provider value={clockApi}>
    <View style={[styles.root, shownOnPage && styles.rootPage]} onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}>
      {body}

      {/* One row floating over the picture: Back at the left, the toggle in the middle; touches between them go through to the page. */}
      <Animated.View pointerEvents="box-none" style={[styles.top, { paddingTop: rowTop }, chromeStyle]}>
        <View pointerEvents="box-none" style={styles.row}>
          {/* Back on clear glass over a video, as the system draws its bar buttons over media; over a photo's page, the bar's own glass. */}
          <GlassIconButton icon="chevron-back" label="Back" onPress={leave} variant={lightTop ? "bar" : "media"} size={40} iconSize={19} haptic={false} hitSlop={8} style={styles.back} />
          {scoped && segments.length > 1 ? <ScopeToggle segments={segments} value={chosen} onChange={choose} overVideo={!lightTop} shadow={lightTop ? undefined : styles.shadow} /> : null}
        </View>
      </Animated.View>

      {loadingMore && onLast ? (
        <View style={[styles.foot, { bottom: barHeight + 6 }]} pointerEvents="none">
          <ActivityIndicator color={shownOnPage ? colors.muted : colors.onMedia} />
        </View>
      ) : moreError && onLast ? (
        <View style={[styles.foot, { bottom: barHeight + 6 }]} pointerEvents="box-none">
          <Pressable onPress={() => void loadMore()} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>Could not load more. Tap to try again.</Text>
          </Pressable>
        </View>
      ) : null}

      <ReelCommentsSheet reel={commentsItem} focusComposer={commentsTyping} onClose={() => setCommentsKey(null)} onCountChange={onCommentCount} />
    </View>
    </ViewerClockContext.Provider>
    </ViewerSwipeContext.Provider>
    </ViewerClosingContext.Provider>
    </ViewerZoomContext.Provider>
    </ViewerChromeContext.Provider>
        </Animated.View>
      </Animated.View>
    </ShareSheetProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The viewer's status bar style, taken once the page covers most of the screen and given back as it closes (half way):
 * on its own, so the switch half way through a zoom redraws only this, never the pages.
 */
function ViewerStatusBar({ open, style, show }: { open: SharedValue<number>; style: "light" | "dark"; show: boolean }) {
  const [taken, setTaken] = useState(() => open.value > 0.5);
  useAnimatedReaction(
    () => open.value > 0.5,
    (now, was) => {
      if (now !== was) runOnJS(setTaken)(now);
    },
  );
  return show && taken ? <StatusBar style={style} /> : null;
}

/** A page whose post is still loading (its picture stands in, under a spinner), or one that has been deleted since. It swipes back too. */
function PendingPage({ entry, width, height, over, pictures = true, onShown, giveWay }: { entry: ViewerEntry; width: number; height: number; over?: boolean; pictures?: boolean; onShown?: () => void; giveWay?: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const { gesture: swipe } = usePageSwipe(width, null);
  // The picture standing in is the one tapped (already loaded): the zoom opens on it as soon as it is drawn, or at once
  // with none to wait for.
  const hasThumb = Boolean(entry.thumb);
  useEffect(() => {
    if (!hasThumb) onShown?.();
  }, [hasThumb, onShown]);
  // Over the loaded page, waiting for its picture: never for long (a picture that will not load leaves the page usable).
  const giveWayRef = useRef(giveWay);
  giveWayRef.current = giveWay;
  useEffect(() => {
    if (!over) return;
    const wait = setTimeout(() => giveWayRef.current?.(), STAND_IN_MAX_MS);
    return () => clearTimeout(wait);
  }, [over]);
  return (
    <GestureDetector gesture={swipe}>
    <View pointerEvents={over ? "none" : "auto"} style={[{ width, height, backgroundColor: colors.mediaBg }, over && StyleSheet.absoluteFill]}>
      {entry.thumb && pictures ? <Image source={{ uri: entry.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={entry.gone ? 30 : 0} transition={0} onDisplay={onShown} /> : null}
      <View style={[StyleSheet.absoluteFill, styles.pendingDim]} />
      <View style={styles.centered}>
        {entry.gone ? (
          <>
            <Icon name="eye-off-outline" size={40} color={colors.onMediaMuted} />
            <Text style={styles.stateTitle}>This post is no longer available</Text>
          </>
        ) : (
          <ActivityIndicator color={colors.onMedia} size="large" />
        )}
      </View>
    </View>
    </GestureDetector>
  );
}

/**
 * Over video, the media colours (light text, dark scrims) in both themes; over a photo's page (the `…Page` styles), the
 * theme's own colours.
 */
const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.mediaBg },
  rootPage: { backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  stateTitle: { color: colors.onMedia, ...textStyle.title3, marginTop: 6, textAlign: "center" },
  stateBody: { color: colors.onMediaMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  stateButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora), borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 12 },
  stateButtonText: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
  top: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  // The toggle is centred on the screen; Back keeps to the left edge, level with it.
  row: { height: ROW, alignItems: "center", justifyContent: "center" },
  back: { position: "absolute", left: 12, top: (ROW - 40) / 2 },
  // A dark, see-through pill in the screen's gutters, the same in both themes since it sits on video.
  commentBar: { position: "absolute", left: 0, right: 0, paddingHorizontal: 16 },
  commentInput: { height: COMMENT_BAR, borderRadius: 999, justifyContent: "center", paddingHorizontal: 20, backgroundColor: colors.mediaPill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.onMediaMuted },
  commentPlaceholder: { color: colors.onMediaMuted, fontSize: 16 },
  commentInputPage: { backgroundColor: colors.input, borderColor: colors.border },
  commentPlaceholderPage: { color: colors.faint },
  shadow: { textShadowColor: colors.mediaScrim, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  foot: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  retry: { backgroundColor: colors.mediaPill, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: colors.onMedia, fontSize: 13, fontWeight: "700" },
  pendingDim: { backgroundColor: "rgba(0,0,0,0.35)" },
  fill: { flex: 1 },
  backdrop: { backgroundColor: colors.mediaBg },
  backdropPage: { backgroundColor: colors.bg },
  // Clips the page to the growing frame, with the tapped picture's rounded corners at the start.
  opening: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
}));

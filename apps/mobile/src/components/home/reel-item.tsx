import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated, { cancelAnimation, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { APP_NAME, deleteFeedPost, getFeedPost, getOrCreateDirectConversation, likePost, reelPath, reportContent, REPORT_REASONS, setPostPinned, sharedPostPath, toggleSaved, unlikePost, type FeedMedia, type Reel, type ReportReason } from "@apartment-book/shared";
import { hapticLike, hapticSelect, hapticTap, alertWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { emitPostPinned, onPostPinned } from "@/lib/posts-events";
import { asViewerItem, viewerThumb, type ViewerItem } from "@/lib/reel-viewer";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useActionSheet } from "../action-sheet";
import { useShareSheet } from "../share-sheet";
import { Icon, useBounceOn } from "@/components/icon";
import { ProgressiveBlur } from "@/components/progressive-blur";
import { ViewerChromeContext } from "@/lib/viewer-chrome";
import { usePageSwipe, type PageSlides } from "@/lib/viewer-swipe";

/** Sound is one switch for the whole Reels feed (starts muted, like every other feed video in the app). */
let reelsMuted = true;
const muteListeners = new Set<() => void>();
function setReelsMuted(next: boolean) {
  reelsMuted = next;
  muteListeners.forEach((l) => l());
}
function subscribeMuted(listener: () => void) {
  muteListeners.add(listener);
  return () => {
    muteListeners.delete(listener);
  };
}
function useReelsMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, () => reelsMuted, () => reelsMuted);
}

/**
 * The shades over a reel are true gradients of a media colour (the same in both themes), each stop that colour at a
 * share of its strength along an eased ramp, so nothing bands even on a blown-out white frame. `share(t)` runs top (0)
 * to bottom (1).
 */
function scrimGradient(scrim: string, share: (t: number) => number, stops = 10): string {
  const m = /rgba?\(([^)]+)\)/.exec(scrim);
  const [r = "0", g = "0", b = "0", a = "1"] = m ? m[1]!.split(",").map((x) => x.trim()) : [];
  const list = Array.from({ length: stops + 1 }, (_, i) => {
    const t = i / stops;
    return `rgba(${r},${g},${b},${(Number(a) * share(t)).toFixed(3)}) ${(t * 100).toFixed(1)}%`;
  });
  return `linear-gradient(to bottom, ${list.join(", ")})`;
}
/** Bottom shade: from nothing at its top edge, already a light tint behind the rail's first counts, nearly the full scrim at the bottom. */
const bottomShare = (t: number) => 0.96 * Math.pow(t, 0.7);
/**
 * Top shade: holds nearly its full strength behind whatever is drawn over the top (Home's wordmark and tabs, the
 * viewer's row), then eases out below it, so the dimmed tab names stay readable even on a blown-out white frame.
 */
const topShare = (t: number) => {
  const x = Math.min(Math.max((t - 0.42) / 0.58, 0), 1);
  return 0.92 * (1 - x * x * (3 - 2 * x));
};
const TOP_SHADE_MIN = 170;
const TOP_SHADE_EXTRA = 96;
/** Tall enough to sit under the whole rail (like, comments, share, save, "…") with room to fade in above the like. */
const SHADE_HEIGHT = 540;
/** How far above the bottom inset (the comment bar or the tab bar) the frosted blur reaches: past the name and the words. */
const BLUR_REACH = 230;
/** The overlay's own bottom padding: the "…" centre 46pt above the bottom inset, Instagram's geometry. */
const OVERLAY_PAD = 31;
/**
 * What a photo on its page leaves free above the bottom inset for the words: the overlay's padding, the name and a line
 * of words, and a little air between the photo and the name. A photo too tall to leave it is shown full screen instead.
 */
const WORDS_ROOM = OVERLAY_PAD + 64;
/** An opened description on a photo's page reads on the page's own colour, which fades in this far above it. */
const UNDERLAY_FADE = 28;
/** The sound button sits this far above the play button's centre, Instagram style: its 44pt disc, then a gap. */
const SOUND_ABOVE = 44 + 26;
/**
 * Under the row drawn over a page's top (Back, the toggle): a lone photo starts PHOTO_GAP below it; a carousel's dots get
 * a line of their own first (DOTS_LINE tall, the dots DOTS_TOP down it), and its photos start under that.
 */
const PHOTO_GAP = 6;
const DOTS_LINE = 22;
const DOTS_TOP = 8;

/** How long "…" waits for your reel's pin state when the read-ahead has not answered yet. */
const PIN_READ_WAIT_MS = 1200;

export const reelKey = (reel: Pick<Reel, "sourceType" | "sourceId">) => `${reel.sourceType}:${reel.sourceId}`;

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

type Props = {
  /** A reel from the Reels feed, or a page of the viewer (a reel, or a post with its photos and videos). */
  reel: Reel | ViewerItem;
  width: number;
  height: number;
  topInset: number;
  /** How much of the page's bottom the floating bar covers: the caption and the rail sit above it. */
  bottomInset: number;
  /** Within one of the visible reel: worth mounting a player so it is ready to go. */
  near: boolean;
  /** This is the visible reel and the Reels section is on screen. */
  playing: boolean;
  onPatch: (key: string, patch: Partial<Reel>) => void;
  onOpenComments: (reel: ViewerItem) => void;
  onRemoved: (key: string) => void;
  /** For a post with several photos or videos: the one to start on. */
  initialSlide?: number;
  /** Where the page's own content may start: the bottom of the row drawn over its top. A photo sits below it, whole. */
  contentTop?: number;
  /** The slide on screen changed, or what it sits on did (and once at the start): the screen's own chrome follows it. */
  onSlideChange?: (key: string, slide: number, surface: ViewerSurface) => void;
};

/**
 * One full-screen page: a reel's video, or a post's photos and videos swiped sideways (dots show where you are), under
 * the same overlay for every page: the creator's name and words, and the rail (like, comments, share, save, "…"). A
 * video fills the screen and plays while its page (and its slide) is on screen; a tap pauses it. A photo sits whole at
 * the top, as wide as the screen, on the theme's own colour, with the words below it in the theme's ink and each of the
 * rail's buttons white over the photo or inked over the page (see ViewerSurface, photoLayout); one too tall to leave the
 * words their space is shown full screen like a video. A double tap anywhere likes.
 */
export const ReelItem = memo(function ReelItem({ reel: source, width, height, topInset, bottomInset, near, playing, onPatch, onOpenComments, onRemoved, initialSlide = 0, contentTop = topInset + 54, onSlideChange }: Props) {
  const reel = useMemo(() => asViewerItem(source), [source]);
  const { user } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const muted = useReelsMuted();
  const colors = useColors();
  const styles = useStyles();
  const [userPaused, setUserPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  /** The rail heart's pop (scale) and the big heart a double tap flashes over the video, like Instagram. */
  const pop = useRef(new Animated.Value(1)).current;
  const bigHeart = useRef(new Animated.Value(0)).current;
  const popAnim = useRef<Animated.CompositeAnimation | null>(null);
  const burstAnim = useRef<Animated.CompositeAnimation | null>(null);
  /** Single tap pauses, double tap likes: the pause waits a beat to see whether a second tap follows. */
  const lastTap = useRef(0);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (pendingTap.current && clearTimeout(pendingTap.current)), []);

  const key = reelKey(reel);
  const own = user?.id === reel.author.id;
  const isTour = reel.sourceType !== "post";
  /** What the menus and alerts call it. */
  const noun = isTour || reel.kind === "reel" ? "reel" : "post";
  const media = reel.media;
  /** One video and nothing else (every reel): drawn on its own, as before; anything else goes through the sideways pager. */
  const single = media.length === 1 && media[0]!.type === "video" ? (media[0] as Extract<FeedMedia, { type: "video" }>) : null;
  /** The slide on screen, for a post with several photos or videos. */
  const [slide, setSlide] = useState(() => Math.max(0, Math.min(media.length - 1, initialSlide)));
  const slideIsVideo = media[slide]?.type === "video";
  /**
   * A post with several photos or videos: its slides sit side by side on a strip that the page's swipe moves (see
   * usePageSwipe). `settled` is the slide the strip last came to rest on: its video plays, and players wait beside it.
   */
  const pager = media.length > 1;
  const stripPos = useSharedValue(-slide * width);
  const [settled, setSettled] = useState(slide);
  // Halfway through a swipe the page takes the slide coming in (its dots, its colours), as iOS's page dots do.
  useAnimatedReaction(
    () => Math.max(0, Math.min(media.length - 1, Math.round(-stripPos.value / Math.max(width, 1)))),
    (i, prev) => {
      if (prev !== null && i !== prev) runOnJS(setSlide)(i);
    },
    [media.length, width],
  );
  // A new width (the phone turned) keeps the strip on its slide.
  useEffect(() => {
    cancelAnimation(stripPos);
    stripPos.value = -settled * width;
  }, [width, settled, stripPos]);
  /** VoiceOver's swipe up or down on a slide: the next one or the previous one. */
  const goTo = useCallback(
    (i: number) => {
      const target = Math.max(0, Math.min(media.length - 1, i));
      stripPos.value = withTiming(-target * width, { duration: 260 }, (finished) => {
        if (finished) runOnJS(setSettled)(target);
      });
    },
    [media.length, width, stripPos],
  );
  const slides = useMemo<PageSlides | null>(() => (pager ? { count: media.length, pos: stripPos, onLand: setSettled } : null), [pager, media.length, stripPos]);
  /** Sideways: the carousel, then back to where the viewer was opened from (only in the viewer). */
  const { gesture: swipe, swipedJustNow } = usePageSwipe(width, slides);
  /** A tap on the page that ends a swipe is part of the swipe: it neither pauses, likes, nor opens anything. */
  const unlessSwiped = (act: () => void) => () => {
    if (!swipedJustNow()) act();
  };
  /** Where the overlay (the words and the rail) sits on the page, and the words and the rail within it, as laid out. */
  const [overlayTop, setOverlayTop] = useState(0);
  const [infoTop, setInfoTop] = useState(0);
  const [railBox, setRailBox] = useState({ y: 0, height: 0 });
  const railTop = railBox.y;
  /** Photos uploaded without their size: measured as they load, so each still sits in its own shape. */
  const [aspects, setAspects] = useState<Record<number, number>>({});
  const onAspect = useCallback((i: number, aspect: number) => setAspects((prev) => (prev[i] === aspect ? prev : { ...prev, [i]: aspect })), []);
  const aspectAt = (i: number): number | null => {
    const m = media[i];
    return m ? (aspectOf(m) ?? aspects[i] ?? null) : null;
  };
  const photoAt = photoTop(contentTop, media.length);
  const floor = photoFloor(height, bottomInset);
  /** A photo on its page: the theme's colours. A video, or a photo too tall for a page: dark, white words over shades. */
  const surface = surfaceOf(media[slide], aspectAt(slide), width, height, photoAt, floor);
  const onPage = surface === "page";
  // The screen's own chrome (its top row, the comment bar, the status bar) follows the slide on screen.
  useEffect(() => {
    onSlideChange?.(key, slide, surface);
  }, [onSlideChange, key, slide, surface]);
  /** Collapsed, the description is one line like Instagram's. Whether it was cut is measured, not guessed (see onTextLayout). */
  const oneLine = [reel.title, reel.caption].filter(Boolean).join(" · ");
  const [clipped, setClipped] = useState(false);
  const canExpand = clipped || oneLine.includes("\n");
  const poster = viewerThumb(media) ?? "";
  const login = () => router.push("/(auth)/login");
  /** Your own posted reel: pinned to your profile or not. A Reel does not carry it, so it is read once the reel is on screen (null until then). */
  const [pinned, setPinned] = useState<boolean | null>(null);
  const readingPin = useRef(false);
  // Read ahead, while your reel plays, so "…" opens at once and always acts on the reel you are looking at.
  useEffect(() => {
    if (!playing || !own || isTour || pinned !== null) return;
    let alive = true;
    getFeedPost(supabase, reel.sourceId).then(
      (post) => {
        if (alive && post) setPinned(Boolean(post.pinned_at));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [playing, own, isTour, pinned, reel.sourceId]);
  // Pinned or unpinned elsewhere (the profile grid, the post screen) while this reel is mounted.
  useEffect(() => {
    if (isTour) return;
    return onPostPinned((id, next) => {
      if (id === reel.sourceId) setPinned(next);
    });
  }, [isTour, reel.sourceId]);

  // Scrolling away clears a manual pause and a stretched-out caption, so coming back starts fresh.
  useEffect(() => {
    if (!playing) {
      setUserPaused(false);
      setExpanded(false);
    }
  }, [playing]);
  // A new slide starts playing (if it is a video) whatever the last one was doing.
  useEffect(() => setUserPaused(false), [slide]);
  /** The paused controls (play, and sound above it): shown only while a video is paused, faded in and out. */
  const showControls = userPaused && slideIsVideo;
  const controls = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(controls, { toValue: showControls ? 1 : 0, duration: showControls ? 160 : 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [showControls, controls]);
  /** The viewer's chrome fade while a page zooms open or closed (none on the Reels tab). */
  const chrome = useContext(ViewerChromeContext);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome ? chrome.value : 1 }));

  /** The heart jumps when it fills and dips when it empties, so the tap is felt even before the count moves. */
  function animateHeart(liked: boolean) {
    popAnim.current?.stop();
    pop.setValue(1);
    // RN's default rest thresholds (0.001) keep a lively spring "settling" for a second or more; these end it once it looks still.
    const settle = { useNativeDriver: true, restDisplacementThreshold: 0.01, restSpeedThreshold: 2 } as const;
    popAnim.current = Animated.sequence(
      liked
        ? [Animated.timing(pop, { toValue: 1.35, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.spring(pop, { toValue: 1, friction: 5, tension: 180, ...settle })]
        : [Animated.timing(pop, { toValue: 0.82, duration: 90, useNativeDriver: true }), Animated.spring(pop, { toValue: 1, friction: 6, tension: 160, ...settle })],
    );
    popAnim.current.start();
  }

  /** About a second on screen; a second double tap restarts it instead of being cut short by the first run. */
  function burst() {
    burstAnim.current?.stop();
    bigHeart.setValue(0);
    burstAnim.current = Animated.sequence([
      Animated.spring(bigHeart, { toValue: 1, friction: 6, tension: 200, useNativeDriver: true, restDisplacementThreshold: 0.01, restSpeedThreshold: 2 }),
      Animated.delay(300),
      Animated.timing(bigHeart, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]);
    burstAnim.current.start();
  }

  async function toggleLike() {
    if (!user) return login();
    if (likeBusy) return;
    const next = !reel.likedByMe;
    const before = { likedByMe: reel.likedByMe, likes: reel.likes };
    animateHeart(next);
    if (next) hapticLike();
    setLikeBusy(true);
    onPatch(key, { likedByMe: next, likes: Math.max(0, reel.likes + (next ? 1 : -1)) });
    try {
      if (next) await likePost(supabase, user.id, reel.sourceType, reel.sourceId);
      else await unlikePost(supabase, user.id, reel.sourceType, reel.sourceId);
    } catch {
      onPatch(key, before);
    } finally {
      setLikeBusy(false);
    }
  }

  async function toggleSave() {
    if (!user) return login();
    // A selection tick as the bookmark fills (or empties), as everywhere else you save.
    hapticSelect();
    const before = reel.savedByMe;
    onPatch(key, { savedByMe: !before });
    try {
      onPatch(key, { savedByMe: await toggleSaved(supabase, user.id, reel.sourceType, reel.sourceId) });
    } catch {
      onPatch(key, { savedByMe: before });
    }
  }

  /** Double tap on the picture: like (never unlike) with a big heart, like Instagram; a lone tap pauses a video (a photo has nothing to pause). */
  function onVideoTap() {
    if (swipedJustNow()) return;
    const now = Date.now();
    if (pendingTap.current) {
      clearTimeout(pendingTap.current);
      pendingTap.current = null;
    }
    if (now - lastTap.current < 260) {
      lastTap.current = 0;
      burst();
      if (!reel.likedByMe) void toggleLike();
      return;
    }
    lastTap.current = now;
    const video = slideIsVideo;
    pendingTap.current = setTimeout(() => {
      pendingTap.current = null;
      if (video) setUserPaused((p) => !p);
    }, 260);
  }

  /** Instagram's share sheet: send the reel to friends as a chat card, or "Share to…" the link with the system sheet. */
  function share() {
    const url = `${SITE_URL}${reelPath(reel)}`;
    const label = reel.title ?? (reel.caption ? reel.caption.slice(0, 80) : `${reel.author.name} on ${APP_NAME}`);
    const target = { target_type: reel.sourceType, target_id: reel.sourceId };
    shareSheet.open(
      {
        ...target,
        kind: isTour ? "listing" : reel.kind,
        path: sharedPostPath(target),
        title: reel.title,
        caption: reel.caption?.trim() ? reel.caption.trim() : null,
        image_url: poster || null,
        author: { id: reel.author.id, name: reel.author.name, avatar_url: reel.author.avatarUrl },
      },
      { url, label },
    );
  }

  async function message() {
    if (!user) return login();
    if (messageBusy) return;
    setMessageBusy(true);
    try {
      const conv = await getOrCreateDirectConversation(supabase, reel.author.id);
      router.push({ pathname: "/messages/[id]", params: { id: conv } });
    } catch (e) {
      Alert.alert("Message", e instanceof Error ? e.message : "Could not start the chat. Try again.");
    } finally {
      setMessageBusy(false);
    }
  }

  function openListing() {
    if (reel.sourceType === "apartment") router.push({ pathname: "/apartments/[id]", params: { id: reel.sourceId } });
    else if (reel.sourceType === "roommate") router.push({ pathname: "/roommates/[id]", params: { id: reel.sourceId } });
  }

  function report() {
    if (!user) return login();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: async () => {
          await reportContent(supabase, user.id, { targetType: reel.sourceType, targetId: reel.sourceId, reason: r.value as ReportReason }).catch(() => {});
          Alert.alert("Thanks", `Our team will review this ${noun}.`);
        },
      })),
      "Why are you reporting this?",
    );
  }

  function confirmDelete() {
    alertWithHaptic("warning", `Delete this ${noun}?`, "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteFeedPost(supabase, reel.sourceId);
            onRemoved(key);
          } catch (e) {
            Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again");
          }
        },
      },
    ]);
  }

  /** Like a post's menu: pin your own reel to the top of your profile, or unpin it. The profile grids hear about it straight away. */
  async function togglePin(next: boolean) {
    setPinned(next);
    try {
      await setPostPinned(supabase, reel.sourceId, next);
      hapticTap();
      emitPostPinned(reel.sourceId, next);
    } catch (e) {
      setPinned(!next);
      alertWithHaptic("error", next ? "Could not pin" : "Could not unpin", errorText(e));
    }
  }

  // The overlay is name and caption only (like TikTok), so the listing and the chat live behind "…".
  async function more() {
    // Usually known already (read while the reel plays). If that read has not answered or failed, ask again, but hold
    // the menu for a moment at most: without an answer it opens without the Pin item, which the next tap will have.
    let pinNow = own && !isTour ? pinned : null;
    if (own && !isTour && pinNow === null) {
      if (readingPin.current) return;
      readingPin.current = true;
      const read = getFeedPost(supabase, reel.sourceId).then(
        (post) => (post ? Boolean(post.pinned_at) : null),
        () => null,
      );
      void read.then((value) => {
        if (value !== null) setPinned(value);
      });
      pinNow = await Promise.race([read, new Promise<null>((resolve) => setTimeout(() => resolve(null), PIN_READ_WAIT_MS))]);
      readingPin.current = false;
    }
    show([
      ...(isTour ? [{ label: "View listing", icon: "open-outline" as const, onPress: openListing }] : []),
      ...(own ? [] : [{ label: `Message ${reel.author.name.split(" ")[0]}`, icon: "chatbubble-ellipses-outline" as const, onPress: () => void message() }]),
      ...(pinNow !== null ? [{ label: pinNow ? "Unpin from profile" : "Pin to profile", icon: pinNow ? ("pin" as const) : ("pin-outline" as const), onPress: () => void togglePin(!pinNow) }] : []),
      ...(own && !isTour ? [{ label: `Delete ${noun}`, icon: "trash-outline" as const, destructive: true, onPress: confirmDelete }] : []),
      ...(own ? [] : [{ label: "Report", icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  /** The photo on its page, when that is what is on screen. */
  const pagePhoto = onPage ? photoLayout(aspectAt(slide), width, height, photoAt, floor).place : null;
  // The big heart a double tap flashes: in the middle of the photo on a photo's page, of the screen otherwise.
  const heartBox = pagePhoto ? frame(pagePhoto) : { left: 0, top: 0, width, height };
  /**
   * Where the picture behind the rail ends, in the rail's own points: each button takes white over the picture and the
   * theme's ink over the page below it. On a video's page the picture runs under the whole rail. An opened description
   * on a photo's page brings the page's colour up behind it, and the buttons there go with the page.
   */
  const underlayTop = pagePhoto && expanded ? overlayTop + infoTop - UNDERLAY_FADE : Infinity;
  const railEdge = pagePhoto ? Math.min(pagePhoto.top + pagePhoto.height, underlayTop) - (overlayTop + railTop) : Infinity;

  return (
    <GestureDetector gesture={swipe}>
    <View style={{ width, height, overflow: "hidden", backgroundColor: onPage ? colors.bg : colors.mediaBg }}>
      {single ? (
        <>
          <VideoSlide uri={single.playbackUrl} poster={poster} aspect={aspectOf(single)} width={width} height={height} mounted={near} playing={playing && !userPaused} muted={muted} topInset={topInset} bottomInset={bottomInset} frost={near} />
          <Pressable style={StyleSheet.absoluteFill} onPress={onVideoTap} accessibilityRole="button" accessibilityLabel={userPaused ? "Play" : "Pause"} />
        </>
      ) : (
        <SlideStrip media={media} aspects={aspects} pos={stripPos} settled={settled} shown={slide} width={width} height={height} photoTop={photoAt} photoFloor={floor} topInset={topInset} bottomInset={bottomInset} near={near} playing={playing && !userPaused} muted={muted} onAspect={onAspect} onTap={onVideoTap} goTo={goTo} />
      )}
      <Animated.View pointerEvents="none" style={[styles.heartBox, heartBox, styles.bigHeart, { opacity: bigHeart, transform: [{ scale: bigHeart.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>
        <Icon name="heart" size={110} color={colors.onMedia} />
      </Animated.View>

      <Reanimated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeStyle]}>
      {/* Several photos or videos: where you are, on a line of their own under the top row (a photo starts below it). */}
      {media.length > 1 ? (
        <View pointerEvents="none" style={[styles.dots, { top: contentTop + DOTS_TOP }]} accessibilityLabel={`${slide + 1} of ${media.length}`}>
          {media.map((_, i) => (
            <View key={i} style={[styles.dot, onPage && styles.dotPage, i === slide && (onPage ? styles.dotOnPage : styles.dotOn)]} />
          ))}
        </View>
      ) : null}

      {/* Where the rail crosses a photo on its page: a soft shadow behind its white icons, inside the photo only, so they
          stay readable on a white wall or a sheet of paper as they do over video. */}
      {pagePhoto && railBox.height > 0 && pagePhoto.top + pagePhoto.height > overlayTop + railTop ? (
        <View pointerEvents="none" style={[styles.placed, frame(pagePhoto)]}>
          <View style={[styles.railPool, { top: overlayTop + railTop - pagePhoto.top, height: Math.min(railBox.height, pagePhoto.top + pagePhoto.height - overlayTop - railTop) }]} />
        </View>
      ) : null}
      {/* An opened description on a photo's page: the page's colour comes up behind it, over the photo's lower part. */}
      {pagePhoto && expanded ? (
        <View pointerEvents="none" style={[styles.underlay, { top: underlayTop }]}>
          <View style={styles.underlayFade} />
          <View style={styles.underlaySolid} />
        </View>
      ) : null}

      <View style={[styles.overlay, { paddingBottom: OVERLAY_PAD + bottomInset }]} pointerEvents="box-none" onLayout={(e) => setOverlayTop(e.nativeEvent.layout.y)}>
        <View style={styles.info} pointerEvents="box-none" onLayout={(e) => setInfoTop(e.nativeEvent.layout.y)}>
          <Pressable onPress={unlessSwiped(() => router.push({ pathname: "/profile/[id]", params: { id: reel.author.id } }))} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" }} accessibilityRole="link" accessibilityLabel={`${reel.author.name}'s profile`}>
            <Text style={[styles.author, onPage && styles.authorPage]} numberOfLines={1}>
              {reel.author.name}
            </Text>
            {reel.author.verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={16} color={onPage ? colors.brand : colors.verifiedOnMedia} accessibilityLabel="Verified student" /> : null}
          </Pressable>
          {/* Short by default, like TikTok: one line of title and one of caption, "… more" opens the rest. */}
          {oneLine ? (
            expanded ? (
              <View style={{ gap: 2 }}>
                {reel.title ? (
                  <Text style={[styles.title, onPage && styles.titlePage]} numberOfLines={3}>
                    {reel.title}
                  </Text>
                ) : null}
                {reel.caption ? (
                  <Text style={[styles.caption, onPage && styles.captionPage]} numberOfLines={10}>
                    {reel.caption}
                  </Text>
                ) : null}
                <Text onPress={unlessSwiped(() => setExpanded(false))} style={[styles.more, onPage && styles.morePage]} accessibilityRole="button" accessibilityLabel="Show less">
                  less
                </Text>
              </View>
            ) : (
              /* One line with a tail "…", like Instagram; the line itself is the button, so VoiceOver reads the text and the hint. */
              <>
                <Text
                  style={[styles.caption, onPage && styles.captionPage]}
                  numberOfLines={1}
                  onPress={canExpand ? unlessSwiped(() => setExpanded(true)) : undefined}
                  accessibilityRole={canExpand ? "button" : "text"}
                  accessibilityHint={canExpand ? "Shows the full description" : undefined}
                >
                  {oneLine}
                </Text>
                {/* The whole description laid out unseen at the same width: more than one line means the line above was
                    cut. (iOS reports a cut line's full text, so the line itself cannot tell.) */}
                <Text style={[styles.caption, styles.measure]} onTextLayout={(e) => setClipped(e.nativeEvent.lines.length > 1)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {oneLine}
                </Text>
              </>
            )
          ) : null}
        </View>

        <View style={styles.rail} onLayout={(e) => setRailBox({ y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height })}>
          <RailButton icon={reel.likedByMe ? "heart" : "heart-outline"} tint={reel.likedByMe ? { media: colors.like, page: colors.like } : undefined} label={compact(reel.likes)} onPress={unlessSwiped(() => void toggleLike())} a11y={reel.likedByMe ? "Unlike" : "Like"} selected={reel.likedByMe} scale={pop} edge={railEdge} />
          <RailButton icon="chatbubble-ellipses-outline" label={compact(reel.comments)} onPress={unlessSwiped(() => onOpenComments(reel))} a11y="Comments" edge={railEdge} />
          <RailButton icon="paper-plane-outline" label="Share" onPress={unlessSwiped(share)} a11y="Share" edge={railEdge} />
          {/* Saved: amber over a picture; on the page the filled bookmark in the ink colour, as under a post in the feed. */}
          <RailButton icon={reel.savedByMe ? "bookmark" : "bookmark-outline"} tint={reel.savedByMe ? { media: colors.amber, page: colors.text } : undefined} label={reel.savedByMe ? "Saved" : "Save"} onPress={unlessSwiped(() => void toggleSave())} a11y={reel.savedByMe ? "Unsave" : "Save"} selected={reel.savedByMe} edge={railEdge} />
          <RailButton icon="ellipsis-horizontal" onPress={unlessSwiped(() => void more())} a11y="More options" small edge={railEdge} />
        </View>
      </View>

      {/* Paused: the play button in the middle and the sound button just above it, Instagram style. Both fade away the
          moment the video plays again (a tap on play, or anywhere); the sound button keeps the video paused. */}
      {slideIsVideo ? (
        <Animated.View pointerEvents={showControls ? "box-none" : "none"} style={[styles.center, { opacity: controls, transform: [{ scale: controls.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
          <View style={styles.controls}>
            <Pressable onPress={unlessSwiped(() => setReelsMuted(!muted))} hitSlop={10} accessibilityRole="button" accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"} style={({ pressed }) => [styles.soundBadge, pressed && { opacity: 0.75 }]}>
              <Icon name={muted ? "volume-mute" : "volume-high"} size={20} color={colors.onMedia} />
            </Pressable>
            <Pressable onPress={unlessSwiped(() => setUserPaused(false))} accessibilityRole="button" accessibilityLabel="Play" style={({ pressed }) => [styles.playBadge, pressed && { opacity: 0.85 }]}>
              <Icon name="play" size={44} color={colors.onMedia} style={{ marginLeft: 5 }} />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
      </Reanimated.View>
    </View>
    </GestureDetector>
  );
});

/**
 * One of the rail's buttons. Over a picture its icon and its count are white with a shadow; over the page's own colour
 * (below a photo on its page) they take the theme's ink: each decides by where it sits, as iOS tints a control by what
 * is behind it. `edge` is where the picture behind the rail ends, in the rail's points (Infinity: it runs under the whole
 * rail); `tint` colours an icon that is on (the red heart, the saved bookmark) over a picture and over the page.
 */
function RailButton({ icon, label, tint, onPress, a11y, selected, small, scale, edge = Infinity }: { icon: keyof typeof Ionicons.glyphMap; label?: string; tint?: { media: string; page: string }; onPress: () => void; a11y: string; selected?: boolean; small?: boolean; scale?: Animated.Value; edge?: number }) {
  const colors = useColors();
  const styles = useStyles();
  // A heart or a bookmark that turns on bounces like the system's symbols.
  const bounce = useBounceOn(Boolean(selected));
  const size = small ? 30 : 34;
  /** Where the button sits in the rail, once laid out; until then it goes with the page wherever there is one. */
  const [box, setBox] = useState<{ y: number; height: number } | null>(null);
  const overPicture = (centre: number) => (box ? centre < edge : edge === Infinity);
  const iconOver = overPicture((box?.y ?? 0) + size / 2);
  const labelOver = overPicture((box?.y ?? 0) + (size + 3 + (box?.height ?? 0)) / 2);
  const ink = tint ? (iconOver ? tint.media : tint.page) : iconOver ? colors.onMedia : colors.text;
  return (
    <Pressable
      onPress={onPress}
      onLayout={(e) => {
        const { y, height } = e.nativeEvent.layout;
        setBox((b) => (b && b.y === y && b.height === height ? b : { y, height }));
      }}
      hitSlop={6}
      style={({ pressed }) => [styles.railButton, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      <Animated.View style={scale ? { transform: [{ scale }] } : undefined}>
        <Icon name={icon} size={size} color={ink} style={iconOver ? styles.iconShadow : undefined} bounce={bounce} />
      </Animated.View>
      {label ? <Text style={[styles.railLabel, !labelOver && styles.railLabelPage]}>{label}</Text> : null}
    </Pressable>
  );
}

/** Width over height, when the upload recorded both. */
export function aspectOf(m: FeedMedia): number | null {
  return m.width && m.height ? m.width / m.height : null;
}

/**
 * What a page's words and buttons sit on while a slide is on screen. "page": a photo on the screen's own colour (white in
 * light, black in dark), with the theme's own ink, as on any other screen of the app. "media": a video, or a photo too
 * tall for a page (a phone screenshot), full screen and dark, with white words over shades in both themes.
 */
export type ViewerSurface = "media" | "page";
/** The surface of a slide of this shape on a page of this size, its photos between `top` and `floor` (see photoLayout). */
export function surfaceOf(m: FeedMedia | undefined, aspect: number | null, pageW: number, pageH: number, top: number, floor: number): ViewerSurface {
  return m?.type === "photo" ? photoLayout(aspect, pageW, pageH, top, floor).surface : "media";
}

/** Where a page's photos start: under the row over its top (`contentTop`) and, on a carousel, the dots' own line. */
export function photoTop(contentTop: number, count: number): number {
  return contentTop + (count > 1 ? DOTS_LINE : PHOTO_GAP);
}

/** The lowest a photo on its page may reach: the name and the words keep the space below it (see WORDS_ROOM). */
export function photoFloor(pageH: number, bottomInset: number): number {
  return pageH - bottomInset - WORDS_ROOM;
}

/** TikTok's canvas: a 9:16 column, as wide as the screen on a phone (as tall as the screen allows on a wider one). */
const CANVAS = 9 / 16;
/** A video within this much of 9:16 (a hair wider) still counts as vertical: it fills the screen. */
const FILL_TOLERANCE = 1.1;

export type Placement = { left: number; top: number; width: number; height: number; fit: "cover" | "contain" };
const frame = (p: Placement) => ({ left: p.left, top: p.top, width: p.width, height: p.height });

/**
 * Where a photo sits, TikTok style, always whole and in its own shape, never cropped or stretched. As wide as the page,
 * at the top of the space under the top row (`top`), on the page's own colour, which stays free below it (from `floor`)
 * for the name and the words ("page"): a landscape, square, 4:5 or 3:4 photo. One too tall to leave that space (9:16, a
 * phone screenshot) is shown like a vertical video instead: full screen, as wide as the page (or as tall, whichever
 * comes first), in the middle, on black ("media"). Until a photo's shape is known (an upload that did not record it,
 * still loading) it is drawn whole at the top of the space.
 */
export function photoLayout(aspect: number | null, pageW: number, pageH: number, top: number, floor: number): { place: Placement; surface: ViewerSurface } {
  const room = Math.max(floor - top, 1);
  if (aspect === null || !(aspect > 0)) return { place: { left: 0, top, width: pageW, height: room, fit: "contain" }, surface: "page" };
  const tall = pageW / aspect;
  if (tall <= room) return { place: { left: 0, top, width: pageW, height: tall, fit: "contain" }, surface: "page" };
  const width = Math.min(pageW, pageH * aspect);
  const height = width / aspect;
  return { place: { left: (pageW - width) / 2, top: (pageH - height) / 2, width, height, fit: "contain" }, surface: "media" };
}

/**
 * Where a video sits: a vertical one (9:16, or within a hair of it) fills the whole screen, its sides trimmed a little on
 * a phone taller than 9:16 (on a page wider than the video, an iPad's, it keeps its full height, whole, in the middle); a
 * square, landscape, 4:5 or 3:4 one stays whole, as wide as the 9:16 canvas, in the middle, the blurred backdrop round
 * it. An unknown shape fits whole on the page.
 */
export function placeVideo(aspect: number | null, pageW: number, pageH: number): Placement {
  const centred = (width: number, height: number, fit: Placement["fit"]): Placement => ({ left: (pageW - width) / 2, top: (pageH - height) / 2, width, height, fit });
  if (aspect === null || !(aspect > 0)) return centred(pageW, pageH, "contain");
  if (aspect <= CANVAS * FILL_TOLERANCE) return pageW / pageH <= aspect ? centred(pageW, pageH, "cover") : centred(pageH * aspect, pageH, "cover");
  const canvasW = Math.min(pageW, pageH * CANVAS);
  return centred(canvasW, canvasW / aspect, "cover");
}

/** The soft, darkened blur of a video's poster that fills whatever of the page the video itself leaves empty. */
function Backdrop({ uri }: { uri: string }) {
  const styles = useStyles();
  return (
    <>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={45} transition={0} />
      <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
    </>
  );
}

/** Does the picture cover the whole page (no backdrop needed)? */
function coversPage(place: Placement, pageW: number, pageH: number) {
  return place.width >= pageW - 0.5 && place.height >= pageH - 0.5;
}

/**
 * A full-screen slide (a video, or a photo too tall for a page): dark, the picture's blurred backdrop wherever the picture
 * leaves the page empty, and over the picture the frost and the shades that keep the white words and the rail readable.
 */
function MediaFrame({ place, backdrop, width, height, topInset, bottomInset, frost, children }: { place: Placement; backdrop: string | null; width: number; height: number; topInset: number; bottomInset: number; frost: boolean; children: ReactNode }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }} pointerEvents="none">
      {backdrop && !coversPage(place, width, height) ? <Backdrop uri={backdrop} /> : null}
      {children}
      {/* Behind the words and the comment bar, the picture frosts over gradually towards the bottom, as under an iOS bar. */}
      {frost ? <ProgressiveBlur height={bottomInset + BLUR_REACH} /> : null}
      {/* Soft shades so white words and icons stay readable over a bright picture: at the top under the bar, at the bottom under the name and the rail. */}
      <View style={[styles.topShade, { height: Math.max(TOP_SHADE_MIN, topInset + TOP_SHADE_EXTRA) }]} />
      <View style={styles.shade} />
    </View>
  );
}

/** A video's slide, full screen when it is vertical: its player (only near the page on screen, so at most a few exist at a time) or its poster. */
function VideoSlide({ uri, poster, aspect, width, height, mounted, playing, muted, topInset, bottomInset, frost }: { uri: string; poster: string; aspect: number | null; width: number; height: number; mounted: boolean; playing: boolean; muted: boolean; topInset: number; bottomInset: number; frost: boolean }) {
  const styles = useStyles();
  const place = placeVideo(aspect, width, height);
  return (
    <MediaFrame place={place} backdrop={poster || null} width={width} height={height} topInset={topInset} bottomInset={bottomInset} frost={frost}>
      {mounted ? <PageVideo uri={uri} poster={poster} place={place} playing={playing} muted={muted} /> : poster ? <Image source={{ uri: poster }} style={[styles.placed, frame(place)]} contentFit={place.fit} transition={0} /> : null}
    </MediaFrame>
  );
}

/** A video's player in its place; its poster stays on top until the first frame is painted, so a page is never a black box. */
function PageVideo({ uri, poster, place, playing, muted }: { uri: string; poster: string; place: Placement; playing: boolean; muted: boolean }) {
  const styles = useStyles();
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.muted = reelsMuted;
  });
  const [hasFrame, setHasFrame] = useState(false);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  return (
    <View style={[styles.placed, frame(place)]}>
      {/* No Live Text on a paused frame: its button would sit over the play control, and the scan it runs on every pause is wasted. */}
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={place.fit} nativeControls={false} allowsVideoFrameAnalysis={false} onFirstFrameRender={() => setHasFrame(true)} />
      {!hasFrame && poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit={place.fit} /> : null}
    </View>
  );
}

/**
 * A photo's slide, TikTok style (see photoLayout): whole and as wide as the screen at the top, under the top row, on the
 * page's own colour, which stays free below it for the words; or, too tall for that, full screen on black like a video.
 * Its tiny blurred preview shows at once; a photo uploaded without its size reports its shape once loaded (`onAspect`).
 */
function PhotoSlide({ uri, blur, aspect, width, height, top, floor, topInset, bottomInset, frost, onAspect }: { uri: string; blur: string | null; aspect: number | null; width: number; height: number; top: number; floor: number; topInset: number; bottomInset: number; frost: boolean; onAspect: (aspect: number) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const { place, surface } = photoLayout(aspect, width, height, top, floor);
  const image = (
    <Image
      source={{ uri }}
      placeholder={blur ? { uri: blur } : undefined}
      placeholderContentFit="contain"
      style={[styles.placed, frame(place)]}
      contentFit="contain"
      contentPosition="top"
      transition={200}
      onLoad={aspect !== null ? undefined : (e) => (e.source.width > 0 && e.source.height > 0 ? onAspect(e.source.width / e.source.height) : undefined)}
    />
  );
  if (surface === "media") {
    return (
      <MediaFrame place={place} backdrop={null} width={width} height={height} topInset={topInset} bottomInset={bottomInset} frost={frost}>
        {image}
      </MediaFrame>
    );
  }
  return (
    <View style={{ width, height, backgroundColor: colors.bg }} pointerEvents="none">
      {image}
    </View>
  );
}

/** VoiceOver's swipe up and down on a slide of a carousel. */
const ADJUST = [{ name: "increment" }, { name: "decrement" }] as const;

/**
 * A post's photos and videos side by side on a strip, one page wide each, that the page's swipe moves (see usePageSwipe):
 * a photo on the page's colour (or full screen, when it is as tall as a phone's screen), a video full screen. A video
 * slide plays once the strip has settled on it (and while its page is on screen); players mount only for the slides
 * beside that one. Each slide takes the page's taps (a lone tap pauses a video, a double tap likes); VoiceOver reads the
 * slide showing, and a swipe up or down on it moves to the next or the previous one.
 */
function SlideStrip({ media, aspects, pos, settled, shown, width, height, photoTop: top, photoFloor: floor, topInset, bottomInset, near, playing, muted, onAspect, onTap, goTo }: { media: FeedMedia[]; aspects: Record<number, number>; pos: SharedValue<number>; settled: number; shown: number; width: number; height: number; photoTop: number; photoFloor: number; topInset: number; bottomInset: number; near: boolean; playing: boolean; muted: boolean; onAspect: (index: number, aspect: number) => void; onTap: () => void; goTo: (index: number) => void }) {
  const styles = useStyles();
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value }] }));
  return (
    <Reanimated.View style={[styles.strip, { width: width * media.length, height }, stripStyle]}>
      {media.map((item, i) => {
        const close = near && Math.abs(i - settled) <= 1;
        return (
          <Pressable
            key={`${i}:${item.type === "photo" ? item.url : item.playbackUrl}`}
            onPress={onTap}
            style={{ width, height }}
            accessibilityRole="adjustable"
            accessibilityLabel={`${item.type === "video" ? "Video" : "Photo"} ${i + 1} of ${media.length}`}
            accessibilityActions={ADJUST}
            onAccessibilityAction={(e) => goTo(e.nativeEvent.actionName === "increment" ? i + 1 : i - 1)}
            accessibilityElementsHidden={i !== shown}
            importantForAccessibility={i === shown ? "auto" : "no-hide-descendants"}
          >
            {item.type === "photo" ? (
              <PhotoSlide uri={item.url} blur={item.blur} aspect={aspectOf(item) ?? aspects[i] ?? null} width={width} height={height} top={top} floor={floor} topInset={topInset} bottomInset={bottomInset} frost={close} onAspect={(a) => onAspect(i, a)} />
            ) : (
              <VideoSlide uri={item.playbackUrl} poster={item.poster ?? ""} aspect={aspectOf(item)} width={width} height={height} mounted={close} playing={playing && i === settled} muted={muted} topInset={topInset} bottomInset={bottomInset} frost={close} />
            )}
          </Pressable>
        );
      })}
    </Reanimated.View>
  );
}

/** A colour at no opacity (#rrggbb in), for a gradient that fades into it. */
function clearOf(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},0)` : "transparent";
}

/**
 * Over a picture, the media colours (light text, dark scrims) in both themes; on a photo's page (the `…Page` styles),
 * the theme's own ink on the page's own colour.
 */
const useStyles = makeStyles((colors) => {
  // Under the white name, caption and labels: darker than mediaScrim, so the text stays sharp on bright footage.
  // A tight halo: a wide, soft one fades to nothing around thin 12pt digits on a bright frame.
  const shadow = { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
  // On the page's own colour the ink needs nothing behind it.
  const plain = { textShadowColor: "transparent", textShadowRadius: 0 } as const;
  return {
    center: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
    heartBox: { position: "absolute", alignItems: "center", justifyContent: "center" },
    playBadge: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
    // The sound button above the play button: the play button stays dead centre, so the pair is lifted by half the sound button's share.
    controls: { alignItems: "center", gap: SOUND_ABOVE - 44, transform: [{ translateY: -SOUND_ABOVE / 2 }] },
    soundBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
    bigHeart: { shadowColor: colors.shadow, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 3 } },
    shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: SHADE_HEIGHT, experimental_backgroundImage: scrimGradient(colors.mediaScrim, bottomShare) },
    // Drawn from the darker text-shadow colour: the top carries smaller, dimmer words than the bottom does.
    topShade: { position: "absolute", left: 0, right: 0, top: 0, experimental_backgroundImage: scrimGradient(colors.mediaTextShadow, topShare, 14) },
    // A thin strip at the photo's right edge, along the rail, casting a wide soft shadow round it (the strip itself is never seen).
    railPool: { position: "absolute", right: 0, width: 1, boxShadow: "0 0 48px 58px rgba(0,0,0,0.42)" },
    // An opened description on a photo's page: the page's colour, fading in above it, behind the words.
    underlay: { position: "absolute", left: 0, right: 0, bottom: 0 },
    underlayFade: { height: UNDERLAY_FADE, experimental_backgroundImage: `linear-gradient(to bottom, ${clearOf(colors.bg)}, ${colors.bg})` },
    underlaySolid: { flex: 1, backgroundColor: colors.bg },
    // Behind a video that leaves part of the page empty: its poster's blur, dimmed so it reads as background and the
    // words over it stay readable.
    backdropDim: { backgroundColor: "rgba(0,0,0,0.45)" },
    // A carousel's slides side by side, moved as one.
    strip: { position: "absolute", top: 0, left: 0, flexDirection: "row" },
    // A picture's place on the page (see photoLayout, placeVideo): clipped, so a cover fit never spills past it.
    placed: { position: "absolute", overflow: "hidden" },
    dots: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onMediaMuted },
    dotOn: { width: 18, backgroundColor: colors.onMedia },
    // On a photo's page, the feed's own carousel dots: grey, the one showing in the violet accent.
    dotPage: { backgroundColor: colors.faint },
    dotOnPage: { width: 18, backgroundColor: colors.accent },
    // Instagram's geometry on an iPhone: the "…" centre 46pt above the tab bar, then save, share, comment and like every 73pt or so; the caption line level with "…".
    overlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", paddingLeft: 14, paddingRight: 8, paddingBottom: OVERLAY_PAD, gap: 10 },
    info: { flex: 1, gap: 6, paddingBottom: 2 },
    author: { color: colors.onMedia, fontSize: 16, fontWeight: "700", flexShrink: 1, ...shadow },
    title: { color: colors.onMedia, fontSize: 15, fontWeight: "700", ...shadow },
    caption: { color: colors.onMedia, fontSize: 14, lineHeight: 19, ...shadow },
    more: { color: colors.onMediaMuted, fontSize: 13, fontWeight: "700", ...shadow },
    rail: { width: 60, alignItems: "center", gap: 21 },
    railButton: { alignItems: "center", gap: 3, minWidth: 48 },
    // The unseen copy of the description that tells whether its one line was cut.
    measure: { position: "absolute", left: 0, right: 0, opacity: 0 },
    railLabel: { color: colors.onMedia, fontSize: 12, fontWeight: "700", ...shadow },
    // A wider, darker halo than the words get: the rail's white strokes are thin, and bright footage would swallow them.
    iconShadow: { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
    authorPage: { color: colors.text, ...plain },
    titlePage: { color: colors.text, ...plain },
    captionPage: { color: colors.text, ...plain },
    morePage: { color: colors.muted, ...plain },
    railLabelPage: { color: colors.text, ...plain },
  };
});

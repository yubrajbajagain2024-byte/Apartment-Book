import { memo, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Animated, Easing, FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image } from "expo-image";
import type { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";
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
/** The sound button sits this far above the play button's centre, Instagram style: its 44pt disc, then a gap. */
const SOUND_ABOVE = 44 + 26;

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
};

/**
 * One full-screen page: a reel's video, or a post's photos and videos swiped sideways (dots show where you are), under
 * the same overlay for every page: the creator's name and words, and the rail (like, comments, share, save, "…"). A
 * video plays while its page (and its slide) is on screen; a tap pauses it, a double tap anywhere likes.
 */
export const ReelItem = memo(function ReelItem({ reel: source, width, height, topInset, bottomInset, near, playing, onPatch, onOpenComments, onRemoved, initialSlide = 0 }: Props) {
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

  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }}>
      {single ? (
        <>
          {near ? <PageVideo uri={single.playbackUrl} poster={poster} aspect={aspectOf(single)} cover={reel.kind === "reel"} width={width} height={height} playing={playing && !userPaused} muted={muted} /> : <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />}
          <Pressable style={StyleSheet.absoluteFill} onPress={onVideoTap} accessibilityRole="button" accessibilityLabel={userPaused ? "Play" : "Pause"} />
        </>
      ) : (
        <MediaPager media={media} width={width} height={height} near={near} playing={playing && !userPaused} muted={muted} start={slide} onSlide={setSlide} onTap={onVideoTap} />
      )}
      <Animated.View pointerEvents="none" style={[styles.center, styles.bigHeart, { opacity: bigHeart, transform: [{ scale: bigHeart.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>
        <Icon name="heart" size={110} color={colors.onMedia} />
      </Animated.View>

      {/* Behind the words and the comment bar, the picture frosts over gradually towards the bottom, as under an iOS bar. */}
      {near ? <ProgressiveBlur height={bottomInset + BLUR_REACH} /> : null}
      {/* Soft shades so white words and icons stay readable over bright video: at the top under the bar, at the bottom under the name and the rail. */}
      <View pointerEvents="none" style={[styles.topShade, { height: Math.max(TOP_SHADE_MIN, topInset + TOP_SHADE_EXTRA) }]} />
      <View pointerEvents="none" style={styles.shade} />

      <Reanimated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeStyle]}>
      {/* Several photos or videos: where you are, under the top row, as on a photo carousel. */}
      {media.length > 1 ? (
        <View pointerEvents="none" style={[styles.dots, { top: topInset + 62 }]} accessibilityLabel={`${slide + 1} of ${media.length}`}>
          {media.map((_, i) => (
            <View key={i} style={[styles.dot, i === slide && styles.dotOn]} />
          ))}
        </View>
      ) : null}

      <View style={[styles.overlay, { paddingBottom: 31 + bottomInset }]} pointerEvents="box-none">
        <View style={styles.info} pointerEvents="box-none">
          <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: reel.author.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" }} accessibilityRole="link" accessibilityLabel={`${reel.author.name}'s profile`}>
            <Text style={styles.author} numberOfLines={1}>
              {reel.author.name}
            </Text>
            {reel.author.verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={16} color={colors.verifiedOnMedia} accessibilityLabel="Verified student" /> : null}
          </Pressable>
          {/* Short by default, like TikTok: one line of title and one of caption, "… more" opens the rest. */}
          {oneLine ? (
            expanded ? (
              <View style={{ gap: 2 }}>
                {reel.title ? (
                  <Text style={styles.title} numberOfLines={3}>
                    {reel.title}
                  </Text>
                ) : null}
                {reel.caption ? (
                  <Text style={styles.caption} numberOfLines={10}>
                    {reel.caption}
                  </Text>
                ) : null}
                <Text onPress={() => setExpanded(false)} style={styles.more} accessibilityRole="button" accessibilityLabel="Show less">
                  less
                </Text>
              </View>
            ) : (
              /* One line with a tail "…", like Instagram; the line itself is the button, so VoiceOver reads the text and the hint. */
              <Text
                style={styles.caption}
                numberOfLines={1}
                onPress={canExpand ? () => setExpanded(true) : undefined}
                accessibilityRole={canExpand ? "button" : "text"}
                accessibilityHint={canExpand ? "Shows the full description" : undefined}
                // The first laid-out line carries less than the whole text when it was truncated.
                onTextLayout={(e) => {
                  const first = e.nativeEvent.lines[0]?.text ?? "";
                  setClipped(e.nativeEvent.lines.length > 1 || first.replace(/…$/, "").trim().length < oneLine.trim().length);
                }}
              >
                {oneLine}
              </Text>
            )
          ) : null}
        </View>

        <View style={styles.rail}>
          <RailButton icon={reel.likedByMe ? "heart" : "heart-outline"} color={reel.likedByMe ? colors.like : colors.onMedia} label={compact(reel.likes)} onPress={() => void toggleLike()} a11y={reel.likedByMe ? "Unlike" : "Like"} selected={reel.likedByMe} scale={pop} />
          <RailButton icon="chatbubble-ellipses-outline" label={compact(reel.comments)} onPress={() => onOpenComments(reel)} a11y="Comments" />
          <RailButton icon="paper-plane-outline" label="Share" onPress={share} a11y="Share" />
          <RailButton icon={reel.savedByMe ? "bookmark" : "bookmark-outline"} color={reel.savedByMe ? colors.amber : colors.onMedia} label={reel.savedByMe ? "Saved" : "Save"} onPress={() => void toggleSave()} a11y={reel.savedByMe ? "Unsave" : "Save"} selected={reel.savedByMe} />
          <RailButton icon="ellipsis-horizontal" onPress={() => void more()} a11y="More options" small />
        </View>
      </View>

      {/* Paused: the play button in the middle and the sound button just above it, Instagram style. Both fade away the
          moment the video plays again (a tap on play, or anywhere); the sound button keeps the video paused. */}
      {slideIsVideo ? (
        <Animated.View pointerEvents={showControls ? "box-none" : "none"} style={[styles.center, { opacity: controls, transform: [{ scale: controls.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
          <View style={styles.controls}>
            <Pressable onPress={() => setReelsMuted(!muted)} hitSlop={10} accessibilityRole="button" accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"} style={({ pressed }) => [styles.soundBadge, pressed && { opacity: 0.75 }]}>
              <Icon name={muted ? "volume-mute" : "volume-high"} size={20} color={colors.onMedia} />
            </Pressable>
            <Pressable onPress={() => setUserPaused(false)} accessibilityRole="button" accessibilityLabel="Play" style={({ pressed }) => [styles.playBadge, pressed && { opacity: 0.85 }]}>
              <Icon name="play" size={44} color={colors.onMedia} style={{ marginLeft: 5 }} />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
      </Reanimated.View>
    </View>
  );
});

function RailButton({ icon, label, color, onPress, a11y, selected, small, scale }: { icon: keyof typeof Ionicons.glyphMap; label?: string; color?: string; onPress: () => void; a11y: string; selected?: boolean; small?: boolean; scale?: Animated.Value }) {
  const colors = useColors();
  const styles = useStyles();
  // A heart or a bookmark that turns on bounces like the system's symbols.
  const bounce = useBounceOn(Boolean(selected));
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.railButton, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={selected === undefined ? undefined : { selected }}>
      <Animated.View style={scale ? { transform: [{ scale }] } : undefined}>
        <Icon name={icon} size={small ? 30 : 34} color={color ?? colors.onMedia} style={styles.iconShadow} bounce={bounce} />
      </Animated.View>
      {label ? <Text style={styles.railLabel}>{label}</Text> : null}
    </Pressable>
  );
}

/** Width over height, when the upload recorded both. */
function aspectOf(m: FeedMedia): number | null {
  return m.width && m.height ? m.width / m.height : null;
}

/**
 * Fills the screen edge to edge when the picture is about as tall as the screen (a reel, a phone video, a portrait
 * photo); anything wider sits whole in the middle over a soft, darkened blur of itself, so nothing is cropped away.
 */
function fillsScreen(aspect: number | null, fallback: boolean): boolean {
  return aspect === null ? fallback : aspect <= 0.62;
}

/** The blurred, darkened copy of a picture behind it when it does not fill the screen. */
function Backdrop({ uri }: { uri: string }) {
  const styles = useStyles();
  return (
    <>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={0} />
      <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
    </>
  );
}

/** A video page's player. Only mounted near the page on screen, so at most three players exist at a time. */
function PageVideo({ uri, poster, aspect, cover, width, height, playing, muted }: { uri: string; poster: string; aspect: number | null; cover: boolean; width: number; height: number; playing: boolean; muted: boolean }) {
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
  const fill = fillsScreen(aspect, cover);
  return (
    <View style={{ width, height }} pointerEvents="none">
      {!fill && poster ? <Backdrop uri={poster} /> : null}
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fill ? "cover" : "contain"} nativeControls={false} onFirstFrameRender={() => setHasFrame(true)} />
      {/* The poster stays on top until the first frame is painted, so a page is never a black box. */}
      {!hasFrame && poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit={fill ? "cover" : "contain"} /> : null}
    </View>
  );
}

/** A photo page: edge to edge when it is tall, otherwise whole over its own blur. Its tiny blurred preview shows at once. */
function PhotoSlide({ photo, width, height }: { photo: Extract<FeedMedia, { type: "photo" }>; width: number; height: number }) {
  const fill = fillsScreen(aspectOf(photo), false);
  const fit = fill ? "cover" : "contain";
  return (
    <View style={{ width, height }}>
      {!fill ? <Backdrop uri={photo.blur ?? photo.url} /> : null}
      <Image source={{ uri: photo.url }} placeholder={photo.blur ? { uri: photo.blur } : undefined} placeholderContentFit={fit} style={StyleSheet.absoluteFill} contentFit={fit} transition={200} />
    </View>
  );
}

/**
 * A post's photos and videos, one full-screen slide each, swiped sideways inside the vertical pager. A video slide plays
 * while it and its page are on screen; players mount only for the slides beside the one showing. Each slide takes the
 * page's taps (a lone tap pauses a video, a double tap likes).
 */
function MediaPager({ media, width, height, near, playing, muted, start, onSlide, onTap }: { media: FeedMedia[]; width: number; height: number; near: boolean; playing: boolean; muted: boolean; start: number; onSlide: (index: number) => void; onTap: () => void }) {
  // Where it opens (the slide showing in the feed when the post was tapped); after that it follows the finger.
  const [index, setIndex] = useState(start);
  const [first] = useState(start);
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(media.length - 1, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i === index) return;
    setIndex(i);
    onSlide(i);
  };
  return (
    <FlatList
      data={media}
      horizontal
      pagingEnabled
      scrollEnabled={media.length > 1}
      showsHorizontalScrollIndicator={false}
      style={StyleSheet.absoluteFill}
      keyExtractor={(m, i) => `${i}:${m.type === "photo" ? m.url : m.playbackUrl}`}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      initialScrollIndex={first > 0 ? first : undefined}
      onMomentumScrollEnd={settle}
      extraData={`${index}:${playing}:${near}:${muted}`}
      renderItem={({ item, index: i }) => (
        <Pressable onPress={onTap} style={{ width, height }} accessibilityRole={item.type === "video" ? "button" : "image"} accessibilityLabel={`${item.type === "video" ? "Video" : "Photo"} ${i + 1} of ${media.length}`}>
          {item.type === "photo" ? (
            <PhotoSlide photo={item} width={width} height={height} />
          ) : near && Math.abs(i - index) <= 1 ? (
            <PageVideo uri={item.playbackUrl} poster={item.poster ?? ""} aspect={aspectOf(item)} cover={false} width={width} height={height} playing={playing && i === index} muted={muted} />
          ) : item.poster ? (
            <Image source={{ uri: item.poster }} style={{ width, height }} contentFit="contain" />
          ) : null}
        </Pressable>
      )}
    />
  );
}

/** Everything here sits over video, so it uses the media colours (light text, dark scrims) in both themes. */
const useStyles = makeStyles((colors) => {
  // Under the white name, caption and labels: darker than mediaScrim, so the text stays sharp on bright footage.
  // A tight halo: a wide, soft one fades to nothing around thin 12pt digits on a bright frame.
  const shadow = { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
  return {
    center: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
    playBadge: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
    // The sound button above the play button: the play button stays dead centre, so the pair is lifted by half the sound button's share.
    controls: { alignItems: "center", gap: SOUND_ABOVE - 44, transform: [{ translateY: -SOUND_ABOVE / 2 }] },
    soundBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
    bigHeart: { shadowColor: colors.shadow, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 3 } },
    shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: SHADE_HEIGHT, experimental_backgroundImage: scrimGradient(colors.mediaScrim, bottomShare) },
    // Drawn from the darker text-shadow colour: the top carries smaller, dimmer words than the bottom does.
    topShade: { position: "absolute", left: 0, right: 0, top: 0, experimental_backgroundImage: scrimGradient(colors.mediaTextShadow, topShare, 14) },
    // Behind a picture that does not fill the screen: its own blur, dimmed so the words over it stay readable.
    backdropDim: { backgroundColor: "rgba(0,0,0,0.38)" },
    dots: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onMediaMuted },
    dotOn: { width: 18, backgroundColor: colors.onMedia },
    // Instagram's geometry on an iPhone: the "…" centre 46pt above the tab bar, then save, share, comment and like every 73pt or so; the caption line level with "…".
    overlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", paddingLeft: 14, paddingRight: 8, paddingBottom: 31, gap: 10 },
    info: { flex: 1, gap: 6, paddingBottom: 2 },
    author: { color: colors.onMedia, fontSize: 16, fontWeight: "700", flexShrink: 1, ...shadow },
    title: { color: colors.onMedia, fontSize: 15, fontWeight: "700", ...shadow },
    caption: { color: colors.onMedia, fontSize: 14, lineHeight: 19, ...shadow },
    more: { color: colors.onMediaMuted, fontSize: 13, fontWeight: "700", ...shadow },
    rail: { width: 60, alignItems: "center", gap: 21 },
    railButton: { alignItems: "center", gap: 3, minWidth: 48 },
    railLabel: { color: colors.onMedia, fontSize: 12, fontWeight: "700", ...shadow },
    // A wider, darker halo than the words get: the rail's white strokes are thin, and bright footage would swallow them.
    iconShadow: { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  };
});

import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, FlatList, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image } from "expo-image";
import { useIsFocused } from "expo-router";
import { VideoView, type VideoPlayer } from "expo-video";
import { CAN_SHARE_PLAYERS, isLent, markDrawn, useLendablePlayer, useLendings } from "@/lib/video-handoff";
import { setVideosMuted, useVideosMuted, VIDEO_AUDIO_MODE, videosMuted } from "@/lib/video-sound";
import type { FeedMedia } from "@apartment-book/shared";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { hapticSelect } from "@/lib/haptics";
import { useSectionPager } from "@/lib/section-pager";
import { Icon } from "@/components/icon";
import { GlassIconButton } from "@/components/glass";

const DOUBLE_TAP_MS = 260;
/** How far a finger moves before the carousel decides whether a swipe is its photos' or the pager's. */
const DECIDE = 10;

type PhotoCarouselProps = {
  media: FeedMedia[];
  aspect?: number;
  /**
   * A tap on a slide; `time` is where its video had got to (null on a photo), and `player` the video's own player (iOS),
   * so a full-screen view can play on from there without reloading.
   */
  onPress?: (at: { time: number | null; player: VideoPlayer | null }) => void;
  /** Double tap, like Instagram. A single tap then waits a moment before it counts. */
  onDoubleTap?: () => void;
  active?: boolean;
  videoLabel?: string | null;
  /** Pass false to draw your own dots (Instagram puts them under the photo); `onIndexChange` tells you which slide is showing. */
  dots?: boolean;
  onIndexChange?: (index: number) => void;
  /**
   * A slide to show from outside (the viewer coming back on another photo): the carousel jumps to it without animating,
   * and with a `time`, that slide's video jumps there (the viewer handing back where it had got to).
   */
  jump?: { index: number; time?: number } | null;
  /**
   * "watch": a video feed's look (the Housing feed, YouTube style): the sound button at the top right, the time left at
   * the bottom right, a thin progress line along the bottom edge, and the photo counter at the top left. "post" (default)
   * is the look of a post's frame.
   */
  chrome?: "post" | "watch";
};

/** 125 → "2:05", 3725 → "1:02:05". */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * Swipeable photos and videos, one slide at a time, with a 1/3 counter and dots.
 * `videoLabel` is the pill shown when the first slide is a video: "Video tour" suits listings; pass another word, or null for no pill.
 *
 * On a page of Home's or Explore's pager of sections (lib/section-pager.ts) the carousel never keeps a finger it cannot
 * use, TikTok's way: swipes go through the photos first, and from the last photo the next swipe on goes to the next
 * section (from the first, back to the one before), the pager following the finger, then gliding on or back once let go.
 *
 * On iOS the list's own scroll gesture still takes a swipe that starts at its end, even with nothing left to scroll and
 * no bounce, so nothing native moves the pager, and the touch would end as a tap that opens the post (measured on the
 * simulator, 2026-10-31). React Native's touches keep coming through all the while, so the carousel reads the finger
 * from them: a swipe that starts on the last photo going on (or the first going back) moves the pager by the finger's
 * travel, and the tap it ends with is dropped. Elsewhere the carousel keeps every swipe and bounces at its ends as before.
 */
export function PhotoCarousel({ media, aspect = 4 / 5, onPress, onDoubleTap, active = true, videoLabel = "Video tour", dots = true, onIndexChange, jump, chrome = "post" }: PhotoCarouselProps) {
  const watch = chrome === "watch";
  const colors = useColors();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<FeedMedia>>(null);
  const height = width ? width / aspect : 0;
  const count = media.length;
  const sectionPager = useSectionPager();
  /** Where the carousel rests, in points: its offset as each scroll comes to rest. */
  const resting = useRef(0);
  /**
   * The touch on the carousel, on a pager of sections: where it started, whether it is the photos' or the pager's (until
   * the finger has moved DECIDE points, neither), how far it has moved and how fast (points a second, smoothed).
   */
  const touch = useRef<{ x: number; y: number; mode: "undecided" | "photos" | "pager"; outward: 1 | -1; dx: number; lastX: number; lastT: number; vx: number } | null>(null);
  /** The touch went to the pager: the tap it ends with is not a tap on the photo. */
  const handedOver = useRef(false);
  const onTouchStart = (e: GestureResponderEvent) => {
    handedOver.current = false;
    touch.current = null;
    const t = e.nativeEvent.touches[0];
    if (!sectionPager || count < 2 || !width || !t || e.nativeEvent.touches.length > 1) return;
    touch.current = { x: t.pageX, y: t.pageY, mode: "undecided", outward: 1, dx: 0, lastX: t.pageX, lastT: e.nativeEvent.timestamp, vx: 0 };
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    const s = touch.current;
    const t = e.nativeEvent.touches[0];
    if (!s || !t || !sectionPager || s.mode === "photos") return;
    const dt = e.nativeEvent.timestamp - s.lastT;
    if (dt > 0) s.vx = 0.7 * (((t.pageX - s.lastX) / dt) * 1000) + 0.3 * s.vx;
    s.lastX = t.pageX;
    s.lastT = e.nativeEvent.timestamp;
    s.dx = t.pageX - s.x;
    if (s.mode === "undecided") {
      const dy = t.pageY - s.y;
      if (Math.abs(dy) > DECIDE && Math.abs(dy) >= Math.abs(s.dx)) {
        s.mode = "photos";
        return;
      }
      if (Math.abs(s.dx) <= DECIDE) return;
      // On the last photo going on, or on the first going back: the pager's. Anything else is the photos' own.
      const last = (count - 1) * width;
      const outward = s.dx < 0 ? resting.current >= last - 1 : resting.current <= 1;
      if (!outward) {
        s.mode = "photos";
        return;
      }
      s.mode = "pager";
      s.outward = s.dx < 0 ? 1 : -1;
      handedOver.current = true;
    }
    // Only ever towards the section it set out for: the photos are still there the other way.
    sectionPager.follow(s.outward === 1 ? Math.min(0, s.dx) : Math.max(0, s.dx));
  };
  const onTouchEnd = () => {
    const s = touch.current;
    touch.current = null;
    if (s?.mode === "pager") sectionPager?.release(s.outward === 1 ? Math.min(0, s.dx) : Math.max(0, s.dx), s.vx);
  };

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!width) return;
      resting.current = e.nativeEvent.contentOffset.x;
      const i = Math.max(0, Math.min(count - 1, Math.round(e.nativeEvent.contentOffset.x / width)));
      setIndex(i);
      onIndexChange?.(i);
    },
    [width, count, onIndexChange],
  );

  /** The players of the video slides, by slide: read when one is tapped, moved when the viewer hands a time back. */
  const players = useRef(new Map<number, VideoPlayer>());
  const onPlayer = useCallback((i: number, player: VideoPlayer | null) => {
    if (player) players.current.set(i, player);
    else players.current.delete(i);
  }, []);
  const timeAt = (i: number): number | null => {
    const p = players.current.get(i);
    return p && Number.isFinite(p.currentTime) ? p.currentTime : null;
  };

  /** The jump last carried out: each one is carried out once, never again on a later layout. */
  const jumped = useRef<typeof jump>(null);
  useEffect(() => {
    if (!jump || !width || jumped.current === jump) return;
    jumped.current = jump;
    const i = Math.max(0, Math.min(count - 1, jump.index));
    if (count > 1) {
      listRef.current?.scrollToIndex({ index: i, animated: false });
      resting.current = i * width;
      setIndex(i);
      onIndexChange?.(i);
    }
    const player = players.current.get(i);
    // Not a player still in the viewer's hands, or that is already there (one that played on in the viewer itself): a
    // seek would only stutter it. Measured round the loop, so a video that has just come round is not sent back.
    if (!player || isLent(player) || typeof jump.time !== "number" || !Number.isFinite(jump.time)) return;
    const apart = Math.abs(player.currentTime - jump.time);
    const length = player.duration > 0 ? player.duration : Infinity;
    if (Math.min(apart, length - apart) > 0.5) player.currentTime = jump.time;
    // Only a new jump moves the carousel; a swipe in the feed after it stays where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, width]);

  const lastTap = useRef(0);
  const single = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (single.current && clearTimeout(single.current)), []);
  function tap() {
    // The end of a swipe the pager took: not a tap on the photo.
    if (handedOver.current) return;
    // Read at the moment it opens (after the wait for a second tap), so a full-screen view starts where the video is.
    // The viewer borrows the player as it opens (see openViewer); one already lent means a viewer is on its way.
    const press = onPress
      ? () => {
          const player = CAN_SHARE_PLAYERS ? (players.current.get(index) ?? null) : null;
          if (player && isLent(player)) return;
          onPress({ time: timeAt(index), player });
        }
      : undefined;
    if (!onDoubleTap) return press?.();
    const now = Date.now();
    if (single.current) clearTimeout(single.current);
    single.current = null;
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onDoubleTap();
      return;
    }
    lastTap.current = now;
    if (press) single.current = setTimeout(press, DOUBLE_TAP_MS);
  }
  const go = (i: number) => listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(count - 1, i)), animated: true });

  if (count === 0) return null;
  return (
    <View style={{ width: "100%", backgroundColor: colors.mediaBg }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        // The touches over the list, read for a swipe past the first or last photo (see above); every swipe stays the list's own too.
        <View onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          <FlatList
            ref={listRef}
            data={media}
            horizontal
            pagingEnabled
            // A single photo has nothing to slide: leave sideways swipes to the Home pager around it.
            scrollEnabled={count > 1}
            // On a pager of sections the ends stay put, so a swipe past them belongs to the pager (see above).
            bounces={!sectionPager}
            overScrollMode={sectionPager ? "never" : undefined}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(m, i) => `${i}-${m.type === "photo" ? m.url : m.playbackUrl}`}
            onMomentumScrollEnd={onScroll}
            onScrollEndDrag={onScroll}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            renderItem={({ item, index: i }) => (
              <Pressable onPress={tap} style={{ width, height }}>
                {item.type === "photo" ? (
                  // The tiny blurred preview saved at upload shows at once, and the full photo fades in over it: no blank frames.
                  <Image source={{ uri: item.url }} placeholder={item.blur ? { uri: item.blur } : undefined} placeholderContentFit="cover" style={{ width, height }} contentFit="cover" transition={250} accessibilityLabel={`Photo ${i + 1} of ${count}`} />
                ) : (
                  <VideoSlide media={item} index={i} width={width} height={height} playing={active && i === index} onPlayer={onPlayer} watch={watch} />
                )}
              </Pressable>
            )}
          />
        </View>
      ) : (
        <View style={{ width: "100%", aspectRatio: aspect }} />
      )}
      {count > 1 ? (
        <>
          <View style={[styles.counter, watch && styles.counterLeft]} accessibilityLabel={`${index + 1} of ${count}`}>
            <Text style={styles.counterText}>
              {index + 1}/{count}
            </Text>
          </View>
          {dots ? (
            <View style={[styles.dots, watch && styles.dotsWatch]} accessibilityRole="tablist">
              {media.map((_, i) => (
                <Pressable key={i} onPress={() => go(i)} hitSlop={6} accessibilityRole="tab" accessibilityState={{ selected: i === index }} style={[styles.dot, i === index && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {videoLabel && !watch && media[0]?.type === "video" ? (
        <View style={styles.videoBadge}>
          <Icon name="videocam" size={13} color={colors.onMedia} />
          <Text style={styles.videoBadgeText}>{videoLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

function VideoSlide({ media, index, width, height, playing, onPlayer, watch = false }: { media: Extract<FeedMedia, { type: "video" }>; index: number; width: number; height: number; playing: boolean; onPlayer: (index: number, player: VideoPlayer | null) => void; watch?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const player = useLendablePlayer(media.playbackUrl, (p) => {
    p.loop = true;
    p.muted = videosMuted();
    p.audioMixingMode = VIDEO_AUDIO_MODE;
    // The watch look's time left and progress line: four reports a second is smooth enough for a thin line.
    if (watch) p.timeUpdateEventInterval = 0.25;
  });
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (!watch) return;
    const sub = player.addListener("timeUpdate", ({ currentTime }) => setTime(currentTime));
    return () => sub.remove();
  }, [player, watch]);
  useEffect(() => {
    onPlayer(index, player);
    return () => onPlayer(index, null);
  }, [onPlayer, index, player]);
  const muted = useVideosMuted();
  const [hasFrame, setHasFrame] = useState(false);
  // Only on the screen on show: a tab or screen left behind (they stay mounted) never plays on unseen, which with one
  // sound switch for every video could be heard.
  const onScreen = useIsFocused();
  const shouldPlay = playing && onScreen;
  // While the full-screen viewer plays this player on, it is the viewer's to run; back here, this slide takes charge again.
  // Only what changes is touched: a player already doing the right thing is left alone, so it never hitches.
  const lendings = useLendings();
  useEffect(() => {
    if (isLent(player)) return;
    if (!shouldPlay) player.pause();
    else if (!player.playing) player.play();
  }, [shouldPlay, player, lendings]);
  // The sound follows the one switch even while lent: the viewer sets the same, so the two never disagree, and a lent
  // player no page of the viewer holds (it went past) still hears a change.
  useEffect(() => {
    if (player.muted !== muted) player.muted = muted;
  }, [muted, player]);
  // The sound button goes quietly as the video goes full screen (before the viewer's zoom covers it) and comes back
  // the same way once the video is back here, rather than vanishing under the zoom and popping back after it.
  const away = isLent(player);
  const control = useRef(new Animated.Value(away ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(control, { toValue: away ? 0 : 1, duration: away ? 120 : 220, useNativeDriver: true }).start();
  }, [away, control]);
  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }}>
      <VideoView
        player={player}
        style={{ width, height }}
        contentFit="cover"
        nativeControls={false}
        allowsVideoFrameAnalysis={false}
        onFirstFrameRender={() => {
          setHasFrame(true);
          markDrawn(player);
        }}
      />
      {/* Poster stays on top until the first video frame is painted, so the slide is never a black box. */}
      {media.poster && !hasFrame ? <Image source={{ uri: media.poster }} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /> : null}
      <Animated.View style={[watch ? styles.muteTop : styles.mute, { opacity: control }]} pointerEvents={away ? "none" : "box-none"}>
        <GlassIconButton icon={muted ? "volume-mute" : "volume-high"} label={muted ? "Unmute" : "Mute"} onPress={() => setVideosMuted(!muted)} variant="media" size={32} iconSize={15} haptic="select" />
      </Animated.View>
      {watch ? <WatchTimeline duration={media.durationSeconds ?? (player.duration > 0 ? player.duration : null)} time={shouldPlay || time > 0 ? time : 0} /> : null}
    </View>
  );
}

/** The watch look's time left (the whole length before it starts) and the line of how far it has played. */
function WatchTimeline({ duration, time }: { duration: number | null; time: number }) {
  const styles = useStyles();
  if (!duration) return null;
  const played = Math.min(1, Math.max(0, time / duration));
  return (
    <>
      <View style={styles.timePill} pointerEvents="none">
        <Text style={styles.timeText}>{clock(duration - time)}</Text>
      </View>
      <View style={styles.track} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.progress, { width: `${played * 100}%` }]} />
      </View>
    </>
  );
}

// Everything here sits on the photo or video, so it uses the media colours, which are the same in both themes.
const useStyles = makeStyles((colors) => ({
  counter: { position: "absolute", top: 10, right: 10, backgroundColor: colors.mediaPill, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  counterText: { color: colors.onMedia, fontSize: 12, fontWeight: "700" },
  dots: { position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onMediaMuted },
  dotActive: { width: 18, backgroundColor: colors.onMedia },
  videoBadge: { position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.mediaPill, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  videoBadgeText: { color: colors.onMedia, fontSize: 12, fontWeight: "700" },
  mute: { position: "absolute", right: 10, bottom: 28 },
  // The watch look.
  counterLeft: { right: undefined, left: 10 },
  dotsWatch: { bottom: 12 },
  muteTop: { position: "absolute", right: 10, top: 10 },
  timePill: { position: "absolute", right: 10, bottom: 12, backgroundColor: colors.mediaPill, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  timeText: { color: colors.onMedia, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.28)" },
  progress: { height: 3, backgroundColor: colors.brand },
}));

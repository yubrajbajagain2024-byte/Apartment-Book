import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { CAN_SHARE_PLAYERS, isLent, lendPlayer, useLendings } from "@/lib/video-handoff";
import type { FeedMedia } from "@apartment-book/shared";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { hapticSelect } from "@/lib/haptics";
import { Icon } from "@/components/icon";
import { GlassIconButton } from "@/components/glass";

const DOUBLE_TAP_MS = 260;

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
};

/**
 * Swipeable photos and videos, one slide at a time, with a 1/3 counter and dots.
 * `videoLabel` is the pill shown when the first slide is a video: "Video tour" suits listings; pass another word, or null for no pill.
 */
export function PhotoCarousel({ media, aspect = 4 / 5, onPress, onDoubleTap, active = true, videoLabel = "Video tour", dots = true, onIndexChange, jump }: PhotoCarouselProps) {
  const colors = useColors();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<FeedMedia>>(null);
  const height = width ? width / aspect : 0;
  const count = media.length;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!width) return;
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

  useEffect(() => {
    if (!jump || !width) return;
    const i = Math.max(0, Math.min(count - 1, jump.index));
    if (count > 1) {
      listRef.current?.scrollToIndex({ index: i, animated: false });
      setIndex(i);
      onIndexChange?.(i);
    }
    const player = players.current.get(i);
    // Not a player that played on in the viewer itself (it is already there): a seek would only stutter it.
    if (player && typeof jump.time === "number" && Number.isFinite(jump.time) && Math.abs(player.currentTime - jump.time) > 0.5) player.currentTime = jump.time;
    // Only a new jump moves the carousel; a swipe in the feed after it stays where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, width]);

  const lastTap = useRef(0);
  const single = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (single.current && clearTimeout(single.current)), []);
  function tap() {
    // Read at the moment it opens (after the wait for a second tap), so a full-screen view starts where the video is.
    const press = onPress
      ? () => {
          const player = CAN_SHARE_PLAYERS ? (players.current.get(index) ?? null) : null;
          // Lent at once, before the screen changes: this feed no longer pauses it as it loses focus, so it never stops.
          if (player) lendPlayer(player);
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
        <FlatList
          ref={listRef}
          data={media}
          horizontal
          pagingEnabled
          // A single photo has nothing to slide: leave sideways swipes to the Home pager around it.
          scrollEnabled={count > 1}
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
                <VideoSlide media={item} index={i} width={width} height={height} playing={active && i === index} onPlayer={onPlayer} />
              )}
            </Pressable>
          )}
        />
      ) : (
        <View style={{ width: "100%", aspectRatio: aspect }} />
      )}
      {count > 1 ? (
        <>
          <View style={styles.counter} accessibilityLabel={`${index + 1} of ${count}`}>
            <Text style={styles.counterText}>
              {index + 1}/{count}
            </Text>
          </View>
          {dots ? (
            <View style={styles.dots} accessibilityRole="tablist">
              {media.map((_, i) => (
                <Pressable key={i} onPress={() => go(i)} hitSlop={6} accessibilityRole="tab" accessibilityState={{ selected: i === index }} style={[styles.dot, i === index && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {videoLabel && media[0]?.type === "video" ? (
        <View style={styles.videoBadge}>
          <Icon name="videocam" size={13} color={colors.onMedia} />
          <Text style={styles.videoBadgeText}>{videoLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

let soundOn = false;

function VideoSlide({ media, index, width, height, playing, onPlayer }: { media: Extract<FeedMedia, { type: "video" }>; index: number; width: number; height: number; playing: boolean; onPlayer: (index: number, player: VideoPlayer | null) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const player = useVideoPlayer({ uri: media.playbackUrl }, (p) => {
    p.loop = true;
    p.muted = !soundOn;
  });
  useEffect(() => {
    onPlayer(index, player);
    return () => onPlayer(index, null);
  }, [onPlayer, index, player]);
  const [muted, setMuted] = useState(!soundOn);
  const [hasFrame, setHasFrame] = useState(false);
  // While the full-screen viewer plays this player on, it is the viewer's to run; back here, this slide takes charge again.
  const lendings = useLendings();
  useEffect(() => {
    if (isLent(player)) return;
    if (playing) player.play();
    else player.pause();
  }, [playing, player, lendings]);
  useEffect(() => {
    if (isLent(player)) return;
    player.muted = muted;
  }, [muted, player, lendings]);
  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }}>
      <VideoView player={player} style={{ width, height }} contentFit="cover" nativeControls={false} allowsVideoFrameAnalysis={false} onFirstFrameRender={() => setHasFrame(true)} />
      {/* Poster stays on top until the first video frame is painted, so the slide is never a black box. */}
      {media.poster && !hasFrame ? <Image source={{ uri: media.poster }} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /> : null}
      <GlassIconButton
        icon={muted ? "volume-mute" : "volume-high"}
        label={muted ? "Unmute" : "Mute"}
        onPress={() => {
          soundOn = muted;
          setMuted(!muted);
        }}
        variant="media"
        size={32}
        iconSize={15}
        haptic="select"
        style={styles.mute}
      />
    </View>
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
}));

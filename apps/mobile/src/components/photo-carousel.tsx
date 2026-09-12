import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import type { FeedMedia } from "@apartment-book/shared";
import { colors } from "@/lib/theme";

/** Swipeable photos and videos, one slide at a time, with a 1/3 counter and dots. */
export function PhotoCarousel({ media, aspect = 4 / 5, onPress, active = true }: { media: FeedMedia[]; aspect?: number; onPress?: () => void; active?: boolean }) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<FeedMedia>>(null);
  const height = width ? width / aspect : 0;
  const count = media.length;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!width) return;
      const i = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(Math.max(0, Math.min(count - 1, i)));
    },
    [width, count],
  );
  const go = (i: number) => listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(count - 1, i)), animated: true });

  if (count === 0) return null;
  return (
    <View style={{ width: "100%", backgroundColor: "#000" }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <FlatList
          ref={listRef}
          data={media}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(m, i) => `${i}-${m.type === "photo" ? m.url : m.playbackUrl}`}
          onMomentumScrollEnd={onScroll}
          onScrollEndDrag={onScroll}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          renderItem={({ item, index: i }) => (
            <Pressable onPress={onPress} style={{ width, height }}>
              {item.type === "photo" ? (
                <Image source={{ uri: item.url }} style={{ width, height }} contentFit="cover" transition={200} accessibilityLabel={`Photo ${i + 1} of ${count}`} />
              ) : (
                <VideoSlide media={item} width={width} height={height} playing={active && i === index} />
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
          <View style={styles.dots} accessibilityRole="tablist">
            {media.map((_, i) => (
              <Pressable key={i} onPress={() => go(i)} hitSlop={6} accessibilityRole="tab" accessibilityState={{ selected: i === index }} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>
        </>
      ) : null}
      {media[0]?.type === "video" ? (
        <View style={styles.videoBadge}>
          <Ionicons name="videocam" size={13} color="#fff" />
          <Text style={styles.videoBadgeText}>Video tour</Text>
        </View>
      ) : null}
    </View>
  );
}

let soundOn = false;

function VideoSlide({ media, width, height, playing }: { media: Extract<FeedMedia, { type: "video" }>; width: number; height: number; playing: boolean }) {
  const player = useVideoPlayer({ uri: media.playbackUrl }, (p) => {
    p.loop = true;
    p.muted = !soundOn;
  });
  const [muted, setMuted] = useState(!soundOn);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  return (
    <View style={{ width, height }}>
      {media.poster ? <Image source={{ uri: media.poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <VideoView player={player} style={{ width, height }} contentFit="cover" nativeControls={false} />
      <Pressable
        onPress={() => {
          soundOn = muted;
          setMuted(!muted);
        }}
        accessibilityRole="button" accessibilityLabel={muted ? "Unmute" : "Mute"}
        style={styles.mute}
      >
        <Ionicons name={muted ? "volume-mute" : "volume-high"} size={16} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  counter: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  counterText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  dots: { position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.6)" },
  dotActive: { width: 18, backgroundColor: "#fff" },
  videoBadge: { position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  videoBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  mute: { position: "absolute", right: 10, bottom: 28, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
});

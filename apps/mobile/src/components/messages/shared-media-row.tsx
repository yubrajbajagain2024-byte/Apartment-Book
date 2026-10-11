import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { SharedItem } from "@apartment-book/shared";
import { formatDuration } from "@/lib/message-attachments";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useVideoFrame } from "./shared-video-thumb";

/**
 * One row of a chat's Media grid: up to three squares, `gap` apart, `start` being the first one's place in the whole tab
 * (what `onOpen` gets back, to open the viewer there). `urls` are the signed URLs by storage path.
 */
export function SharedMediaRow({
  items,
  start,
  size,
  gap,
  urls,
  labelFor,
  onOpen,
}: {
  items: SharedItem[];
  start: number;
  size: number;
  gap: number;
  urls: Record<string, string>;
  labelFor: (item: SharedItem) => string;
  onOpen: (index: number) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap, marginBottom: gap }}>
      {items.map((item, i) => (
        <SharedMediaTile
          key={`${item.messageId}:${start + i}`}
          item={item}
          index={start + i}
          size={size}
          url={item.attachment ? urls[item.attachment.path] : undefined}
          label={labelFor(item)}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

/**
 * A photo or video square. Photos load from their signed URL with the storage path as the cache key, so a URL signed
 * again later is not downloaded again; website photos from before attachments load from their public URL. Videos show
 * their first frame once it is ready (a dark tile until then), with a play mark and the length. GIFs hold still here.
 * Re-renders only when its own URL or label changes.
 */
const SharedMediaTile = memo(function SharedMediaTile({ item, index, size, url, label, onOpen }: { item: SharedItem; index: number; size: number; url: string | undefined; label: string; onOpen: (index: number) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const video = item.kind === "video";
  const path = item.attachment?.path;
  const frame = useVideoFrame(video ? path : null, video ? url : null);
  const source = item.legacyImageUrl ? { uri: item.legacyImageUrl } : !video && url && path ? { uri: url, cacheKey: path } : frame;
  const duration = video ? formatDuration(item.attachment?.duration) : "";
  return (
    <Pressable
      onPress={() => onOpen(index)}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, { width: size, height: size }, video && styles.videoTile, pressed && styles.pressed]}
    >
      {source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} autoplay={false} recyclingKey={path ?? item.legacyImageUrl ?? null} accessible={false} /> : null}
      {video && !frame ? (
        <View style={styles.center} pointerEvents="none">
          <Ionicons name="videocam" size={26} color={colors.onMediaMuted} />
        </View>
      ) : null}
      {video ? (
        <View style={styles.badge} pointerEvents="none">
          <Ionicons name="play" size={10} color={colors.onMedia} />
          {duration ? <Text style={styles.duration}>{duration}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const useStyles = makeStyles((colors) => ({
  tile: { backgroundColor: colors.skeleton, overflow: "hidden" },
  videoTile: { backgroundColor: colors.mediaBg },
  pressed: { opacity: 0.8 },
  center: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", left: 6, bottom: 6, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.mediaPill, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  duration: { color: colors.onMedia, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
}));

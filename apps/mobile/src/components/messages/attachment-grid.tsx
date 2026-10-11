import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { formatDuration, type UploadStatus } from "@/lib/message-attachments";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { VideoPoster } from "./attachment-thumb";

/** One photo or video of a message, ready to draw: `uri` is a local file or a signed URL (null until signed). */
export type GridMedia = {
  key: string;
  kind: "image" | "video";
  uri: string | null;
  /** The storage path: keeps the cached picture when the signed URL changes. */
  cacheKey?: string;
  width?: number | null;
  height?: number | null;
  /** Seconds. */
  duration?: number | null;
  /** Set while the message is being sent from this device. */
  status?: UploadStatus;
};

const GAP = 2;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A message's photos and videos as one rounded block, like X: one keeps its shape, two sit side by side, three are a
 * tall one and two squares, four or more a 2×2 grid whose last square says "+N". Tapping one opens it at that index.
 */
export function AttachmentGrid({ media, width, onOpen, onLongPress }: { media: GridMedia[]; width: number; onOpen: (index: number) => void; onLongPress?: () => void }) {
  const styles = useStyles();
  const count = media.length;
  if (count === 0) return null;
  const tile = (i: number, w: number, h: number, more = 0) => <Tile key={media[i].key} item={media[i]} index={i} total={count} width={w} height={h} more={more} onOpen={onOpen} onLongPress={onLongPress} />;
  if (count === 1) {
    const only = media[0];
    const ratio = only.width && only.height ? clamp(only.width / only.height, 0.65, 1.8) : only.kind === "video" ? 16 / 9 : 1;
    return <View style={[styles.block, { width }]}>{tile(0, width, Math.round(width / ratio))}</View>;
  }
  const half = Math.floor((width - GAP) / 2);
  if (count === 2) {
    const h = Math.round(half * 1.3);
    return (
      <View style={[styles.block, styles.row, { width: half * 2 + GAP }]}>
        {tile(0, half, h)}
        {tile(1, half, h)}
      </View>
    );
  }
  if (count === 3) {
    return (
      <View style={[styles.block, styles.row, { width: half * 2 + GAP }]}>
        {tile(0, half, half * 2 + GAP)}
        <View style={styles.column}>
          {tile(1, half, half)}
          {tile(2, half, half)}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.block, styles.column, { width: half * 2 + GAP }]}>
      <View style={styles.row}>
        {tile(0, half, half)}
        {tile(1, half, half)}
      </View>
      <View style={styles.row}>
        {tile(2, half, half)}
        {tile(3, half, half, count - 4)}
      </View>
    </View>
  );
}

function Tile({
  item,
  index,
  total,
  width,
  height,
  more,
  onOpen,
  onLongPress,
}: {
  item: GridMedia;
  index: number;
  total: number;
  width: number;
  height: number;
  more: number;
  onOpen: (index: number) => void;
  onLongPress?: () => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const video = item.kind === "video";
  const duration = video ? formatDuration(item.duration) : "";
  const busy = item.status !== undefined && item.status !== "done";
  const label = `${video ? "Video" : "Photo"} ${index + 1} of ${total}${duration ? `, ${duration}` : ""}${more > 0 ? `, and ${more} more` : ""}`;
  return (
    <Pressable
      onPress={() => onOpen(index)}
      onLongPress={onLongPress}
      disabled={!item.uri}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, { width, height }, pressed && { opacity: 0.85 }]}
    >
      {video ? (
        <VideoPoster cacheKey={item.cacheKey ?? item.key} uri={item.uri} style={StyleSheet.absoluteFill} />
      ) : item.uri ? (
        <Image source={{ uri: item.uri, cacheKey: item.cacheKey }} recyclingKey={item.key} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : null}
      {video && !busy ? (
        <View style={[styles.center, { pointerEvents: "none" }]}>
          <View style={styles.play}>
            <Ionicons name="play" size={22} color={colors.onMedia} style={{ marginLeft: 3 }} />
          </View>
        </View>
      ) : null}
      {video && duration ? (
        <View style={[styles.duration, { pointerEvents: "none" }]}>
          <Text style={styles.durationText}>{duration}</Text>
        </View>
      ) : null}
      {more > 0 ? (
        <View style={[styles.center, styles.scrim, { pointerEvents: "none" }]}>
          <Text style={styles.more}>+{more}</Text>
        </View>
      ) : null}
      {busy ? (
        <View style={[styles.center, styles.scrim, { pointerEvents: "none" }]}>
          {item.status === "uploading" ? <ActivityIndicator color={colors.onMedia} /> : item.status === "failed" ? <Ionicons name="alert-circle" size={28} color={colors.onMedia} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  block: { borderRadius: radius.lg, overflow: "hidden", gap: GAP },
  row: { flexDirection: "row", gap: GAP },
  column: { gap: GAP },
  tile: { backgroundColor: colors.skeleton, overflow: "hidden" },
  center: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  scrim: { backgroundColor: colors.mediaScrim },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
  duration: { position: "absolute", left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.mediaPill },
  durationText: { color: colors.onMedia, fontSize: 11, fontWeight: "700" },
  more: { color: colors.onMedia, fontSize: 24, fontWeight: "800" },
}));

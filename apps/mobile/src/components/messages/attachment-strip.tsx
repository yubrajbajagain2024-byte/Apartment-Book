import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { formatFileSize } from "@apartment-book/shared";
import { fileExtension, formatDuration, type PendingAttachment } from "@/lib/message-attachments";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { fileIcon } from "./attachment-file-row";
import { VideoPoster } from "./attachment-thumb";

/** What is about to be sent, above the message field: photo and video thumbnails and file chips, each removable. */
export function AttachmentStrip({ items, onRemove }: { items: PendingAttachment[]; onRemove: (id: string) => void }) {
  const styles = useStyles();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.strip} accessibilityLabel="Attachments">
      {items.map((item) => (item.kind === "file" ? <FileChip key={item.id} item={item} onRemove={onRemove} /> : <MediaThumb key={item.id} item={item} onRemove={onRemove} />))}
    </ScrollView>
  );
}

function MediaThumb({ item, onRemove }: { item: PendingAttachment; onRemove: (id: string) => void }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.thumb} accessible accessibilityLabel={`${item.kind === "video" ? "Video" : "Photo"}: ${item.name}`}>
      {item.kind === "video" ? <VideoPoster cacheKey={item.id} uri={item.uri} style={StyleSheet.absoluteFill} /> : <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={100} />}
      {item.kind === "video" ? (
        <View style={[styles.badge, { pointerEvents: "none" }]}>
          <Ionicons name="videocam" size={11} color={colors.onMedia} />
          <Text style={styles.badgeText}>{formatDuration(item.duration) || "Video"}</Text>
        </View>
      ) : null}
      <RemoveButton label={`Remove ${item.name}`} onPress={() => onRemove(item.id)} />
    </View>
  );
}

function FileChip({ item, onRemove }: { item: PendingAttachment; onRemove: (id: string) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const meta = [fileExtension(item.name), item.size > 0 ? formatFileSize(item.size) : null].filter(Boolean).join(" · ");
  return (
    <View style={styles.file} accessible accessibilityLabel={`File: ${item.name}${meta ? `, ${meta}` : ""}`}>
      <View style={styles.fileIcon}>
        <Ionicons name={fileIcon(item)} size={20} color={colors.brand} />
      </View>
      <View style={styles.fileBody}>
        <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">
          {item.name}
        </Text>
        {meta ? <Text style={styles.fileMeta}>{meta}</Text> : null}
      </View>
      <RemoveButton label={`Remove ${item.name}`} onPress={() => onRemove(item.id)} />
    </View>
  );
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={styles.remove}>
      <Ionicons name="close" size={13} color={colors.onMedia} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  strip: { gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 },
  thumb: { width: 68, height: 68, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.skeleton },
  badge: { position: "absolute", left: 4, bottom: 4, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.mediaPill },
  badgeText: { color: colors.onMedia, fontSize: 10, fontWeight: "700" },
  file: {
    width: 200,
    height: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 10,
    paddingRight: 26,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  fileIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  fileBody: { flex: 1, minWidth: 0, gap: 2 },
  fileName: { fontSize: 13, fontWeight: "600", color: colors.text },
  fileMeta: { fontSize: 11, color: colors.muted },
  remove: { position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.mediaPill, alignItems: "center", justifyContent: "center" },
}));

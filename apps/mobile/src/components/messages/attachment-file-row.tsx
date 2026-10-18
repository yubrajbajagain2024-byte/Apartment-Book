import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatFileSize, type MessageAttachment } from "@apartment-book/shared";
import { fileExtension, openInBrowser, openMessageFile, type UploadStatus } from "@/lib/message-attachments";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

type IconName = keyof typeof Ionicons.glyphMap;

/** A recognisable icon per kind of file. */
export function fileIcon(attachment: Pick<MessageAttachment, "mime" | "name" | "kind">): IconName {
  const mime = attachment.mime.toLowerCase();
  const ext = fileExtension(attachment.name).toLowerCase();
  if (attachment.kind === "image" || mime.startsWith("image/")) return "image-outline";
  if (attachment.kind === "video" || mime.startsWith("video/")) return "videocam-outline";
  if (mime.includes("zip") || ext === "zip") return "archive-outline";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv" || ["xls", "xlsx", "csv"].includes(ext)) return "grid-outline";
  if (mime.includes("presentation") || mime.includes("powerpoint") || ["ppt", "pptx"].includes(ext)) return "easel-outline";
  if (mime === "application/pdf" || mime.includes("word") || mime.includes("rtf") || mime.startsWith("text/")) return "document-text-outline";
  return "document-outline";
}

/**
 * One file in a chat: its icon, name and "PDF · 3.4 MB". Tapping opens it in the in-app browser: `onPress` when given,
 * else `url`, else a fresh signed link for `attachment.path`. `status` shows a spinner or a warning while sending.
 */
export function AttachmentFileRow({
  attachment,
  url,
  onPress,
  onLongPress,
  status,
  style,
}: {
  attachment: MessageAttachment;
  url?: string | null;
  onPress?: () => void;
  onLongPress?: () => void;
  status?: UploadStatus;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const styles = useStyles();
  const ext = fileExtension(attachment.name);
  const meta = [ext, attachment.size > 0 ? formatFileSize(attachment.size) : null].filter(Boolean).join(" · ");
  const open = onPress ?? (url ? () => void openInBrowser(url, colors.brand) : attachment.path ? () => void openMessageFile(attachment, colors.brand) : undefined);
  return (
    <Pressable
      onPress={open}
      onLongPress={onLongPress}
      disabled={!open && !onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${attachment.name}${meta ? `, ${meta}` : ""}`}
      accessibilityHint={open ? "Opens the file" : undefined}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }, style]}
    >
      <View style={styles.icon}>
        <Ionicons name={fileIcon(attachment)} size={22} color={colors.brand} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
          {attachment.name}
        </Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      {status === "uploading" ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : status === "failed" ? (
        <Ionicons name="alert-circle" size={20} color={colors.red} accessibilityLabel="Not sent" />
      ) : status === "waiting" ? (
        <Ionicons name="time-outline" size={18} color={colors.faint} accessibilityLabel="Waiting to upload" />
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  icon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
}));

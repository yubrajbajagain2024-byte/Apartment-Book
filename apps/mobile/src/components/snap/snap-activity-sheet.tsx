import { ScrollView, StyleSheet, Text, View } from "react-native";
import { formatMessageTime, snapActivityLabel, snapDetectionOf, snapDetectionText, snapState, type MessageSnap, type SnapActivity } from "@apartment-book/shared";
import { Icon, type IconName } from "@/components/icon";
import { Sheet, SheetHeader } from "@/components/sheet";
import { Button } from "@/components/ui";
import { SNAP_DETECTION } from "@/lib/snap-capture-guard";
import { makeStyles, useColors } from "@/lib/theme-provider";

const ICONS: Record<SnapActivity["type"], IconName> = {
  delivered: "checkmark-circle-outline",
  opened: "eye-outline",
  screenshot: "camera-outline",
  recording: "videocam-outline",
  deleted: "arrow-undo-outline",
  expired: "time-outline",
};

/** What this phone tells the sender, for the recipient's own information. */
function yourDeviceText(): string {
  switch (SNAP_DETECTION) {
    case "ios":
      return "The sender is told when you take a screenshot. While a Snap is open the screen goes black if it is recorded or mirrored.";
    case "android":
      return "Screenshots and screen recordings are blocked while a Snap is open, so the sender is never told of one.";
    default:
      return "This build can't detect screenshots, and the sender is told that nothing on it would be reported.";
  }
}

/**
 * A Snap's story, Snapchat style, for either side of the chat: sent, delivered, opened, any screenshot or screen
 * recording, deleted, expired, each with its time, newest last; under it, what can and cannot be known about captures
 * (never more than the viewer's device reported), and for the sender of a Snap still waiting, Delete Snap.
 */
export function SnapActivitySheet({
  snap,
  mine,
  sentAt,
  visible,
  onClose,
  onDelete,
}: {
  snap: MessageSnap | null;
  mine: boolean;
  sentAt: string | null;
  visible: boolean;
  onClose: () => void;
  /** Offered to the sender while the Snap still waits. */
  onDelete?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const entries = snap?.activity ?? [];
  const canDelete = Boolean(snap && mine && onDelete && snapState(snap) === "new");
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close Snap activity" maxHeight="80%">
      <SheetHeader title="Snap activity" onClose={onClose} closeLabel="Close Snap activity" />
      <ScrollView contentContainerStyle={styles.body} bounces={false}>
        {snap ? (
          <>
            <Row icon="paper-plane-outline" label={mine ? "Sent" : "Received"} at={sentAt} />
            {entries.map((entry, i) => (
              <Row key={`${entry.type}:${entry.at}:${i}`} icon={ICONS[entry.type]} label={snapActivityLabel(entry, mine)} at={entry.at} />
            ))}
            <View style={styles.note}>
              <Icon name="shield-checkmark-outline" size={16} color={colors.muted} />
              <Text style={styles.noteText}>{mine ? snapDetectionText(snapDetectionOf(snap)) : yourDeviceText()}</Text>
            </View>
            {canDelete ? (
              <View style={styles.actions}>
                <Button title="Delete Snap" variant="danger" onPress={onDelete} />
                <Text style={styles.hint}>Takes it back before it is opened. The chat shows that it was deleted.</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/** One entry, as a quiet iOS list row: a grey symbol in a soft circle, the words, the time. Every kind looks the same. */
function Row({ icon, label, at }: { icon: IconName; label: string; at: string | null }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}${at ? `, ${formatMessageTime(at)}` : ""}`}>
      <View style={styles.iconBox}>
        <Icon name={icon} size={16} color={colors.muted} />
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.time}>{at ? formatMessageTime(at) : ""}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconBox: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, fontSize: 15, color: colors.text },
  time: { fontSize: 13, color: colors.muted, fontVariant: ["tabular-nums"] },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 14 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.muted },
  actions: { marginTop: 18, gap: 8 },
  hint: { fontSize: 12, lineHeight: 16, color: colors.muted, textAlign: "center" },
}));

import { Pressable, Text, View, type ViewStyle } from "react-native";
import { snapState, snapStatusText, type MessageSnap } from "@apartment-book/shared";
import { Icon, type IconName } from "@/components/icon";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/**
 * A Snap in a chat: never its picture, only what became of it. Its recipient sees "New Snap · Tap to view" on an Aurora
 * tile and opens it (once); then "Opened", or "Expired" when 31 days went by first. Its sender sees "Delivered", then
 * the same. A Snap that is over keeps a hollow tile.
 */
export function SnapBubble({
  snap,
  mine,
  dimmed,
  corners,
  onOpen,
  onLongPress,
}: {
  snap: MessageSnap;
  mine: boolean;
  dimmed?: boolean;
  /** The run's corner radii, as text bubbles have them. */
  corners?: ViewStyle;
  onOpen?: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles();
  const fresh = snapState(snap) === "new";
  const canOpen = fresh && !mine && Boolean(onOpen);
  const video = snap.kind === "video";
  const title = canOpen ? "New Snap" : video ? "Video Snap" : "Snap";
  const status = canOpen ? `Tap to view · ${video ? "Video" : "Photo"}` : snapStatusText(snap, mine);
  const icon: IconName = mine ? (fresh ? "send" : "paper-plane-outline") : video ? (fresh ? "videocam" : "videocam-outline") : fresh ? "camera" : "camera-outline";
  return (
    <Pressable
      onPress={canOpen ? onOpen : undefined}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole={canOpen ? "button" : undefined}
      accessibilityLabel={`${title}, ${status}`}
      accessibilityHint={canOpen ? "Opens it once. It disappears after you view it." : undefined}
      style={({ pressed }) => [styles.bubble, mine ? styles.mine : styles.theirs, corners, dimmed && styles.dim, pressed && canOpen && styles.pressed]}
    >
      <View style={[styles.tile, fresh ? { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) } : styles.tileSpent]}>
        <Icon name={icon} size={18} color={fresh ? colors.onBrand : colors.faint} weight="semibold" />
      </View>
      <View style={styles.words}>
        <Text style={[styles.title, !fresh && styles.titleSpent]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.status} numberOfLines={1}>
          {status}
        </Text>
      </View>
      {canOpen ? <Icon name="chevron-forward" size={14} color={colors.faint} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  bubble: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 180, borderRadius: 18, borderCurve: "continuous", paddingLeft: 8, paddingRight: 14, paddingVertical: 8 },
  theirs: { backgroundColor: colors.input },
  mine: { backgroundColor: colors.brandSoft },
  dim: { opacity: 0.6 },
  pressed: { opacity: 0.8 },
  tile: { width: 36, height: 36, borderRadius: 11, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  tileSpent: { borderWidth: 1.5, borderColor: colors.border },
  words: { flexShrink: 1, gap: 1 },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  titleSpent: { fontWeight: "600" },
  status: { fontSize: 13, color: colors.muted },
}));

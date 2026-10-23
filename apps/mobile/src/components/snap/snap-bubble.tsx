import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { snapState, snapStatusText, type MessageSnap } from "@apartment-book/shared";
import { Icon, type IconName } from "@/components/icon";
import { auroraGradient, radius } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A Snap in a chat. While it waits it is a photo or video bubble at the Snap's own shape (as a sent photo would be), but
 * blurred past recognition: its tiny preview, or the Aurora for one sent without a preview. Over it, "Tap to view" for its
 * recipient (one tap opens it, once) and "Delivered" for its sender. Once opened, expired or gone it shrinks to a small
 * card that says so, with no picture at all: the database has taken the preview off the message by then.
 */
export function SnapBubble({
  snap,
  mine,
  width,
  dimmed,
  corners,
  onOpen,
  onLongPress,
}: {
  snap: MessageSnap;
  mine: boolean;
  /** The chat's width for photos and videos. */
  width: number;
  dimmed?: boolean;
  /** The run's corner radii, as text bubbles have them (used by the small card). */
  corners?: ViewStyle;
  onOpen?: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles();
  const fresh = snapState(snap) === "new";
  const video = snap.kind === "video";
  const canOpen = fresh && !mine && Boolean(onOpen);

  if (fresh) {
    const ratio = snap.width && snap.height ? clamp(snap.width / snap.height, 0.65, 1.8) : video ? 9 / 16 : 3 / 4;
    const height = Math.round(width / ratio);
    const label = mine ? "Delivered" : "Tap to view";
    const icon: IconName = mine ? "send" : video ? "play" : "eye-outline";
    return (
      <Pressable
        onPress={canOpen ? onOpen : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole={canOpen ? "button" : undefined}
        accessibilityLabel={`${video ? "Video" : "Photo"} Snap, ${label}`}
        accessibilityHint={canOpen ? "Opens it once. It disappears after you view it." : undefined}
        style={({ pressed }) => [styles.media, { width, height }, dimmed && styles.dim, pressed && canOpen && styles.pressed]}
      >
        {snap.preview ? (
          <>
            {/* The tiny picture, scaled up and blurred: colours and light, nothing to make out. */}
            <Image source={{ uri: snap.preview }} style={styles.blurred} contentFit="cover" blurRadius={28} transition={0} accessibilityIgnoresInvertColors />
            <View style={[StyleSheet.absoluteFill, styles.veil]} />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }]} />
        )}
        <View style={styles.center} pointerEvents="none">
          <View style={styles.badge}>
            <Icon name={icon} size={16} color={colors.onMedia} weight="semibold" />
            <Text style={styles.badgeText}>{label}</Text>
          </View>
        </View>
        <View style={styles.corner} pointerEvents="none">
          <Icon name={video ? "videocam" : "camera"} size={12} color={colors.onMedia} />
          <Text style={styles.cornerText}>Snap · Opens once</Text>
        </View>
      </Pressable>
    );
  }

  const status = snapStatusText(snap, mine);
  const icon: IconName = mine ? "paper-plane-outline" : video ? "videocam-outline" : "camera-outline";
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityLabel={`${video ? "Video Snap" : "Snap"}, ${status}`}
      style={[styles.card, mine ? styles.mine : styles.theirs, corners, dimmed && styles.dim]}
    >
      <View style={styles.tile}>
        <Icon name={icon} size={16} color={colors.faint} weight="semibold" />
      </View>
      <Text style={styles.status} numberOfLines={1}>
        {status}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  media: { borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.mediaBg },
  // A little larger than the bubble, so the blur's soft edge falls outside it.
  blurred: { position: "absolute", top: -12, left: -12, right: -12, bottom: -12 },
  veil: { backgroundColor: "rgba(0,0,0,0.22)" },
  center: { ...{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, alignItems: "center", justifyContent: "center" },
  badge: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 16, height: 38, borderRadius: 19, backgroundColor: colors.mediaControl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.mediaControlEdge },
  badgeText: { fontSize: 15, fontWeight: "700", color: colors.onMedia },
  corner: { position: "absolute", left: 10, bottom: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  cornerText: { fontSize: 12, fontWeight: "600", color: colors.onMedia, textShadowColor: colors.mediaTextShadow, textShadowRadius: 4 },
  dim: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
  card: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 18, borderCurve: "continuous", paddingLeft: 6, paddingRight: 14, paddingVertical: 6 },
  theirs: { backgroundColor: colors.input },
  mine: { backgroundColor: colors.brandSoft },
  tile: { width: 30, height: 30, borderRadius: 9, borderCurve: "continuous", borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  status: { fontSize: 15, fontWeight: "600", color: colors.muted },
}));

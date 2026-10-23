import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { requireOptionalNativeModule } from "expo";
import { snapState, snapStatusText, type MessageSnap } from "@apartment-book/shared";
import { GlassBackdrop } from "@/components/glass";
import { Icon, type IconName } from "@/components/icon";
import { useReduceTransparency } from "@/lib/accessibility";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether this build carries expo-blur (Expo Go and every build made since it was added do); without it the veil alone frosts the preview. */
const CAN_BLUR = (() => {
  try {
    return Platform.OS === "ios" && Boolean(requireOptionalNativeModule("ExpoBlur"));
  } catch {
    return false;
  }
})();

/** The bubble's corner, the same as a sent photo's, and the round mark in its middle. */
const RADIUS = 18;
const MARK = 58;
/** A Snap that is over takes this much of a waiting one's width, its shape kept: there is nothing left to look at. */
const QUIET_SCALE = 0.7;

/**
 * A Snap in a chat: the same large bubble as a sent photo, at the Snap's own shape, and never its picture. While it
 * waits it shows only its tiny preview, scaled up and blurred past recognition under a layer of frosted glass, with
 * "Tap to view" (its recipient: one tap opens it full screen, once) or "Delivered" (its sender) on a glass mark in the
 * middle. Opened, expired or gone, it keeps its shape but goes quiet: the preview is off the message by then (the
 * database takes it off), so a plain frosted surface carries "Opened", "Expired" or "Unavailable", at seven tenths of the
 * size.
 */
export function SnapBubble({
  snap,
  mine,
  width,
  dimmed,
  onOpen,
  onLongPress,
}: {
  snap: MessageSnap;
  mine: boolean;
  /** The chat's width for photos and videos. */
  width: number;
  dimmed?: boolean;
  onOpen?: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles();
  const reduceTransparency = useReduceTransparency();
  const state = snapState(snap);
  const fresh = state === "new";
  const video = snap.kind === "video";
  const canOpen = fresh && !mine && Boolean(onOpen);
  const ratio = snap.width && snap.height ? clamp(snap.width / snap.height, 0.65, 1.8) : video ? 9 / 16 : 3 / 4;
  const shown = fresh ? width : Math.round(width * QUIET_SCALE);
  const height = Math.round(shown / ratio);
  const status = snapStatusText(snap, mine);
  const icon: IconName = fresh ? (mine ? "paper-plane-outline" : video ? "play" : "eye-outline") : state === "opened" ? "eye-off-outline" : state === "expired" ? "time-outline" : "cloud-offline-outline";
  const kind = video ? "Video Snap" : "Snap";

  if (fresh) {
    return (
      <Pressable
        onPress={canOpen ? onOpen : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole={canOpen ? "button" : undefined}
        accessibilityLabel={`${kind}, ${status}`}
        accessibilityHint={canOpen ? "Opens it once. It disappears after you view it." : undefined}
        style={({ pressed }) => [styles.bubble, { width: shown, height }, dimmed && styles.dim, pressed && canOpen && styles.pressed]}
      >
        {snap.preview ? (
          // The tiny picture, scaled up and blurred: colours and light, nothing to make out.
          <Image source={{ uri: snap.preview }} style={styles.blurred} contentFit="cover" blurRadius={28} transition={0} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }]} />
        )}
        {/* Frosted glass over it: a real blur where the build has one, and a thin dark veil either way. */}
        {CAN_BLUR && !reduceTransparency ? <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, styles.veil]} />
        <View style={styles.center} pointerEvents="none">
          <View style={[styles.mark, { borderColor: colors.mediaControlEdge }]}>
            <GlassBackdrop variant="media" radius={MARK / 2} />
            <Icon name={icon} size={24} color={colors.onMedia} weight="semibold" />
          </View>
          <Text style={styles.status}>{status}</Text>
          <Text style={styles.note}>{mine ? "Opens once for them" : "Opens once"}</Text>
        </View>
        <View style={styles.corner} pointerEvents="none">
          <Icon name={video ? "videocam" : "camera"} size={12} color={colors.onMedia} />
          <Text style={styles.cornerText}>{kind}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityLabel={`${kind}, ${status}`}
      style={[styles.bubble, styles.quiet, { width: shown, height }, dimmed && styles.dim]}
    >
      {/* A frosted surface with a breath of the aurora: the glass with nothing behind it any more. */}
      <View style={[StyleSheet.absoluteFill, { opacity: 0.55, experimental_backgroundImage: auroraGradient(colors.auroraWash, 135) }]} />
      <View style={styles.center} pointerEvents="none">
        <View style={[styles.mark, styles.quietMark, { borderColor: colors.border }]}>
          <Icon name={icon} size={20} color={colors.muted} weight="semibold" />
        </View>
        <Text style={[styles.status, { color: colors.text }]}>{status}</Text>
        {state === "opened" ? <Text style={[styles.note, { color: colors.muted }]}>{mine ? "They viewed it" : "You viewed it"}</Text> : null}
      </View>
      <View style={styles.corner} pointerEvents="none">
        <Icon name={video ? "videocam-outline" : "camera-outline"} size={12} color={colors.muted} />
        <Text style={[styles.cornerText, styles.quietCornerText]}>{kind}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  bubble: { borderRadius: RADIUS, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.mediaBg },
  quiet: { backgroundColor: colors.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  // A little larger than the bubble, so the blur's soft edge falls outside it.
  blurred: { position: "absolute", top: -12, left: -12, right: -12, bottom: -12 },
  veil: { backgroundColor: "rgba(0,0,0,0.18)" },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 16 },
  mark: { width: MARK, height: MARK, borderRadius: MARK / 2, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  quietMark: { width: MARK * QUIET_SCALE, height: MARK * QUIET_SCALE, borderRadius: (MARK * QUIET_SCALE) / 2, backgroundColor: colors.card },
  status: { fontSize: 15, fontWeight: "700", color: colors.onMedia, textAlign: "center", textShadowColor: colors.mediaTextShadow, textShadowRadius: 6 },
  note: { fontSize: 12, fontWeight: "500", color: colors.onMediaMuted, textAlign: "center", marginTop: -6, textShadowColor: colors.mediaTextShadow, textShadowRadius: 6 },
  corner: { position: "absolute", left: 12, bottom: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  cornerText: { fontSize: 12, fontWeight: "600", color: colors.onMedia, textShadowColor: colors.mediaTextShadow, textShadowRadius: 4 },
  quietCornerText: { color: colors.muted, textShadowRadius: 0 },
  dim: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
}));

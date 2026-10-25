import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import { requireOptionalNativeModule } from "expo";
import { formatMessageTime, snapActivityLabel, snapLatestActivity, snapState, snapStatusText, snapWasDeleted, type MessageSnap } from "@apartment-book/shared";
import { GlassBackdrop, LIQUID_GLASS } from "@/components/glass";
import { Icon, type IconName } from "@/components/icon";
import { useReduceTransparency } from "@/lib/accessibility";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether this build carries expo-blur (Expo Go and every build made since it was added do). */
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
/** A Snap that is over takes this much of a waiting one's width, its shape kept. */
const QUIET_SCALE = 0.7;
/**
 * How much the tiny preview is softened under the glass: enough to smooth its 32 pixels into soft colour and shape. The
 * preview is so small that no detail survives being drawn at this size, blur or not; the glass does the frosting.
 */
const SOFT_BLUR = 3;
/** With Reduce Transparency there is no glass pane, so the preview itself is blurred as far as before. */
const HEAVY_BLUR = 30;

/**
 * A Snap in a chat: the same large bubble as a sent photo, at the Snap's own shape, never the Snap itself. Its preview
 * (the 32-pixel JPEG made on the phone when it was taken, from the photo or the video's first frame) sits under a
 * semi-transparent pane of frosted glass, Liquid Glass on iOS 26 and a thin system blur elsewhere, so its colours and
 * shapes show softly through and nothing can be made out. While it waits, "Tap to view" (its recipient: one tap opens it
 * full screen, once) or "Delivered" (its sender) sits on a glass mark in the middle; once opened it keeps the same
 * frosted preview at seven tenths of the size, with "Opened". Expired, deleted or gone, the preview is off the message,
 * so a plain dark surface carries the status (as for a Snap sent from an app too old to make a preview). Under the
 * bubble, the newest thing that happened to it ("Opened · 14:05", "Screenshot taken · 14:06", "Snap deleted") as a
 * quiet grey note, the same for every kind of entry, a tap on which opens the whole story (`onActivity`).
 */
export function SnapBubble({
  snap,
  mine,
  width,
  dimmed,
  onOpen,
  onActivity,
  onLongPress,
}: {
  snap: MessageSnap;
  mine: boolean;
  /** The chat's width for photos and videos. */
  width: number;
  dimmed?: boolean;
  onOpen?: () => void;
  /** A tap on the activity line under the bubble: the Snap's whole story. */
  onActivity?: () => void;
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
  const mark = fresh ? MARK : Math.round(MARK * QUIET_SCALE);
  const status = snapStatusText(snap, mine);
  const deleted = snapWasDeleted(snap);
  const icon: IconName = fresh ? (mine ? "paper-plane-outline" : video ? "play" : "eye-outline") : state === "opened" ? "eye-off-outline" : state === "expired" ? "time-outline" : deleted ? "arrow-undo-outline" : "cloud-offline-outline";
  const kind = video ? "Video Snap" : "Snap";
  const note = fresh ? (mine ? "Opens once for them" : "Opens once") : state === "opened" ? (mine ? "They viewed it" : "You viewed it") : null;
  // The frosted pane: Liquid Glass where the phone draws it, a thin blur where the build has one, none with Reduce
  // Transparency (the preview is then blurred heavily instead).
  const pane = reduceTransparency ? "none" : LIQUID_GLASS ? "glass" : CAN_BLUR ? "blur" : "none";
  const latest = snapLatestActivity(snap);
  // A capture gets its small symbol beside the words, in the same quiet grey as every other entry.
  const captureIcon: IconName | null = latest?.type === "screenshot" ? "camera-outline" : latest?.type === "recording" ? "videocam-outline" : null;

  return (
    <View style={[styles.column, mine ? styles.columnMine : styles.columnTheirs]}>
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
          <>
            {/* The tiny picture, softened: its colours and shapes, nothing to make out. */}
            <Image source={{ uri: snap.preview }} style={styles.preview} contentFit="cover" blurRadius={pane === "none" ? HEAVY_BLUR : SOFT_BLUR} transition={0} accessibilityIgnoresInvertColors />
            {pane === "glass" ? <GlassView pointerEvents="none" style={StyleSheet.absoluteFill} glassEffectStyle="clear" colorScheme="dark" /> : null}
            {pane === "blur" ? <BlurView pointerEvents="none" intensity={22} tint="systemUltraThinMaterialDark" style={StyleSheet.absoluteFill} /> : null}
            {/* Light catching the top of the pane, and the faintest veil so the white words keep their contrast. */}
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sheen]} />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.blank]} />
        )}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.edge]} />
        <View style={styles.center} pointerEvents="none">
          <View style={[styles.mark, { width: mark, height: mark, borderRadius: mark / 2, borderColor: colors.mediaControlEdge }]}>
            <GlassBackdrop variant="media" radius={mark / 2} />
            <Icon name={icon} size={fresh ? 24 : 18} color={colors.onMedia} weight="semibold" />
          </View>
          <Text style={[styles.status, !fresh && styles.statusSmall]}>{status}</Text>
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>
        <View style={styles.corner} pointerEvents="none">
          <Icon name={video ? "videocam" : "camera"} size={12} color={colors.onMedia} />
          <Text style={styles.cornerText}>{kind}</Text>
        </View>
      </Pressable>
      {latest ? (
        <Pressable
          onPress={onActivity}
          disabled={!onActivity}
          hitSlop={6}
          accessibilityRole={onActivity ? "button" : undefined}
          accessibilityLabel={`${snapActivityLabel(latest, mine)}, ${formatMessageTime(latest.at)}`}
          accessibilityHint={onActivity ? "Shows everything that happened to this Snap" : undefined}
          style={({ pressed }) => [styles.activity, pressed && onActivity && { opacity: 0.6 }]}
        >
          {captureIcon ? <Icon name={captureIcon} size={12} color={colors.muted} /> : null}
          <Text style={styles.activityText} numberOfLines={1}>
            {snapActivityLabel(latest, mine)} · {formatMessageTime(latest.at)}
          </Text>
          {onActivity ? <Icon name="chevron-forward" size={10} color={colors.faint} weight="semibold" /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  column: { gap: 4 },
  columnMine: { alignItems: "flex-end" },
  columnTheirs: { alignItems: "flex-start" },
  bubble: { borderRadius: RADIUS, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.mediaBg },
  // A little larger than the bubble, so the softened edge falls outside it.
  preview: { position: "absolute", top: -8, left: -8, right: -8, bottom: -8 },
  sheen: { experimental_backgroundImage: "linear-gradient(to bottom, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 32%, rgba(0,0,0,0.06) 60%, rgba(0,0,0,0.16) 100%)" },
  // The pane's rim: a hairline of light around the bubble, as on Apple's glass.
  edge: { borderRadius: RADIUS, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.22)" },
  // No preview to show: a neutral dark surface, the same in both themes (white words sit on it).
  blank: { backgroundColor: "#2c2c2e", experimental_backgroundImage: "linear-gradient(160deg, #3a3a3c 0%, #1c1c1e 100%)" },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14 },
  mark: { borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  status: { fontSize: 15, fontWeight: "700", color: colors.onMedia, textAlign: "center", textShadowColor: colors.mediaTextShadow, textShadowRadius: 6 },
  statusSmall: { fontSize: 14 },
  note: { fontSize: 12, fontWeight: "500", color: colors.onMediaMuted, textAlign: "center", marginTop: -4, textShadowColor: colors.mediaTextShadow, textShadowRadius: 6 },
  corner: { position: "absolute", left: 12, bottom: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  cornerText: { fontSize: 12, fontWeight: "600", color: colors.onMedia, textShadowColor: colors.mediaTextShadow, textShadowRadius: 4 },
  // Under the bubble: the newest thing that happened, in the chat's own small, quiet type, the same for every entry.
  activity: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6 },
  activityText: { fontSize: 12, lineHeight: 16, fontWeight: "500", color: colors.muted },
  dim: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
}));

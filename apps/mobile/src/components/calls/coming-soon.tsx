import { useEffect } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CallKind } from "@apartment-book/shared";
import { GlassBackdrop } from "@/components/glass";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** How long the notice stays. */
const SHOWN_FOR_MS = 2400;

/**
 * What a tap on a call button says while calls are paused (CALLS_PAUSED): a small glass pill that drifts in just under
 * the chat's bar, the phone or camera, "Coming Soon" and "Audio and video calls" under it, and drifts away again on its
 * own. It never takes a touch, and VoiceOver reads it out. `onDone` fires once it has been shown long enough.
 */
export function ComingSoonNotice({ kind, onDone }: { kind: CallKind; onDone: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Audio and video calls are coming soon.");
    const timer = setTimeout(onDone, SHOWN_FOR_MS);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 66 }]}>
      <Animated.View entering={reduceMotion ? undefined : FadeInUp.duration(220)} exiting={reduceMotion ? undefined : FadeOutUp.duration(200)} style={styles.pill} accessibilityRole="alert">
        <GlassBackdrop variant="float" radius={24} />
        <View style={styles.icon}>
          <Icon name={kind === "video" ? "videocam" : "call"} size={15} color={colors.brand} />
        </View>
        <View>
          <Text style={styles.title}>Coming Soon</Text>
          <Text style={styles.detail}>Audio and video calls</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 20 },
  pill: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingRight: 18, paddingVertical: 7, borderRadius: 24, borderCurve: "continuous", overflow: "hidden", borderWidth: 0.5, borderColor: colors.glassEdge },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  title: { fontSize: 15, lineHeight: 19, fontWeight: "600", color: colors.text },
  detail: { fontSize: 13, lineHeight: 16, color: colors.muted },
}));

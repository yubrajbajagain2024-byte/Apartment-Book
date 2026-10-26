import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CallRecord } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { auroraGradient } from "@/lib/theme";
import { useColors } from "@/lib/theme-provider";

/**
 * A call ringing this phone, over whatever is on screen, laid out like FaceTime's: who is calling, large, on a soft
 * Aurora dusk, "UniBuzz Audio" or "UniBuzz Video", and Decline (red) and Accept (green) at the bottom. The
 * photo breathes while it rings.
 */
export function IncomingCallScreen({ call, onAccept, onDecline }: { call: CallRecord; onAccept: () => void; onDecline: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const caller = call.participants.find((p) => p.user_id === call.started_by)?.profile ?? null;
  const name = caller?.full_name ?? "Someone";
  const others = call.participants.filter((p) => p.user_id !== call.started_by).length;
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = reduceMotion ? 1 : withRepeat(withSequence(withTiming(1.06, { duration: 900, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })), -1);
  }, [scale, reduceMotion]);
  const breathe = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Modal visible animationType={reduceMotion ? "none" : "fade"} transparent={false} statusBarTranslucent onRequestClose={onDecline}>
      <View style={styles.screen} accessibilityViewIsModal>
        <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: auroraGradient(colors.aurora, 160), opacity: 0.35 }]} />
        <View style={[styles.top, { paddingTop: insets.top + 56 }]}>
          <Animated.View style={[styles.ring, breathe]}>
            <Avatar name={name} url={caller?.avatar_url} size={120} online={false} />
          </Animated.View>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.kind}>
            UniBuzz {call.kind === "video" ? "Video" : "Audio"}
            {others > 1 ? ` · ${others + 1} people` : ""}
          </Text>
        </View>
        <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 16) + 36 }]}>
          <Action label="Decline" icon="call" color={colors.red} rotate onPress={onDecline} />
          <Action label="Accept" icon={call.kind === "video" ? "videocam" : "call"} color={colors.green} onPress={onAccept} />
        </View>
      </View>
    </Modal>
  );
}

function Action({ label, icon, color, rotate, onPress }: { label: string; icon: "call" | "videocam"; color: string; rotate?: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.action}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.button, { backgroundColor: color }, pressed && { transform: [{ scale: 0.94 }] }]}>
        <Icon name={icon} size={30} color={colors.onBrand} style={rotate ? { transform: [{ rotate: "135deg" }] } : undefined} />
      </Pressable>
      <Text style={styles.actionLabel}>{label}</Text>
    </View>
  );
}

// The screen is always dark, as a call's is; only the two buttons take the theme's green and red.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b14", justifyContent: "space-between" },
  top: { alignItems: "center", gap: 10, paddingHorizontal: 32 },
  ring: { padding: 6, borderRadius: 70, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", marginBottom: 10 },
  name: { fontSize: 32, fontWeight: "700", color: "#ffffff", textAlign: "center" },
  kind: { fontSize: 17, color: "rgba(255,255,255,0.75)", textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "space-evenly", paddingHorizontal: 24 },
  action: { alignItems: "center", gap: 10 },
  button: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 15, fontWeight: "600", color: "#ffffff" },
});

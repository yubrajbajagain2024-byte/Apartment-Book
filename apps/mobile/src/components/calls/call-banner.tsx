import { Pressable, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import type { CallRecord } from "@apartment-book/shared";
import { GlassBackdrop } from "@/components/glass";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { makeStyles, useColors } from "@/lib/theme-provider";

/**
 * A call going on in this chat that you are not in: a glass pill under the chat's bar, "Video call in progress" (or
 * "ringing", while nobody has answered yet) with how many are in it, and Join. It goes when the call ends.
 */
export function CallBanner({ call, top, onJoin }: { call: CallRecord; top: number; onJoin: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const inCall = call.participants.filter((p) => p.state === "joined").length;
  const word = call.kind === "video" ? "Video call" : "Audio call";
  const line = call.status === "ringing" ? `${word} ringing` : `${word} in progress`;
  const count = inCall > 1 ? `${inCall} in the call` : null;
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInUp.duration(220)} exiting={reduceMotion ? undefined : FadeOutUp.duration(180)} pointerEvents="box-none" style={[styles.wrap, { top }]}>
      <Pressable onPress={onJoin} accessibilityRole="button" accessibilityLabel={`${line}${count ? `, ${count}` : ""}. Join`} style={({ pressed }) => [styles.pill, pressed && { opacity: 0.8 }]}>
        <GlassBackdrop variant="float" radius={22} />
        <View style={styles.dot} />
        <Icon name={call.kind === "video" ? "videocam" : "call"} size={16} color={colors.text} />
        <View style={styles.words}>
          <Text style={styles.line} numberOfLines={1}>
            {line}
          </Text>
          {count ? (
            <Text style={styles.count} numberOfLines={1}>
              {count}
            </Text>
          ) : null}
        </View>
        <View style={styles.join}>
          <Text style={styles.joinText}>Join</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 3 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingLeft: 12, paddingRight: 6, borderRadius: 22, borderCurve: "continuous", overflow: "hidden", borderWidth: 0.5, borderColor: colors.glassEdge },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  words: { maxWidth: 190 },
  line: { fontSize: 14, fontWeight: "600", color: colors.text },
  count: { fontSize: 12, color: colors.muted },
  join: { height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  joinText: { fontSize: 14, fontWeight: "700", color: colors.onBrand },
}));

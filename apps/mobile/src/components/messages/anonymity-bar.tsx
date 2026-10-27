import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import type { ChatAnonymity } from "@apartment-book/shared";
import { GlassBackdrop } from "@/components/glass";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/**
 * A chat about an anonymous listing while its poster is still hidden: a glass pill under the chat's bar, as a call in
 * progress has. The poster reads "Anonymous to Cara" with Show who I am (only to Cara: the listing stays anonymous);
 * the person who wrote to them reads "The poster is anonymous", which explains what that means. It goes once the
 * poster has shown who they are.
 */
export function AnonymityBar({ anonymity, otherName, top, busy, onReveal, onExplain }: { anonymity: ChatAnonymity; otherName: string | null; top: number; busy: boolean; onReveal: () => void; onExplain: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const poster = anonymity.role === "poster";
  const line = poster ? `Anonymous to ${otherName ?? "them"}` : "The poster is anonymous";
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInUp.duration(220)} exiting={reduceMotion ? undefined : FadeOutUp.duration(180)} pointerEvents="box-none" style={[styles.wrap, { top }]}>
      <Pressable onPress={onExplain} accessibilityRole="button" accessibilityLabel={`${line}. What this means`} style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}>
        <GlassBackdrop variant="float" radius={22} />
        <View style={styles.mark}>
          <Icon name="eye-off" sf="theatermasks.fill" size={15} color={colors.auroraInk} />
        </View>
        <Text style={styles.line} numberOfLines={1}>
          {line}
        </Text>
        {poster ? (
          <Pressable
            onPress={onReveal}
            disabled={busy}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Show ${otherName ?? "them"} who you are`}
            style={({ pressed }) => [styles.reveal, { experimental_backgroundImage: auroraGradient(colors.aurora, 135) }, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            {busy ? <ActivityIndicator color={colors.onBrand} size="small" /> : <Text style={styles.revealText}>Show who I am</Text>}
          </Pressable>
        ) : (
          <View style={styles.info}>
            <Icon name="information-circle-outline" size={18} color={colors.muted} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 3 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, maxWidth: "92%", paddingLeft: 8, paddingRight: 6, borderRadius: 22, borderCurve: "continuous", overflow: "hidden", borderWidth: 0.5, borderColor: colors.glassEdge },
  mark: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  line: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  reveal: { height: 32, minWidth: 116, paddingHorizontal: 14, borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  revealText: { fontSize: 14, fontWeight: "700", color: colors.onBrand },
  info: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
}));

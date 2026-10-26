import { useEffect } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { buzzState, useBuzzState, type BuzzUiState } from "@/lib/buzz-store";
import { P, R, T } from "./ui";

const selectToast = (s: BuzzUiState) => s.toast;

/**
 * Buzz's toast (UniVerse's toaster in the incognito surface): one short note at a time, floating `bottom` points above
 * the screen's bottom edge (over the tab bar, or the reply bar), gone after a few seconds or on a tap. Screen readers hear
 * it as it appears. Every Buzz screen that is on top renders one; the note itself lives in the Buzz store, so a toast
 * raised just before a screen closes ("Thread hidden") finishes on the screen underneath.
 */
export function BuzzToastHost({ bottom, enabled = true }: { bottom: number; enabled?: boolean }) {
  const toast = useBuzzState(selectToast);
  const reduce = useReduceMotion();
  useEffect(() => {
    if (!toast || !enabled) return;
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(toast.title ? `${toast.title}. ${toast.text}` : toast.text);
    const id = toast.id;
    const t = setTimeout(() => buzzState.dismissToast(id), toast.duration);
    return () => clearTimeout(t);
  }, [toast, enabled]);
  if (!toast || !enabled) return null;
  const icon = toast.tone === "error" ? "alert-circle" : toast.tone === "success" ? "checkmark-circle" : "information-circle-outline";
  const tint = toast.tone === "error" ? P.danger : toast.tone === "success" ? P.accentInk : P.ink2;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <Reanimated.View key={toast.id} entering={reduce ? undefined : FadeInDown.duration(220)} exiting={reduce ? undefined : FadeOutDown.duration(160)}>
        <Pressable onPress={() => buzzState.dismissToast(toast.id)} accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityHint="Dismisses this message" style={styles.toast}>
          <Icon name={icon} size={20} color={tint} />
          {/* flexShrink, not flex: 1: the toast is as wide as its text, and a zero flex basis would leave the text no width. */}
          <View style={{ flexShrink: 1 }}>
            {toast.title ? <Text style={[T.labelSm, { color: P.ink }]}>{toast.title}</Text> : null}
            <Text style={[T.footnote, { color: toast.title ? P.ink2 : P.ink }]}>{toast.text}</Text>
          </View>
        </Pressable>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 520,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: R.md,
    borderCurve: "continuous",
    backgroundColor: P.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: P.lineStrong,
    shadowColor: P.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});

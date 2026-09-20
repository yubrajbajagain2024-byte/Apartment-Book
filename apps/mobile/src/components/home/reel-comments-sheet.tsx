import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Reel } from "@apartment-book/shared";
import { colors, radius } from "@/lib/theme";
import { Comments } from "../comments";

/** Bottom sheet with the comment thread of one reel. Pass `reel = null` to keep it closed. */
export function ReelCommentsSheet({ reel, onClose, onCountChange }: { reel: Reel | null; onClose: () => void; onCountChange: (delta: number) => void }) {
  const insets = useSafeAreaInsets();
  const drag = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  // Keep showing the last reel while the sheet slides away, so it does not go blank mid-animation.
  const [shown, setShown] = useState<Reel | null>(reel);
  const open = reel !== null;

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (reel) setShown(reel);
  }, [reel]);
  useEffect(() => {
    if (open) drag.setValue(0);
  }, [open, drag]);

  // Pull the handle down to close, like every other sheet on the phone.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 90 || g.vy > 1.2) closeRef.current();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(),
      }),
    [drag],
  );

  const count = shown?.comments ?? 0;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.root}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close comments" />
          <Animated.View style={[styles.sheet, { transform: [{ translateY: drag }] }]}>
            <View {...pan.panHandlers} style={styles.header}>
              <View style={styles.handle} />
              <Text style={styles.heading} accessibilityRole="header">
                {count === 0 ? "No comments yet" : `${count} ${count === 1 ? "comment" : "comments"}`}
              </Text>
              <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>
            {shown ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, paddingBottom: Math.max(insets.bottom, 12) + 12 }}>
                <Comments key={`${shown.sourceType}:${shown.sourceId}`} targetType={shown.sourceType} targetId={shown.sourceId} ownerId={shown.author.id} onCountChange={onCountChange} />
              </ScrollView>
            ) : null}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.25)" },
  sheet: { height: "70%", backgroundColor: colors.card, borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, overflow: "hidden" },
  header: { alignItems: "center", paddingTop: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 10 },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text },
  close: { position: "absolute", right: 12, top: 16, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
});

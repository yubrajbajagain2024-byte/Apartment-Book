import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View, type GestureResponderHandlers } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PostTargetType } from "@apartment-book/shared";
import { colors, radius } from "@/lib/theme";
import { CommentComposer, CommentList, CommentsHeading, useCommentThread } from "./comments";

export type CommentsTarget = { targetType: PostTargetType; targetId: string; ownerId: string; comments: number };

/** Bottom sheet with the comment thread of one post or reel, TikTok style: the count up top, the thread, and the composer pinned under it. Pass `target = null` to keep it closed. */
export function CommentsSheet({ target, onClose, onCountChange }: { target: CommentsTarget | null; onClose: () => void; onCountChange: (delta: number) => void }) {
  const drag = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  // Keep showing the last thread while the sheet slides away, so it does not go blank mid-animation.
  const [shown, setShown] = useState<CommentsTarget | null>(target);
  const open = target !== null;

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (target) setShown(target);
  }, [target]);
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

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.root}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close comments" />
          <Animated.View style={[styles.sheet, { transform: [{ translateY: drag }] }]}>
            {shown ? <SheetBody key={`${shown.targetType}:${shown.targetId}`} target={shown} panHandlers={pan.panHandlers} onClose={onClose} onCountChange={onCountChange} /> : null}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The thread of one target: header with the count and sort button, the scrolling list, and the composer pinned at the bottom. */
function SheetBody({ target, panHandlers, onClose, onCountChange }: { target: CommentsTarget; panHandlers: GestureResponderHandlers; onClose: () => void; onCountChange: (delta: number) => void }) {
  const insets = useSafeAreaInsets();
  const thread = useCommentThread({ targetType: target.targetType, targetId: target.targetId, ownerId: target.ownerId, onCountChange });
  // The post's number until the thread has loaded, then what is really there (replies included).
  const count = thread.count ?? target.comments;
  return (
    <>
      <View {...panHandlers} style={styles.header}>
        <View style={styles.handle} />
        <CommentsHeading count={count} onSort={thread.setSort} />
        <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
        <CommentList thread={thread} emptyText="Be the first to comment." />
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <CommentComposer thread={thread} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.25)" },
  sheet: { height: "70%", backgroundColor: colors.card, borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, overflow: "hidden" },
  header: { alignItems: "center", paddingTop: 8, paddingBottom: 10, paddingHorizontal: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 10 },
  close: { position: "absolute", right: 12, top: 16, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 14, paddingTop: 10, backgroundColor: colors.card },
});

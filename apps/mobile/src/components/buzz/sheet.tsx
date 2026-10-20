import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotion } from "@/lib/accessibility";
import { motion } from "@/lib/theme";
import { P, PIconButton, R, T } from "./ui";

const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 900;

/**
 * A Buzz sheet (UniVerse's `Sheet` in the incognito surface): the screen dims, the sheet rises from the bottom on UIKit's
 * presentation spring and leaves the same way (it fades under Reduce Motion). The grabber and the header (title,
 * description, the round close button) pull it down; a tap on the dimmed screen, Android's back button and VoiceOver's
 * escape gesture close it too. `footer` stays pinned under the content, above the home indicator; `keyboard` keeps text
 * fields above the keyboard. `onDismiss` runs once it is fully gone. Phosphor only, whatever the app's theme.
 */
export function BuzzSheet({
  visible,
  onClose,
  onDismiss,
  title,
  description,
  closeLabel = "Close",
  footer,
  keyboard,
  maxHeight = "90%",
  children,
  contentStyle,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  title?: string;
  description?: string;
  closeLabel?: string;
  footer?: ReactNode;
  keyboard?: boolean;
  maxHeight?: ViewStyle["maxHeight"];
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const y = useSharedValue(screen);
  const fade = useSharedValue(0);
  const height = useSharedValue(screen);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  // Fully gone: iOS says so once the modal itself has been dismissed (nothing else can be presented before that); Android
  // dialogs do not wait on each other, so there it is now.
  const gone = useCallback(() => {
    setMounted(false);
    if (Platform.OS !== "ios") dismissRef.current?.();
  }, []);
  const nativeDismissed = useCallback(() => dismissRef.current?.(), []);

  useEffect(() => {
    if (!mounted) return;
    const finish = (done?: boolean) => {
      "worklet";
      if (done) runOnJS(gone)();
    };
    if (visible) {
      if (reduce) {
        y.value = 0;
        fade.value = withTiming(1, { duration: 200 });
      } else {
        fade.value = 1;
        y.value = withSpring(0, motion.sheet);
      }
    } else if (reduce) fade.value = withTiming(0, { duration: 180 }, finish);
    else y.value = withTiming(Math.max(height.value, 1) + 40, { duration: motion.sheetOut, easing: Easing.bezier(0.4, 0, 1, 1) }, finish);
  }, [visible, mounted, reduce, y, fade, height, gone]);

  const requestClose = useCallback(() => closeRef.current(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onUpdate((e) => {
          y.value = e.translationY > 0 ? e.translationY : -Math.sqrt(-e.translationY) * 1.5;
        })
        .onEnd((e) => {
          if (e.translationY > Math.min(CLOSE_DISTANCE, height.value * 0.28) || e.velocityY > CLOSE_VELOCITY) {
            y.value = withTiming(height.value + 40, { duration: 200, easing: Easing.out(Easing.quad) }, (done) => {
              if (done) runOnJS(requestClose)();
            });
          } else y.value = withSpring(0, { ...motion.sheet, velocity: e.velocityY });
        }),
    [y, height, requestClose],
  );

  const backdrop = useAnimatedStyle(() => ({ opacity: fade.value * interpolate(y.value, [0, Math.max(height.value, 1)], [1, 0], Extrapolation.CLAMP) }));
  const sheet = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateY: y.value }] }));

  const head = (
    <View style={styles.head}>
      <View style={styles.grabber} />
      {title ? (
        <View style={styles.titleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[T.title2, { color: P.ink }]} accessibilityRole="header">
              {title}
            </Text>
            {description ? <Text style={[T.footnote, { color: P.ink2, marginTop: 2 }]}>{description}</Text> : null}
          </View>
          <PIconButton icon="close" label={closeLabel} onPress={requestClose} variant="filled" size={36} iconSize={18} color={P.ink2} />
        </View>
      ) : null}
    </View>
  );

  const body = (
    <Animated.View
      onLayout={(e) => {
        height.value = e.nativeEvent.layout.height;
      }}
      accessibilityViewIsModal
      onAccessibilityEscape={requestClose}
      style={[styles.sheet, { maxHeight }, sheet]}
    >
      <GestureDetector gesture={pan}>{head}</GestureDetector>
      <View style={[styles.content, contentStyle]}>{children}</View>
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom - 8, 12) }]}>{footer}</View> : <View style={{ height: Math.max(insets.bottom - 8, 12) }} />}
    </Animated.View>
  );

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={requestClose} onDismiss={Platform.OS === "ios" ? nativeDismissed : undefined}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, backdrop]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
        {keyboard ? (
          <KeyboardAvoidingView style={styles.stage} behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none">
            {body}
          </KeyboardAvoidingView>
        ) : (
          <View style={styles.stage} pointerEvents="box-none">
            {body}
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: P.backdrop },
  stage: { flex: 1, justifyContent: "flex-end" },
  sheet: { marginHorizontal: 8, marginBottom: 8, borderRadius: 34, borderCurve: "continuous", overflow: "hidden", backgroundColor: P.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: P.line },
  head: { paddingTop: 8 },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 2.5, backgroundColor: P.surface4 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
  content: { paddingHorizontal: 16, flexShrink: 1 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, backgroundColor: P.surface2 },
});

/** The radius of the rounded groups inside a sheet (the report reasons). */
export const SHEET_GROUP_RADIUS = R.lg;

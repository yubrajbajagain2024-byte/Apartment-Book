import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, type LegacyPanGesture as PanGesture } from "react-native-gesture-handler";
import Animated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotion } from "@/lib/accessibility";
import { motion, sheetShape } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

/** What a sheet's header and body can reach: the drag that pulls the sheet down, and the close it ends in. */
type SheetApi = { pan: PanGesture; close: () => void };
const SheetContext = createContext<SheetApi | null>(null);

/** How far down a released drag has to have come (or how fast it has to be going) to close the sheet. */
const CLOSE_DISTANCE = 140;
const CLOSE_SHARE = 0.28;
const CLOSE_VELOCITY = 900;

/**
 * One bottom sheet for the whole app, built like iOS's own: the screen behind dims as the sheet rises on UIKit's
 * presentation spring (no bounce), and leaves the same way. The grabber and the header pull it down on the UI thread;
 * let go past a quarter of its height, or with a flick, and it closes, otherwise it springs back. A tap on the dimmed
 * screen, Android's back button and VoiceOver's escape gesture close it too. Under Reduce Motion it fades instead.
 *
 * The owner keeps the open state: `visible` opens and closes it, `onClose` asks to close (set `visible` to false), and
 * `onDismiss` runs once it is fully gone (iOS presents nothing else while a modal is still on screen). The sheet floats
 * inset from the screen's edges (`sheetShape`); give it a `height` for a fixed size, or let its content size it up to
 * `maxHeight`. `draggable="sheet"` lets a drag anywhere on it pull it down (sheets without a scrolling list), and
 * `keyboard` keeps text fields above the keyboard.
 */
export function Sheet({
  visible,
  onClose,
  onDismiss,
  closeLabel,
  height,
  maxHeight = "90%",
  keyboard = false,
  draggable = "header",
  style,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  /** What VoiceOver says for the dimmed screen behind, which closes the sheet ("Close comments"). */
  closeLabel: string;
  height?: ViewStyle["height"];
  maxHeight?: ViewStyle["maxHeight"];
  keyboard?: boolean;
  draggable?: "header" | "sheet";
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const { height: screenHeight } = useWindowDimensions();
  // Mounted from the moment it opens until its exit has finished, so the sheet can animate out before the modal goes.
  const [mounted, setMounted] = useState(visible);
  const closeRef = useRef(onClose);
  const visibleRef = useRef(visible);
  useEffect(() => {
    closeRef.current = onClose;
    visibleRef.current = visible;
  });

  // Where the sheet sits below its resting place (0 = fully up), how tall it is, and the fade used under Reduce Motion.
  const y = useSharedValue(screenHeight);
  const sheetHeight = useSharedValue(screenHeight);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    const finish = (done?: boolean) => {
      "worklet";
      if (done) runOnJS(setMounted)(false);
    };
    if (visible) {
      if (reduceMotion) {
        y.value = 0;
        fade.value = withTiming(1, { duration: 200 });
      } else {
        fade.value = 1;
        y.value = withSpring(0, motion.sheet);
      }
    } else if (reduceMotion) {
      fade.value = withTiming(0, { duration: 180 }, finish);
    } else {
      y.value = withTiming(Math.max(sheetHeight.value, 1) + 40, { duration: motion.sheetOut, easing: Easing.bezier(0.4, 0, 1, 1) }, finish);
    }
  }, [visible, mounted, reduceMotion, y, fade, sheetHeight]);

  const requestClose = useCallback(() => closeRef.current(), []);
  /**
   * A drag that went far enough has already carried the sheet off screen: ask the owner to close. Should it keep the
   * sheet open after all, bring it back rather than leave an invisible sheet over the screen.
   */
  const closeFromDrag = useCallback(() => {
    closeRef.current();
    setTimeout(() => {
      if (visibleRef.current) y.value = withSpring(0, motion.sheet);
    }, 60);
  }, [y]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Vertical drags only, so a sideways swipe in a row of chips or faces still scrolls that row.
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onUpdate((e) => {
          // Down follows the finger; up gives a little, the way a sheet at its full height resists.
          y.value = e.translationY > 0 ? e.translationY : -Math.sqrt(-e.translationY) * 1.5;
        })
        .onEnd((e) => {
          const far = e.translationY > Math.min(CLOSE_DISTANCE, sheetHeight.value * CLOSE_SHARE);
          if (far || e.velocityY > CLOSE_VELOCITY) {
            y.value = withTiming(sheetHeight.value + 40, { duration: 200, easing: Easing.out(Easing.quad) }, (done) => {
              if (done) runOnJS(closeFromDrag)();
            });
          } else {
            y.value = withSpring(0, { ...motion.sheet, velocity: e.velocityY });
          }
        }),
    [y, sheetHeight, closeFromDrag],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: fade.value * interpolate(y.value, [0, Math.max(sheetHeight.value, 1)], [1, 0], Extrapolation.CLAMP),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: y.value }],
  }));

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    sheetHeight.value = e.nativeEvent.layout.height;
  }, [sheetHeight]);

  const api = useMemo<SheetApi>(() => ({ pan, close: requestClose }), [pan, requestClose]);

  const body = (
    <Animated.View
      onLayout={onLayout}
      accessibilityViewIsModal
      onAccessibilityEscape={requestClose}
      style={[styles.sheet, height !== undefined ? { height } : { maxHeight }, style, sheetStyle]}
    >
      {children}
    </Animated.View>
  );

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={requestClose} onDismiss={onDismiss}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
        <SheetContext.Provider value={api}>
          {keyboard ? (
            <KeyboardAvoidingView style={styles.stage} behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none">
              {draggable === "sheet" ? <GestureDetector gesture={pan}>{body}</GestureDetector> : body}
            </KeyboardAvoidingView>
          ) : (
            <View style={styles.stage} pointerEvents="box-none">
              {draggable === "sheet" ? <GestureDetector gesture={pan}>{body}</GestureDetector> : body}
            </View>
          )}
        </SheetContext.Provider>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * The top of a sheet: the grabber, then a 44pt row with the title centred, an optional control on the left (Reset, a
 * sort button) and the round close button on the right. Pulling anywhere on it drags the sheet down. Pass `title` for
 * plain text, or `titleNode` for something richer (the comment count with its sort button).
 */
export function SheetHeader({ title, titleNode, leading, onClose, closeLabel = "Close", divider = true }: { title?: string; titleNode?: ReactNode; leading?: ReactNode; onClose?: () => void; closeLabel?: string; divider?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const sheet = useContext(SheetContext);
  const close = onClose ?? sheet?.close;
  const content = (
    <View style={[styles.header, divider && styles.headerDivider]}>
      <View style={styles.grabber} />
      <View style={styles.headerRow}>
        {titleNode ?? (
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        )}
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        {close ? (
          <Pressable onPress={close} hitSlop={10} style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={closeLabel}>
            <Icon name="close" size={17} weight="semibold" color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
  return sheet ? <GestureDetector gesture={sheet.pan}>{content}</GestureDetector> : content;
}

/** The bottom of a sheet: a hairline over the actions, clear of the home indicator. */
export function SheetFooter({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom - sheetShape.marginBottom, 12) }, style]}>{children}</View>;
}

/** The sheet this component is inside, for a body that wants to close it (null outside a sheet). */
export function useSheet(): { close: () => void } | null {
  return useContext(SheetContext);
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop },
  stage: { flex: 1, justifyContent: "flex-end" },
  // iOS 26: the sheet floats inset from the screen's edges, its corners concentric with the phone's; a hairline marks its edge on black.
  sheet: { backgroundColor: colors.elevated, ...sheetShape, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  header: { paddingTop: 6, paddingBottom: 2 },
  headerDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 2.5, backgroundColor: colors.grabber },
  headerRow: { height: 48, justifyContent: "center", paddingHorizontal: 60 },
  title: { fontSize: 17, fontWeight: "600", color: colors.text, textAlign: "center" },
  leading: { position: "absolute", left: 16, top: 0, bottom: 0, justifyContent: "center" },
  close: { position: "absolute", right: 14, top: 9, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.elevated },
}));

import { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { hapticTap } from "@/lib/haptics";
import { motion } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** How far a bubble is dragged to the right before letting go answers it. */
const THRESHOLD = 56;
/** Past the threshold the bubble follows the finger at a quarter of its pace (rubber banding). */
const DRAG_PAST = 0.25;

/**
 * Messenger's swipe to reply: drag a message to the right and a reply mark surfaces from under it, the phone ticking as
 * the drag reaches far enough; let go there and the message is answered (the drag springs back either way). The drag
 * runs on the UI thread and only ever to the right, so the list keeps scrolling and the screen's own back swipe keeps
 * its edge. Still under Reduce Motion: the mark fades in, the bubble stays put.
 */
export function SwipeToReply({ enabled = true, onReply, style, children }: { enabled?: boolean; onReply: () => void; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const x = useSharedValue(0);
  const armed = useSharedValue(false);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(18)
    .failOffsetX(-12)
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      const dx = Math.max(0, e.translationX);
      x.value = dx <= THRESHOLD ? dx : THRESHOLD + (dx - THRESHOLD) * DRAG_PAST;
      if (!armed.value && dx >= THRESHOLD) {
        armed.value = true;
        runOnJS(hapticTap)();
      } else if (armed.value && dx < THRESHOLD - 12) {
        armed.value = false;
      }
    })
    .onEnd(() => {
      if (armed.value) runOnJS(onReply)();
    })
    .onFinalize(() => {
      armed.value = false;
      x.value = withSpring(0, motion.snappy);
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: reduceMotion ? 0 : x.value }] }));
  const mark = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [THRESHOLD * 0.35, THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateX: reduceMotion ? 0 : -x.value }, { scale: interpolate(x.value, [THRESHOLD * 0.35, THRESHOLD], [0.6, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[style, slide]}>
        {/* Under the bubble, held in place while the bubble slides away from it. */}
        <Animated.View pointerEvents="none" style={[styles.markHolder, mark]}>
          <View style={styles.mark}>
            <Icon name="arrow-undo-outline" size={15} color={colors.text} weight="semibold" />
          </View>
        </Animated.View>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const useStyles = makeStyles((colors) => ({
  markHolder: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "flex-start", paddingLeft: 6 },
  mark: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
}));

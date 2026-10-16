import { memo } from "react";
import { Animated, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useCreateMenu } from "./create-menu";
import { useOverVideo, type OverVideoStore } from "./home-top-tabs";

/** How far the pill floats from the page's bottom-right corner (the tab bar sits under the page, so nothing else is in the way). */
const MARGIN = 16;
const HEIGHT = 48;

/**
 * The "+ New post" pill floating over the bottom-right of the Home feed: a violet-to-blue gradient with a soft glow, like
 * the design it follows. It opens the same create sheet as before (Post / Reel / Buzz). `opacity` is the pager's position
 * turned into 1 on For you, Buzz and Posts and 0 on Reels (the video page keeps its "+" in the top bar instead), so the
 * pill fades with the finger on the native driver; `overVideo` says when it is gone and must not take taps. Memoized: it
 * never re-renders with Home's pages.
 */
export const NewPostButton = memo(function NewPostButton({ opacity, overVideo: store }: { opacity: Animated.AnimatedInterpolation<number> | null; overVideo: OverVideoStore }) {
  const styles = useStyles();
  const colors = useColors();
  const create = useCreateMenu();
  const overVideo = useOverVideo(store);
  return (
    <Animated.View pointerEvents={overVideo ? "none" : "box-none"} style={[styles.wrap, { opacity: opacity ?? (overVideo ? 0 : 1) }]}>
      <Pressable onPress={create} accessibilityRole="button" accessibilityLabel="Create" style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
        <Ionicons name="add" size={22} color={colors.onBrand} />
        <Text style={styles.label}>New post</Text>
      </Pressable>
    </Animated.View>
  );
});

const useStyles = makeStyles((colors) => ({
  wrap: { position: "absolute", right: MARGIN, bottom: MARGIN },
  // A real gradient where the platform draws one (iOS and Android); the plain violet underneath stands in elsewhere.
  pill: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    paddingLeft: 18,
    paddingRight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent,
    experimental_backgroundImage: `linear-gradient(100deg, ${colors.accent} 0%, ${colors.accentBlue} 100%)`,
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pressed: { opacity: 0.85 },
  label: { color: colors.onBrand, fontSize: 16, fontWeight: "700" },
}));

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useIsFocused } from "expo-router";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { HOME_TABS, type HomeSection } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { MaskGlyph } from "@/components/buzz/ui";
import { buzzState } from "@/lib/buzz-store";
import { phosphor } from "@/lib/palette";

/*
 * Home's top bar near Buzz (UniVerse's HomeTopBar on the Buzz pane): the bar turns Phosphor as the pager comes to Buzz,
 * its words light and its underline lime; your photo crossfades to a neutral person glyph and is not drawn at all
 * while the pager rests on Buzz, so nothing on the Buzz page shows who is looking; and the Buzz label carries the small
 * lime mask while Buzz is near. Everything that moves follows the pager on the native driver; the few flags that change
 * what is drawn flip only when the pager crosses a threshold (halfway, at rest), like the bar's look over Reels.
 */

/** Where Buzz sits in the pager (-1 if it has no page). */
export const BUZZ_PAGE_INDEX = HOME_TABS.findIndex((t) => t.value === "buzz");
/** Space between the lime mask and the Buzz label. */
const MASK_GAP = 4;

type Flags = { near: boolean; avatarGone: boolean; glyphGone: boolean };

/** At this distance from Buzz (in pages) or closer, the photo is gone; at this distance or further, the glyph is. */
const AT_REST = 0.01;

function flagsFor(distance: number): Flags {
  return { near: distance < 0.5, avatarGone: distance <= AT_REST, glyphGone: distance >= 1 - AT_REST };
}

function distanceOf(section: HomeSection): number {
  const i = HOME_TABS.findIndex((t) => t.value === section);
  return i < 0 || BUZZ_PAGE_INDEX < 0 ? 1 : Math.abs(i - BUZZ_PAGE_INDEX);
}

export type BuzzBar = {
  /** Within half a page of Buzz: the bar's words and underline take the Phosphor look. */
  near: boolean;
  /** Your photo is drawn (anywhere but at rest on Buzz). */
  avatarShown: boolean;
  /** The neutral glyph is drawn (anywhere near Buzz). */
  glyphShown: boolean;
  /** 1 on Buzz, 0 a page away: the Phosphor layer's opacity, the glyph's and the mask's. */
  layer: Animated.AnimatedInterpolation<number> | null;
  /** 0 on Buzz, 1 a page away: the photo's opacity. */
  avatarOpacity: Animated.AnimatedInterpolation<number> | null;
};

/*
 * Whether Home is the screen on show and its pager rests on Buzz: anything else that draws your photo while Buzz is on
 * screen (the tab bar's Profile tab) can stand a neutral glyph in for it. Kept by useBuzzBar.
 */
let restingOnBuzz = false;
const restingListeners = new Set<() => void>();
function setRestingOnBuzz(next: boolean) {
  if (next === restingOnBuzz) return;
  restingOnBuzz = next;
  restingListeners.forEach((l) => l());
}
function subscribeResting(listener: () => void) {
  restingListeners.add(listener);
  return () => {
    restingListeners.delete(listener);
  };
}
const readResting = () => restingOnBuzz;

/** True while Home is on screen resting on its Buzz page (nothing there may show who is looking). */
export function useHomeRestingOnBuzz(): boolean {
  return useSyncExternalStore(subscribeResting, readResting, readResting);
}

/** The Buzz look of Home's bar, from the pager's offset (`scrollX`) and the section it last settled on. */
export function useBuzzBar(scrollX: Animated.Value, pageWidth: number, section: HomeSection): BuzzBar {
  const [flags, setFlags] = useState<Flags>(() => flagsFor(distanceOf(section)));
  const focused = useIsFocused();
  useEffect(() => setRestingOnBuzz(focused && flags.avatarGone), [focused, flags.avatarGone]);
  useEffect(() => () => setRestingOnBuzz(false), []);

  // The section the pager settled on is the truth at rest.
  useEffect(() => {
    const next = flagsFor(distanceOf(section));
    setFlags((f) => (f.near === next.near && f.avatarGone === next.avatarGone && f.glyphGone === next.glyphGone ? f : next));
    // Remember the last section that was not Buzz: the guidelines gate's "Not now" goes back there.
    if (section !== "buzz") buzzState.setPreviousSection(section);
  }, [section]);

  // While the pager moves: flip only at the thresholds (a native-driven value still reports to JS listeners).
  useEffect(() => {
    if (BUZZ_PAGE_INDEX < 0 || pageWidth <= 0) return;
    const id = scrollX.addListener(({ value }) => {
      const next = flagsFor(Math.abs(value / pageWidth - BUZZ_PAGE_INDEX));
      setFlags((f) => (f.near === next.near && f.avatarGone === next.avatarGone && f.glyphGone === next.glyphGone ? f : next));
    });
    return () => scrollX.removeListener(id);
  }, [scrollX, pageWidth]);

  const layer = useMemo(() => {
    if (BUZZ_PAGE_INDEX < 0 || pageWidth <= 0) return null;
    const at = BUZZ_PAGE_INDEX * pageWidth;
    return scrollX.interpolate({ inputRange: [at - pageWidth, at, at + pageWidth], outputRange: [0, 1, 0], extrapolate: "clamp" });
  }, [scrollX, pageWidth]);
  const avatarOpacity = useMemo(() => (layer ? layer.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) : null), [layer]);

  return { near: flags.near, avatarShown: !flags.avatarGone, glyphShown: !flags.glyphGone, layer, avatarOpacity };
}

/** The bar's Phosphor background, over its usual one, as opaque as Buzz is near (`layer`). */
export function BuzzBarLayer({ layer }: { layer: BuzzBar["layer"] }) {
  if (!layer) return null;
  return <Animated.View pointerEvents="none" style={[styles.layer, { opacity: layer }]} />;
}

/** The same for the strip under the status bar. */
export function BuzzStatusStripLayer({ layer, height }: { layer: BuzzBar["layer"]; height: number }) {
  if (!layer) return null;
  return <Animated.View pointerEvents="none" style={[styles.strip, { height, opacity: layer }]} />;
}

/** The neutral person glyph that stands where your photo is while Buzz is on screen. It opens your profile, as the photo does. */
export function BuzzMeGlyph({ opacity, onPress, size }: { opacity: BuzzBar["layer"]; onPress: () => void; size: number }) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.center, opacity ? { opacity } : null]}>
      <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel="Your profile" style={styles.center}>
        <Icon name="person-circle-outline" size={size} color={phosphor.ink} />
      </Pressable>
    </Animated.View>
  );
}

/**
 * The lime mask before the Buzz label: drawn over the labels row (SlidingTabs draws the labels), one cell per tab like
 * its `spread` layout, the mask just left of an invisible copy of the bold label, fading in as Buzz comes near.
 */
export function BuzzLabelMask({ layer, fontSize, sidePad }: { layer: BuzzBar["layer"]; fontSize: number; sidePad: number }) {
  if (!layer || BUZZ_PAGE_INDEX < 0) return null;
  const glyph = Math.round(fontSize * 0.85);
  return (
    <View pointerEvents="none" style={[styles.maskRow, { left: sidePad, right: sidePad }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {HOME_TABS.map((t) => (
        <View key={t.value} style={styles.cell}>
          {t.value === "buzz" ? (
            // In flow, not offset by a percentage: the mask, the invisible label, and a spacer as wide as the mask, so the
            // label stays centred over the real one and the mask sits just before it.
            <View style={styles.maskLine}>
              <Animated.View style={[styles.mask, { width: glyph, opacity: layer }]}>
                <MaskGlyph size={glyph} color={phosphor.accent} />
              </Animated.View>
              <Text style={[styles.ghost, { fontSize }]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                {t.label}
              </Text>
              <View style={{ width: glyph + MASK_GAP }} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque: under it sits the bar's own colour (white in Light), which a see-through Phosphor would turn grey.
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: -StyleSheet.hairlineWidth, backgroundColor: phosphor.surface1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: phosphor.line },
  strip: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 12, backgroundColor: phosphor.surface1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  maskRow: { position: "absolute", top: 0, bottom: 0, flexDirection: "row" },
  cell: { flex: 1, alignItems: "center", justifyContent: "center" },
  ghost: { fontWeight: "700", opacity: 0 },
  maskLine: { flexDirection: "row", alignItems: "center" },
  mask: { marginRight: MASK_GAP, alignItems: "center", justifyContent: "center" },
});

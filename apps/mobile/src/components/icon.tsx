import { useRef, type ReactNode } from "react";
import { type ColorValue, Platform, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SymbolView, type SFSymbol, type SymbolWeight } from "expo-symbols";
import { useReduceMotion } from "@/lib/accessibility";

/** Every icon in the app is named with its Ionicons name: the same names as before, so a screen never changes them. */
export type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The SF Symbol drawn for each icon on iOS: Apple's own glyphs, with their optical weights and alignment, so the app
 * reads as native next to the system's bars, sheets and menus. Each name was checked against the SF Symbols catalogue;
 * anything not listed (and every icon on Android and the web) is drawn with Ionicons as before. Colours stay the app's.
 */
const SF: Partial<Record<IconName, SFSymbol>> = {
  "add": "plus",
  "add-circle": "plus.circle.fill",
  "add-circle-outline": "plus.circle",
  "alert-circle": "exclamationmark.circle.fill",
  "archive-outline": "archivebox",
  "arrow-undo-outline": "arrowshape.turn.up.left",
  "arrow-up": "arrow.up",
  "arrow-up-circle": "arrow.up.circle.fill",
  "arrow-up-circle-outline": "arrow.up.circle",
  "bag-handle-outline": "bag",
  "ban-outline": "nosign",
  "basketball-outline": "basketball",
  "bed-outline": "bed.double",
  "bicycle-outline": "bicycle",
  "book-outline": "book",
  "bookmark": "bookmark.fill",
  "bookmark-outline": "bookmark",
  "bulb": "lightbulb.fill",
  "bulb-outline": "lightbulb",
  "calendar-outline": "calendar",
  "camera": "camera.fill",
  "camera-outline": "camera",
  "chatbox-outline": "text.bubble",
  "chatbubble": "bubble.right.fill",
  "chatbubble-ellipses-outline": "ellipsis.bubble",
  "chatbubble-outline": "bubble.right",
  "chatbubbles": "bubble.left.and.bubble.right.fill",
  "chatbubbles-outline": "bubble.left.and.bubble.right",
  "checkbox": "checkmark.square.fill",
  "checkmark": "checkmark",
  "checkmark-circle": "checkmark.circle.fill",
  "checkmark-circle-outline": "checkmark.circle",
  "checkmark-done-outline": "checkmark.circle",
  "chevron-back": "chevron.left",
  "chevron-down": "chevron.down",
  "chevron-forward": "chevron.right",
  "chevron-up": "chevron.up",
  "close": "xmark",
  "close-circle": "xmark.circle.fill",
  "close-circle-outline": "xmark.circle",
  "cloud-offline-outline": "wifi.slash",
  "compass": "safari.fill",
  "compass-outline": "safari",
  "copy": "square.on.square",
  "create-outline": "square.and.pencil",
  "cube-outline": "cube",
  "desktop-outline": "desktopcomputer",
  "document-outline": "doc",
  "document-text-outline": "doc.text",
  "earth-outline": "globe.americas",
  "easel-outline": "doc.richtext",
  "ellipse-outline": "circle",
  "ellipsis-horizontal": "ellipsis",
  "ellipsis-horizontal-circle": "ellipsis.circle",
  "exit-outline": "rectangle.portrait.and.arrow.right",
  "eye-off-outline": "eye.slash",
  "eye-outline": "eye",
  "film": "play.rectangle.fill",
  "film-outline": "play.rectangle",
  "flag-outline": "flag",
  "flame": "flame.fill",
  "flame-outline": "flame",
  "globe-outline": "globe",
  "grid": "square.grid.3x3.fill",
  "grid-outline": "square.grid.3x3",
  "heart": "heart.fill",
  "heart-outline": "heart",
  "help": "questionmark",
  "home": "house.fill",
  "home-outline": "house",
  "image": "photo.fill",
  "image-outline": "photo",
  "images": "photo.fill.on.rectangle.fill",
  "images-outline": "photo.on.rectangle",
  "information-circle-outline": "info.circle",
  "mic": "mic.fill",
  "mic-outline": "mic",
  "laptop-outline": "laptopcomputer",
  "link": "link",
  "link-outline": "link",
  "location": "mappin.and.ellipse",
  "location-outline": "mappin.and.ellipse",
  "lock-closed": "lock.fill",
  "lock-closed-outline": "lock",
  "lock-open-outline": "lock.open",
  "log-out-outline": "rectangle.portrait.and.arrow.right",
  "mail-open-outline": "envelope.open",
  "mail-outline": "envelope",
  "navigate-outline": "location",
  "newspaper-outline": "newspaper",
  "notifications": "bell.fill",
  "notifications-off": "bell.slash.fill",
  "notifications-off-outline": "bell.slash",
  "notifications-outline": "bell",
  "open-outline": "arrow.up.right.square",
  "options-outline": "slider.horizontal.3",
  "paper-plane-outline": "paperplane",
  "people": "person.2.fill",
  "people-outline": "person.2",
  "person": "person.fill",
  "person-add": "person.fill.badge.plus",
  "person-add-outline": "person.badge.plus",
  "person-circle": "person.crop.circle.fill",
  "person-circle-outline": "person.crop.circle",
  "person-outline": "person",
  "pin": "pin.fill",
  "pin-outline": "pin",
  "play": "play.fill",
  "pricetag-outline": "tag",
  "qr-code-outline": "qrcode",
  "refresh": "arrow.clockwise",
  "restaurant-outline": "fork.knife",
  "school": "graduationcap.fill",
  "school-outline": "graduationcap",
  "search": "magnifyingglass",
  "search-outline": "magnifyingglass",
  "send": "paperplane.fill",
  "settings": "gearshape.fill",
  "settings-outline": "gearshape",
  "share-outline": "square.and.arrow.up",
  "shield-checkmark-outline": "checkmark.shield",
  "shirt-outline": "tshirt",
  "sparkles": "sparkles",
  "sparkles-outline": "sparkles",
  "square-outline": "square",
  "storefront": "storefront.fill",
  "storefront-outline": "storefront",
  "swap-vertical-outline": "arrow.up.arrow.down",
  "thumbs-down": "hand.thumbsdown.fill",
  "thumbs-down-outline": "hand.thumbsdown",
  "thumbs-up": "hand.thumbsup.fill",
  "thumbs-up-outline": "hand.thumbsup",
  "time": "clock.fill",
  "time-outline": "clock",
  "trash-outline": "trash",
  "trending-up-outline": "chart.line.uptrend.xyaxis",
  "videocam": "video.fill",
  "videocam-off-outline": "video.slash",
  "videocam-outline": "video",
  "volume-high": "speaker.wave.2.fill",
  "volume-mute": "speaker.slash.fill",
  "water-outline": "drop",
};

/** Symbols newer than the oldest iOS the app runs on: on an older iPhone the Ionicon stands in. */
const MIN_IOS: Partial<Record<SFSymbol, number>> = { basketball: 16, storefront: 17, "storefront.fill": 17, "arrowshape.up": 17, "arrowshape.up.fill": 17, "arrowshape.down": 17, "arrowshape.down.fill": 17 };
const IOS = Platform.OS === "ios" ? parseFloat(String(Platform.Version)) : 0;
/**
 * An SF Symbol fills its box edge to edge, an Ionicon leaves a margin: drawn this share of the size (centred in the
 * same box), a symbol matches the optical size of the icon it replaces, so no row reflows.
 */
const OPTICAL = 0.88;

export type IconProps = {
  name: IconName;
  size?: number;
  color?: ColorValue;
  /** Margins, and the text shadow used over photos and video (drawn as a soft layer shadow under a symbol). */
  style?: StyleProp<TextStyle>;
  /** A specific SF Symbol instead of the mapped one (iOS only), e.g. the verified seal or a tab's own glyph. */
  sf?: SFSymbol;
  /** The symbol's stroke weight on iOS; regular by default, like the system's bar buttons. */
  weight?: SymbolWeight;
  /** Change this number to play the symbol's bounce once (a like, a save, a tab chosen). Zero or undefined: still. */
  bounce?: number;
  /** What to draw where the SF Symbol cannot be (Android, the web, older iOS) instead of the Ionicon `name`. */
  fallback?: ReactNode;
  accessibilityLabel?: string;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: "auto" | "yes" | "no" | "no-hide-descendants";
  testID?: string;
};

/** One icon: an SF Symbol on iOS (iOS 17 animates `bounce`), the Ionicon elsewhere. A drop-in for <Ionicons>. */
export function Icon({ name, size = 24, color, style, sf, weight = "regular", bounce, fallback, accessibilityLabel, ...rest }: IconProps) {
  const ionicon = fallback ?? <Ionicons name={name} size={size} color={color} style={style} accessibilityLabel={accessibilityLabel} {...rest} />;
  const symbol = sf ?? SF[name];
  if (!symbol || IOS === 0) return ionicon;
  const min = MIN_IOS[symbol];
  if (min !== undefined && IOS < min) return ionicon;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const { textShadowColor, textShadowRadius, textShadowOffset, color: _color, fontSize: _fontSize, lineHeight: _lineHeight, fontWeight: _fontWeight, textAlign: _textAlign, ...layout } = flat;
  const inner = Math.round(size * OPTICAL);
  const inset = (size - inner) / 2;
  const shadow: ViewStyle | null = textShadowColor ? { shadowColor: textShadowColor, shadowOpacity: 1, shadowRadius: textShadowRadius ?? 0, shadowOffset: textShadowOffset ?? { width: 0, height: 0 } } : null;
  const box = withInset(layout as ViewStyle, inset);
  return (
    <SymbolView
      // A new key mounts the symbol afresh, which is when it plays its effect: once per change of `bounce`.
      key={bounce ? `b${bounce}` : "still"}
      name={symbol}
      size={inner}
      tintColor={color}
      weight={weight}
      animationSpec={bounce ? { effect: { type: "bounce", wholeSymbol: true } } : undefined}
      fallback={ionicon}
      accessible={accessibilityLabel ? true : undefined}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
      accessibilityLabel={accessibilityLabel}
      {...rest}
      style={[box, shadow]}
    />
  );
}

/**
 * For `bounce`: a number that goes up each time `on` turns true after the first render (a heart filling, a bookmark
 * saving, a tab chosen), so the symbol answers the change and never plays when a screen merely appears. It reads 0
 * while `on` is false, so the thing turning off (the tab left behind, a like taken back) swaps to its plain symbol at
 * once, with no effect: the bounce belongs to what turns on, never to what turns off. Counted during render rather than
 * in an effect, so the symbol that turns on mounts with its bounce in the very frame it changes (never drawn plain first
 * and then again bouncing). Zero under Reduce Motion.
 */
export function useBounceOn(on: boolean): number {
  const reduce = useReduceMotion();
  const seen = useRef<{ on: boolean; count: number } | null>(null);
  if (seen.current === null) seen.current = { on, count: 0 };
  else if (seen.current.on !== on) seen.current = { on, count: on ? seen.current.count + 1 : seen.current.count };
  return reduce || !on ? 0 : seen.current.count;
}

/** The caller's margins (whichever form they came in) plus the optical inset on every side, so the icon's box stays `size`. */
function withInset(layout: ViewStyle, inset: number): ViewStyle {
  const { margin, marginHorizontal, marginVertical, marginTop, marginBottom, marginLeft, marginRight, marginStart, marginEnd, ...rest } = layout;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    ...rest,
    marginTop: n(marginTop ?? marginVertical ?? margin) + inset,
    marginBottom: n(marginBottom ?? marginVertical ?? margin) + inset,
    marginLeft: n(marginLeft ?? marginStart ?? marginHorizontal ?? margin) + inset,
    marginRight: n(marginRight ?? marginEnd ?? marginHorizontal ?? margin) + inset,
  };
}

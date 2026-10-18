import type { TextStyle, ViewStyle } from "react-native";

/**
 * CampConnect's design system, the parts that are the same in both themes. Colours live in palette.ts and come from
 * the theme (useColors() / makeStyles() in theme-provider.tsx), so they follow Light, Dark and System Default.
 *
 * The look: quiet luxury. Warm ivory and near-black surfaces, ink for what matters and one violet accent used
 * sparingly, hairlines rather than boxes, an editorial serif (Playfair Display) for the wordmark and titles over the
 * platform's own sans for everything you read and tap, corners kept modest, shadows barely there, and motion on soft
 * springs. Nothing here is decoration: every value is a size, a weight or a rhythm the screens share.
 */

/** Corner radii: modest, so cards and controls read as crafted rather than bubbly. `pill` is for capsules only. */
export const radius = { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 };

/**
 * iOS's continuous ("squircle") corner: the curvature eases into the straight edge instead of meeting it at a kink,
 * as on every Apple surface. Spread into any rounded rectangle; circles and capsules keep their plain arcs.
 */
export const continuous = { borderCurve: "continuous" } as const;

/**
 * An iOS 26 sheet at a partial height: it floats inset from the screen's sides and bottom, its corners concentric
 * with the phone's, rather than spanning edge to edge.
 */
export const sheetShape = { marginHorizontal: 8, marginBottom: 8, borderRadius: 34, borderCurve: "continuous", overflow: "hidden" } as const;

/** The spacing rhythm, on a 4pt grid. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

/**
 * The faces loaded in app/_layout.tsx (assets/fonts): Playfair Display for display text, the system face (SF on iOS,
 * Roboto on Android) for everything else. A display style names its face and never sets fontWeight: iOS would look
 * for another weight inside a family that holds just one.
 */
export const fonts = {
  display: "PlayfairDisplay-SemiBold",
  displayMedium: "PlayfairDisplay-Medium",
  displayBold: "PlayfairDisplay-Bold",
  displayItalic: "PlayfairDisplay-MediumItalic",
} as const;

/** The font files, keyed by the family names above. */
export const FONT_FILES = {
  [fonts.display]: require("../../assets/fonts/PlayfairDisplay-SemiBold.ttf"),
  [fonts.displayMedium]: require("../../assets/fonts/PlayfairDisplay-Medium.ttf"),
  [fonts.displayBold]: require("../../assets/fonts/PlayfairDisplay-Bold.ttf"),
  [fonts.displayItalic]: require("../../assets/fonts/PlayfairDisplay-MediumItalic.ttf"),
} as const;

/**
 * The type scale. Display and title are the serif (screen titles, the wordmark, big numbers, the headline of an empty
 * state); the rest is the system face. Sizes are points before the phone's text-size setting.
 */
export const type = {
  /** The largest serif: a welcome, a profile's name. */
  display: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.5 },
  /** Screen titles in the app's own bars, the Home wordmark. */
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  /** A serif heading inside a page: an empty state's headline, a sheet's title. */
  headline: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  /** A quiet serif aside: "You're all caught up." */
  aside: { fontFamily: fonts.displayItalic, fontSize: 16, lineHeight: 22 },
  /** Sans headings: a card's title, a section heading. */
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "700" as const, letterSpacing: -0.2 },
  /** A row's main line: names. */
  subheading: { fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 22 },
  bodySmall: { fontSize: 15, lineHeight: 21 },
  /** Buttons, chips, tabs. */
  label: { fontSize: 14, lineHeight: 18, fontWeight: "600" as const },
  /** Times, metadata, helper text. */
  caption: { fontSize: 13, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 16 },
  /** A tracked small-caps label above a section or a stat: the editorial eyebrow. */
  eyebrow: { fontSize: 11, lineHeight: 14, fontWeight: "700" as const, letterSpacing: 1.1, textTransform: "uppercase" as const },
} satisfies Record<string, TextStyle>;

/**
 * Depth, kept faint: a card's lift in light (dark mode draws hairlines instead, see makeStyles callers), a floating
 * control's shadow, and the sheet's. iOS shadow props; `elevation` for Android.
 */
export const shadows = {
  card: { shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  float: { shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  sheet: { shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
} satisfies Record<string, ViewStyle>;

/**
 * Motion, after UIKit's springs: `spring` settles without a visible overshoot (the default for things that move into
 * place), `snappy` answers a finger at once (selection thumbs, toggles), `bouncy` keeps a little life (a like, a badge).
 * Every animation is skipped when Reduce Motion is on (see lib/accessibility).
 */
export const motion = {
  spring: { damping: 18, stiffness: 240, mass: 0.7 },
  snappy: { damping: 24, stiffness: 380, mass: 0.6 },
  bouncy: { damping: 12, stiffness: 260, mass: 0.6 },
  /** For Animated.spring (the legacy API): the same feel. */
  legacySpring: { friction: 7, tension: 160, useNativeDriver: true },
  pressScale: 0.97,
  /** Durations in ms for timing animations: a fade, a slide. */
  fast: 140,
  base: 220,
  slow: 320,
} as const;

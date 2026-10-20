// Colours live in palette.ts and come from the theme (useColors() / makeStyles() in theme-provider.tsx),
// so they follow Light, Dark and System Default. Sizes stay here because they are the same in both themes.
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

/**
 * Apple's text styles at the default size, with UIKit's line heights: one scale for every screen, so a heading, a
 * list row and a caption read the same wherever they appear. Titles are bold (700), like the system's navigation large
 * titles; nothing in the app goes heavier except the UniBuzz wordmark. The system font (SF Pro) brings its own
 * optical tracking, so none of these set letterSpacing.
 */
export const textStyle = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "700" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subheadline: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption1: { fontSize: 12, lineHeight: 16 },
  caption2: { fontSize: 11, lineHeight: 13 },
} as const;

/**
 * iOS's continuous ("squircle") corner: the curvature eases into the straight edge instead of meeting it at a kink, as
 * on every Apple surface. Same radii as before; circles and capsules keep their plain arcs.
 */
export const continuous = { borderCurve: "continuous" } as const;

/** Where the aurora's four stops sit: cyan only at the leading edge, blue and periwinkle across the middle (where a label sits), violet at the end. */
const AURORA_AT = [0, 34, 68, 100] as const;

/**
 * The Aurora as a CSS gradient for `experimental_backgroundImage`: pass `colors.aurora` (fills under white words) or
 * `colors.auroraGlow` (rings, underlines). `angle` follows CSS: 90 runs left to right, 135 corner to corner.
 */
export function auroraGradient(stops: readonly string[], angle = 110): string {
  return `linear-gradient(${angle}deg, ${stops.map((c, i) => `${c} ${AURORA_AT[i] ?? 100}%`).join(", ")})`;
}

/** An iOS 26 sheet at a partial height: it floats inset from the screen's sides and bottom, its corners concentric with the phone's. */
export const sheetShape = { marginHorizontal: 8, marginBottom: 8, borderRadius: 34, borderCurve: "continuous", overflow: "hidden" } as const;

/**
 * Motion, after UIKit's springs: `spring` settles without a visible overshoot, `snappy` answers a finger at once
 * (selection thumbs), and a control sinks to `pressScale` while it is held. Everything is still under Reduce Motion
 * (see lib/accessibility).
 */
export const motion = {
  spring: { damping: 18, stiffness: 240, mass: 0.7 },
  snappy: { damping: 24, stiffness: 380, mass: 0.6 },
  /** UIKit's sheet presentation: critically damped (no bounce) with a response of about 0.37s. */
  sheet: { damping: 34, stiffness: 290, mass: 1 },
  /** How long a sheet takes to leave, accelerating away like the system's own. */
  sheetOut: 240,
  legacySpring: { friction: 7, tension: 160, useNativeDriver: true },
  pressScale: 0.97,
  base: 220,
} as const;

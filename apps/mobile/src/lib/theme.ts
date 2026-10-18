// Colours live in palette.ts and come from the theme (useColors() / makeStyles() in theme-provider.tsx),
// so they follow Light, Dark and System Default. Sizes stay here because they are the same in both themes.
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

/**
 * iOS's continuous ("squircle") corner: the curvature eases into the straight edge instead of meeting it at a kink, as
 * on every Apple surface. Same radii as before; circles and capsules keep their plain arcs.
 */
export const continuous = { borderCurve: "continuous" } as const;

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
  legacySpring: { friction: 7, tension: 160, useNativeDriver: true },
  pressScale: 0.97,
  base: 220,
} as const;

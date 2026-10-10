/**
 * The two CampConnect palettes. Every colour on screen comes from one of these through useColors() / makeStyles(),
 * so a theme switch repaints the whole app at once. Same keys in both; screens never pick a hex code themselves.
 *
 * Light: white background, black text, light grey borders, blue accents.
 * Dark: pure black background, white text, dark grey cards and borders, the same blue accents.
 */
export type ThemeColors = {
  /** The CampConnect blue: buttons, links, active tabs, accents. The same in both themes. */
  brand: string;
  brandDark: string;
  /** A faint blue wash behind brand icons and selected chips. */
  brandSoft: string;
  /** Text and icons drawn on a brand-blue fill. */
  onBrand: string;
  /** Screen background. */
  bg: string;
  /** Cards, rows, headers, the tab bar. */
  card: string;
  /** Sheets, menus and dialogs that float above the screen. */
  elevated: string;
  /** Main text and icons. */
  text: string;
  /** Secondary text: times, captions, labels. */
  muted: string;
  /** Hints, placeholders, disabled icons. */
  faint: string;
  /** Hairlines, dividers, card outlines. */
  border: string;
  /** Text fields, search boxes, pills. */
  input: string;
  /** Placeholder shapes while content loads. */
  skeleton: string;
  green: string;
  red: string;
  amber: string;
  /** The filled heart. */
  like: string;
  /** Soft status backgrounds and the text that sits on them. */
  dangerSoft: string;
  dangerText: string;
  successSoft: string;
  successText: string;
  warningSoft: string;
  warningText: string;
  /** Text and icons over photos and videos (always light: the picture decides, not the theme). */
  onMedia: string;
  onMediaMuted: string;
  /** Dark pills and gradients that keep text readable over photos and videos. */
  mediaScrim: string;
  /** Behind photos and videos while they load, and the Reels page. */
  mediaBg: string;
  /** The dimmed screen behind sheets and dialogs. */
  backdrop: string;
  /** Shadow colour for raised elements. */
  shadow: string;
};

export type ColorScheme = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";

export const lightColors: ThemeColors = {
  brand: "#1877f2",
  brandDark: "#166fe5",
  brandSoft: "#e7f0fd",
  onBrand: "#ffffff",
  bg: "#ffffff",
  card: "#ffffff",
  elevated: "#ffffff",
  text: "#050505",
  muted: "#65676b",
  faint: "#8a8d91",
  border: "#e4e6eb",
  input: "#f0f2f5",
  skeleton: "#e4e6eb",
  green: "#31a24c",
  red: "#e41e3f",
  amber: "#f7b928",
  like: "#ed4956",
  dangerSoft: "#fdecec",
  dangerText: "#8a1c1c",
  successSoft: "#e6f6ea",
  successText: "#1f7a37",
  warningSoft: "#fff4d6",
  warningText: "#7a5200",
  onMedia: "#ffffff",
  onMediaMuted: "rgba(255,255,255,0.75)",
  mediaScrim: "rgba(0,0,0,0.45)",
  mediaBg: "#000000",
  backdrop: "rgba(0,0,0,0.25)",
  shadow: "#000000",
};

export const darkColors: ThemeColors = {
  brand: "#1877f2",
  brandDark: "#166fe5",
  brandSoft: "#0f2747",
  onBrand: "#ffffff",
  bg: "#000000",
  card: "#1c1c1e",
  elevated: "#1c1c1e",
  text: "#ffffff",
  muted: "#a8abaf",
  faint: "#7c7f84",
  border: "#2c2c2e",
  input: "#2c2c2e",
  skeleton: "#2c2c2e",
  green: "#3fbf5f",
  red: "#ff453a",
  amber: "#ffd60a",
  like: "#ff4d67",
  dangerSoft: "#3b1518",
  dangerText: "#ffb4b4",
  successSoft: "#10301b",
  successText: "#7ee2a0",
  warningSoft: "#3a2f0b",
  warningText: "#ffd66b",
  onMedia: "#ffffff",
  onMediaMuted: "rgba(255,255,255,0.75)",
  mediaScrim: "rgba(0,0,0,0.45)",
  mediaBg: "#000000",
  backdrop: "rgba(0,0,0,0.6)",
  shadow: "#000000",
};

export const palettes: Record<ColorScheme, ThemeColors> = { light: lightColors, dark: darkColors };

/** The three choices in Settings → Theme, in order. */
export const THEME_PREFERENCES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System Default" },
];

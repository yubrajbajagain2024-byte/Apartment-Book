/**
 * The two CampConnect palettes. Every colour on screen comes from one of these through useColors() / makeStyles(),
 * so a theme switch repaints the whole app at once. Same keys in both; screens never pick a hex code themselves.
 *
 * Light: white background, black text, light grey borders, blue accents.
 * Dark: pure black background and bars, white text, dark grey cards and borders, the same blue accents.
 */
export type ThemeColors = {
  /** The CampConnect blue: buttons, links, active tabs, accents. The same in both themes. */
  brand: string;
  brandDark: string;
  /** A faint blue wash behind brand icons and selected chips. */
  brandSoft: string;
  /** Text and icons drawn on a brand-blue fill. */
  onBrand: string;
  /** The violet accent of the Home feed: the active label's underline, the slide dots under a photo and where the "New post" button's gradient starts. */
  accent: string;
  /** The blue the "New post" button's gradient ends in. */
  accentBlue: string;
  /** The teal the ring around your photo in the Home bar starts from (it ends in `accent`). */
  accentTeal: string;
  /** The floating bottom bar where there is no liquid glass (Android, iOS before 26): a translucent fill, and the hairline around the pill everywhere. */
  glass: string;
  glassEdge: string;
  /** The lighter capsule behind the bar's active tab. */
  glassHighlight: string;
  /** Screen background. */
  bg: string;
  /** Cards and rows that sit on the screen. Bars use `bar`. */
  card: string;
  /** Top bars, the tab bar, tab rows right under a top bar and bottom composer bars: the same as the screen, so they read as one surface; hairlines separate them. */
  bar: string;
  /** Sheets, menus and dialogs that float above the screen. */
  elevated: string;
  /** Main text and icons. */
  text: string;
  /** Secondary text: times, captions, labels. */
  muted: string;
  /**
   * Hints, placeholders, disabled icons. At least 4.5:1 on the page and on cards in both themes, and on the input fill
   * in dark; light placeholders sit at about 4.1:1 on the grey input fill, so they stay a step lighter than `muted`.
   */
  faint: string;
  /** Hairlines, dividers, card outlines. */
  border: string;
  /** Text fields, search boxes, pills. */
  input: string;
  /** Placeholder shapes while content loads. */
  skeleton: string;
  /** A soft panel on the screen: the profile's stats card. Lighter than the screen in dark, a grey wash in light. */
  panel: string;
  /** The profile's cover band: its top colour (it fades down into `bg`) and the two soft glows over it, violet and teal. */
  coverTop: string;
  coverGlowA: string;
  coverGlowB: string;
  /** The translucent round buttons floating on the cover (Back, Find friends, the menu); they sit on `bar` once the cover has scrolled away. */
  coverButton: string;
  /** Green and red for text, icons and dots (the presence dot, unread markers). */
  green: string;
  red: string;
  amber: string;
  /** Red behind white text: Delete buttons, unread count badges. Darker than `red` in dark mode so the text stays readable. */
  dangerFill: string;
  /** Green behind white text, such as a "Sent" button. */
  successFill: string;
  /** The filled heart. */
  like: string;
  /** Hashtags in captions. */
  hashtag: string;
  /** Buzz's downvote violet: `downvote` for the bare arrow and score, `downvoteFill` behind white text in a filled pill. */
  downvote: string;
  downvoteFill: string;
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
  /** Dark round buttons and gradients that keep icons readable over photos and videos. */
  mediaScrim: string;
  /** The darker pill behind small text over photos (photo counters, prices, badges). */
  mediaPill: string;
  /** The shadow under white text and marks drawn straight on photos and videos (Reels captions, grid view counts). */
  mediaTextShadow: string;
  /** The verified tick over video: lighter than `brand`, so it stays clear on dark footage. */
  verifiedOnMedia: string;
  /**
   * A control drawn on video (the Campus | Global toggle over Reels, the viewer's Back and sound buttons): a dark glass
   * fill, its light edge and the brighter thumb on the chosen part. The same in both themes, so white words always have
   * something dark behind them (white stays above 4.5:1 even on a white frame).
   */
  mediaControl: string;
  mediaControlEdge: string;
  mediaControlActive: string;
  /** Behind photos and videos while they load, and the Reels page. */
  mediaBg: string;
  /** The dimmed screen behind sheets and dialogs. */
  backdrop: string;
  /** The little bar at the top of a sheet that says it can be pulled down: iOS's grabber grey. */
  grabber: string;
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
  accent: "#6a4df0",
  accentBlue: "#3b82f6",
  accentTeal: "#14b8a6",
  glass: "rgba(255,255,255,0.92)",
  glassEdge: "rgba(0,0,0,0.1)",
  glassHighlight: "rgba(0,0,0,0.08)",
  bg: "#ffffff",
  card: "#ffffff",
  bar: "#ffffff",
  elevated: "#ffffff",
  text: "#050505",
  muted: "#65676b",
  faint: "#737679",
  border: "#e4e6eb",
  input: "#f0f2f5",
  skeleton: "#e4e6eb",
  panel: "#f0f2f5",
  coverTop: "#e4e8f4",
  coverGlowA: "rgba(124,92,255,0.34)",
  coverGlowB: "rgba(32,196,160,0.28)",
  coverButton: "rgba(0,0,0,0.07)",
  green: "#31a24c",
  red: "#e41e3f",
  amber: "#f7b928",
  dangerFill: "#e41e3f",
  successFill: "#31a24c",
  like: "#ed4956",
  hashtag: "#00376b",
  downvote: "#6a5cff",
  downvoteFill: "#6a5cff",
  dangerSoft: "#fdecec",
  dangerText: "#8a1c1c",
  successSoft: "#e6f6ea",
  successText: "#1f7a37",
  warningSoft: "#fff4d6",
  warningText: "#7a5200",
  onMedia: "#ffffff",
  onMediaMuted: "rgba(255,255,255,0.75)",
  mediaScrim: "rgba(0,0,0,0.45)",
  mediaPill: "rgba(0,0,0,0.65)",
  mediaTextShadow: "rgba(0,0,0,0.6)",
  verifiedOnMedia: "#4da3ff",
  mediaControl: "rgba(18,18,20,0.58)",
  mediaControlEdge: "rgba(255,255,255,0.24)",
  mediaControlActive: "rgba(255,255,255,0.28)",
  mediaBg: "#000000",
  backdrop: "rgba(0,0,0,0.25)",
  grabber: "#c7c7cc",
  shadow: "#000000",
};

export const darkColors: ThemeColors = {
  brand: "#1877f2",
  brandDark: "#166fe5",
  brandSoft: "#0f2747",
  onBrand: "#ffffff",
  accent: "#8b7cff",
  accentBlue: "#5b9bff",
  accentTeal: "#2dd4bf",
  glass: "rgba(22,22,24,0.92)",
  glassEdge: "rgba(255,255,255,0.14)",
  glassHighlight: "rgba(255,255,255,0.16)",
  bg: "#000000",
  card: "#1c1c1e",
  bar: "#000000",
  elevated: "#1c1c1e",
  text: "#ffffff",
  muted: "#a8abaf",
  faint: "#929599",
  border: "#38383a",
  input: "#2c2c2e",
  skeleton: "#2c2c2e",
  panel: "#1c1c1e",
  coverTop: "#18163a",
  coverGlowA: "rgba(118,84,240,0.55)",
  coverGlowB: "rgba(36,200,160,0.34)",
  coverButton: "rgba(255,255,255,0.14)",
  green: "#3fbf5f",
  red: "#ff453a",
  amber: "#ffd60a",
  dangerFill: "#d70015",
  successFill: "#1f7a37",
  like: "#ff4d67",
  hashtag: "#e0f1ff",
  downvote: "#8b7fff",
  downvoteFill: "#6a5cff",
  dangerSoft: "#3b1518",
  dangerText: "#ffb4b4",
  successSoft: "#10301b",
  successText: "#7ee2a0",
  warningSoft: "#3a2f0b",
  warningText: "#ffd66b",
  onMedia: "#ffffff",
  onMediaMuted: "rgba(255,255,255,0.75)",
  mediaScrim: "rgba(0,0,0,0.45)",
  mediaPill: "rgba(0,0,0,0.65)",
  mediaTextShadow: "rgba(0,0,0,0.6)",
  verifiedOnMedia: "#4da3ff",
  mediaControl: "rgba(18,18,20,0.58)",
  mediaControlEdge: "rgba(255,255,255,0.24)",
  mediaControlActive: "rgba(255,255,255,0.28)",
  mediaBg: "#000000",
  backdrop: "rgba(0,0,0,0.6)",
  grabber: "#5a5a5e",
  shadow: "#000000",
};

export const palettes: Record<ColorScheme, ThemeColors> = { light: lightColors, dark: darkColors };

/** The three choices in Settings → Theme, in order. */
export const THEME_PREFERENCES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System Default" },
];

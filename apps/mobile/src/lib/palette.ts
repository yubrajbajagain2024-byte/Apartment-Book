/**
 * The two CampConnect palettes. Every colour on screen comes from one of these through useColors() / makeStyles(),
 * so a theme switch repaints the whole app at once. Same keys in both; screens never pick a hex code themselves.
 *
 * Quiet luxury in both: warm ivory surfaces and near-black ink in light, near-black surfaces and warm white ink in dark.
 * Ink is the primary colour (buttons, links, selected things), one violet accent is used sparingly for what moves
 * (Home's underline, the feed dots, hashtags), and a bronze marks the verified. Hairlines separate; nothing is boxed.
 *
 * Every text colour clears WCAG contrast on every surface it sits on (bg, card, input, panel, elevated), in both themes:
 * `text` above 15:1, `muted` at least 6.5:1 (AAA on the screen), `faint` at least 4.6:1 (AA, even placeholders on a
 * field's fill). Hairlines (`border`) are about 1.3:1 so they read as a crisp line, not a smudge, and the outlines of
 * controls you tap (`borderStrong`) about 1.6:1 or more so a chip or an outline button reads as one shape. The floating
 * bar's `glass` fill lets a breath of the content through its Liquid Glass at 92%: even over pure black or white
 * content its grey labels keep at least 6:1.
 */
export type ThemeColors = {
  /** CampConnect's primary: ink. Buttons, links, selected tabs and chips; white ink in dark. */
  brand: string;
  brandDark: string;
  /** A faint warm wash behind icons, selected chips and avatar initials. */
  brandSoft: string;
  /** Text and icons drawn on a brand fill. */
  onBrand: string;
  /** The verified mark beside a name: bronze, the one warm metal in the palette. */
  verified: string;
  /** The one accent, a deep violet: Home's sliding underline, the slide dots under a photo, hashtags, selection. */
  accent: string;
  /** A second violet, close to `accent`, for the quiet duotone of the few gradients left (the ring around your photo). */
  accentBlue: string;
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
  /** Secondary text: inactive tabs, captions, labels, metadata. At least 6.5:1 everywhere. */
  muted: string;
  /** Tertiary text: placeholders, times, hints, disabled icons. Still at least 4.6:1 everywhere, so it is never washed out. */
  faint: string;
  /** Hairlines, dividers, card outlines. */
  border: string;
  /** The outline of a control you tap: chips, outline buttons, tags, toggles, round icon buttons. Stronger than `border`. */
  borderStrong: string;
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
  /** A control drawn on video (a segmented toggle): a dark glass fill, its light edge, and the brighter thumb on the chosen part. Theme-independent. */
  mediaControl: string;
  mediaControlEdge: string;
  mediaControlActive: string;
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
  brand: "#121214",
  brandDark: "#000000",
  brandSoft: "#ECEAE4",
  onBrand: "#FFFFFF",
  verified: "#A8884A",
  accent: "#5B4BDB",
  accentBlue: "#4F5FD8",
  accentTeal: "#7C6EE6",
  glass: "rgba(247,246,243,0.92)",
  glassEdge: "rgba(18,18,20,0.12)",
  glassHighlight: "rgba(18,18,20,0.08)",
  bg: "#F7F6F3",
  card: "#FFFFFF",
  bar: "#F7F6F3",
  elevated: "#FFFFFF",
  text: "#121214",
  muted: "#525257",
  faint: "#68686D",
  border: "#DBD9D3",
  borderStrong: "#C4C2BC",
  input: "#EDEBE6",
  skeleton: "#ECEAE4",
  panel: "#F1EFEA",
  coverTop: "#ECEAE4",
  coverGlowA: "rgba(91,75,219,0.16)",
  coverGlowB: "rgba(168,136,74,0.14)",
  coverButton: "rgba(18,18,20,0.06)",
  green: "#2F9E5B",
  red: "#D23B4B",
  amber: "#C79A2E",
  dangerFill: "#C8323F",
  successFill: "#2F9E5B",
  like: "#D8405A",
  hashtag: "#5B4BDB",
  downvote: "#5B4BDB",
  downvoteFill: "#5B4BDB",
  dangerSoft: "#FBECEC",
  dangerText: "#8E2430",
  successSoft: "#E8F4EC",
  successText: "#1F6B3B",
  warningSoft: "#FBF3DF",
  warningText: "#7A5614",
  onMedia: "#FFFFFF",
  onMediaMuted: "rgba(255,255,255,0.88)",
  mediaScrim: "rgba(0,0,0,0.45)",
  mediaPill: "rgba(0,0,0,0.62)",
  mediaTextShadow: "rgba(0,0,0,0.6)",
  verifiedOnMedia: "#E6CB85",
  mediaControl: "rgba(18,18,20,0.58)",
  mediaControlEdge: "rgba(255,255,255,0.24)",
  mediaControlActive: "rgba(255,255,255,0.28)",
  mediaBg: "#000000",
  backdrop: "rgba(18,18,20,0.32)",
  shadow: "#121214",
};

export const darkColors: ThemeColors = {
  brand: "#F3F2EE",
  brandDark: "#FFFFFF",
  brandSoft: "#232326",
  onBrand: "#0B0B0C",
  verified: "#D4B36A",
  accent: "#9A8CFF",
  accentBlue: "#8F9BFF",
  accentTeal: "#B3A7FF",
  glass: "rgba(21,21,23,0.92)",
  glassEdge: "rgba(255,255,255,0.14)",
  glassHighlight: "rgba(255,255,255,0.14)",
  bg: "#0B0B0C",
  card: "#151517",
  bar: "#0B0B0C",
  elevated: "#1A1A1D",
  text: "#F3F2EE",
  muted: "#A8A8AD",
  faint: "#8A8A8F",
  border: "#2E2E32",
  borderStrong: "#424246",
  input: "#1E1E21",
  skeleton: "#202023",
  panel: "#151517",
  coverTop: "#141418",
  coverGlowA: "rgba(154,140,255,0.22)",
  coverGlowB: "rgba(212,179,106,0.14)",
  coverButton: "rgba(255,255,255,0.12)",
  green: "#4CC273",
  red: "#FF5563",
  amber: "#E6B84A",
  dangerFill: "#C8323F",
  successFill: "#2F9E5B",
  like: "#FF5A73",
  hashtag: "#B9AEFF",
  downvote: "#9A8CFF",
  downvoteFill: "#5B4BDB",
  dangerSoft: "#3A1A1E",
  dangerText: "#FFB3BB",
  successSoft: "#143022",
  successText: "#8CE0A8",
  warningSoft: "#3A2E12",
  warningText: "#F2D27A",
  onMedia: "#FFFFFF",
  onMediaMuted: "rgba(255,255,255,0.88)",
  mediaScrim: "rgba(0,0,0,0.45)",
  mediaPill: "rgba(0,0,0,0.62)",
  mediaTextShadow: "rgba(0,0,0,0.6)",
  verifiedOnMedia: "#E6CB85",
  mediaControl: "rgba(18,18,20,0.58)",
  mediaControlEdge: "rgba(255,255,255,0.24)",
  mediaControlActive: "rgba(255,255,255,0.28)",
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

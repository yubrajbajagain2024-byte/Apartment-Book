/**
 * Buzz v2 constants and copy, ported from UniVerse. The database enforces the same numbers (migration
 * `20261103000100_buzz_v2.sql`); `supabase/tests/buzz-v2.test.mjs` checks the two agree where it can.
 */
import type { BuzzFeedSort, BuzzItemStatus, BuzzPollDuration, BuzzReportReason, BuzzTopWindow, ModerationCategory } from "./types";

/**
 * The version of the Buzz guidelines a person must accept before their first Buzz read. Bump it (here AND in
 * `public.buzz_guidelines_version()`) to ask everyone again.
 */
export const BUZZ_GUIDELINES_VERSION = "2026-10-21";

export const BUZZ_LIMITS = {
  text: 500,
  title: 100,
  replyText: 500,
  images: 4,
  videoMaxSeconds: 60,
  search: 80,
  pollOptionText: 60,
  pollMinOptions: 2,
  pollMaxOptions: 4,
  reportNote: 500,
} as const;

export const BUZZ_PAGE = { feed: 20, replies: 50, mine: 20 } as const;

/** Community collapse / auto-hide thresholds, over ELIGIBLE votes (account ≥ 24 h, not muted, trusted). */
export const BUZZ_COLLAPSE = { score: -5, votes: 8 } as const;
export const BUZZ_AUTO_HIDE = { score: -10, votes: 12 } as const;
export const BUZZ_MILESTONES: readonly number[] = [10, 25, 50, 100, 250];
/** Below this many students a campus is "small": the composer warns, and it is never named next to a buzz. */
export const BUZZ_SMALL_CAMPUS = 50;
/** Polls unlock this long after joining. */
export const BUZZ_POLL_MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

export const BUZZ_SORT_OPTIONS: readonly { value: BuzzFeedSort; label: string }[] = [
  { value: "hot", label: "Hot" },
  { value: "new", label: "New" },
  { value: "top", label: "Top" },
];
export const BUZZ_TOP_WINDOWS: readonly { value: BuzzTopWindow; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "This week" },
  { value: "all", label: "All time" },
];
export const BUZZ_SEARCH_SORTS: readonly { value: Extract<BuzzFeedSort, "new" | "top">; label: string }[] = [
  { value: "new", label: "Newest" },
  { value: "top", label: "Top" },
];
export const BUZZ_POLL_DURATIONS: readonly BuzzPollDuration[] = [1, 3, 7];
export const BUZZ_SEARCH_SUGGESTIONS: readonly string[] = ["dining", "food", "parking", "housing", "roommate", "professor", "library", "gym", "bus", "wifi"];

/* ───────────────────────────── copy ───────────────────────────── */

export const BUZZ_GATE_COPY = {
  title: "Before your first buzz",
  subtitle: "Anonymous to students, accountable to moderators.",
  rules: [
    "Nobody on campus can see who wrote a buzz.",
    "Don't name or target individuals.",
    "Threats, harassment and illegal sales get removed, and repeat offenders get banned.",
  ],
  footnote:
    "Every buzz stays linked to your account for safety. Moderators act on content without seeing who wrote it; only a very small number of admins can reveal an author, for serious cases, with a written reason that is permanently logged.",
  learnMore: "How Buzz anonymity works",
  accept: "I understand",
  notNow: "Not now",
  back: "Back",
} as const;

export const BUZZ_COMPOSER_COPY = {
  title: "New buzz",
  banner: "You're anonymous",
  defaultNote: "Other students can't see who you are. Community Guidelines still apply.",
  smallCampusNote: "Small campus: be mindful that details can identify you.",
  titlePlaceholder: "Title (optional)",
  bodyPlaceholder: "What's campus actually thinking?",
  mediaHint: "Up to 4 photos, or one video up to 60 seconds. Location and camera details are removed.",
  pollsLocked: "Polls unlock after 24 hours",
  pollHint: "Results hidden until people vote",
  submit: "Buzz it",
  campusScopeNote: (campusShortName: string) => `Only shows in the ${campusShortName} campus feed.`,
  globalScopeNote: "Only shows in the Global feed, for students at every campus.",
  promptAttached: (prompt: string) => `Answering today's prompt: ${prompt}`,
  posted: (scope: "campus" | "global", alias: string) =>
    `Buzzed to ${scope === "global" ? "Global" : "your campus"}. Your alias in this thread is ${alias}.`,
  videoTooLong: "Videos on Buzz max out at 60 seconds.",
} as const;

export const BUZZ_REPLY_COPY = {
  placeholder: "Reply anonymously…",
  banner: "You're anonymous",
  verb: "Replying",
  replied: (alias: string) => `Replied as ${alias}`,
  locked: "This thread is locked.",
  closed: "This buzz is no longer open for replies.",
  emptyTitle: "No replies yet.",
  emptyBody: "Reply and you'll get your own alias in this thread.",
  emptyAction: "Write a reply",
} as const;

/** The chip an author sees on their own non-active items. */
export const BUZZ_STATUS_CHIPS: Partial<Record<BuzzItemStatus, string>> = {
  held: "Held for review",
  hidden: "Hidden pending review",
  removed: "Removed",
};

export const BUZZ_FEED_COPY = {
  smallCampus: "Small campus: be mindful that details can identify you.",
  promptOverline: "Today's prompt",
  promptAction: "Answer anonymously",
  searchPlaceholder: (where: string) => `Search ${where} buzz`,
  loadError: "Buzz didn't load. That's on us.",
  end: "That's everything for now",
  topTodayEmpty: "Nothing has taken off today yet.",
  checkNew: "Check New",
  campusEmpty: (university: string) => `It's quiet at ${university}. Somebody has to say it first.`,
  startFirst: "Start the first buzz",
  seeGlobal: "See Global",
  globalEmptyTitle: "Nothing here yet.",
  globalEmptyBody: "Be the first to say it.",
  coldStart: (university: string) => `${university} is just getting started — showing Global.`,
  coldStartAction: "Post the first one",
  collapsedCommunity: "Hidden by the community",
  collapsedAnon: "Hidden by you in this thread",
  tapToView: "Tap to view",
  supportLink: "Support resources",
  showMore: "Show more",
  showLess: "Show less",
  newBuzz: "New buzz",
} as const;

export const BUZZ_MINE_COPY = {
  title: "My buzzes",
  karma: (karma: number) => `Your buzz karma: ${karma}`,
  private: "Only you can ever see this list.",
  privateNote: "Private. Karma is the sum of your scores and is never shown to anyone else.",
  emptyTitle: "You haven't buzzed yet.",
  emptyAction: "Write a buzz",
  replyingIn: "Replying in",
  threadUnavailable: "[thread unavailable]",
  end: "That's all of yours",
} as const;

export const BUZZ_SEARCH_COPY = {
  title: "Search Buzz",
  intro: "Find buzzes about anything: type a word or two. Try one of these:",
  loadError: "Search didn't load. That's on us.",
  noMatch: (where: string, q: string) => `No ${where} buzzes match "${q}".`,
  tryGlobal: "Try another word, or look in Global.",
  tryCampus: "Try another word, or look on your campus.",
  end: "That's every match",
} as const;

/** Overflow menu labels (no Block on Buzz: blocking would let you test who wrote what). */
export const BUZZ_MENU_COPY = {
  share: "Share",
  copyLink: "Copy link",
  report: "Report",
  hideThread: "Hide this thread",
  threadHidden: "Thread hidden",
  hideAnon: "Hide this anon in this thread",
  anonHidden: "Hidden in this thread",
  delete: "Delete",
  deleted: "Deleted",
} as const;

/* ───────────────────────────── reports ───────────────────────────── */

export interface BuzzReportReasonDef {
  id: BuzzReportReason;
  label: string;
  noteRequired: boolean;
}

/** Order is the order shown in the report sheet. */
export const BUZZ_REPORT_REASONS: readonly BuzzReportReasonDef[] = [
  { id: "self_harm", label: "I'm worried about this person", noteRequired: false },
  { id: "threat", label: "Threat or violence", noteRequired: false },
  { id: "minor_safety", label: "Involves a minor", noteRequired: false },
  { id: "doxxing", label: "Shares private info", noteRequired: false },
  { id: "harassment", label: "Harassment or bullying", noteRequired: false },
  { id: "hate", label: "Hate", noteRequired: false },
  { id: "sexual", label: "Sexual content or unwanted advances", noteRequired: false },
  { id: "drugs_illegal", label: "Drugs or illegal sales", noteRequired: false },
  { id: "impersonation", label: "Pretending to be someone", noteRequired: false },
  { id: "spam_scam", label: "Spam or scam", noteRequired: false },
  { id: "academic_dishonesty", label: "Cheating or academic dishonesty", noteRequired: false },
  { id: "other", label: "Something else", noteRequired: true },
];

export const MODERATION_CATEGORY_LABELS: Record<ModerationCategory, string> = {
  threat_violence: "Threats & violence",
  harassment_bullying: "Harassment & bullying",
  hate: "Hate",
  sexual_minors: "Sexual content & minors",
  sexual_explicit: "Sexual content",
  drugs_illegal_sales: "Drugs & illegal sales",
  self_harm: "Self-harm & suicide",
  pii_doxxing: "Private info & doxxing",
  named_accusation: "Naming people",
  impersonation: "Impersonation",
  spam_scam: "Spam & scams",
  academic_dishonesty: "Academic dishonesty",
  profanity: "Profanity",
};

/** Section anchors of the Community Guidelines page (`/guidelines`). */
export const GUIDELINE_ANCHORS: Record<ModerationCategory, string> = {
  threat_violence: "threats",
  harassment_bullying: "harassment",
  hate: "hate",
  sexual_minors: "sexual",
  sexual_explicit: "sexual",
  drugs_illegal_sales: "drugs",
  self_harm: "self-harm",
  pii_doxxing: "private-info",
  named_accusation: "private-info",
  impersonation: "impersonation",
  spam_scam: "spam",
  academic_dishonesty: "academic",
  profanity: "harassment",
};
export const BUZZ_ANONYMITY_ANCHOR = "buzz-anonymity";

/* ───────────────────────────── look ───────────────────────────── */

/**
 * The incognito "Phosphor" world Buzz lives in (UniVerse's `[data-surface="incognito"]` tokens): near-black green
 * canvas, lime accent, a coral downvote. Both apps paint Buzz — its pane, thread, composer, search, My buzzes — with
 * these and nothing else; the public Aurora never appears inside Buzz and Phosphor never appears outside it.
 */
export const BUZZ_PHOSPHOR = {
  canvas: "#070908",
  surface1: "#0e120f",
  surface2: "#151b16",
  surface3: "#1d261f",
  surface4: "#28342a",
  glass: "rgba(14,18,15,0.76)",
  glassStrong: "rgba(14,18,15,0.9)",
  ink: "#f2f4fb",
  ink2: "#b9c2b4",
  ink3: "#869183",
  ink4: "#586155",
  line: "rgba(255,255,255,0.10)",
  lineSubtle: "rgba(255,255,255,0.06)",
  lineStrong: "rgba(255,255,255,0.18)",
  accent: "#c5f53b",
  accentHover: "#d3fb5c",
  accentPress: "#a6d822",
  accentInk: "#d3fb5c",
  accentSoft: "rgba(197,245,59,0.13)",
  accentLine: "rgba(197,245,59,0.34)",
  onAccent: "#0c1400",
  down: "#ff8a65",
  danger: "#ff5a5f",
  /** The hero gradient (FAB, "Buzz it"). */
  gradient: ["#e0ff85", "#c5f53b", "#6ee7a0"] as const,
  /** The soft gradient behind the "You're anonymous" banner and the prompt card. */
  gradientSoft: ["rgba(197,245,59,0.16)", "rgba(110,231,160,0.08)"] as const,
} as const;

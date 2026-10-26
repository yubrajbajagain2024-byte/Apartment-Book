/**
 * Moderation engine types, ported from UniVerse (`shared/src/core.ts` "moderation" section, safety.md §2.8 binding, and
 * `server/src/lib/moderation/types.ts`). They live here, in the server-only package, instead of a shared types file.
 *
 * The AUTHOR-FACING types (`ModerationCategory`, `SupportResources`, `ModerationUserMessage`, `AuthorNotice`,
 * `ContentBlockedDetails`) must stay structurally identical to `packages/shared/src/buzz/types.ts`, because the website
 * and the app read them from there. `tests/compat.test.ts` checks it.
 */

/* ───────────────────────────── surfaces ───────────────────────────── */

/** Every surface the UniVerse matrix knows. UniBuzz writes through `buzz`, `buzz_reply` and `buzz_poll` today. */
export type ModerationSurface =
  | 'buzz' | 'buzz_reply' | 'buzz_poll'
  | 'orbit_post' | 'comment' | 'reel_caption' | 'event' | 'profile' | 'handle' | 'group_name'
  | 'market_listing' | 'roommate_listing'
  | 'message' | 'group_message'
  | 'report_note' | 'appeal';

export type ModerationSurfaceGroup = 'anon' | 'public' | 'commerce' | 'private' | 'staff';

export const SURFACE_GROUP: Record<ModerationSurface, ModerationSurfaceGroup> = {
  buzz: 'anon', buzz_reply: 'anon', buzz_poll: 'anon',
  orbit_post: 'public', comment: 'public', reel_caption: 'public', event: 'public',
  profile: 'public', handle: 'public', group_name: 'public',
  market_listing: 'commerce', roommate_listing: 'commerce',
  message: 'private', group_message: 'private',
  report_note: 'staff', appeal: 'staff',
};

/* ───────────────────────────── taxonomy ───────────────────────────── */

export type ModerationCategory =
  | 'threat_violence' | 'harassment_bullying' | 'hate'
  | 'sexual_minors' | 'sexual_explicit'
  | 'drugs_illegal_sales' | 'self_harm'
  | 'pii_doxxing' | 'named_accusation' | 'impersonation'
  | 'spam_scam' | 'academic_dishonesty' | 'profanity';

export type ModerationSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type ModerationAction = 'allow' | 'flag' | 'block';
export type ModerationPriority = 'p0' | 'p1' | 'p2' | 'p3';
/** The two statuses a write can be persisted with. */
export type PersistStatus = 'active' | 'held';
export type RecipientBanner = 'B-SCAM' | 'B-OFFPLATFORM' | 'B-STAFF-IMPERSONATION' | 'B-SEXUAL';
/** Which field of the entity a text is (for queue display). */
export type ModerationField = 'title' | 'body' | 'option' | 'name' | 'bio' | 'handle';

/**
 * Section anchors of the Community Guidelines page (`/guidelines#<anchor>`). Same values as `GUIDELINE_ANCHORS` in
 * `packages/shared/src/buzz/constants.ts` (UniBuzz uses bare ids; UniVerse prefixed them with `#`).
 */
export const GUIDELINE_ANCHORS: Record<ModerationCategory, string> = {
  threat_violence: 'threats',
  harassment_bullying: 'harassment',
  hate: 'hate',
  sexual_minors: 'sexual',
  sexual_explicit: 'sexual',
  drugs_illegal_sales: 'drugs',
  self_harm: 'self-harm',
  pii_doxxing: 'private-info',
  named_accusation: 'private-info',
  impersonation: 'impersonation',
  spam_scam: 'spam',
  academic_dishonesty: 'academic',
  profanity: 'harassment',
};

export const CATEGORY_LABELS: Record<ModerationCategory, string> = {
  threat_violence: 'Threats & violence',
  harassment_bullying: 'Harassment & bullying',
  hate: 'Hate',
  sexual_minors: 'Sexual content & minors',
  sexual_explicit: 'Sexual content',
  drugs_illegal_sales: 'Drugs & illegal sales',
  self_harm: 'Self-harm & suicide',
  pii_doxxing: 'Private info & doxxing',
  named_accusation: 'Naming people',
  impersonation: 'Impersonation',
  spam_scam: 'Spam & scams',
  academic_dishonesty: 'Academic dishonesty',
  profanity: 'Profanity',
};

/* ───────────────────────────── context / result ───────────────────────────── */

export interface ModerationContext {
  surface: ModerationSurface;
  /** Which field of the entity this text is (for queue display). Default 'body'. */
  field?: ModerationField;
  /** Author. Used for account modifiers and events only; never copied into the result. */
  userId?: string;
  role?: 'user' | 'moderator' | 'admin';
  accountType?: 'student' | 'org';
  accountAgeMs: number;
  activeStrikePoints: number;
  universityId?: string | null;
  /** ISO 3166-1 alpha-2 of the author's university (a country name is accepted too); selects crisis resources. */
  countryCode?: string | null;
  /** PRIVATE surfaces: true when this is the first message of a not-yet-accepted request. */
  isMessageRequest?: boolean;
  /** Folded-text hashes (`textHash`) of this author's writes in the last 10 minutes — the duplicate detector. */
  recentHashes?: readonly string[];
  /**
   * The rule packs to run, by id (`ts_writer_context.enabledRulePacks`). Omitted / null = every registered pack.
   * The PII and behavioural detectors are not packs and always run.
   */
  enabledRulePacks?: readonly string[] | null;
}

export interface ModerationMatch {
  /** Stable, e.g. 'thr.intent_target.v1'. */
  ruleId: string;
  category: ModerationCategory;
  subcode: string;
  severity: ModerationSeverity;
  /** [start, end) offsets into the ORIGINAL text. Staff-only; never sent to the author. */
  span: [number, number];
  view: 'canonical' | 'folded' | 'spaced' | 'squashed' | 'original';
}

export interface SupportResources {
  kind: 'self_harm';
  headline: string;
  body: string;
  lines: Array<{ label: string; detail: string; href: string }>;
  emergencyNote: string;
}

export interface ModerationUserMessage {
  id: string;
  title: string;
  body: string;
  guidelineAnchor: string | null;
}

export interface ModerationSignals {
  evasion: boolean;
  invisibleChars: number;
  homoglyphs: number;
  urls: number;
  mentions: number;
  capsRatio: number;
  hasFullName: boolean;
}

export interface ModerationResult {
  action: ModerationAction;
  /** For 'flag': whether the content goes live immediately or waits for review. 'visible' for allow. */
  visibility: 'visible' | 'held';
  /** Status the caller MUST persist with: allow→'active', flag→'active'|'held'. Undefined for block. */
  persistStatus?: PersistStatus;
  /** Highest-severity category, or null when nothing matched. */
  category: ModerationCategory | null;
  subcode: string | null;
  severity: ModerationSeverity;
  /** All matches, highest severity first. Staff-only. MUST NOT be serialized to non-staff clients. */
  matches: ModerationMatch[];
  /** True → a queue item is created even when action is 'block' (threats, minors, self-harm methods). */
  escalate: boolean;
  /** Queue priority when a queue item will be created. */
  priority: ModerationPriority | null;
  /** PRIVATE surfaces: no queue item; staff cannot read unless a participant reports. */
  privateFlag: boolean;
  /** Author-facing copy (safety §2.10). Null for allow without support. */
  userMessage: ModerationUserMessage | null;
  /** Shown to the AUTHOR regardless of action when self-harm signals are present. */
  support: SupportResources | null;
  /** PRIVATE surfaces: safety banner id to attach for the RECIPIENT. */
  recipientBanner: RecipientBanner | null;
  signals: ModerationSignals;
  engine: { version: string; rulePacks: string[]; elapsedMs: number };
}

/** The ONLY moderation data a non-staff client may receive (from `toAuthorNotice`). */
export interface AuthorNotice {
  status: PersistStatus;
  userMessage: ModerationUserMessage | null;
  support: SupportResources | null;
}

/** `details` of a 422 `content_blocked`. */
export interface ContentBlockedDetails {
  messageId: string;
  title: string;
  category: ModerationCategory | null;
  guidelineAnchor: string | null;
  support: SupportResources | null;
}

/* ───────────────────────────── rules (safety §2.3) ───────────────────────────── */

export type RuleKind = 'term' | 'combo' | 'guard' | 'regex' | 'behavioral';
export type TextView = ModerationMatch['view'];

/** Each rule is data (safety §2.3). Rule ids are stable strings (`thr.intent_target.v1`). */
export interface ModerationRule {
  id: string;
  category: ModerationCategory;
  subcode: string;
  severity: ModerationSeverity;
  kind: RuleKind;
  /** Which normalised view(s) of the text the rule reads. */
  view: TextView | TextView[];
  /** Restrict to these surfaces (default: all). */
  surfaces?: ModerationSurface[];
  /** Phrases that cancel a match in the same sentence (never cancel `critical` severe-list matches). */
  guards?: string[];
  /**
   * kind 'term': word-boundary list lookup on `folded` / `spaced`; on `squashed` a substring lookup (terms shorter
   * than `minSquashLength`, default 5, are skipped there) guarded by the Scunthorpe allow-list.
   */
  terms?: string[];
  minSquashLength?: number;
  /**
   * kind 'combo': every slot must hit within `window` tokens (default 12). Slot entries: phrases, `re:<source>`
   * (unicode regex, boundary-wrapped), or the specials `<fullname>`, `<handle>`, `<name>` (either).
   */
  slots?: string[][];
  window?: number;
  /** kind 'regex': source + flags (compiled once by the engine). */
  pattern?: string;
  flags?: string;
  /** Create a queue item even when the outcome is `block` (threats, minors, self-harm methods). */
  escalate?: boolean;
}

export interface RulePack {
  id: string;
  version: string;
  rules: ModerationRule[];
}

/* ───────────────────────────── optional AI second pass (safety §2.9) ───────────────────────────── */

export interface SecondPassInput {
  text: string;
  surfaceGroup: 'anon' | 'public' | 'commerce' | 'private_reported';
  firstPass: { category: ModerationCategory | null; severity: ModerationSeverity };
}

export interface SecondPassVerdict {
  category: ModerationCategory | null;
  severity: ModerationSeverity;
  /** 0..1 */
  confidence: number;
  /** ≤ 280 chars, staff-only. */
  rationale: string;
}

export interface SecondPassClassifier {
  readonly name: string;
  classify(input: SecondPassInput, signal: AbortSignal): Promise<SecondPassVerdict>;
}

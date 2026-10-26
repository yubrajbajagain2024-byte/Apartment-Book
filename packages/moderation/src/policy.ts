/**
 * Severity + outcome matrix (safety §2.5, binding) and the account modifiers. Pure.
 * `decide()` maps ONE match (category · subcode · severity) on a surface to an outcome; the engine merges the
 * strictest outcome across matches.
 */
import type {
  ModerationAction, ModerationCategory, ModerationContext, ModerationPriority, ModerationSeverity, ModerationSurface,
  ModerationSurfaceGroup, RecipientBanner,
} from './types';
import { SURFACE_GROUP } from './types';
import type { MessageId } from './copy';

export const SEVERITY_RANK: Record<ModerationSeverity, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const SEVERITIES: ModerationSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

export function raiseSeverity(s: ModerationSeverity, by = 1): ModerationSeverity {
  return SEVERITIES[Math.min(4, SEVERITY_RANK[s] + by)]!;
}

export const PRIORITY_RANK: Record<ModerationPriority, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

export function higherPriority(a: ModerationPriority | null, b: ModerationPriority | null): ModerationPriority | null {
  if (!a) return b;
  if (!b) return a;
  return PRIORITY_RANK[a] <= PRIORITY_RANK[b] ? a : b;
}

/** One level up (p3 → p2 …). */
export function raisePriority(p: ModerationPriority): ModerationPriority {
  return (['p0', 'p0', 'p1', 'p2'] as const)[PRIORITY_RANK[p]]!;
}

export function priorityForSeverity(s: ModerationSeverity): ModerationPriority {
  switch (s) {
    case 'critical': return 'p0';
    case 'high': return 'p1';
    case 'medium': return 'p2';
    default: return 'p3';
  }
}

export interface Outcome {
  action: ModerationAction;
  visibility: 'visible' | 'held';
  escalate: boolean;
  /** PRIVATE FLAG*: delivered, banner, event row, no queue item. */
  privateFlag: boolean;
  banner: RecipientBanner | null;
  /** Author copy id for block / held. */
  messageId: MessageId | null;
  /** Self-harm signal → support sheet for the author. */
  support: 'ideation' | 'method' | null;
  /** Queue label ('wellbeing'). */
  label: string | null;
}

const ALLOW: Outcome = { action: 'allow', visibility: 'visible', escalate: false, privateFlag: false, banner: null, messageId: null, support: null, label: null };

function block(messageId: MessageId, escalate = false, extra: Partial<Outcome> = {}): Outcome {
  return { ...ALLOW, action: 'block', escalate, messageId, ...extra };
}
function held(messageId: MessageId = 'M-HELD', extra: Partial<Outcome> = {}): Outcome {
  return { ...ALLOW, action: 'flag', visibility: 'held', messageId, ...extra };
}
function visible(extra: Partial<Outcome> = {}): Outcome {
  return { ...ALLOW, action: 'flag', visibility: 'visible', ...extra };
}
function privateFlag(banner: RecipientBanner): Outcome {
  return { ...ALLOW, action: 'flag', visibility: 'visible', privateFlag: true, banner };
}

export interface DecideInput {
  category: ModerationCategory;
  subcode: string;
  severity: ModerationSeverity;
  surface: ModerationSurface;
  /** Folded text mentions "you" (hate slurs in DMs block only when directed at the recipient). */
  directedAtYou: boolean;
  isMessageRequest: boolean;
}

/** The outcome matrix of safety §2.5 for one match. STAFF surfaces always ALLOW. */
export function decide(i: DecideInput): Outcome {
  const g: ModerationSurfaceGroup = SURFACE_GROUP[i.surface];
  if (g === 'staff') return ALLOW;
  const priv = g === 'private';
  const sev = SEVERITY_RANK[i.severity];
  const { subcode } = i;

  switch (i.category) {
    case 'threat_violence': {
      if (subcode === 'threat_place' || subcode === 'threat_person') {
        if (sev >= SEVERITY_RANK.high) return block('M-THREAT', true);
        return priv ? ALLOW : g === 'anon' ? held() : visible();
      }
      if (subcode === 'incitement' || subcode === 'weapons_instructions') return block('M-THREAT', !priv);
      // glorification / ambiguous (medium)
      if (priv) return ALLOW;
      return g === 'anon' ? held() : visible();
    }
    case 'harassment_bullying': {
      if (subcode === 'kys') return block('M-KYS');
      if (priv) return ALLOW;
      if (sev >= SEVERITY_RANK.high) return block('M-HARASS');
      return visible();
    }
    case 'hate': {
      if (subcode === 'discriminatory_listing') return g === 'commerce' ? block('M-LISTING-DISCRIM') : ALLOW;
      const core = subcode === 'slur' || subcode === 'dehumanization' || subcode === 'exclusion_call' || subcode === 'hate_symbol';
      if (core && sev >= SEVERITY_RANK.high) {
        if (priv) return i.directedAtYou ? block('M-HATE') : ALLOW;
        return block('M-HATE');
      }
      // atrocity_denial / quoted / reclaimed / ambiguous
      if (priv) return ALLOW;
      return g === 'anon' ? held() : visible();
    }
    case 'sexual_minors':
      return block('M-MINORS', true);
    case 'sexual_explicit': {
      if (subcode === 'ncii_threat' || subcode === 'sextortion') return block('M-SEXUAL', true);
      if (subcode === 'solicitation' || subcode === 'nude_trading') return priv ? privateFlag('B-SEXUAL') : block('M-SEXUAL');
      // explicit_text
      if (priv) return ALLOW;
      return g === 'anon' ? held() : block('M-SEXUAL');
    }
    case 'drugs_illegal_sales': {
      if (subcode === 'discussion') return g === 'commerce' ? visible() : ALLOW;
      return block('M-DRUGS');
    }
    case 'self_harm': {
      if (subcode === 'method_instructions') return block('S-METHOD', !priv, { support: 'method' });
      if (subcode === 'encouragement') return block('M-KYS');
      // ideation / concern_other: ALLOW + support + P0 queue (no queue on PRIVATE)
      return { ...ALLOW, support: 'ideation', escalate: !priv, label: 'wellbeing' };
    }
    case 'pii_doxxing': {
      if (subcode === 'unmask_attempt') return g === 'anon' ? block('M-UNMASK') : ALLOW;
      if (subcode === 'social_handle_third_party') return g === 'anon' ? held() : ALLOW;
      if (subcode === 'room_number_self') return g === 'anon' ? held() : ALLOW;
      if (priv) {
        if (i.isMessageRequest && (subcode === 'phone' || subcode === 'email')) return { ...ALLOW, banner: 'B-OFFPLATFORM' };
        return ALLOW;
      }
      if (i.surface === 'event' && subcode === 'street_address') return ALLOW;
      if (i.surface === 'profile' && subcode === 'email') return ALLOW;
      return block('M-PII');
    }
    case 'named_accusation': {
      if (g === 'anon') return sev >= SEVERITY_RANK.critical ? block('M-NAMED') : held('M-NAMED');
      if (g === 'public') return visible();
      return ALLOW;
    }
    case 'impersonation': {
      if (subcode === 'staff_claim') return priv ? privateFlag('B-STAFF-IMPERSONATION') : block('M-IMPERSONATION');
      if (subcode === 'reserved_handle') return g === 'public' ? block('M-HANDLE') : ALLOW;
      // real_person_claim / official_claim
      if (g === 'anon') return held();
      if (g === 'public') return visible();
      return ALLOW;
    }
    case 'spam_scam': {
      if (subcode === 'duplicate') return block('M-DUP');
      if (subcode === 'new_link') return block('M-LINK-NEW');
      if (subcode === 'link_flood' || subcode === 'mention_flood') return block('M-SPAM');
      if (subcode === 'caps_flood') return ALLOW;
      if (subcode === 'mlm' || subcode === 'account_sale') {
        if (g === 'commerce') return block('M-SPAM');
        return priv ? ALLOW : visible();
      }
      // payment_scam / deposit_scam / code_phish / off_platform_push
      if (g === 'anon') return block('M-SPAM');
      if (g === 'public') return visible();
      if (g === 'commerce') return held();
      return privateFlag('B-SCAM');
    }
    case 'academic_dishonesty': {
      if (g === 'commerce') return subcode === 'live_exam_answers' ? ALLOW : block('M-ACADEMIC');
      if (g === 'anon') return held();
      if (g === 'public') return visible();
      return ALLOW;
    }
    case 'profanity': {
      if (subcode === 'severe_name' && (i.surface === 'profile' || i.surface === 'handle' || i.surface === 'group_name')) {
        return block('M-NAME-PROFANE');
      }
      return ALLOW;
    }
    default:
      return ALLOW;
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Account modifiers of safety §2.5 (applied after `decide`). */
export function applyAccountModifiers(o: Outcome, ctx: Pick<ModerationContext, 'accountAgeMs' | 'activeStrikePoints' | 'surface'>): Outcome {
  const g = SURFACE_GROUP[ctx.surface];
  if (o.action !== 'flag' || o.visibility !== 'visible' || o.privateFlag) return o;
  if (ctx.accountAgeMs < DAY_MS && g === 'anon') return { ...o, visibility: 'held', messageId: 'M-HELD' };
  if (ctx.activeStrikePoints >= 5 && g !== 'private') return { ...o, visibility: 'held', messageId: 'M-HELD' };
  return o;
}

/** block > flag held > flag visible > allow. */
export function strictness(o: Pick<Outcome, 'action' | 'visibility'>): number {
  if (o.action === 'block') return 3;
  if (o.action === 'flag') return o.visibility === 'held' ? 2 : 1;
  return 0;
}

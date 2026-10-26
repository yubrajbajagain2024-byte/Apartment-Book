/**
 * User-facing copy per outcome (safety §2.10, final) + support resources (S-HEAD / S-BODY) + recipient banners.
 * Tone: plain, never accusatory, never reveals the matched word.
 *
 * Ported from UniVerse verbatim except the product name (UniVerse → UniBuzz) in M-SEXUAL, M-IMPERSONATION and
 * B-STAFF-IMPERSONATION, and `crisisLines` also accepting a country NAME (UniBuzz stores `universities.country` as
 * "United States", not an ISO code).
 */
import type { ModerationCategory, ModerationUserMessage, RecipientBanner, SupportResources } from './types';
import { GUIDELINE_ANCHORS } from './types';

export type MessageId =
  | 'M-HELD' | 'M-THREAT' | 'M-HARASS' | 'M-KYS' | 'M-HATE' | 'M-MINORS' | 'M-SEXUAL' | 'M-DRUGS' | 'M-PII' | 'M-UNMASK'
  | 'M-NAMED' | 'M-IMPERSONATION' | 'M-HANDLE' | 'M-SPAM' | 'M-DUP' | 'M-LINK-NEW' | 'M-ACADEMIC' | 'M-LISTING-DISCRIM'
  | 'M-GENERIC' | 'M-NAME-PROFANE' | 'S-METHOD';

const HELD_BODY =
  "Your post is with our safety team before it goes live. This usually takes under a day. You don't need to do anything.";

const COPY: Record<MessageId, { title: string; body: string }> = {
  'M-HELD': { title: 'In review', body: HELD_BODY },
  'M-THREAT': {
    title: "This can't be posted",
    body: 'It reads as a threat or a call to violence. We take those seriously even as jokes. If someone is in danger, call your local emergency number.',
  },
  'M-HARASS': { title: "Let's not go after people", body: 'This looks like it targets a person. Criticize ideas and situations, not individuals.' },
  'M-KYS': { title: "This can't be posted", body: 'Telling someone to hurt themselves is never OK here.' },
  'M-HATE': { title: "This can't be posted", body: 'It includes language that attacks people for who they are.' },
  'M-MINORS': { title: "This can't be posted", body: 'Content that sexualizes anyone under 18 is banned and reported to the authorities.' },
  'M-SEXUAL': { title: 'Keep it PG-13', body: "Explicit sexual content and solicitation aren't allowed on UniBuzz." },
  'M-DRUGS': {
    title: 'No buying or selling this here',
    body: "Posts that buy, sell, or source drugs, prescription meds, weapons, fake IDs, or alcohol and vapes for underage students aren't allowed. Talking about these topics is fine.",
  },
  'M-PII': {
    title: 'Private info spotted',
    body: 'This looks like it includes {kind}. For everyone\'s safety, keep personal details out of public posts. You can share your own details in a private message.',
  },
  'M-UNMASK': { title: "Don't unmask people", body: "Guessing or revealing who is behind an anonymous buzz isn't allowed." },
  'M-NAMED': {
    title: "Naming people isn't allowed here",
    body: "Buzz can't verify accusations, and a wrong one can wreck someone's life. If something happened to you, report it to us or to campus services and we'll help you find the right place.",
  },
  'M-IMPERSONATION': {
    title: "This can't be posted",
    body: 'It claims to come from UniBuzz staff or an official source. Staff never post anonymously and never ask for login codes.',
  },
  'M-HANDLE': { title: 'That name is reserved', body: "Pick a name that doesn't look like an official account." },
  'M-SPAM': { title: 'Looks like spam', body: "This matches patterns we see in spam and scams. If that's wrong, reword it and try again." },
  'M-DUP': { title: 'You already posted this', body: "Posting the same thing repeatedly isn't allowed." },
  'M-LINK-NEW': { title: 'Links unlock after 24 hours', body: "New accounts can't post links yet. This keeps spam bots out." },
  'M-ACADEMIC': { title: "This can't be listed", body: "Selling or requesting exam answers, test banks, or someone to do your coursework isn't allowed." },
  'M-LISTING-DISCRIM': {
    title: 'Listings must be open to everyone',
    body: "Roommate and marketplace listings can't exclude people based on protected characteristics.",
  },
  'M-GENERIC': { title: 'In review', body: HELD_BODY },
  // Not in safety §2.10 (which lists no copy for the profile/handle/group_name severe-profanity block). Foundation addition.
  'M-NAME-PROFANE': { title: 'Pick a different name', body: "Names can't include slurs or explicit language." },
  'S-METHOD': {
    title: "We can't post this, but we're here",
    body: 'If you want to talk to someone, these are free and confidential.',
  },
};

/** `pii.<subcode>` → the "{kind}" phrase of M-PII (PII block messages MAY say which kind was seen). */
const PII_KIND: Record<string, string> = {
  phone: 'a phone number',
  email: 'an email address',
  street_address: 'a street address',
  room_number: 'a room number',
  id_number: 'an ID number',
  license_plate: 'a license plate',
};

export function userMessage(id: MessageId, category: ModerationCategory | null, piiSubcode?: string): ModerationUserMessage {
  const c = COPY[id];
  const body = id === 'M-PII' ? c.body.replace('{kind}', PII_KIND[piiSubcode ?? ''] ?? 'personal details') : c.body;
  return { id, title: c.title, body, guidelineAnchor: category ? GUIDELINE_ANCHORS[category] : null };
}

/* ───────────────────────────── support resources ───────────────────────────── */

const S_HEAD = 'It sounds like things are heavy right now';
const S_BODY = "You're not in trouble and your post went through. If you want to talk to someone, these are free and confidential.";
const EMERGENCY = "If you're in immediate danger, call your local emergency number.";

type Line = SupportResources['lines'][number];

const CAMPUS_LINE: Line = {
  label: 'Campus counseling',
  detail: 'Free, confidential sessions through your student health or counseling center.',
  href: 'https://www.ulifeline.org/',
};

/** Country names (as `universities.country` stores them) → the ISO 3166-1 alpha-2 codes `crisisLines` switches on. */
const COUNTRY_NAMES: Record<string, string> = {
  'united states': 'US', 'united states of america': 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US',
  canada: 'CA',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  'northern ireland': 'GB',
  ireland: 'IE', 'republic of ireland': 'IE',
  australia: 'AU',
  india: 'IN',
};

/** 'US' / 'us' / 'United States' → 'US'; anything unknown → '' (the default helpline). */
export function toCountryCode(country: string | null | undefined): string {
  const raw = (country ?? '').trim();
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return COUNTRY_NAMES[raw.toLowerCase()] ?? '';
}

function crisisLines(countryCode: string): Line[] {
  switch (toCountryCode(countryCode)) {
    case 'US':
    case 'CA':
      return [
        { label: 'Call or text 988', detail: '988 Suicide & Crisis Lifeline · 24/7', href: 'tel:988' },
        { label: 'Text 988', detail: 'Text with a crisis counselor', href: 'sms:988' },
      ];
    case 'GB':
    case 'IE':
      return [{ label: 'Samaritans · 116 123', detail: 'Free, 24/7, from any phone', href: 'tel:116123' }];
    case 'AU':
      return [{ label: 'Lifeline · 13 11 14', detail: '24/7 crisis support', href: 'tel:131114' }];
    case 'IN':
      return [{ label: 'Tele-MANAS · 14416', detail: 'Free 24/7 mental-health helpline', href: 'tel:14416' }];
    default:
      return [{ label: 'Find a helpline', detail: 'Free, confidential helplines in your country', href: 'https://findahelpline.com/' }];
  }
}

/** S-HEAD / S-BODY + lines for `countryCode` + campus counseling + emergency note. */
export function supportResources(countryCode: string | null | undefined, variant: 'ideation' | 'method' = 'ideation'): SupportResources {
  return {
    kind: 'self_harm',
    headline: variant === 'method' ? COPY['S-METHOD'].title : S_HEAD,
    body: variant === 'method' ? COPY['S-METHOD'].body : S_BODY,
    lines: [...crisisLines(countryCode ?? ''), CAMPUS_LINE],
    emergencyNote: EMERGENCY,
  };
}

/* ───────────────────────────── recipient banners (PRIVATE) ───────────────────────────── */

export const BANNER_COPY: Record<RecipientBanner, string> = {
  'B-SCAM': "Be careful. Never pay deposits or share codes for something you haven't seen. Keep deals in the app.",
  'B-OFFPLATFORM': 'This person shared contact details in their first message. Scammers often try to move chats off the app.',
  'B-STAFF-IMPERSONATION': 'UniBuzz staff will never message you for a code.',
  'B-SEXUAL': 'You can block and report unwanted sexual messages. Tap here.',
};

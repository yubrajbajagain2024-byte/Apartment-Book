/**
 * PII detectors (safety §2.6, binding behaviour; the regexes are the reference implementations).
 * They read the `canonical` view (digits intact); `pii.full_name` reads `original`. Pure.
 */
import type { ModerationCategory, ModerationSeverity } from './types';
import { GIVEN_NAMES, NAME_STOP_LIST, NAME_TITLES, PUBLIC_FIGURES, TLDS } from './data/lists';
import { indexFor, tokenStarts, toOriginalSpan, type Normalized, type View } from './normalize';

export interface RawMatch {
  ruleId: string;
  category: ModerationCategory;
  subcode: string;
  severity: ModerationSeverity;
  /** [start, end) into the ORIGINAL text. */
  span: [number, number];
  view: View['name'];
}

export interface NameHit {
  /** Original span. */
  span: [number, number];
  /** Lower-cased name text. */
  text: string;
  /** Title-preceded ("Prof. Garcia") → role name. */
  role: boolean;
}

export interface PiiScan {
  matches: RawMatch[];
  fullNames: NameHit[];
  /** Original spans of `@handle` tokens. */
  handles: [number, number][];
  urls: string[];
  mentions: number;
}

/* ───────────────────────────── phone ───────────────────────────── */

const RE_PHONE_RUN = /(?:\+?\d[\s().\-–·]*){7,15}/g;
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

function acceptDigits(digits: string, plus: boolean): boolean {
  const n = digits.length;
  if (n === 5 || n === 9) return false;
  if (plus) return n >= 8 && n <= 15;
  if (n === 10) return !/^[01]/.test(digits) && !/^[01]/.test(digits.slice(3, 4));
  if (n === 11) return digits.startsWith('1') && !/^[01]/.test(digits.slice(1, 2)) && !/^[01]/.test(digits.slice(4, 5));
  return false;
}

function phoneContextRejects(text: string, start: number, end: number, raw: string): boolean {
  const before = text.slice(Math.max(0, start - 8), start);
  const after = text.slice(end, end + 8);
  if (/\$\s*$/.test(before) || /^\s*(?:usd|obo|dollars|bucks|eur|gbp|inr)\b/.test(after) || /\b(?:usd|obo)\s*$/.test(before)) return true;
  // year ranges / dates / times
  if (/^\s*(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\s*$/.test(raw)) return true;
  if (/^\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s*$/.test(raw) || /^\s*\d{4}[/.-]\d{1,2}[/.-]\d{1,2}\s*$/.test(raw)) return true;
  if (/:\s*\d{2}/.test(raw)) return true;
  // course codes ("cs 314") never reach 7 digits on their own; a code glued to a year range fails the NANP test
  // student counts ("2000000 students")
  if (/^\s*(?:students|people|users|followers|views|likes)\b/.test(after)) return true;
  return false;
}

function scanPhone(view: View, out: RawMatch[]): void {
  const text = view.text;
  for (const m of text.matchAll(RE_PHONE_RUN)) {
    const raw = m[0];
    const start = m.index ?? 0;
    const end = start + raw.length;
    const plus = raw.trim().startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (!acceptDigits(digits, plus)) continue;
    if (phoneContextRejects(text, start, end, raw)) continue;
    out.push({ ruleId: 'pii.phone', category: 'pii_doxxing', subcode: 'phone', severity: 'high', span: toOriginalSpan(view, start, end), view: 'canonical' });
  }
  // spelled / obfuscated digits: runs of ≥ 7 digit-like tokens
  const tokens = text.split(' ');
  let offset = 0;
  const positions: number[] = [];
  for (const t of tokens) {
    positions.push(offset);
    offset += t.length + 1;
  }
  const digitLike = (t: string): string | null => {
    const clean = t.replace(/[().\-–·,]/g, '');
    if (!clean) return null;
    if (DIGIT_WORDS[clean]) return DIGIT_WORDS[clean]!;
    if (/^[\doli]+$/.test(clean) && /\d/.test(clean)) return clean.replace(/o/g, '0').replace(/[li]/g, '1');
    if (/^\+?\d+$/.test(clean)) return clean;
    return null;
  };
  let run: string[] = [];
  let runStart = -1;
  const flush = (endIdx: number): void => {
    if (run.length >= 7) {
      const joined = run.join('');
      const plus = joined.startsWith('+');
      const digits = joined.replace(/\D/g, '');
      if (acceptDigits(digits, plus)) {
        const s = positions[runStart]!;
        const e = positions[endIdx - 1]! + tokens[endIdx - 1]!.length;
        if (!out.some((x) => x.ruleId === 'pii.phone' && x.span[0] <= view.map[s]! && x.span[1] >= view.end[e - 1]!)) {
          out.push({ ruleId: 'pii.phone', category: 'pii_doxxing', subcode: 'phone', severity: 'high', span: toOriginalSpan(view, s, e), view: 'canonical' });
        }
      }
    }
    run = [];
    runStart = -1;
  };
  tokens.forEach((t, i) => {
    const d = digitLike(t);
    if (d) {
      if (runStart < 0) runStart = i;
      run.push(d);
    } else flush(i);
  });
  flush(tokens.length);
}

/* ───────────────────────────── email ───────────────────────────── */

const RE_EMAIL = /[a-z0-9._%+\-]+\s*(@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9\-]+((?:\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z0-9\-]+)+)/g;

function scanEmail(view: View, out: RawMatch[]): string[] {
  const found: string[] = [];
  for (const m of view.text.matchAll(RE_EMAIL)) {
    const atForm = m[1]!.trim();
    const domainPart = m[2]!;
    const spelledAt = atForm === 'at';
    const spelledDot = /\(dot\)|\[dot\]|\sdot\s/.test(domainPart);
    // the bare " at " form needs a spelled dot form too (else "meet at 5pm.ok" would match)
    if (spelledAt && !spelledDot) continue;
    const labels = domainPart.split(/\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*/).filter(Boolean);
    const tld = labels[labels.length - 1] ?? '';
    const tld2 = labels.length >= 2 ? `${labels[labels.length - 2]}.${tld}` : '';
    if (!TLDS.has(tld) && !TLDS.has(tld2)) continue;
    const start = m.index ?? 0;
    found.push(m[0]);
    out.push({ ruleId: 'pii.email', category: 'pii_doxxing', subcode: 'email', severity: 'high', span: toOriginalSpan(view, start, start + m[0].length), view: 'canonical' });
  }
  return found;
}

/* ───────────────────────────── street address ───────────────────────────── */

const RE_STREET =
  /\b\d{1,5}[a-z]?\s+(?:[nsew]\.?\s+)?(?:[a-z0-9'.]+\s+){1,4}(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|ter|terrace|pkwy|parkway|cir|circle|hwy|highway)\b\.?(?:\s*(?:apt|unit|suite|ste|#)\s*[a-z0-9\-]+)?/g;

function scanStreet(view: View, out: RawMatch[]): void {
  for (const m of view.text.matchAll(RE_STREET)) {
    if (/^\d{1,3}(?:st|nd|rd|th)\b/.test(m[0])) continue; // ordinal-only ("1st place")
    const start = m.index ?? 0;
    out.push({ ruleId: 'pii.street_address', category: 'pii_doxxing', subcode: 'street_address', severity: 'high', span: toOriginalSpan(view, start, start + m[0].length), view: 'canonical' });
  }
}

/* ───────────────────────────── room number ───────────────────────────── */

const RE_ROOM_WORD = /\b(?:dorm|hall|residence|room|rm|suite|floor|apt)\b/g;
const RE_ROOM_NUM = /\b\d{2,4}[a-z]?\b/;
const RE_THIRD_PERSON = /\b(?:he|she|they|her|his|their|lives|stays|find (?:him|her|them))\b/;
const RE_FIRST_PERSON = /\b(?:my|i|i'm|im|me|our|we)\b/;
const RE_CLASSROOM = /\b(?:lecture|class|classes|office hours|exam|midterm|final|meeting|seminar|lab|section|tutorial|review session|workshop|club meets|meets in|meeting in)\b/;

function scanRoom(view: View, out: RawMatch[]): void {
  const text = view.text;
  const starts = tokenStarts(text);
  const tokens = text.split(' ');
  for (const m of text.matchAll(RE_ROOM_WORD)) {
    const ti = indexFor(starts, m.index ?? 0);
    // classroom / office context ("lecture in room 204", "office hours in rm 3.120") is not a dorm location
    if (RE_CLASSROOM.test(tokens.slice(Math.max(0, ti - 4), ti).join(' '))) continue;
    const near = tokens.slice(Math.max(0, ti - 4), ti + 5);
    const numIdx = near.findIndex((t, i) => i !== ti - Math.max(0, ti - 4) && RE_ROOM_NUM.test(t) && !/^(?:19|20)\d{2}$/.test(t));
    if (numIdx < 0) continue;
    const wide = tokens.slice(Math.max(0, ti - 12), ti + 13).join(' ');
    const third = RE_THIRD_PERSON.test(wide);
    const first = RE_FIRST_PERSON.test(wide);
    if (!third && !first) continue;
    const s = starts[Math.max(0, ti - 4)]!;
    const endTok = Math.min(tokens.length - 1, ti + 4);
    const e = starts[endTok]! + tokens[endTok]!.length;
    if (third) {
      out.push({ ruleId: 'pii.room_number', category: 'pii_doxxing', subcode: 'room_number', severity: 'high', span: toOriginalSpan(view, s, e), view: 'canonical' });
    } else {
      out.push({ ruleId: 'pii.room_number', category: 'pii_doxxing', subcode: 'room_number_self', severity: 'low', span: toOriginalSpan(view, s, e), view: 'canonical' });
    }
    return; // one hit is enough
  }
}

/* ───────────────────────────── id number / license plate ───────────────────────────── */

const RE_SSN = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;
const RE_ID_WORD = /\b(?:student id|sid|uid|id number|ssn)\b/g;
const RE_PLATE_WORD = /\b(?:plate|license|licence|tag)\b/g;

function scanIdAndPlate(view: View, out: RawMatch[]): void {
  const text = view.text;
  for (const m of text.matchAll(RE_SSN)) {
    const start = m.index ?? 0;
    out.push({ ruleId: 'pii.id_number', category: 'pii_doxxing', subcode: 'id_number', severity: 'high', span: toOriginalSpan(view, start, start + m[0].length), view: 'canonical' });
  }
  const starts = tokenStarts(text);
  const tokens = text.split(' ');
  const windowAfter = (ti: number, n: number): { tokens: string[]; s: number; e: number } => {
    const endTok = Math.min(tokens.length - 1, ti + n);
    return { tokens: tokens.slice(ti + 1, endTok + 1), s: starts[ti]!, e: starts[endTok]! + tokens[endTok]!.length };
  };
  for (const m of text.matchAll(RE_ID_WORD)) {
    const ti = indexFor(starts, m.index ?? 0) + (m[0].includes(' ') ? 1 : 0);
    const w = windowAfter(ti, 4);
    if (w.tokens.some((t) => /^\d{6,10}$/.test(t.replace(/[:#]/g, '')))) {
      out.push({ ruleId: 'pii.id_number', category: 'pii_doxxing', subcode: 'id_number', severity: 'high', span: toOriginalSpan(view, w.s, w.e), view: 'canonical' });
    }
  }
  for (const m of text.matchAll(RE_PLATE_WORD)) {
    const ti = indexFor(starts, m.index ?? 0);
    const w = windowAfter(ti, 4);
    const joined = w.tokens.join(' ');
    const plate = [...joined.matchAll(/\b([a-z0-9]{2,4}[\s\-]?[a-z0-9]{2,4})\b/g)].find((m) => /\d/.test(m[1]!) && /[a-z]/.test(m[1]!));
    if (plate) {
      out.push({ ruleId: 'pii.license_plate', category: 'pii_doxxing', subcode: 'license_plate', severity: 'high', span: toOriginalSpan(view, w.s, w.e), view: 'canonical' });
    }
  }
}

/* ───────────────────────────── full names (original view) ───────────────────────────── */

const RE_CAP_TOKEN = /^[A-Z][a-z'’\-]+$/;

export function scanFullNames(original: string): NameHit[] {
  const out: NameHit[] = [];
  const re = /\S+/g;
  const toks: { t: string; s: number; e: number }[] = [];
  for (const m of original.matchAll(re)) toks.push({ t: m[0], s: m.index ?? 0, e: (m.index ?? 0) + m[0].length });
  const clean = (t: string): string => t.replace(/[.,;:!?"“”()]+$/g, '').replace(/^[("“]+/g, '');
  const isCap = (t: string): boolean => RE_CAP_TOKEN.test(clean(t));
  const bare = (t: string): string => clean(t).toLowerCase().replace(/[’']/g, "'");
  let i = 0;
  while (i < toks.length) {
    const t0 = bare(toks[i]!.t).replace(/\.$/, '');
    const titled = NAME_TITLES.has(t0);
    const first = titled ? i + 1 : i;
    if (first >= toks.length || !isCap(toks[first]!.t)) {
      i += 1;
      continue;
    }
    const given = GIVEN_NAMES.has(bare(toks[first]!.t));
    if (!titled && !given) {
      i += 1;
      continue;
    }
    // collect up to 3 capitalised tokens (2–3 without a title; 1–2 after a title)
    let last = first;
    while (last + 1 < toks.length && last - first < 2 && isCap(toks[last + 1]!.t)) last += 1;
    const count = last - first + 1;
    if (!titled && count < 2) {
      i += 1;
      continue;
    }
    const lastWord = bare(toks[last]!.t);
    if (NAME_STOP_LIST.has(lastWord)) {
      i = last + 1;
      continue;
    }
    const text = toks.slice(first, last + 1).map((x) => bare(x.t)).join(' ');
    if (PUBLIC_FIGURES.has(text)) {
      i = last + 1;
      continue;
    }
    out.push({ span: [toks[titled ? i : first]!.s, toks[last]!.e], text, role: titled });
    i = last + 1;
  }
  return out;
}

/* ───────────────────────────── urls / mentions ───────────────────────────── */

const RE_URL =
  /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|edu|gg|me|ly|app|xyz|info|link|shop|store|online|site|tv|us|uk|ca|de|in|to|cc|gl|ee|be|it|fr|es)\b(?:\/[^\s]*)?/g;
const RE_MENTION = /(?<![\p{L}\p{N}_])@[a-z0-9_]{3,20}(?![\p{L}\p{N}_])/gu;

export function scanUrls(canonicalText: string, emails: string[]): string[] {
  let text = canonicalText;
  for (const e of emails) text = text.replace(e, ' '.repeat(e.length));
  return [...text.matchAll(RE_URL)].map((m) => m[0]).filter((u) => !/^\d+(?:\.\d+)+$/.test(u));
}

/* ───────────────────────────── entry ───────────────────────────── */

export function scanPii(n: Normalized): PiiScan {
  const matches: RawMatch[] = [];
  const emails = scanEmail(n.canonical, matches);
  scanPhone(n.canonical, matches);
  scanStreet(n.canonical, matches);
  scanRoom(n.canonical, matches);
  scanIdAndPlate(n.canonical, matches);
  const fullNames = scanFullNames(n.original);
  const handles: [number, number][] = [];
  for (const m of n.canonical.text.matchAll(RE_MENTION)) {
    const start = m.index ?? 0;
    handles.push(toOriginalSpan(n.canonical, start, start + m[0].length));
  }
  return { matches, fullNames, handles, urls: scanUrls(n.canonical.text, emails), mentions: handles.length };
}

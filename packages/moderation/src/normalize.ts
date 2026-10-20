/**
 * Text normalisation (safety §2.2, binding). Produces the four detector views — `canonical`, `folded`, `spaced`,
 * `squashed` — plus two extra term-matching candidates (`foldedL`: leet `1→l`; `folded1`: 1-char repeat collapse).
 * Every view carries an index map back to the ORIGINAL text so `matches[].span` always refers to `original`.
 *
 * Pure, synchronous, offline. No DB, no config.
 */
import type { ModerationMatch } from './types';

export type ViewName = ModerationMatch['view'];

/** A cell = one output unit (usually one char) + the original code-unit offset it came from. */
interface Cell {
  ch: string;
  o: number;
}

export interface View {
  /** Name reported in `ModerationMatch.view`. */
  name: ViewName;
  text: string;
  /** `map[i]` = original offset of `text[i]`. Monotonic non-decreasing. */
  map: Int32Array;
  /** Original END offset of `text[i]` (exclusive). */
  end: Int32Array;
}

export interface Normalized {
  original: string;
  canonical: View;
  folded: View;
  /** `folded` with the alternative leet candidate `1→l` (reported as view 'folded'). */
  foldedL: View;
  /** `folded` with runs of ≥ 2 identical chars collapsed to 1 (reported as view 'folded'). */
  folded1: View;
  spaced: View;
  squashed: View;
  signals: {
    invisibleChars: number;
    homoglyphs: number;
    /** N9 joined sequences (`k i l l` → `kill`). */
    spacedJoins: number;
    capsRatio: number;
  };
}

/* ───────────────────────────── tables ───────────────────────────── */

const INVISIBLE_RANGES: [number, number][] = [
  [0x00ad, 0x00ad], [0x034f, 0x034f], [0x061c, 0x061c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180e],
  [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x206a, 0x206f], [0xfeff, 0xfeff], [0xe0100, 0xe01ef],
];
/** Variation selectors are stripped but NOT counted as evasion (they ride on ordinary emoji). */
const VARIATION_SELECTORS: [number, number] = [0xfe00, 0xfe0f];
/**
 * Everything else that renders as nothing: any Default_Ignorable_Code_Point or format control (Cf) — tag characters
 * U+E0000–E007F, shorthand format controls U+1BCA0–1BCA3, interlinear annotations U+FFF9–FFFB … — plus the braille
 * blank U+2800 (a "symbol" that draws as an empty cell). Stripped and counted as evasion.
 */
const RE_IGNORABLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\u2800\uFFF9-\uFFFB]/u;

/**
 * Latin look-alikes that NFKC leaves alone and no real word needs: small capitals, IPA letters, regional-indicator
 * letters (U+1F1E6–1F1FF, handled by range). Folded for every token (they are never a script of their own).
 */
const LATIN_CONFUSABLES: Record<string, string> = {
  'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l',
  'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z',
  'ɩ': 'i', 'ɑ': 'a', 'ɡ': 'g', 'ʋ': 'v', 'ɐ': 'a', 'ʍ': 'm', 'ɯ': 'm', 'ɹ': 'r', 'ʇ': 't', 'ʞ': 'k', 'ɾ': 'r', 'ʂ': 's',
};
const REGIONAL_INDICATORS: [number, number] = [0x1f1e6, 0x1f1ff];

/** Cyrillic / Greek / Armenian look-alikes → Latin (safety N5 minimum + a few common extras). */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h',
  'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h', 'ԛ': 'q', 'ԝ': 'w', 'ӏ': 'l', 'ь': 'b', 'г': 'r',
  // Greek
  'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'β': 'b', 'η': 'n',
  'γ': 'y', 'μ': 'u', 'ω': 'w',
  // Armenian
  'ո': 'n', 'ս': 'u', 'օ': 'o', 'ա': 'a', 'ց': 'g', 'հ': 'h', 'զ': 'q',
  // misc Latin-ish
  'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ħ': 'h', 'ŧ': 't',
};

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '+': 't',
  '(': 'c', '|': 'i', '€': 'e', '£': 'l', '¥': 'y',
};

/** Signal emoji → combo tokens (safety §2.2). An emoji alone never triggers anything. */
const EMOJI_TOKENS: Record<string, string> = {
  '🔫': '[gun]', '🔪': '[knife]', '💣': '[bomb]', '💊': '[pill]', '🍃': '[weed]', '🌿': '[weed]', '❄': '[snow]', '⛄': '[snow]',
  '🍄': '[shroom]', '🔌': '[plug]', '🍆': '[sexual]', '🍑': '[sexual]', '💦': '[sexual]',
};

const SEPARATOR_CLASS = '[ .\\-_*/\\\\,]';

/* ───────────────────────────── helpers ───────────────────────────── */

function inRanges(cp: number, ranges: [number, number][]): boolean {
  for (const [a, b] of ranges) if (cp >= a && cp <= b) return true;
  return false;
}

function toView(name: ViewName, cells: Cell[]): View {
  let text = '';
  const map = new Int32Array(cells.reduce((n, c) => n + c.ch.length, 0));
  const end = new Int32Array(map.length);
  let i = 0;
  for (const c of cells) {
    for (let k = 0; k < c.ch.length; k += 1) {
      map[i] = c.o;
      end[i] = c.o + 1;
      i += 1;
    }
    text += c.ch;
  }
  return { name, text, map, end };
}

function toCells(text: string): Cell[] {
  const cells: Cell[] = [];
  let offset = 0;
  for (const ch of text) {
    cells.push({ ch, o: offset });
    offset += ch.length;
  }
  return cells;
}

/** Splits cells into whitespace-delimited tokens (index ranges). */
function tokenRanges(cells: Cell[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < cells.length; i += 1) {
    const ws = cells[i]!.ch === ' ';
    if (!ws && start < 0) start = i;
    if (ws && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, cells.length]);
  return out;
}

const RE_LATIN = /\p{Script=Latin}/u;
const RE_CYRILLIC = /\p{Script=Cyrillic}/u;
const RE_GREEK = /\p{Script=Greek}/u;
const RE_ARMENIAN = /\p{Script=Armenian}/u;
const RE_LETTER = /\p{L}/u;
const RE_ALNUM = /[\p{L}\p{N}]/u;

function isHandleOrUrl(token: string): boolean {
  return token.startsWith('@') || token.includes('://') || token.startsWith('www.') || /^[a-z0-9._%+-]+@[a-z0-9-]+\./.test(token);
}

/* ───────────────────────────── pipeline ───────────────────────────── */

export function normalize(original: string): Normalized {
  // caps ratio on the original
  let letters = 0;
  let upper = 0;
  for (const ch of original) {
    if (!RE_LETTER.test(ch)) continue;
    letters += 1;
    if (ch !== ch.toLowerCase() && ch === ch.toUpperCase()) upper += 1;
  }
  const capsRatio = letters === 0 ? 0 : upper / letters;

  // N1 NFKC (per code point, so the index map stays exact) + emoji tokens + Latin confusables (counted as homoglyphs)
  let homoglyphs = 0;
  let cells: Cell[] = [];
  for (const c of toCells(original)) {
    const emoji = EMOJI_TOKENS[c.ch];
    if (emoji) {
      cells.push({ ch: ' ', o: c.o });
      for (const ch of emoji) cells.push({ ch, o: c.o });
      cells.push({ ch: ' ', o: c.o });
      continue;
    }
    for (const ch of c.ch.normalize('NFKC')) {
      const cp = ch.codePointAt(0) ?? 0;
      const fold =
        cp >= REGIONAL_INDICATORS[0] && cp <= REGIONAL_INDICATORS[1] ? String.fromCharCode(97 + cp - REGIONAL_INDICATORS[0]) : LATIN_CONFUSABLES[ch];
      if (fold) homoglyphs += 1;
      cells.push({ ch: fold ?? ch, o: c.o });
    }
  }

  // N2 strip invisibles
  let invisibleChars = 0;
  cells = cells.filter((c) => {
    const cp = c.ch.codePointAt(0) ?? 0;
    if (cp >= VARIATION_SELECTORS[0] && cp <= VARIATION_SELECTORS[1]) return false;
    if (inRanges(cp, INVISIBLE_RANGES) || RE_IGNORABLE.test(c.ch)) {
      invisibleChars += 1;
      return false;
    }
    return true;
  });

  // N3 strip diacritics (NFD, drop marks) · N4 lowercase
  {
    const next: Cell[] = [];
    for (const c of cells) {
      for (const ch of c.ch.normalize('NFD')) {
        if (/\p{M}/u.test(ch)) continue;
        for (const l of ch.toLowerCase()) next.push({ ch: l, o: c.o });
      }
    }
    cells = next;
  }

  // N6 (early) whitespace collapse so that N5 works on clean tokens
  cells = collapseWhitespace(cells);

  // N5 homoglyph fold (token-wise; pure non-Latin words are left alone)
  for (const [s, e] of tokenRanges(cells)) {
    let hasLatin = false;
    const scripts = new Set<string>();
    for (let i = s; i < e; i += 1) {
      const ch = cells[i]!.ch;
      if (RE_LATIN.test(ch)) {
        hasLatin = true;
        scripts.add('latin');
      } else if (RE_CYRILLIC.test(ch)) scripts.add('cyr');
      else if (RE_GREEK.test(ch)) scripts.add('gre');
      else if (RE_ARMENIAN.test(ch)) scripts.add('arm');
    }
    const mixedShort = e - s <= 12 && scripts.size >= 2;
    if (!hasLatin && !mixedShort) continue;
    for (let i = s; i < e; i += 1) {
      const fold = HOMOGLYPHS[cells[i]!.ch];
      if (fold) {
        cells[i] = { ch: fold, o: cells[i]!.o };
        homoglyphs += 1;
      }
    }
  }
  const canonicalCells = cells;
  const canonical = toView('canonical', canonicalCells);

  // N7 leet fold (tokens with ≥ 1 letter; never handles / urls / emails) · N8 repeat collapse
  const leet = (alt: boolean): Cell[] => {
    const out = canonicalCells.map((c) => ({ ch: c.ch, o: c.o }));
    for (const [s, e] of tokenRanges(out)) {
      const token = out.slice(s, e).map((c) => c.ch).join('');
      if (!RE_LETTER.test(token) || isHandleOrUrl(token)) continue;
      for (let i = s; i < e; i += 1) {
        const ch = out[i]!.ch;
        const fold = alt && ch === '1' ? 'l' : LEET[ch];
        if (fold) out[i] = { ch: fold, o: out[i]!.o };
      }
    }
    return collapseRepeats(out, 3, 2);
  };
  const foldedCells = leet(false);
  const folded = toView('folded', foldedCells);
  const foldedL = toView('folded', leet(true));
  const folded1 = toView('folded', collapseRepeats(foldedCells, 2, 1));

  // N9 separator squash: ≥ 3 single-char tokens split by space or . - _ * / \ ,
  let spacedJoins = 0;
  const spacedCells: Cell[] = [];
  {
    const text = folded.text;
    const re = new RegExp(`(?<=^|\\s)([\\p{L}\\p{N}])(?:${SEPARATOR_CLASS}([\\p{L}\\p{N}])){2,}(?=\\s|$)`, 'gu');
    let last = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      for (let i = last; i < start; i += 1) spacedCells.push(foldedCells[i]!);
      for (let i = start; i < start + m[0].length; i += 1) {
        const c = foldedCells[i]!;
        if (RE_ALNUM.test(c.ch)) spacedCells.push(c);
      }
      last = start + m[0].length;
      spacedJoins += 1;
    }
    for (let i = last; i < text.length; i += 1) spacedCells.push(foldedCells[i]!);
  }
  const spaced = toView('spaced', spacedCells);

  // N10 full squash
  const squashed = toView('squashed', spacedCells.filter((c) => RE_ALNUM.test(c.ch)));

  return {
    original, canonical, folded, foldedL, folded1, spaced, squashed,
    signals: { invisibleChars, homoglyphs, spacedJoins, capsRatio },
  };
}

function collapseWhitespace(cells: Cell[]): Cell[] {
  const out: Cell[] = [];
  let pendingSpace = false;
  for (const c of cells) {
    if (/\s/u.test(c.ch)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out.push({ ch: ' ', o: c.o });
      pendingSpace = false;
    }
    out.push(c);
  }
  return out;
}

/** Runs of ≥ `min` identical chars → `keep` chars. */
function collapseRepeats(cells: Cell[], min: number, keep: number): Cell[] {
  const out: Cell[] = [];
  let i = 0;
  while (i < cells.length) {
    let j = i;
    while (j < cells.length && cells[j]!.ch === cells[i]!.ch) j += 1;
    const run = j - i;
    const n = run >= min ? keep : run;
    for (let k = 0; k < n; k += 1) out.push(cells[i + k]!);
    i = j;
  }
  return out;
}

/* ───────────────────────────── span helpers ───────────────────────────── */

/** `[start, end)` in a view → `[start, end)` in the original text. */
export function toOriginalSpan(view: View, start: number, end: number): [number, number] {
  if (view.text.length === 0) return [0, 0];
  const s = Math.max(0, Math.min(start, view.text.length - 1));
  const e = Math.max(s, Math.min(end, view.text.length)) - 1;
  return [view.map[s]!, view.end[e]!];
}

/** First view index whose original offset is ≥ `originalOffset` (binary search over the monotonic map). */
export function toViewIndex(view: View, originalOffset: number): number {
  let lo = 0;
  let hi = view.map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.map[mid]! < originalOffset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Start offsets of the whitespace tokens of `text` (for `indexFor`). */
export function tokenStarts(text: string): number[] {
  const out: number[] = [];
  let inToken = false;
  for (let i = 0; i < text.length; i += 1) {
    const ws = text[i] === ' ';
    if (!ws && !inToken) out.push(i);
    inToken = !ws;
  }
  return out;
}

/** Start offsets of the sentences of `text` (split on . ! ? and newlines). */
export function sentenceStarts(text: string): number[] {
  const out: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') out.push(i + 1);
  }
  return out;
}

/** Index of the token / sentence (from a `*Starts` table) that contains `offset`. */
export function indexFor(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= offset) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/** The whitespace token of `text` that contains `offset` (lowercased alnum only). */
export function tokenAt(text: string, offset: number): string {
  let s = offset;
  while (s > 0 && text[s - 1] !== ' ') s -= 1;
  let e = offset;
  while (e < text.length && text[e] !== ' ') e += 1;
  return text.slice(s, e).replace(/[^\p{L}\p{N}]/gu, '');
}

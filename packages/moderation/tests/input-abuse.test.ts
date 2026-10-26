/**
 * HARDENING — moderation bypass with unicode tricks (real engine, every UGC surface). Port of section F of UniVerse
 * `server/tests/hardening/input-abuse.test.ts`, run "full mode" (every rule pack on, as there).
 *
 * In UniVerse the second group was recorded as FINDINGS (failing on purpose); its normaliser was then fixed (Latin
 * small capitals / IPA letters / regional indicators fold, braille blank / interlinear annotation / tag characters /
 * shorthand format controls strip), and this port carries the fixed normaliser — so every case here must pass.
 * The end-to-end case (a small-caps death threat posted through the API) lives in buzz-api.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './helpers/load.ts';

const m = await loadEngine();
type Ctx = Parameters<typeof m.moderate>[1];
type Surface = Ctx['surface'];

const DAY = 24 * 60 * 60 * 1000;

const SMALL_CAPS: Record<string, string> = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ',
  q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', y: 'ʏ', z: 'ᴢ',
};
const per = (s: string, sep: string): string => s.split(' ').map((w) => [...w].join(sep)).join(' ');

const handled: Record<string, (s: string) => string> = {
  'zero-width space': (s) => per(s, '​'),
  'word joiner': (s) => per(s, '⁠'),
  'soft hyphen': (s) => per(s, '­'),
  'cyrillic homoglyphs': (s) => s.replace(/o/g, 'о').replace(/a/g, 'а').replace(/e/g, 'е'),
  fullwidth: (s) => [...s].map((c) => (/[a-z]/.test(c) ? String.fromCodePoint(0xff41 + c.charCodeAt(0) - 97) : c)).join(''),
  'math bold': (s) => [...s].map((c) => (/[a-z]/.test(c) ? String.fromCodePoint(0x1d41a + c.charCodeAt(0) - 97) : c)).join(''),
  'combining strike': (s) => [...s].map((c) => `${c}̶`).join(''),
  'hangul filler': (s) => per(s, 'ㅤ'),
};
const evasions: Record<string, (s: string) => string> = {
  'latin small capitals (ᴋɪʟʟ)': (s) => [...s].map((c) => SMALL_CAPS[c] ?? c).join(''),
  'braille blank U+2800 between letters': (s) => per(s, '⠀'),
  'interlinear annotation U+FFF9 between letters': (s) => per(s, '￹'),
  'tag characters U+E0041 between letters': (s) => per(s, String.fromCodePoint(0xe0041)),
  'shorthand format control U+1BCA0 between letters': (s) => per(s, String.fromCodePoint(0x1bca0)),
  'latin iota ɩ for i': (s) => s.replace(/i/g, 'ɩ'),
  'regional indicator letters': (s) => [...s].map((c) => (/[a-z]/.test(c) ? `${String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 97)}​` : c)).join(''),
};
const SURFACES: Surface[] = [
  'buzz', 'buzz_reply', 'buzz_poll', 'orbit_post', 'comment', 'reel_caption', 'event', 'profile', 'group_name', 'market_listing',
  'roommate_listing', 'message', 'group_message',
];
const PHRASES = ['i am going to kill you', 'kys loser'];
const ctxFor = (surface: Surface): Ctx => ({
  surface, userId: 'u_probe', role: 'user', accountType: 'student', accountAgeMs: 30 * DAY, activeStrikePoints: 0,
  universityId: 'uni_utexas', countryCode: 'US',
});

/** Surfaces/phrases the engine blocks in plain text — the baseline an evasion must also be held to. */
function blockedPlain(): [Surface, string][] {
  const out: [Surface, string][] = [];
  for (const s of SURFACES) for (const p of PHRASES) if (m.moderate(p, ctxFor(s)).action === 'block') out.push([s, p]);
  return out;
}

describe('F. moderation bypass (real engine)', () => {
  it('[probe] sanity: the plain phrases are blocked on every public, anon and private UGC surface', () => {
    assert.equal(blockedPlain().length, SURFACES.length * PHRASES.length);
  });

  for (const [name, f] of Object.entries(handled)) {
    it(`[probe] ${name} does not slip past moderate() on any surface`, () => {
      const slipped = blockedPlain().filter(([s, p]) => m.moderate(f(p), ctxFor(s)).action !== 'block').map(([s, p]) => `${s}: ${p}`);
      assert.deepEqual(slipped, []);
    });
  }

  for (const [name, f] of Object.entries(evasions)) {
    it(`[fixed finding] ${name} does not slip a blocked threat/kys past moderate()`, () => {
      const slipped = blockedPlain()
        .map(([s, p]) => ({ s, p, r: m.moderate(f(p), ctxFor(s)).action }))
        .filter((x) => x.r !== 'block')
        .map((x) => `${x.s}: "${x.p}" → ${x.r}`);
      assert.deepEqual(slipped, []);
    });
  }

  it('evasion is visible to staff: obfuscated text raises the evasion signal', () => {
    for (const f of [...Object.values(evasions), handled['zero-width space']!, handled['cyrillic homoglyphs']!]) {
      const r = m.moderate(f('i am going to kill you'), ctxFor('buzz'));
      assert.equal(r.action, 'block');
      assert.ok(r.signals.evasion || r.signals.homoglyphs > 0 || r.signals.invisibleChars > 0, 'some obfuscation signal');
    }
  });

  it('a huge or hostile input never throws and stays fast (fail-closed is the only error path)', () => {
    const nasty = [
      '\u0000'.repeat(10_000),
      '🔫'.repeat(5_000),
      'a̶'.repeat(5_000),
      `${'('.repeat(3_000)}kill you${')'.repeat(3_000)}`,
      '\ud800'.repeat(1_000),
      ' '.repeat(50_000),
      'k i l l '.repeat(2_000),
    ];
    for (const text of nasty) {
      const t0 = performance.now();
      const r = m.moderate(text, ctxFor('buzz'));
      assert.ok(['allow', 'flag', 'block'].includes(r.action));
      assert.ok(performance.now() - t0 < 2_000);
    }
  });
});

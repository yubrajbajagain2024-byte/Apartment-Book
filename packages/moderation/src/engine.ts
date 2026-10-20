/**
 * The moderation engine (safety §2.0–§2.7): normalise → detectors (term · combo · guard · PII · behavioural) →
 * policy (surface × account) → ModerationResult. Pure, synchronous, deterministic, offline. The callers in moderate.ts
 * wrap `evaluate()` so a thrown error becomes the fail-closed hold.
 *
 * Ported verbatim from UniVerse `server/src/lib/moderation/engine.ts`; only the imports, `ENGINE_VERSION` and the
 * exported `hashFolded` (the same hash `evaluate` computes, so `textHash()` always matches `recentHashes`) changed.
 */
import crypto from 'node:crypto';
import type { ModerationContext, ModerationMatch, ModerationResult, ModerationSeverity, ModerationUserMessage, RecipientBanner } from './types';
import { SURFACE_GROUP } from './types';
import { userMessage, supportResources, type MessageId } from './copy';
import { indexFor, normalize, sentenceStarts, tokenAt, tokenStarts, toOriginalSpan, toViewIndex, type Normalized, type View, type ViewName } from './normalize';
import { URL_SHORTENERS } from './data/lists';
import { scanPii, type PiiScan, type RawMatch } from './pii';
import { applyAccountModifiers, DAY_MS, decide, higherPriority, priorityForSeverity, raiseSeverity, SEVERITY_RANK, strictness, type Outcome } from './policy';
import type { ModerationRule, RulePack } from './types';

/** UniVerse engine 1.0.0, UniBuzz port 1 (brand-adapted copy and impersonation terms). */
export const ENGINE_VERSION = 'uv-engine/1.0.0+unibuzz.1';

/** sha256 of an already-folded text, first 32 hex chars. */
export function hashFolded(folded: string): string {
  return crypto.createHash('sha256').update(folded).digest('hex').slice(0, 32);
}

export interface Evaluation {
  result: ModerationResult;
  /** sha256 of the folded text (first 32 hex chars) — duplicate detector + moderation_events.text_hash. */
  textHash: string;
  /** Queue label ('wellbeing' for self-harm ideation / concern). */
  label: string | null;
}

/* ───────────────────────────── compilation ───────────────────────────── */

const BOUNDARY_L = '(?<![\\p{L}\\p{N}_])';
const BOUNDARY_R = '(?![\\p{L}\\p{N}_])';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseSource(p: string): string {
  return p.startsWith('re:') ? `(?:${p.slice(3)})` : escapeRe(p.trim().replace(/\s+/g, ' '));
}

function boundaryRegex(phrases: string[]): RegExp | null {
  const parts = phrases.filter((p) => p && !p.startsWith('<')).map(phraseSource);
  if (parts.length === 0) return null;
  // longest first so "kill yourself" wins over "kill"
  parts.sort((a, b) => b.length - a.length);
  return new RegExp(`${BOUNDARY_L}(?:${parts.join('|')})${BOUNDARY_R}`, 'giu');
}

type Special = 'fullname' | 'handle' | 'name';

interface Slot {
  re: RegExp | null;
  specials: Special[];
}

interface Compiled {
  rule: ModerationRule;
  views: ViewName[];
  guard: RegExp | null;
  /** term: boundary alternation. */
  re: RegExp | null;
  /** term on `squashed`: substring terms (≥ 5 chars). */
  squashedTerms: string[];
  slots: Slot[];
  window: number;
}

const compiledCache = new WeakMap<RulePack, Compiled[]>();

function compile(pack: RulePack): Compiled[] {
  const hit = compiledCache.get(pack);
  if (hit) return hit;
  const out: Compiled[] = [];
  for (const rule of pack.rules) {
    try {
      const views = (Array.isArray(rule.view) ? rule.view : [rule.view]).filter((v) => v !== 'original' && v !== 'canonical') as ViewName[];
      const c: Compiled = { rule, views, guard: boundaryRegex(rule.guards ?? []), re: null, squashedTerms: [], slots: [], window: rule.window ?? 12 };
      if (rule.kind === 'term' && rule.terms) {
        c.re = boundaryRegex(rule.terms);
        const minLen = Math.max(3, rule.minSquashLength ?? 5);
        c.squashedTerms = rule.terms.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter((t) => t.length >= minLen);
      } else if (rule.kind === 'combo' && rule.slots) {
        c.slots = rule.slots.map((entries) => ({
          re: boundaryRegex(entries),
          specials: entries.filter((e) => e.startsWith('<')).map((e) => e.slice(1, -1) as Special),
        }));
        if (c.slots.some((s) => !s.re && s.specials.length === 0)) continue;
      } else if (rule.kind === 'regex' && rule.pattern) {
        c.re = new RegExp(rule.pattern, rule.flags ?? 'giu');
      } else continue;
      out.push(c);
    } catch {
      /* a malformed rule is skipped, never fatal */
    }
  }
  compiledCache.set(pack, out);
  return out;
}

/* ───────────────────────────── matching ───────────────────────────── */

/** Scunthorpe guard for the `squashed` view: the original token containing the hit is a known safe word. */
const SQUASH_ALLOW_LIST: ReadonlySet<string> = new Set([
  'assassin', 'assassins', 'assassination', 'classic', 'classical', 'cockpit', 'grape', 'grapes', 'therapist', 'therapists',
  'scunthorpe', 'snigger', 'sniggering', 'sniggered', 'raccoon', 'raccoons', 'tycoon', 'cocoon', 'cocoons', 'shitake',
  'shiitake', 'hancock', 'hitchcock', 'peacock', 'cockatoo', 'cockroach', 'cockroaches', 'dickens', 'dickinson', 'dickson',
  'analysis', 'analyst', 'basement', 'passage', 'massage', 'assess', 'assessment', 'assignment', 'associate', 'assume',
  'harass', 'harassment', 'sextant', 'sexton', 'sussex', 'essex', 'middlesex', 'wessex', 'pussycat', 'pusher', 'buttress',
  'cumulative', 'cumulus', 'document', 'accumulate', 'circumstance', 'circumstances', 'circumvent', 'niggling', 'niggle',
  'niggardly', 'niggard', 'faggoting',
]);

interface Hit {
  s: number;
  e: number;
  tok: number;
}

interface ViewIndex {
  view: View;
  tokens: number[];
  sentences: number[];
}

/** The distinct (name, index) pairs a rule reads — `squashed` is handled separately by runTerm. */
function viewsFor(c: Compiled, views: Record<ViewName, ViewIndex[]>): [ViewName, ViewIndex][] {
  const out: [ViewName, ViewIndex][] = [];
  const seen = new Set<ViewIndex>();
  for (const name of c.views) {
    if (name === 'squashed') continue;
    for (const vi of views[name] ?? []) {
      if (seen.has(vi)) continue;
      seen.add(vi);
      out.push([name, vi]);
    }
  }
  return out;
}

function indexView(view: View): ViewIndex {
  return { view, tokens: tokenStarts(view.text), sentences: sentenceStarts(view.text) };
}

function sentenceText(vi: ViewIndex, offset: number): string {
  const si = indexFor(vi.sentences, offset);
  const start = vi.sentences[si] ?? 0;
  const end = vi.sentences[si + 1] ?? vi.view.text.length;
  return vi.view.text.slice(start, end);
}

function guarded(c: Compiled, vi: ViewIndex, offset: number): boolean {
  if (!c.guard) return false;
  c.guard.lastIndex = 0;
  return c.guard.test(sentenceText(vi, offset));
}

function specialHits(special: Special, pii: PiiScan, vi: ViewIndex): Hit[] {
  const spans: [number, number][] = [];
  if (special === 'fullname' || special === 'name') for (const n of pii.fullNames) spans.push(n.span);
  if (special === 'handle' || special === 'name') spans.push(...pii.handles);
  return spans.map(([os, oe]) => {
    const s = toViewIndex(vi.view, os);
    const e = Math.max(s, toViewIndex(vi.view, oe));
    return { s, e, tok: indexFor(vi.tokens, s) };
  });
}

function regexHits(re: RegExp, vi: ViewIndex): Hit[] {
  const out: Hit[] = [];
  re.lastIndex = 0;
  for (const m of vi.view.text.matchAll(re)) {
    const s = m.index ?? 0;
    out.push({ s, e: s + m[0].length, tok: indexFor(vi.tokens, s) });
  }
  return out;
}

function runTerm(c: Compiled, views: Record<ViewName, ViewIndex[]>, n: Normalized, out: RawMatch[]): void {
  const seen = new Set<string>();
  const push = (span: [number, number], view: ViewName): void => {
    const key = `${span[0]}:${span[1]}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ruleId: c.rule.id, category: c.rule.category, subcode: c.rule.subcode, severity: c.rule.severity, span, view });
  };
  for (const [name, vi] of viewsFor(c, views)) {
    if (!c.re) continue;
    for (const h of regexHits(c.re, vi)) {
      if (guarded(c, vi, h.s)) continue;
      push(toOriginalSpan(vi.view, h.s, h.e), name);
    }
  }
  if (c.views.includes('squashed') && c.squashedTerms.length) {
    const vi = views.squashed?.[0];
    if (!vi) return;
    const text = vi.view.text;
    for (const term of c.squashedTerms) {
      let from = 0;
      while (from <= text.length - term.length) {
        const idx = text.indexOf(term, from);
        if (idx < 0) break;
        from = idx + 1;
        const span = toOriginalSpan(vi.view, idx, idx + term.length);
        // already found with boundaries by folded/spaced → skip; otherwise Scunthorpe guard on the original token
        if (out.some((m) => m.ruleId === c.rule.id && m.span[0] <= span[0] && m.span[1] >= span[1])) continue;
        const token = tokenAt(n.canonical.text, toViewIndex(n.canonical, span[0]));
        if (SQUASH_ALLOW_LIST.has(token)) continue;
        if (c.rule.severity !== 'critical' && guarded(c, indexView(n.folded), toViewIndex(n.folded, span[0]))) continue;
        push(span, 'squashed');
      }
    }
  }
}

function runCombo(c: Compiled, views: Record<ViewName, ViewIndex[]>, pii: PiiScan, out: RawMatch[]): void {
  const seen = new Set<string>();
  for (const [name, vi] of viewsFor(c, views)) {
    {
      const perSlot: Hit[][] = c.slots.map((slot) => {
        const hits: Hit[] = slot.re ? regexHits(slot.re, vi) : [];
        for (const sp of slot.specials) hits.push(...specialHits(sp, pii, vi));
        return hits;
      });
      if (perSlot.some((h) => h.length === 0)) continue;
      const anchorIdx = perSlot.reduce((best, h, i) => (h.length < perSlot[best]!.length ? i : best), 0);
      for (const a of perSlot[anchorIdx]!) {
        let lo = a.tok;
        let hi = a.tok;
        let sMin = a.s;
        let eMax = a.e;
        let ok = true;
        for (let i = 0; i < perSlot.length && ok; i += 1) {
          if (i === anchorIdx) continue;
          let best: Hit | null = null;
          let bestSpread = Infinity;
          for (const h of perSlot[i]!) {
            const spread = Math.max(hi, h.tok) - Math.min(lo, h.tok);
            if (spread < bestSpread) {
              bestSpread = spread;
              best = h;
            }
          }
          if (!best || bestSpread > c.window) ok = false;
          else {
            lo = Math.min(lo, best.tok);
            hi = Math.max(hi, best.tok);
            sMin = Math.min(sMin, best.s);
            eMax = Math.max(eMax, best.e);
          }
        }
        if (!ok) continue;
        if (guarded(c, vi, a.s) || guarded(c, vi, sMin)) continue;
        const span = toOriginalSpan(vi.view, sMin, eMax);
        const key = `${span[0]}:${span[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ruleId: c.rule.id, category: c.rule.category, subcode: c.rule.subcode, severity: c.rule.severity, span, view: name });
      }
    }
  }
}

/* ───────────────────────────── behavioural ───────────────────────────── */

function behavioural(n: Normalized, pii: PiiScan, ctx: ModerationContext, textHash: string, out: RawMatch[]): void {
  const g = SURFACE_GROUP[ctx.surface];
  const whole: [number, number] = [0, n.original.length];
  const push = (id: string, subcode: string, severity: ModerationSeverity): void => {
    out.push({ ruleId: id, category: 'spam_scam', subcode, severity, span: whole, view: 'folded' });
  };

  // duplicate (safety §2.7): needs recent-write state from moderateWrite
  const recent = ctx.recentHashes ?? [];
  if (n.folded.text.length >= 20 && recent.length) {
    const count = recent.filter((h) => h === textHash).length;
    if (g === 'private' ? count >= 4 : count >= 1) push('spam.duplicate', 'duplicate', 'high');
  }
  // links
  const urls = pii.urls;
  const shortener = urls.some((u) => {
    const host = u.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? '';
    return URL_SHORTENERS.has(host);
  });
  if (urls.length > 2 || (shortener && (g === 'anon' || g === 'commerce'))) push('spam.link_flood', 'link_flood', 'high');
  if (urls.length > 0 && ctx.accountAgeMs < DAY_MS && (g === 'anon' || g === 'public' || g === 'commerce')) push('spam.new_link', 'new_link', 'medium');
  if (pii.mentions > 5) push('spam.mention_flood', 'mention_flood', 'high');
}

/* ───────────────────────────── evaluation ───────────────────────────── */

const RE_YOU = /(?<![\p{L}\p{N}_])(?:you|u|ur|your|youre|you're|yourself)(?![\p{L}\p{N}_])/u;

function emptyResult(packIds: string[], elapsedMs: number, n?: Normalized, pii?: PiiScan): ModerationResult {
  return {
    action: 'allow', visibility: 'visible', persistStatus: 'active', category: null, subcode: null, severity: 'none', matches: [],
    escalate: false, priority: null, privateFlag: false, userMessage: null, support: null, recipientBanner: null,
    signals: {
      evasion: false, invisibleChars: n?.signals.invisibleChars ?? 0, homoglyphs: n?.signals.homoglyphs ?? 0, urls: pii?.urls.length ?? 0,
      mentions: pii?.mentions ?? 0, capsRatio: n?.signals.capsRatio ?? 0, hasFullName: (pii?.fullNames.length ?? 0) > 0,
    },
    engine: { version: ENGINE_VERSION, rulePacks: packIds, elapsedMs },
  };
}

/** Fail-closed result (safety §2.8): flag · held · category null · P2 · M-GENERIC. */
export function failClosedResult(packIds: string[]): ModerationResult {
  return {
    ...emptyResult(packIds, 0),
    action: 'flag', visibility: 'held', persistStatus: 'held', priority: 'p2', userMessage: userMessage('M-GENERIC', null),
  };
}

export function evaluate(text: string, ctx: ModerationContext, packs: RulePack[]): Evaluation {
  const t0 = performance.now();
  const packIds = packs.map((p) => p.id);
  const n = normalize(text);
  const textHash = hashFolded(n.folded.text);
  if (n.canonical.text.length === 0) return { result: emptyResult(packIds, elapsed(t0), n), textHash, label: null };

  const pii = scanPii(n);
  // the leet `1→l` and 1-char-collapse candidates are scanned only when they differ from `folded`
  const foldedVariants = [n.folded, n.foldedL, n.folded1].filter((v, i, all) => i === 0 || all.slice(0, i).every((p) => p.text !== v.text));
  const foldedIndexes = foldedVariants.map(indexView);
  const views: Record<ViewName, ViewIndex[]> = {
    original: [],
    canonical: [indexView(n.canonical)],
    folded: foldedIndexes,
    spaced: n.spaced.text === n.folded.text ? [foldedIndexes[0]!] : [indexView(n.spaced)],
    squashed: [indexView(n.squashed)],
  };

  const raw: RawMatch[] = [...pii.matches];
  for (const pack of packs) {
    for (const c of compile(pack)) {
      if (c.rule.surfaces && !c.rule.surfaces.includes(ctx.surface)) continue;
      if (c.rule.kind === 'combo') runCombo(c, views, pii, raw);
      else if (c.rule.kind === 'term' || c.rule.kind === 'regex') runTerm(c, views, n, raw);
    }
  }
  behavioural(n, pii, ctx, textHash, raw);

  // signals + severity adjustments (evasion / caps flood raise every match by one level)
  const evasion = n.signals.invisibleChars >= 3 || n.signals.homoglyphs >= 2 || n.signals.spacedJoins >= 1;
  const letters = n.original.replace(/[^\p{L}]/gu, '').length;
  const capsFlood = n.original.length >= 40 && letters > 0 && n.signals.capsRatio >= 0.7;
  const bump = (evasion ? 1 : 0) + (capsFlood ? 1 : 0);
  const matches: ModerationMatch[] = raw
    .map((m) => ({ ...m, severity: bump && m.category !== 'profanity' ? raiseSeverity(m.severity, bump) : m.severity }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const base = emptyResult(packIds, 0, n, pii);
  base.signals.evasion = evasion;
  if (matches.length === 0) {
    base.engine.elapsedMs = elapsed(t0);
    return { result: base, textHash, label: null };
  }

  // policy per match → strictest wins
  const directedAtYou = RE_YOU.test(n.folded.text);
  const decided = matches.map((m) => ({
    m,
    o: applyAccountModifiers(
      decide({ category: m.category, subcode: m.subcode, severity: m.severity, surface: ctx.surface, directedAtYou, isMessageRequest: ctx.isMessageRequest === true }),
      ctx,
    ),
  }));
  decided.sort((a, b) => strictness(b.o) - strictness(a.o) || SEVERITY_RANK[b.m.severity] - SEVERITY_RANK[a.m.severity]);
  const top = decided[0]!;
  const action = top.o.action;
  const visibility: 'visible' | 'held' = action === 'flag' ? top.o.visibility : 'visible';
  const escalate = decided.some((d) => d.o.escalate);
  const supportKind = decided.find((d) => d.o.support === 'method')?.o.support ?? decided.find((d) => d.o.support)?.o.support ?? null;
  const banner: RecipientBanner | null = decided.find((d) => d.o.banner)?.o.banner ?? null;
  const label = decided.find((d) => d.o.label)?.o.label ?? null;

  // queue priority: only outcomes that will create a queue item contribute
  let priority = null as ModerationResult['priority'];
  for (const d of decided) {
    const queues = (d.o.action === 'flag' && !d.o.privateFlag) || d.o.escalate;
    if (!queues) continue;
    const p = d.o.label === 'wellbeing' ? 'p0' : d.o.escalate ? (SEVERITY_RANK[d.m.severity] >= SEVERITY_RANK.critical ? 'p0' : 'p1') : priorityForSeverity(d.m.severity);
    priority = higherPriority(priority, p);
  }

  let msg: ModerationUserMessage | null = null;
  if (action === 'block') msg = userMessage((top.o.messageId ?? 'M-GENERIC') as MessageId, top.m.category, top.m.subcode);
  else if (action === 'flag' && visibility === 'held') msg = userMessage((top.o.messageId ?? 'M-HELD') as MessageId, top.m.category, top.m.subcode);

  const result: ModerationResult = {
    ...base,
    action,
    visibility,
    persistStatus: action === 'block' ? undefined : visibility === 'held' ? 'held' : 'active',
    category: top.m.category,
    subcode: top.m.subcode,
    severity: matches[0]!.severity,
    matches,
    escalate,
    priority,
    privateFlag: action === 'flag' && top.o.privateFlag,
    userMessage: msg,
    support: supportKind ? supportResources(ctx.countryCode, supportKind) : null,
    recipientBanner: banner,
  };
  if (result.persistStatus === undefined) delete result.persistStatus;
  result.engine.elapsedMs = elapsed(t0);
  return { result, textHash, label };
}

function elapsed(t0: number): number {
  return Math.round((performance.now() - t0) * 100) / 100;
}

/** Test / debugging aid: the normalised views of a text. */
export { normalize };

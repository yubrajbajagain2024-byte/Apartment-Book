/**
 * Optional AI second pass (safety §2.9, SPEC §3.3): an ESCALATOR ONLY. Ported from UniVerse
 * `server/src/lib/moderation/secondPass.ts`; the server coupling (config, db transaction, content adapter, logger,
 * clock) is injected instead.
 *  - Active only when `MODERATION_AI_API_KEY` is set (or a test installs a classifier via `setSecondPassClassifier`).
 *    With the key absent `getSecondPassClassifier()` is null, nothing is enqueued and no network call can occur.
 *  - Runs after the write, asynchronously; never delays or fails a user request (the website schedules
 *    `flushSecondPass()` with Next's `after()`).
 *  - Scope: ANON / PUBLIC / COMMERCE with rule outcome allow | flag. PRIVATE surfaces are never sent. Blocks are not sent.
 *  - Payload: text + surface group + first-pass verdict only (no user / entity / campus / time). Correlation = random nonce.
 *  - Powers: allow → flag (queue item source `ai_flag`), or active → hidden (P1) when confidence ≥ 0.90 and the category
 *    maps to severity ≥ high. It can never approve, restore, un-block, remove or sanction.
 *  - Resilience: each attempt is time-boxed (`MODERATION_AI_TIMEOUT_MS`, default 4000); 2 retries with jitter, then
 *    drop; circuit breaker after 5 consecutive failures for 5 min; in-memory queue capped at 500 (oldest dropped).
 *    Failures are counted and otherwise silent.
 *  - Storage: the job's `sink` applies an escalation (UniBuzz: `ts_apply_moderation` with the `ai_flag` queue entry,
 *    and `buzz_v2_set_status(…, 'hidden')` when `hide`) — UniVerse did both directly in SQLite.
 */
import crypto from 'node:crypto';
import { log } from './logger';
import { SEVERITY_RANK } from './policy';
import type { QueueEntry } from './queue';
import type {
  ModerationAction, ModerationCategory, ModerationSeverity, ModerationSurface, PersistStatus, SecondPassClassifier, SecondPassInput,
  SecondPassVerdict,
} from './types';
import { SURFACE_GROUP } from './types';

const MAX_JOBS = 500;
const RETRIES = 2;
const BREAKER_FAILURES = 5;
const BREAKER_OPEN_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 4000;
/** Claude model used when `MODERATION_AI_MODEL` is unset. */
export const DEFAULT_SECOND_PASS_MODEL = 'claude-opus-5-5';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS: ReadonlySet<string> = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

/* ───────────────────────────── configuration (injected) ───────────────────────────── */

export interface SecondPassEnv {
  MODERATION_AI_API_KEY?: string;
  /** 'anthropic' (default) or the URL of a compatible endpoint. */
  MODERATION_AI_PROVIDER?: string;
  MODERATION_AI_MODEL?: string;
  MODERATION_AI_TIMEOUT_MS?: string;
}

interface Options {
  env: () => SecondPassEnv;
  fetch: () => typeof fetch;
  now: () => number;
  /** Wait before retry `attempt` (0-based). UniVerse: 200–600 ms of jitter, none in tests. */
  retryDelayMs: (attempt: number) => number;
}

const DEFAULTS: Options = {
  env: () => process.env as SecondPassEnv,
  fetch: () => globalThis.fetch,
  now: () => Date.now(),
  retryDelayMs: () => 200 + Math.random() * 400,
};

let options: Options = { ...DEFAULTS };

/** Override where the env, `fetch`, the clock and the retry wait come from (tests, other hosts). Omitted keys keep their
 * current value; `null` restores every default. */
export function configureSecondPass(next: {
  env?: SecondPassEnv | (() => SecondPassEnv);
  fetch?: typeof fetch;
  now?: () => number;
  retryDelayMs?: (attempt: number) => number;
} | null): void {
  if (!next) {
    options = { ...DEFAULTS };
  } else {
    const env = next.env;
    const fetchImpl = next.fetch;
    options = {
      env: env === undefined ? options.env : typeof env === 'function' ? env : () => env,
      fetch: fetchImpl === undefined ? options.fetch : () => fetchImpl,
      now: next.now ?? options.now,
      retryDelayMs: next.retryDelayMs ?? options.retryDelayMs,
    };
  }
  envClassifier = null;
}

function nonEmpty(v: string | undefined): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

interface AiConfig {
  apiKey: string | null;
  provider: string;
  model: string | null;
  timeoutMs: number;
}

function aiConfig(): AiConfig {
  const env = options.env() ?? {};
  const timeoutMs = Number(env.MODERATION_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return {
    apiKey: nonEmpty(env.MODERATION_AI_API_KEY),
    provider: nonEmpty(env.MODERATION_AI_PROVIDER) ?? 'anthropic',
    model: nonEmpty(env.MODERATION_AI_MODEL),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

/* ───────────────────────────── jobs ───────────────────────────── */

export interface SecondPassTarget {
  /** 'buzz' | 'buzz_reply' in UniBuzz. */
  entityType: string;
  entityId: string;
  authorId: string | null;
  universityId: string | null;
  surface: ModerationSurface;
  /** The status the write was persisted with (UniVerse re-read it through the content adapter before hiding). */
  status: PersistStatus;
}

export interface SecondPassEscalation {
  /** The `ai_flag` queue entry to create or merge (`ts_apply_moderation` with `{ events: [], queue }`). */
  queue: QueueEntry;
  /** Also hide the item pending review (only ever for an `active` item, confident and severe). */
  hide: boolean;
}

export type SecondPassSink = (target: SecondPassTarget & { nonce: string }, escalation: SecondPassEscalation) => void | Promise<void>;

export interface SecondPassJob extends SecondPassTarget {
  nonce: string;
  input: SecondPassInput;
  sink: SecondPassSink;
}

const queue: SecondPassJob[] = [];
let draining: Promise<void> | null = null;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;
export const secondPassMetrics = { processed: 0, failed: 0, dropped: 0, escalated: 0 };

/* ───────────────────────────── classifier ───────────────────────────── */

let override: SecondPassClassifier | null = null;
let envClassifier: { key: string; classifier: SecondPassClassifier } | null = null;

const VALID_CATEGORIES: ReadonlySet<string> = new Set<ModerationCategory>([
  'threat_violence', 'harassment_bullying', 'hate', 'sexual_minors', 'sexual_explicit', 'drugs_illegal_sales', 'self_harm',
  'pii_doxxing', 'named_accusation', 'impersonation', 'spam_scam', 'academic_dishonesty', 'profanity',
]);
const VALID_SEVERITIES: ReadonlySet<string> = new Set<ModerationSeverity>(['none', 'low', 'medium', 'high', 'critical']);

function parseVerdict(raw: unknown): SecondPassVerdict {
  const v = (raw ?? {}) as Record<string, unknown>;
  const category = typeof v.category === 'string' && VALID_CATEGORIES.has(v.category) ? (v.category as ModerationCategory) : null;
  const severity = typeof v.severity === 'string' && VALID_SEVERITIES.has(v.severity) ? (v.severity as ModerationSeverity) : 'none';
  const confidence = typeof v.confidence === 'number' && Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0;
  const rationale = typeof v.rationale === 'string' ? v.rationale.slice(0, 280) : '';
  return { category, severity, confidence, rationale };
}

/** JSON schema of the verdict (structured output on the Anthropic API; everything else is told in the prompt). */
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    category: { anyOf: [{ type: 'string', enum: [...VALID_CATEGORIES] }, { type: 'null' }] },
    severity: { type: 'string', enum: [...VALID_SEVERITIES] },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['category', 'severity', 'confidence', 'rationale'],
  additionalProperties: false,
} as const;

/**
 * Minimal `fetch` classifier (provider `anthropic` by default). Built lazily; only when the env key is present.
 * Raw HTTP on purpose: the moderation package has no SDK dependency (UniVerse SPEC §3.3 "minimal fetch classifier").
 */
function buildEnvClassifier(cfg: AiConfig): SecondPassClassifier | null {
  const { apiKey, provider, model, timeoutMs } = cfg;
  if (!apiKey) return null;
  const direct = provider === 'anthropic';
  const endpoint = direct ? ANTHROPIC_MESSAGES_URL : provider;
  const modelId = model ?? DEFAULT_SECOND_PASS_MODEL;
  return {
    name: provider,
    async classify(input, signal): Promise<SecondPassVerdict> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = (): void => controller.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const prompt =
          `Classify the following ${input.surfaceGroup} post from a university social app against these categories: ` +
          `${[...VALID_CATEGORIES].join(', ')}. First-pass verdict: ${input.firstPass.category ?? 'none'} / ${input.firstPass.severity}. ` +
          'Reply with JSON only: {"category": <category or null>, "severity": "none|low|medium|high|critical", "confidence": 0..1, "rationale": "<= 280 chars"}.\n\n' +
          `TEXT:\n${input.text}`;
        const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
        const body: Record<string, unknown> = { model: modelId, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] };
        if (direct) {
          // A short classification: low effort, and a schema so the reply is always the verdict object.
          body.output_config = { effort: 'low', format: { type: 'json_schema', schema: VERDICT_SCHEMA } };
          if (FALLBACK_MODELS.has(modelId)) {
            // A safety classifier may decline moderation text; let the API retry on its recommended fallback model.
            headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
            body.fallbacks = 'default';
          }
        }
        const res = await options.fetch()(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        if (!res.ok) throw new Error(`second pass HTTP ${res.status}`);
        const json = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
        if (json.stop_reason === 'refusal') return { category: null, severity: 'none', confidence: 0, rationale: '' };
        if (json.stop_reason === 'max_tokens') throw new Error('second pass reply truncated');
        const text = json.content?.find((c) => c.type === 'text')?.text ?? '';
        const found = /\{[\s\S]*\}/.exec(text)?.[0] ?? '{}';
        return parseVerdict(JSON.parse(found));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** null ⇔ `MODERATION_AI_API_KEY` absent and no test classifier installed. Never touches the network. */
export function getSecondPassClassifier(): SecondPassClassifier | null {
  if (override) return override;
  const cfg = aiConfig();
  if (!cfg.apiKey) return null;
  const key = JSON.stringify(cfg);
  if (envClassifier?.key !== key) {
    const classifier = buildEnvClassifier(cfg);
    envClassifier = classifier ? { key, classifier } : null;
  }
  return envClassifier?.classifier ?? null;
}

/** Tests. */
export function setSecondPassClassifier(c: SecondPassClassifier | null): void {
  override = c;
  envClassifier = null;
}

/* ───────────────────────────── queue ───────────────────────────── */

/** Whether a first-pass outcome is in scope for the second pass (safety §2.9). */
export function secondPassEligible(surface: ModerationSurface, action: ModerationAction): SecondPassInput['surfaceGroup'] | null {
  if (action === 'block') return null;
  const g = SURFACE_GROUP[surface];
  if (g === 'anon' || g === 'public' || g === 'commerce') return g;
  return null;
}

/**
 * Enqueue (fire-and-forget) and start draining. No-op without a classifier, for a block, or off-scope surfaces.
 * Returns whether a job was queued.
 */
export function enqueueSecondPass(job: {
  text: string;
  firstPass: SecondPassInput['firstPass'] & { action: ModerationAction };
  target: SecondPassTarget;
  sink: SecondPassSink;
}): boolean {
  if (!getSecondPassClassifier()) return false;
  const group = secondPassEligible(job.target.surface, job.firstPass.action);
  if (!group || !job.text.trim()) return false;
  if (queue.length >= MAX_JOBS) {
    queue.shift();
    secondPassMetrics.dropped += 1;
  }
  queue.push({
    ...job.target,
    nonce: crypto.randomBytes(8).toString('hex'),
    input: { text: job.text, surfaceGroup: group, firstPass: { category: job.firstPass.category, severity: job.firstPass.severity } },
    sink: job.sink,
  });
  void drain();
  return true;
}

/** Drains the in-memory queue (the website awaits this inside `after()`; tests await it). */
export function flushSecondPass(): Promise<void> {
  return drain();
}

async function drainLoop(): Promise<void> {
  while (queue.length) {
    const job = queue.shift()!;
    await processJob(job);
  }
}

function drain(): Promise<void> {
  if (draining) return draining;
  if (queue.length === 0) return Promise.resolve();
  // `.finally` settles asynchronously, so the reset always runs AFTER the assignment below (never a stale promise)
  const p: Promise<void> = drainLoop().finally(() => {
    if (draining === p) draining = null;
  });
  draining = p;
  return p;
}

/** One attempt, time-boxed even for a classifier that ignores its abort signal. */
async function classifyOnce(classifier: SecondPassClassifier, input: SecondPassInput): Promise<SecondPassVerdict> {
  const controller = new AbortController();
  const timeoutMs = aiConfig().timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('second pass timed out'));
    }, timeoutMs + 250);
  });
  try {
    return parseVerdict(await Promise.race([classifier.classify(input, controller.signal), timeout]));
  } finally {
    clearTimeout(timer);
  }
}

async function processJob(job: SecondPassJob): Promise<void> {
  const classifier = getSecondPassClassifier();
  if (!classifier) return;
  if (options.now() < breakerOpenUntil) {
    secondPassMetrics.dropped += 1;
    return;
  }
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    let verdict: SecondPassVerdict;
    try {
      verdict = await classifyOnce(classifier, job.input);
    } catch {
      secondPassMetrics.failed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= BREAKER_FAILURES) {
        breakerOpenUntil = options.now() + BREAKER_OPEN_MS;
        consecutiveFailures = 0;
        return;
      }
      const wait = attempt < RETRIES ? options.retryDelayMs(attempt) : 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    consecutiveFailures = 0;
    secondPassMetrics.processed += 1;
    await applyVerdict(job, verdict, classifier.name);
    return;
  }
}

/** Escalate only: allow → flag (queue item, source ai_flag); active → hidden pending review when confident + severe. */
async function applyVerdict(job: SecondPassJob, verdict: SecondPassVerdict, classifierName: string): Promise<void> {
  if (!verdict.category || verdict.severity === 'none' || verdict.confidence < 0.7) return;
  const severe = SEVERITY_RANK[verdict.severity] >= SEVERITY_RANK.high;
  const hide = verdict.confidence >= 0.9 && severe && job.status === 'active';
  const entry: QueueEntry = {
    source: 'ai_flag',
    category: verdict.category,
    severity: verdict.severity,
    priority: hide || severe ? 'p1' : 'p2',
    label: null,
    ruleIds: [],
    aiVerdict: { ...verdict, classifier: classifierName, nonce: job.nonce },
  };
  const { sink, input: _input, ...target } = job;
  try {
    await sink(target, { queue: entry, hide });
    secondPassMetrics.escalated += 1;
  } catch (err) {
    log.error('second pass: could not apply verdict', err);
  }
}

/** Tests: clear the queue, the breaker and the counters. */
export function resetSecondPass(): void {
  queue.length = 0;
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
  secondPassMetrics.processed = 0;
  secondPassMetrics.failed = 0;
  secondPassMetrics.dropped = 0;
  secondPassMetrics.escalated = 0;
}

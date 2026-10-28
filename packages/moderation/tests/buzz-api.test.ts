/**
 * The website's moderated Buzz write API (`POST /api/buzz`, `POST /api/buzz/:threadId/replies`), exercised through its
 * handler core (`apps/web/src/lib/buzz-server/handlers.ts`) with an injected fake Supabase client — no network, no
 * database. Checks the Buzz v2 contract §5: flow order, status codes, `{ error: { code, message, details } }`, what the
 * database functions receive (`p_status`, `p_support_link`, `p_moderation`), the author notice, logging hygiene, the
 * second pass (inert without a key: zero outbound requests), and the end-to-end evasion case of UniVerse's hardening F.
 */
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadBuzzServer, loadEngine } from './helpers/load.ts';

const api = await loadBuzzServer();
const m = await loadEngine();

type Deps = Parameters<typeof api.handleCreateBuzz>[1];
type RpcArgs = Record<string, unknown>;
type RpcResult = { data?: unknown; error?: { message: string; code?: string } | null };

const DAY = 24 * 60 * 60 * 1000;
const USER = '6f1f6c1e-8a1b-4d55-9a57-4f6c2f0a9b11';
const UNIVERSITY = '0b8e1c52-5d4f-4a8e-9a77-2a1c3c4d5e6f';
const THREAD = '2c7a9d80-1e3b-4f5a-8c6d-7e8f9a0b1c2d';
const PARENT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PHOTO = 'https://abcd.supabase.co/storage/v1/object/public/uploads/buzz/anon/0123456789abcdef0123456789abcdef.jpg';

function writer(over: Record<string, unknown> = {}, posting: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: USER, universityId: UNIVERSITY, countryCode: 'United States', role: 'user', accountAgeMs: 30 * DAY, activeStrikePoints: 0,
    recentHashes: [], posting: { allowed: true, mutedUntil: null, reason: null, warningId: null, ...posting }, enabledRulePacks: null, ...over,
  };
}

function buzzItem(args: RpcArgs): Record<string, unknown> {
  const input = args.p_input as { text: string; title?: string; scope?: string };
  return {
    kind: 'buzz', id: 'b0b0b0b0-0000-4000-8000-000000000001', threadId: 'b0b0b0b0-0000-4000-8000-000000000001',
    alias: { emoji: '☄️', label: 'Anon Comet', color: '#7C9BFF' }, isOp: true, isMine: true, text: input.text, title: input.title ?? '',
    score: 0, myVote: 0, collapsed: false, status: args.p_status, supportLink: args.p_support_link, createdAt: 1_760_000_040_000,
    media: [], scope: input.scope ?? 'campus', poll: null, replyCount: 0, locked: false, campusShortName: null, promptId: null,
  };
}

function replyItem(args: RpcArgs): Record<string, unknown> {
  const input = args.p_input as { text: string; parentId?: string };
  return {
    kind: 'reply', id: 'c0c0c0c0-0000-4000-8000-000000000002', threadId: args.p_thread, parentId: input.parentId ?? args.p_thread, depth: 1,
    replyingTo: null, alias: { emoji: '🦊', label: 'Anon Fox', color: '#FF8A65' }, isOp: false, isMine: true, text: input.text, score: 0,
    myVote: 0, collapsed: false, status: args.p_status, supportLink: args.p_support_link, createdAt: 1_760_000_100_000,
  };
}

interface Harness {
  deps: Deps;
  calls: { fn: string; args: RpcArgs }[];
  logs: { method: string; route: string; status: number; durationMs: number }[];
  warns: string[];
  deferred: (() => Promise<void>)[];
}

function harness(opts: {
  user?: string | null;
  noServiceKey?: boolean;
  rpc?: Partial<Record<string, (args: RpcArgs) => RpcResult>>;
} = {}): Harness {
  const calls: Harness['calls'] = [];
  const logs: Harness['logs'] = [];
  const warns: string[] = [];
  const deferred: Harness['deferred'] = [];
  const handlers: Record<string, (args: RpcArgs) => RpcResult> = {
    ts_writer_context: () => ({ data: writer() }),
    ts_record_blocked: () => ({ data: null }),
    buzz_v2_create: (args) => ({ data: buzzItem(args) }),
    buzz_v2_reply: (args) => ({ data: replyItem(args) }),
    ts_apply_moderation: () => ({ data: null }),
    buzz_v2_set_status: () => ({ data: null }),
    ...opts.rpc,
  };
  const client = {
    async rpc(fn: string, args: RpcArgs = {}) {
      calls.push({ fn, args: JSON.parse(JSON.stringify(args)) as RpcArgs });
      const h = handlers[fn];
      if (!h) return { data: null, error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } };
      const r = h(args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  const deps: Deps = {
    getUserId: async () => (opts.user === undefined ? USER : opts.user),
    serviceClient: () => (opts.noServiceKey ? null : client),
    log: (line) => logs.push(line),
    warn: (message) => warns.push(message),
    defer: (task) => deferred.push(task),
  };
  return { deps, calls, logs, warns, deferred };
}

function post(body: unknown, init: { contentType?: string; raw?: string; bearer?: boolean } = {}): Request {
  const headers: Record<string, string> = { 'content-type': init.contentType ?? 'application/json' };
  if (init.bearer) headers.authorization = 'Bearer test-token';
  return new Request('http://localhost/api/buzz', { method: 'POST', headers, body: init.raw ?? JSON.stringify(body) });
}

async function send(h: Harness, body: unknown, init?: Parameters<typeof post>[1]): Promise<{ status: number; json: any; res: Response }> {
  const res = await api.handleCreateBuzz(post(body, init), h.deps);
  return { status: res.status, json: await res.json(), res };
}

async function sendReply(h: Harness, threadId: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await api.handleCreateBuzzReply(post(body), threadId, h.deps);
  return { status: res.status, json: await res.json() };
}

const fns = (h: Harness): string[] => h.calls.map((c) => c.fn);
const callOf = (h: Harness, fn: string): RpcArgs => {
  const c = h.calls.find((x) => x.fn === fn);
  assert.ok(c, `${fn} was called`);
  return c.args;
};

/* every test runs with fetch replaced: the write API (and the inert second pass) must never reach the network */
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
before(() => {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network is not allowed in tests');
  }) as typeof fetch;
  m.configureSecondPass({ env: { MODERATION_AI_API_KEY: '' }, retryDelayMs: () => 0 });
});
afterEach(() => {
  m.setSecondPassClassifier(null);
  m.resetSecondPass();
});
after(() => {
  globalThis.fetch = originalFetch;
  m.configureSecondPass(null);
  assert.equal(fetchCalls, 0, 'zero outbound requests');
});

/* ───────────────────────────── POST /api/buzz ───────────────────────────── */

describe('POST /api/buzz — gates before moderation', () => {
  it('401 unauthenticated without a session or token; nothing is called', async () => {
    const h = harness({ user: null });
    const { status, json, res } = await send(h, { text: 'hello campus' });
    assert.equal(status, 401);
    assert.deepEqual(json, { error: { code: 'unauthenticated', message: 'Log in to use Buzz.' } });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(h.calls, []);
  });

  it('503 unavailable without SUPABASE_SERVICE_ROLE_KEY', async () => {
    const h = harness({ noServiceKey: true });
    const { status, json } = await send(h, { text: 'hello campus' });
    assert.equal(status, 503);
    assert.deepEqual(json.error, { code: 'unavailable', message: "Posting to Buzz isn't set up on this server yet." });
  });

  it('503 unavailable while the database has no Buzz v2 functions yet (the live project today)', async () => {
    const h = harness({ rpc: { ts_writer_context: () => ({ error: { message: 'Could not find the function public.ts_writer_context(p_author)', code: 'PGRST202' } }) } });
    const { status, json } = await send(h, { text: 'hello campus' });
    assert.equal(status, 503);
    assert.equal(json.error.code, 'unavailable');
    assert.deepEqual(fns(h), ['ts_writer_context']);
  });

  it('403 muted / suspended / banned / warning_unacknowledged with details — before the body is even validated', async () => {
    const cases: [Record<string, unknown>, string, Record<string, unknown>][] = [
      [{ allowed: false, reason: 'muted', mutedUntil: 1_760_000_000_000 }, 'muted', { until: 1_760_000_000_000 }],
      [{ allowed: false, reason: 'suspended', mutedUntil: '2026-11-01T00:00:00.000Z', category: 'harassment_bullying' }, 'suspended', { until: Date.parse('2026-11-01T00:00:00.000Z'), category: 'harassment_bullying' }],
      [{ allowed: false, reason: 'banned' }, 'banned', { until: null, category: null }],
      [{ allowed: false, reason: 'warning', warningId: 'w-1' }, 'warning_unacknowledged', { warningId: 'w-1' }],
    ];
    for (const [posting, code, details] of cases) {
      const h = harness({ rpc: { ts_writer_context: () => ({ data: writer({}, posting) }) } });
      const { status, json } = await send(h, { text: '' }); // invalid body: the posting check answers first
      assert.equal(status, 403, code);
      assert.equal(json.error.code, code);
      assert.deepEqual(json.error.details, details);
      assert.ok(json.error.message.length > 10);
      assert.deepEqual(fns(h), ['ts_writer_context']);
    }
  });

  it('400 validation_failed (limits from BUZZ_LIMITS); 413 / 415 for oversized and non-JSON bodies', async () => {
    const bad: [unknown, string][] = [
      [{ text: '' }, 'Say something first.'],
      [{ text: '   ', title: '  ' }, 'Say something first.'],
      [{ text: 'x'.repeat(501) }, ''],
      [{ text: 'ok', title: 't'.repeat(101) }, ''],
      [{ text: 'ok', images: ['https://evil.example/pixel.gif'] }, 'Buzz photos must be uploaded anonymously.'],
      [{ text: 'ok', images: [PHOTO, PHOTO, PHOTO, PHOTO, PHOTO] }, 'You can attach up to 4 photos.'],
      [{ text: 'ok', images: [PHOTO], video: { playbackId: 'abcdefgh1234' } }, 'Add photos or one video, not both.'],
      [{ text: 'ok', video: { playbackId: 'abcdefgh1234', durationSeconds: 61 } }, 'Videos on Buzz max out at 60 seconds.'],
      [{ text: 'ok', video: { playbackId: 'bad id!' } }, ''],
      [{ text: 'ok', poll: { options: ['A', 'a'], durationDays: 1 } }, 'Poll options must be different.'],
      [{ text: 'ok', poll: { options: ['A'], durationDays: 1 } }, ''],
      [{ text: 'ok', poll: { options: ['A', 'B', 'C', 'D', 'E'], durationDays: 1 } }, ''],
      [{ text: 'ok', poll: { options: ['A', 'B'], durationDays: 2 } }, 'Polls run for 1, 3 or 7 days.'],
      [{ text: 'ok', scope: 'everywhere' }, ''],
      [{ text: 'ok', promptId: 'not-a-uuid' }, 'That prompt has expired.'],
      [{ text: 'ok', category: 'gossip' }, 'Pick a category from the list.'],
      [{ text: 'ok', category: 7 }, 'Pick a category from the list.'],
      [[1, 2, 3], ''],
    ];
    for (const [body, message] of bad) {
      const h = harness();
      const { status, json } = await send(h, body);
      assert.equal(status, 400, JSON.stringify(body));
      assert.equal(json.error.code, 'validation_failed');
      if (message) assert.equal(json.error.message, message);
      assert.ok(json.error.details && typeof json.error.details === 'object');
      assert.deepEqual(fns(h), ['ts_writer_context'], 'nothing is moderated or written');
    }
    const malformed = await send(harness(), null, { raw: '{"text": "unterminated' });
    assert.deepEqual([malformed.status, malformed.json.error.code, malformed.json.error.message], [400, 'validation_failed', 'Malformed request body.']);
    const form = await send(harness(), null, { raw: 'text=hello', contentType: 'application/x-www-form-urlencoded' });
    assert.deepEqual([form.status, form.json.error.code], [415, 'validation_failed']);
    const huge = await send(harness(), { text: 'ok', title: 'x'.repeat(70 * 1024) });
    assert.deepEqual([huge.status, huge.json.error.code], [413, 'validation_failed']);
  });

  it('403 too_new for a poll from an account younger than 24 h (before any moderation)', async () => {
    const h = harness({ rpc: { ts_writer_context: () => ({ data: writer({ accountAgeMs: 2 * 60 * 60 * 1000 }) }) } });
    const { status, json } = await send(h, { text: 'which is better', poll: { options: ['PCL', 'Alkek'], durationDays: 1 } });
    assert.equal(status, 403);
    assert.deepEqual([json.error.code, json.error.message], ['too_new', 'Polls unlock 24 hours after you join.']);
    assert.ok(json.error.details.availableAt > Date.now());
    assert.deepEqual(fns(h), ['ts_writer_context']);
  });
});

describe('POST /api/buzz — moderation', () => {
  it('422 content_blocked with ContentBlockedDetails; an escalated block is recorded with its text for the queue', async () => {
    const h = harness();
    const { status, json } = await send(h, { title: 'Heads up', text: 'I am going to kill you' });
    assert.equal(status, 422);
    assert.equal(json.error.code, 'content_blocked');
    assert.equal(json.error.message, 'It reads as a threat or a call to violence. We take those seriously even as jokes. If someone is in danger, call your local emergency number.');
    assert.deepEqual(json.error.details, {
      messageId: 'M-THREAT', title: "This can't be posted", category: 'threat_violence', guidelineAnchor: 'threats', support: null,
    });
    assert.deepEqual(fns(h), ['ts_writer_context', 'ts_record_blocked']);
    const rec = callOf(h, 'ts_record_blocked');
    assert.equal(rec.p_author, USER);
    assert.equal(rec.p_surface, 'buzz');
    assert.equal(rec.p_text, 'Heads up\nI am going to kill you');
    const pm = rec.p_moderation as { events: { field: string; action: string; textHash: string }[]; queue: { source: string; priority: string } | null };
    assert.deepEqual(pm.events.map((e) => [e.field, e.action, e.textHash]), [['body', 'block', '']]);
    assert.deepEqual([pm.queue?.source, pm.queue?.priority], ['rule_block_escalation', 'p0']);
    assert.ok(!/matches|ruleId|signals|engine/.test(JSON.stringify(json)), 'no engine internals reach the author');
  });

  it('a plain block is recorded without a queue item; a self-harm method block carries the support resources', async () => {
    const h = harness();
    const kys = await send(h, { text: 'kys loser' });
    assert.deepEqual([kys.status, kys.json.error.details.messageId], [422, 'M-KYS']);
    assert.equal((callOf(h, 'ts_record_blocked').p_moderation as { queue: unknown }).queue, null);

    const h2 = harness();
    const method = await send(h2, { text: 'how many pills does it take to overdose' });
    assert.equal(method.status, 422);
    assert.equal(method.json.error.details.messageId, 'S-METHOD');
    assert.equal(method.json.error.details.support.kind, 'self_harm');
    assert.equal(method.json.error.details.support.lines[0].href, 'tel:988', 'countryCode "United States" → US lines');
    assert.equal((callOf(h2, 'ts_record_blocked').p_moderation as { queue: { source: string } }).queue.source, 'rule_block_escalation');
  });

  it('poll options are moderated (surface buzz_poll, field option): a blocked option blocks the buzz', async () => {
    const h = harness();
    const { status, json } = await send(h, { text: 'vote below', poll: { options: ['the library', 'kys loser'], durationDays: 3 } });
    assert.equal(status, 422);
    assert.equal(json.error.details.messageId, 'M-KYS');
    const pm = callOf(h, 'ts_record_blocked').p_moderation as { events: { field: string; surface: string }[] };
    assert.deepEqual(pm.events.map((e) => [e.field, e.surface]), [['option', 'buzz_poll']]);
    assert.ok(!fns(h).includes('buzz_v2_create'));
  });

  it('a failed ts_record_blocked still answers 422 (and warns, without user data)', async () => {
    const h = harness({ rpc: { ts_record_blocked: () => ({ error: { message: 'boom' } }) } });
    const { status } = await send(h, { text: 'I am going to kill you' });
    assert.equal(status, 422);
    assert.deepEqual(h.warns, ['could not record a blocked write (buzz)']);
  });

  it('201: buzz_v2_create gets the trimmed input, status, support flag and p_moderation; the author gets the notice', async () => {
    const h = harness();
    const body = {
      title: '  Best tacos near campus?  ', text: '  Looking for recommendations ', scope: 'global', images: [PHOTO],
      imageMeta: [{ url: PHOTO, width: 1200, height: 900, blur: null, extra: 'dropped' }], authorId: 'attacker', status: 'active',
    };
    const { status, json, res } = await send(h, body);
    assert.equal(status, 201);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(fns(h), ['ts_writer_context', 'buzz_v2_create']);
    const args = callOf(h, 'buzz_v2_create');
    assert.equal(args.p_author, USER);
    assert.deepEqual(args.p_input, {
      text: 'Looking for recommendations', scope: 'global', title: 'Best tacos near campus?', images: [PHOTO],
      imageMeta: [{ url: PHOTO, width: 1200, height: 900, blur: null }],
    });
    assert.equal(args.p_status, 'active');
    assert.equal(args.p_support_link, false);
    const pm = args.p_moderation as { events: { field: string; action: string; textHash: string }[]; queue: unknown };
    assert.deepEqual(pm.events.map((e) => [e.field, e.action]), [['title', 'allow'], ['body', 'allow']]);
    assert.equal(pm.events[0]!.textHash, m.textHash('Best tacos near campus?'));
    assert.equal(pm.queue, null);
    assert.equal(json.kind, 'buzz');
    assert.equal(json.title, 'Best tacos near campus?');
    assert.deepEqual(json.moderation, { status: 'active', userMessage: null, support: null });
    for (const k of ['authorId', 'author_id', 'userId', 'user_id']) assert.ok(!(k in json), k);
  });

  it('201: a category goes to buzz_v2_create as it was picked; none (or null) sends none', async () => {
    const picked = harness();
    assert.equal((await send(picked, { text: 'who else is up', category: 'hot_take' })).status, 201);
    assert.deepEqual(callOf(picked, 'buzz_v2_create').p_input, { text: 'who else is up', scope: 'campus', category: 'hot_take' });
    for (const body of [{ text: 'no category' }, { text: 'no category', category: null }]) {
      const h = harness();
      assert.equal((await send(h, body)).status, 201);
      assert.deepEqual(callOf(h, 'buzz_v2_create').p_input, { text: 'no category', scope: 'campus' });
    }
  });

  it('a held field holds the buzz: p_status held + M-HELD notice + queue item', async () => {
    const h = harness();
    const { status, json } = await send(h, { text: 'anyone got the answer key for the midterm' });
    assert.equal(status, 201);
    const args = callOf(h, 'buzz_v2_create');
    assert.equal(args.p_status, 'held');
    assert.deepEqual((args.p_moderation as { queue: { priority: string; source: string } }).queue, {
      ...(args.p_moderation as { queue: object }).queue, priority: 'p1', source: 'rule_flag',
    });
    assert.equal(json.status, 'held');
    assert.equal(json.moderation.status, 'held');
    assert.deepEqual([json.moderation.userMessage.id, json.moderation.userMessage.title], ['M-HELD', 'In review']);
  });

  it('self-harm ideation posts (active) with the support flag, support resources and a P0 wellbeing queue item', async () => {
    const h = harness();
    const { status, json } = await send(h, { text: 'i want to die' });
    assert.equal(status, 201);
    const args = callOf(h, 'buzz_v2_create');
    assert.deepEqual([args.p_status, args.p_support_link], ['active', true]);
    const queue = (args.p_moderation as { queue: { priority: string; label: string; category: string } }).queue;
    assert.deepEqual([queue.priority, queue.label, queue.category], ['p0', 'wellbeing', 'self_harm']);
    assert.equal(json.moderation.status, 'active');
    assert.equal(json.moderation.userMessage, null);
    assert.equal(json.moderation.support.headline, 'It sounds like things are heavy right now');
  });

  it('uses the writer context: recentHashes (duplicate), accountAgeMs (new-account links), enabledRulePacks', async () => {
    const text = 'selling my calculus textbook, barely used, message me';
    const dup = await send(harness({ rpc: { ts_writer_context: () => ({ data: writer({ recentHashes: [m.textHash(text)] }) }) } }), { text });
    assert.deepEqual([dup.status, dup.json.error.details.messageId], [422, 'M-DUP']);
    const fresh = await send(harness({ rpc: { ts_writer_context: () => ({ data: writer({ accountAgeMs: 60_000 }) }) } }), { text: 'see https://txstate.edu' });
    assert.deepEqual([fresh.status, fresh.json.error.details.messageId], [422, 'M-LINK-NEW']);
    // staff switched admin.spam off (its payment-scam list has no "do i have to" guard): the question posts again
    const falsePositive = 'do i have to pay upfront for housing';
    assert.equal((await send(harness(), { text: falsePositive })).status, 422);
    const withoutSpam = m.RULE_PACK_IDS.filter((id) => id !== 'admin.spam');
    const toggled = harness({ rpc: { ts_writer_context: () => ({ data: writer({ enabledRulePacks: withoutSpam }) }) } });
    assert.equal((await send(toggled, { text: falsePositive })).status, 201);
    assert.equal((await send(toggled, { text: 'I am going to kill you' })).status, 422, 'the other packs keep working');
    assert.deepEqual(toggled.warns, []);
  });

  it('an empty or unknown enabledRulePacks list never means "no rules": every pack runs (and unknown ids are reported)', async () => {
    for (const list of [[], ['threats', 'hate']]) {
      const h = harness({ rpc: { ts_writer_context: () => ({ data: writer({ enabledRulePacks: list }) }) } });
      const res = await send(h, { text: 'do i have to pay upfront for housing' });
      assert.equal(res.status, 422, JSON.stringify(list));
      assert.deepEqual(h.warns, list.length ? ['ts_writer_context lists rule packs this engine does not ship'] : []);
    }
  });

  it('end-to-end evasion (UniVerse hardening F): a small-caps death threat is 422 on both routes', async () => {
    const threat = 'ɪ ᴀᴍ ɢᴏɪɴɢ ᴛᴏ ᴋɪʟʟ ʏᴏᴜ';
    assert.equal((await send(harness(), { text: threat })).status, 422);
    assert.equal((await sendReply(harness(), THREAD, { text: threat })).status, 422);
    assert.equal((await send(harness(), { text: 'k i l l yourself' })).json.error.code, 'content_blocked');
  });
});

describe('POST /api/buzz — database errors → HTTP', () => {
  it('buzz:<code>:<message> maps to 404 / 403 / 429 / 400 with the message passed through; anything else is generic', async () => {
    const cases: [string, number, string, string][] = [
      ["buzz:rate_limited:You're posting a lot. Try again in a little while.", 429, 'rate_limited', "You're posting a lot. Try again in a little while."],
      ['buzz:buzz_gate_required:Accept the Buzz guidelines first.', 403, 'buzz_gate_required', 'Accept the Buzz guidelines first.'],
      ["buzz:not_found:That buzz isn't available.", 404, 'not_found', "That buzz isn't available."],
      ['buzz:too_new:Polls unlock 24 hours after you join.', 403, 'too_new', 'Polls unlock 24 hours after you join.'],
      ['buzz:muted:', 403, 'muted', 'Something went wrong. Try again.'],
      ['buzz:validation_failed:Buzz photos must be uploaded anonymously', 400, 'validation_failed', 'Buzz photos must be uploaded anonymously'],
      ['ts:not_found:Not found', 404, 'not_found', 'Not found'],
      ['duplicate key value violates unique constraint "buzz_posts_pkey" Key (author_id)=(6f1f…)', 500, 'unknown', 'Something went wrong. Try again.'],
    ];
    for (const [message, status, code, text] of cases) {
      const h = harness({ rpc: { buzz_v2_create: () => ({ error: { message, code: 'P0001' } }) } });
      const res = await send(h, { text: 'a normal buzz about the bus schedule' });
      assert.equal(res.status, status, message);
      assert.deepEqual(res.json, { error: { code, message: text } });
    }
    const missing = await send(harness({ rpc: { buzz_v2_create: undefined } }), { text: 'a normal buzz' });
    assert.deepEqual([missing.status, missing.json.error.code], [503, 'unavailable']);
    const garbage = await send(harness({ rpc: { buzz_v2_create: () => ({ data: 'not an item' }) } }), { text: 'a normal buzz' });
    assert.deepEqual([garbage.status, garbage.json.error.code], [500, 'unknown']);
    const throws = harness();
    throws.deps.serviceClient = () => ({ rpc: () => Promise.reject(new Error('socket hang up')) });
    const crashed = await send(throws, { text: 'a normal buzz' });
    assert.deepEqual(crashed.json, { error: { code: 'unknown', message: 'Something went wrong. Try again.' } });
  });
});

/* ───────────────────────────── POST /api/buzz/:threadId/replies ───────────────────────────── */

describe('POST /api/buzz/:threadId/replies', () => {
  it('201: buzz_v2_reply gets the thread, the input, status and p_moderation (surface buzz_reply)', async () => {
    const h = harness();
    const { status, json } = await sendReply(h, THREAD, { text: '  same, the 8am bus is always late  ', parentId: PARENT });
    assert.equal(status, 201);
    assert.deepEqual(fns(h), ['ts_writer_context', 'buzz_v2_reply']);
    const args = callOf(h, 'buzz_v2_reply');
    assert.deepEqual([args.p_author, args.p_thread, args.p_status, args.p_support_link], [USER, THREAD, 'active', false]);
    assert.deepEqual(args.p_input, { text: 'same, the 8am bus is always late', parentId: PARENT });
    const pm = args.p_moderation as { events: { surface: string; field: string }[] };
    assert.deepEqual(pm.events.map((e) => [e.surface, e.field]), [['buzz_reply', 'body']]);
    assert.equal(json.kind, 'reply');
    assert.deepEqual(json.moderation, { status: 'active', userMessage: null, support: null });
  });

  it('a reply to the root omits parentId; a held reply is stored held', async () => {
    const h = harness();
    const { status, json } = await sendReply(h, THREAD, { text: 'anyone got the answer key for the midterm' });
    assert.equal(status, 201);
    assert.deepEqual(callOf(h, 'buzz_v2_reply').p_input, { text: 'anyone got the answer key for the midterm' });
    assert.equal(callOf(h, 'buzz_v2_reply').p_status, 'held');
    assert.equal(json.moderation.userMessage.id, 'M-HELD');
  });

  it('404 for a thread id that cannot exist (after the auth check), 401 first', async () => {
    assert.equal((await sendReply(harness({ user: null }), 'nope', { text: 'hi' })).status, 401);
    const h = harness();
    const { status, json } = await sendReply(h, 'not-a-thread', { text: 'hi there' });
    assert.equal(status, 404);
    assert.deepEqual(json, { error: { code: 'not_found', message: "That buzz isn't available." } });
    assert.deepEqual(h.calls, []);
  });

  it('422 blocked reply recorded on surface buzz_reply; locked / missing threads come back from the database', async () => {
    const h = harness();
    const blocked = await sendReply(h, THREAD, { text: 'you are so ugly and worthless' });
    assert.deepEqual([blocked.status, blocked.json.error.details.messageId], [422, 'M-HARASS']);
    assert.equal(callOf(h, 'ts_record_blocked').p_surface, 'buzz_reply');
    const locked = await sendReply(harness({ rpc: { buzz_v2_reply: () => ({ error: { message: 'buzz:locked:This thread is locked.' } }) } }), THREAD, { text: 'ok' });
    assert.deepEqual([locked.status, locked.json.error.code, locked.json.error.message], [403, 'locked', 'This thread is locked.']);
    const gone = await sendReply(harness({ rpc: { buzz_v2_reply: () => ({ error: { message: "buzz:not_found:That buzz isn't available." } }) } }), THREAD, { text: 'ok' });
    assert.deepEqual([gone.status, gone.json.error.code], [404, 'not_found']);
  });

  it('400 for an empty reply, a too-long reply or a malformed parentId', async () => {
    for (const body of [{ text: '   ' }, { text: 'x'.repeat(501) }, { text: 'ok', parentId: 'abc' }, {}]) {
      const h = harness();
      const res = await sendReply(h, THREAD, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.json.error.code, 'validation_failed');
      assert.deepEqual(fns(h), ['ts_writer_context']);
    }
  });
});

/* ───────────────────────────── logging + second pass ───────────────────────────── */

describe('logging and the second pass', () => {
  it('logs exactly method + route template + status + duration — never a body, a user id or a thread id', async () => {
    const h = harness();
    await send(h, { text: 'my secret crush is in the library' });
    await sendReply(h, THREAD, { text: 'I am going to kill you' });
    await send(harness({ user: null }), { text: 'x' });
    assert.deepEqual(h.logs.map((l) => Object.keys(l).sort()), [['durationMs', 'method', 'route', 'status'], ['durationMs', 'method', 'route', 'status']]);
    assert.deepEqual(h.logs.map((l) => [l.method, l.route, l.status]), [['POST', '/api/buzz', 201], ['POST', '/api/buzz/[threadId]/replies', 422]]);
    const everything = JSON.stringify([h.logs, h.warns]);
    for (const secret of [USER, THREAD, 'crush', 'kill', UNIVERSITY]) assert.ok(!everything.includes(secret), secret);
  });

  it('inert without MODERATION_AI_API_KEY: nothing is deferred, nothing is fetched', async () => {
    assert.equal(m.getSecondPassClassifier(), null);
    const h = harness();
    assert.equal((await send(h, { text: 'coffee on the quad today' })).status, 201);
    assert.equal(h.deferred.length, 0);
    assert.equal(fetchCalls, 0);
  });

  it('with a classifier it runs after the response and can only escalate (ai_flag queue entry, hide an active item)', async () => {
    m.setSecondPassClassifier({
      name: 'stub',
      async classify(input) {
        assert.ok(!JSON.stringify(input).includes(USER));
        return input.text.includes('coffee')
          ? { category: 'threat_violence', severity: 'critical', confidence: 0.95, rationale: 'test' }
          : { category: null, severity: 'none', confidence: 1, rationale: 'clean' };
      },
    });
    const h = harness();
    const res = await send(h, { text: 'coffee on the quad today' });
    assert.equal(res.status, 201);
    assert.equal(res.json.moderation.status, 'active', 'the response never waits for the second pass');
    assert.equal(h.deferred.length, 1);
    await h.deferred[0]!();
    const applied = callOf(h, 'ts_apply_moderation');
    assert.deepEqual([applied.p_entity_type, applied.p_entity_id, applied.p_surface, applied.p_author, applied.p_university], ['buzz', res.json.id, 'buzz', USER, UNIVERSITY]);
    const queue = (applied.p_moderation as { events: unknown[]; queue: { source: string; priority: string; aiVerdict: { classifier: string } } });
    assert.deepEqual(queue.events, []);
    assert.deepEqual([queue.queue.source, queue.queue.priority, queue.queue.aiVerdict.classifier], ['ai_flag', 'p1', 'stub']);
    assert.deepEqual(callOf(h, 'buzz_v2_set_status'), { p_entity_type: 'buzz', p_id: res.json.id, p_status: 'hidden' });

    const clean = harness();
    await send(clean, { text: 'the bus is late again' });
    await clean.deferred[0]?.();
    assert.ok(!fns(clean).includes('ts_apply_moderation'), 'a clean verdict changes nothing');
    assert.ok(!fns(clean).includes('buzz_v2_set_status'));
  });
});

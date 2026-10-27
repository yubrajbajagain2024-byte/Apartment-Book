/**
 * Moderation engine (SPEC §4.2.6, safety §2, §8.2 #6–#8) — port of UniVerse `server/tests/core/moderation.test.ts`:
 * fixture tables per category incl. leetspeak, spacing, homoglyph, zero-width and idiom guards; PII fixtures;
 * self-harm path; second pass inert without the env key (zero outbound requests); moderateWrite / toModerationRecord /
 * duplicate detector / account modifiers / author-notice hygiene.
 *
 * The UniVerse fixture tables ran with only the `baseline` pack registered (`createTestApp({ slices: [] })`), so they
 * run here with `enabledRulePacks: ['baseline']`; the admin packs have their own tables (rules.test.ts), and a final
 * section re-runs these tables with every pack on, the way UniBuzz runs in production.
 * The DB assertions of the UniVerse file (moderation_events / mod_queue rows) become assertions on the `p_moderation`
 * record the database receives.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadEngine } from './helpers/load.ts';

const m = await loadEngine();
type Ctx = Parameters<typeof m.moderate>[1];
type Surface = Ctx['surface'];
type Category = NonNullable<ReturnType<typeof m.moderate>['category']>;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASELINE_ONLY = ['baseline'] as const;

type Expect = 'block' | 'flag' | 'allow';
interface Fixture {
  text: string;
  expect: Expect;
  surface?: Surface;
  category?: Category;
  subcode?: string;
  messageId?: string;
  visibility?: 'visible' | 'held';
  support?: boolean;
  accountAgeMs?: number;
  banner?: string;
  isMessageRequest?: boolean;
  recentHashes?: string[];
}

function ctxFor(surface: Surface, extra: Partial<Ctx> = {}): Ctx {
  return {
    surface, userId: 'u_test', role: 'user', accountType: 'student', accountAgeMs: 30 * DAY, activeStrikePoints: 0,
    universityId: 'uni_utexas', countryCode: 'US', enabledRulePacks: BASELINE_ONLY, ...extra,
  };
}

const tables: [string, Fixture[]][] = [];

function checkFixture(f: Fixture, packs: readonly string[] | null): void {
  const r = m.moderate(f.text, ctxFor(f.surface ?? 'buzz', {
    enabledRulePacks: packs,
    ...(f.accountAgeMs !== undefined ? { accountAgeMs: f.accountAgeMs } : {}),
    ...(f.isMessageRequest !== undefined ? { isMessageRequest: f.isMessageRequest } : {}),
    ...(f.recentHashes ? { recentHashes: f.recentHashes } : {}),
  }));
  const why = `category=${r.category} subcode=${r.subcode} msg=${r.userMessage?.id}`;
  assert.equal(r.action, f.expect, why);
  if (f.category) assert.equal(r.category, f.category, why);
  if (f.subcode) assert.equal(r.subcode, f.subcode, why);
  if (f.messageId) assert.equal(r.userMessage?.id, f.messageId, why);
  if (f.visibility) assert.equal(r.visibility, f.visibility, why);
  if (f.support !== undefined) assert.equal(r.support !== null, f.support, why);
  if (f.banner) assert.equal(r.recipientBanner, f.banner, why);
  if (f.expect === 'block') {
    assert.equal(r.persistStatus, undefined);
    assert.ok(r.userMessage);
    assert.ok(r.userMessage.body.length > 10);
  } else {
    assert.equal(r.persistStatus, r.visibility === 'held' ? 'held' : 'active');
  }
  if (f.expect === 'allow' && !f.support) assert.equal(r.userMessage, null, why);
}

function runTable(name: string, fixtures: Fixture[]): void {
  tables.push([name, fixtures]);
  describe(name, () => {
    for (const f of fixtures) {
      it(`${f.expect.padEnd(5)} · ${f.surface ?? 'buzz'} · ${JSON.stringify(f.text)}`, () => checkFixture(f, BASELINE_ONLY));
    }
  });
}

afterEach(() => {
  m.setSecondPassClassifier(null);
  m.configureSecondPass(null);
  m.resetSecondPass();
});

/* ───────────────────────────── #6 fixture tables ───────────────────────────── */

runTable('threat_violence', [
  { text: 'I am going to kill you', expect: 'block', category: 'threat_violence', messageId: 'M-THREAT' },
  { text: 'i will k i l l you tomorrow', expect: 'block', category: 'threat_violence' },
  { text: 'imma sh00t up the library', expect: 'block', category: 'threat_violence' },
  { text: 'someone should stab that guy after class', expect: 'block', category: 'threat_violence', subcode: 'incitement' },
  { text: 'how to make a pipe bomb', expect: 'block', category: 'threat_violence', subcode: 'weapons_instructions' },
  { text: "you're dead when i see you", expect: 'block', category: 'threat_violence' },
  { text: 'hope you die', expect: 'flag', category: 'threat_violence', visibility: 'held' },
  { text: 'I am going to kill you', expect: 'block', surface: 'message', messageId: 'M-THREAT' },
  { text: 'this exam is killing me', expect: 'allow' },
  { text: 'i killed it at the presentation', expect: 'allow' },
  { text: 'im gonna kill it in class today', expect: 'allow' },
  { text: 'that concert was the bomb', expect: 'allow' },
  { text: 'dead tired after the library', expect: 'allow' },
  { text: 'gonna shoot my shot with the ta at the game', expect: 'allow' },
  { text: 'i will attack this problem with you tomorrow', expect: 'allow' },
]);

// Everyday emoji are two UTF-16 units each: the normalizer once lost count of them and failed closed (held) on any.
runTable('everyday_emoji', [
  { text: 'I feel lonely today 😢😢😢', expect: 'allow' },
  { text: '😢', expect: 'allow' },
  { text: 'finals week 😂🔥 lets go 👍', expect: 'allow' },
  { text: 'happy birthday ❤️🎉', expect: 'allow' },
  { text: '😡😡 i will k i l l you tomorrow', expect: 'block', category: 'threat_violence' },
  { text: 'i will k i l l you 😡 tomorrow', expect: 'block', category: 'threat_violence' },
]);

runTable('harassment_bullying', [
  { text: 'kys loser', expect: 'block', category: 'harassment_bullying', subcode: 'kys', messageId: 'M-KYS' },
  { text: 'k y s', expect: 'block', category: 'harassment_bullying', subcode: 'kys' },
  { text: 'you are so ugly and worthless', expect: 'block', category: 'harassment_bullying', messageId: 'M-HARASS' },
  { text: "let's all spam her dms", expect: 'block', category: 'harassment_bullying', subcode: 'pile_on_call' },
  { text: 'rate the freshmen girls', expect: 'block', category: 'harassment_bullying', subcode: 'rate_people' },
  { text: 'ur a pathetic loser', expect: 'block', category: 'harassment_bullying' },
  { text: 'you are an idiot', expect: 'flag', category: 'harassment_bullying', visibility: 'visible' },
  { text: 'you are so ugly and worthless', expect: 'allow', surface: 'message' },
  { text: 'kys loser', expect: 'block', surface: 'message', subcode: 'kys' },
  { text: "i'm such a loser today", expect: 'allow' },
  { text: 'this assignment is ugly', expect: 'allow' },
  { text: 'my code is trash', expect: 'allow' },
  { text: 'the freshmen are so hyped', expect: 'allow' },
  { text: 'the sky is so pretty tonight', expect: 'allow' },
  { text: 'you killed it at the game', expect: 'allow' },
  { text: 'you freak me out sometimes lol', expect: 'allow' },
  { text: 'did you see the disgusting bathroom in jester', expect: 'allow' },
]);

runTable('hate', [
  { text: 'n1gger', expect: 'block', category: 'hate', subcode: 'slur', messageId: 'M-HATE' },
  { text: 'nіgger', expect: 'block', category: 'hate', subcode: 'slur' }, // Cyrillic і
  { text: 'fa​gg​ot', expect: 'block', category: 'hate', subcode: 'slur' }, // zero-width
  { text: 'jews are vermin', expect: 'block', category: 'hate', subcode: 'dehumanization' },
  { text: "muslims don't belong here", expect: 'block', category: 'hate', subcode: 'exclusion_call' },
  { text: 'the holocaust never happened', expect: 'flag', category: 'hate', visibility: 'held' },
  { text: 'no blacks please', expect: 'block', surface: 'roommate_listing', subcode: 'discriminatory_listing', messageId: 'M-LISTING-DISCRIM' },
  { text: 'the classic assassin movie was great', expect: 'allow' },
  { text: 'i love my jewish friends', expect: 'allow' },
  { text: 'muslims celebrate eid next week', expect: 'allow' },
  { text: 'history lecture on the holocaust today', expect: 'allow' },
  { text: 'black coffee only, no sugar', expect: 'allow' },
  { text: 'no blacks please', expect: 'allow', surface: 'message' },
  { text: 'there are chinks in the armor of that argument', expect: 'allow' },
]);

runTable('sexual_minors', [
  { text: 'child porn links dm me', expect: 'block', category: 'sexual_minors', messageId: 'M-MINORS' },
  { text: 'that 15 year old is so hot', expect: 'block', category: 'sexual_minors' },
  { text: 'cp l1nks anyone', expect: 'block', category: 'sexual_minors' },
  { text: 'high schooler nudes', expect: 'block', category: 'sexual_minors' },
  { text: 'send me pics little girl dont tell your parents', expect: 'block', category: 'sexual_minors' },
  { text: 'u n d e r a g e nudes', expect: 'block', category: 'sexual_minors' },
  { text: 'child porn links dm me', expect: 'block', surface: 'message' },
  { text: 'my 15 year old brother is visiting campus', expect: 'allow' },
  { text: 'high schoolers toured the campus today', expect: 'allow' },
  { text: 'a little girl at the park had a cute dog', expect: 'allow' },
  { text: 'underage drinking is a problem here', expect: 'allow' },
  { text: 'child psychology class was great', expect: 'allow' },
]);

runTable('sexual_explicit', [
  { text: 'blowjob tips', expect: 'block', surface: 'orbit_post', category: 'sexual_explicit', messageId: 'M-SEXUAL' },
  { text: 'blowjob tips', expect: 'flag', surface: 'buzz', visibility: 'held' },
  { text: 'dtf tonight anyone', expect: 'block', subcode: 'solicitation' },
  { text: 'trade nudes with me', expect: 'block', subcode: 'nude_trading' },
  { text: 'ill leak your nudes if you leave me', expect: 'block', subcode: 'ncii_threat' },
  { text: 'pay me 200 or everyone gets the recording', expect: 'block', subcode: 'sextortion' },
  { text: 'selling nudes hmu', expect: 'block', subcode: 'solicitation' },
  { text: 'dtf tonight anyone', expect: 'flag', surface: 'message', banner: 'B-SEXUAL' },
  { text: 'sex ed class was informative', expect: 'allow' },
  { text: 'found a nude beach on spring break', expect: 'allow' },
  { text: 'sugar cookies at the union today', expect: 'allow' },
  { text: 'hookup culture essay due tomorrow', expect: 'allow' },
  { text: 'blowjob tips', expect: 'allow', surface: 'message' },
]);

runTable('drugs_illegal_sales', [
  { text: 'selling adderall dm me', expect: 'block', category: 'drugs_illegal_sales', messageId: 'M-DRUGS' },
  { text: 'who has weed for tonight', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'need a plug for shrooms', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'where can i get a fake id', expect: 'block', subcode: 'fake_id' },
  { text: 'selling a glock no paperwork', expect: 'block', subcode: 'weapon_sale' },
  { text: 's3lling m0lly for $20 hmu', expect: 'block', category: 'drugs_illegal_sales' },
  { text: '🍃 for sale dm me', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'selling adderall dm me', expect: 'block', surface: 'message' },
  { text: 'weed is legal in some states', expect: 'allow' },
  { text: 'harm reduction: fentanyl test strips at the health center', expect: 'allow' },
  { text: 'my prescription for adderall ran out', expect: 'allow' },
  { text: 'selling my textbook and a lamp', expect: 'allow' },
  { text: 'the plug on my charger broke', expect: 'allow' },
  { text: 'nerf gun for sale', expect: 'allow', surface: 'market_listing' },
  { text: 'looking for a bud to study with', expect: 'allow' },
  { text: 'who has coke for the party', expect: 'allow' },
  { text: 'weed is legal in some states', expect: 'flag', surface: 'market_listing', visibility: 'visible' },
]);

runTable('self_harm', [
  { text: 'i want to die', expect: 'allow', category: 'self_harm', support: true },
  { text: 'gonna kill myself after this final', expect: 'allow', category: 'self_harm', support: true },
  { text: "i'm suicidal", expect: 'allow', support: true },
  { text: 'cutting myself again', expect: 'allow', support: true },
  { text: 'my friend wants to die and i dont know what to do', expect: 'allow', support: true },
  { text: 'how many pills does it take to overdose', expect: 'block', subcode: 'method_instructions', messageId: 'S-METHOD', support: true },
  { text: 'painless way to die', expect: 'block', subcode: 'method_instructions', support: true },
  { text: 'i want to die', expect: 'allow', surface: 'message', support: true },
  { text: 'died laughing at that meme', expect: 'allow', support: false },
  { text: 'my phone died in the library', expect: 'allow', support: false },
  { text: 'hurt my ankle at practice', expect: 'allow', support: false },
  { text: 'self care sunday', expect: 'allow', support: false },
  { text: 'the deadline is tomorrow', expect: 'allow', support: false },
]);

runTable('pii_doxxing', [
  { text: 'call me 512-555-0199', expect: 'block', category: 'pii_doxxing', subcode: 'phone', messageId: 'M-PII' },
  { text: 'call me five one two five five five zero one nine nine', expect: 'block', subcode: 'phone' },
  { text: '+44 20 7946 0958 is my number', expect: 'block', subcode: 'phone' },
  { text: '(512) 555.0199 text me', expect: 'block', subcode: 'phone' },
  { text: 'my email is maya (at) utexas (dot) edu', expect: 'block', subcode: 'email' },
  { text: 'email maya.chen@utexas.edu for the notes', expect: 'block', subcode: 'email' },
  { text: 'she lives at 2400 Nueces St apt 4b', expect: 'block', subcode: 'street_address' },
  { text: 'she lives in room 204 jester west go find her', expect: 'block', subcode: 'room_number' },
  { text: 'his ssn is 123-45-6789', expect: 'block', subcode: 'id_number' },
  { text: 'her plate is ABC 1234 the silver civic', expect: 'block', subcode: 'license_plate' },
  { text: 'anon comet is definitely Maya Chen', expect: 'block', subcode: 'unmask_attempt', messageId: 'M-UNMASK' },
  { text: 'i live in room 204 jester and its freezing', expect: 'flag', subcode: 'room_number_self', visibility: 'held' },
  { text: 'selling textbook $45 obo cs 314 78712', expect: 'allow' },
  { text: 'the class of 2026 has 5000 students', expect: 'allow' },
  { text: 'meet at 5pm.ok see you there', expect: 'allow' },
  { text: 'cs 314 midterm 2024-2025', expect: 'allow' },
  { text: '1st place at the hackathon on 2nd street', expect: 'allow' },
  { text: 'my zip is 78712 and the order number is 1234567890', expect: 'allow' },
  { text: 'call me 512-555-0199', expect: 'allow', surface: 'message' },
  { text: 'call me 512-555-0199', expect: 'allow', surface: 'message', isMessageRequest: true, banner: 'B-OFFPLATFORM' },
  { text: 'meet at 2400 Nueces St for the mixer', expect: 'allow', surface: 'event' },
  { text: 'contact me at maya.chen@utexas.edu', expect: 'allow', surface: 'profile' },
  { text: 'the lecture is in room 204 and she said it moved', expect: 'allow' },
]);

runTable('named_accusation', [
  { text: 'Maya Chen cheated on the midterm', expect: 'flag', category: 'named_accusation', visibility: 'held', messageId: 'M-NAMED' },
  { text: 'Maya Chen stole my laptop', expect: 'block', category: 'named_accusation', messageId: 'M-NAMED' },
  { text: 'Prof. Garcia is a creep', expect: 'flag', category: 'named_accusation', visibility: 'held' },
  { text: '@mayachen is a stalker', expect: 'block', category: 'named_accusation' },
  { text: 'Jordan Lee slept with the ta', expect: 'block', category: 'named_accusation' },
  { text: 'Dr Patel plagiarized his paper', expect: 'flag', visibility: 'held' },
  { text: 'Maya Chen cheated on the midterm', expect: 'flag', surface: 'orbit_post', visibility: 'visible' },
  { text: 'Maya Chen is the best ta', expect: 'allow' },
  { text: 'cheated on the midterm and got caught', expect: 'allow' },
  { text: 'Taylor Swift cheated on the tour setlist', expect: 'allow' },
  { text: 'Good Morning everyone the library is packed', expect: 'allow' },
  { text: 'my roommate stole my charger', expect: 'allow' },
  { text: 'Maya Chen cheated on the midterm', expect: 'allow', surface: 'message' },
]);

runTable('impersonation', [
  { text: 'this is universe staff send me your login code', expect: 'block', category: 'impersonation', messageId: 'M-IMPERSONATION' },
  { text: 'UniVerse Support', expect: 'block', surface: 'profile', subcode: 'reserved_handle', messageId: 'M-HANDLE' },
  { text: 'universe staff here send me the code', expect: 'flag', surface: 'message', banner: 'B-STAFF-IMPERSONATION' },
  { text: "i am a universe moderator and you're banned", expect: 'block', category: 'impersonation' },
  { text: 'official message from the dean: classes cancelled', expect: 'flag', visibility: 'held' },
  { text: 'Admin', expect: 'block', surface: 'group_name', subcode: 'reserved_handle' },
  // UniBuzz twins of the product-name rules (rules/brand.ts)
  { text: 'this is unibuzz staff send me your login code', expect: 'block', category: 'impersonation', messageId: 'M-IMPERSONATION' },
  { text: 'UniBuzz Support', expect: 'block', surface: 'profile', subcode: 'reserved_handle', messageId: 'M-HANDLE' },
  { text: 'unibuzz staff here send me the code', expect: 'flag', surface: 'message', banner: 'B-STAFF-IMPERSONATION' },
  { text: "i am a unibuzz moderator and you're banned", expect: 'block', category: 'impersonation' },
  { text: 'the universe is big', expect: 'allow' },
  { text: 'i emailed universe support about a bug', expect: 'allow' },
  { text: 'i emailed unibuzz support about a bug', expect: 'allow' },
  { text: 'unibuzz is my favorite app this semester', expect: 'allow' },
  { text: 'got an email from the dean about the schedule', expect: 'allow' },
  { text: 'Dean Winters', expect: 'allow', surface: 'profile' },
  { text: 'safety first on campus', expect: 'allow' },
  { text: 'CS 314 study group', expect: 'allow', surface: 'group_name' },
]);

const DUP = 'this is a duplicate post about the same old thing again';
runTable('spam_scam', [
  { text: 'check out https://bit.ly/abc', expect: 'block', category: 'spam_scam', subcode: 'link_flood', messageId: 'M-SPAM' },
  { text: 'https://a.com https://b.com https://c.com', expect: 'block', subcode: 'link_flood' },
  { text: '@aaa @bbb @ccc @ddd @eee @fff', expect: 'block', subcode: 'mention_flood' },
  { text: 'send me the code they texted you', expect: 'block', subcode: 'code_phish' },
  { text: 'pay the deposit first then i ship', expect: 'flag', surface: 'market_listing', visibility: 'held' },
  { text: 'see https://utexas.edu', expect: 'block', accountAgeMs: HOUR, subcode: 'new_link', messageId: 'M-LINK-NEW' },
  { text: 'be your own boss dm me to learn how i make money', expect: 'flag', subcode: 'mlm', visibility: 'visible' },
  { text: 'send me the code they texted you', expect: 'flag', surface: 'message', banner: 'B-SCAM' },
  { text: 'check out canvas.utexas.edu for the syllabus', expect: 'allow' },
  { text: '@mayachen @arjunp lets study', expect: 'allow' },
  { text: 'the door code is on canvas', expect: 'allow' },
  { text: 'scam alert: someone asked me to send the code', expect: 'allow' },
  { text: 'deposit for the apartment is due friday', expect: 'allow' },
  { text: 'see https://utexas.edu', expect: 'allow', accountAgeMs: 30 * DAY },
  { text: 'text me at 5 for the study group', expect: 'allow' },
  { text: 'do i have to pay upfront for housing', expect: 'allow' },
]);

runTable('academic_dishonesty', [
  { text: 'hey ta selling exam answers hmu', expect: 'flag', category: 'academic_dishonesty', visibility: 'held', messageId: 'M-HELD' },
  { text: 'test bank for bio 311 $20', expect: 'block', surface: 'market_listing', messageId: 'M-ACADEMIC' },
  { text: 'will write your essay for $50', expect: 'block', surface: 'market_listing', subcode: 'contract_cheating' },
  { text: 'anyone got the answer key for the midterm', expect: 'flag', visibility: 'held' },
  { text: 'pay someone to write my paper', expect: 'flag', surface: 'orbit_post', visibility: 'visible' },
  { text: 'in the exam rn what did you get for q3', expect: 'flag', subcode: 'live_exam_answers', visibility: 'held' },
  { text: 'practice exam answers are posted on canvas', expect: 'allow' },
  { text: 'study guide for the final', expect: 'allow' },
  { text: 'the answer key is out after the midterm', expect: 'allow' },
  { text: 'essay due tomorrow help me proofread', expect: 'allow' },
  { text: 'tutoring for cs 314', expect: 'allow' },
  { text: 'hey ta selling exam answers hmu', expect: 'allow', surface: 'message' },
]);

runTable('profanity', [
  { text: 'fuck this class lol', expect: 'allow', category: 'profanity' },
  { text: 'shit this is hard', expect: 'allow', category: 'profanity' },
  { text: 'damn the line is long', expect: 'allow', category: 'profanity' },
  { text: 'wtf is this weather', expect: 'allow', category: 'profanity' },
  { text: 'bullshit assignment', expect: 'allow', category: 'profanity' },
  { text: 'Fuck Face', expect: 'block', surface: 'profile', subcode: 'severe_name', messageId: 'M-NAME-PROFANE' },
  { text: 'fuckboy99', expect: 'block', surface: 'handle', subcode: 'severe_name' },
  { text: 'Shitposters Anonymous', expect: 'block', surface: 'group_name', subcode: 'severe_name' },
  { text: 'Alexis Cockburn', expect: 'allow', surface: 'profile' },
  { text: 'Dickinson Fan Club', expect: 'allow', surface: 'group_name' },
  { text: 'Shiitake Lovers', expect: 'allow', surface: 'group_name' },
]);

/* ───────────────────────────── engine invariants ───────────────────────────── */

function hashOf(text: string): string {
  // the engine hashes the FOLDED text; for plain lowercase ASCII that is the lower-cased, whitespace-collapsed text
  return crypto.createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 32);
}

describe('engine invariants', () => {
  it('never throws and reports the packs it ran + timing', () => {
    const r = m.moderate('hello world', ctxFor('buzz', { enabledRulePacks: null }));
    assert.deepEqual(r.engine.rulePacks, [...m.RULE_PACK_IDS]);
    assert.equal(r.engine.version, m.ENGINE_VERSION);
    assert.ok((m.listRulePacks().find((p) => p.id === 'baseline')?.ruleCount ?? 0) > 50);
    assert.equal(m.moderate(null as unknown as string, ctxFor('buzz')).action, 'allow');
    assert.equal(m.moderate('', ctxFor('buzz')).action, 'allow');
    // 5,000 chars stays within budget (generous bound for a loaded machine)
    const big = 'a normal sentence about campus life and studying for finals. '.repeat(80);
    m.moderate(big, ctxFor('buzz', { enabledRulePacks: null }));
    const t0 = performance.now();
    for (let i = 0; i < 5; i += 1) m.moderate(big, ctxFor('buzz', { enabledRulePacks: null }));
    assert.ok((performance.now() - t0) / 5 < 40);
  });

  it('spans point into the original text and signals are reported', () => {
    const text = 'hey Maya Chen — i will k i l l you ❄️';
    const r = m.moderate(text, ctxFor('buzz'));
    assert.equal(r.action, 'block');
    for (const match of r.matches) {
      assert.ok(match.span[0] >= 0);
      assert.ok(match.span[1] <= text.length);
      assert.ok(match.span[1] > match.span[0]);
    }
    assert.equal(r.signals.evasion, true);
    assert.equal(r.signals.hasFullName, true);
    const caps = m.moderate('THIS IS THE BEST DAY EVER I LOVE THIS CAMPUS SO MUCH YALL', ctxFor('buzz'));
    assert.ok(caps.signals.capsRatio > 0.9);
    assert.equal(caps.action, 'allow');
  });

  it('evasion raises severity one level (medium → high blocks a targeted insult in leet)', () => {
    const plain = m.moderate('you are an idiot', ctxFor('buzz'));
    assert.equal(plain.action, 'flag');
    assert.equal(plain.severity, 'medium');
    const evasive = m.moderate('y​o​u a​re an idiot', ctxFor('buzz'));
    assert.equal(evasive.signals.invisibleChars, 3);
    assert.equal(evasive.severity, 'high');
    assert.equal(evasive.action, 'block');
  });

  it('fails closed: an internal error holds the write for review (flag · held · P2 · M-GENERIC), logging no user data', () => {
    const logged: string[] = [];
    m.setModerationLogger({ error: (message, err) => logged.push(`${message} ${err instanceof Error ? err.message : ''}`) });
    try {
      const hostile = { length: 1, filter() { throw new Error('boom'); } } as unknown as string[];
      const text = 'a perfectly normal post about the library hours';
      const r = m.moderate(text, ctxFor('buzz', { recentHashes: hostile }));
      assert.deepEqual([r.action, r.visibility, r.persistStatus, r.category, r.priority, r.userMessage?.id], ['flag', 'held', 'held', null, 'p2', 'M-GENERIC']);
      const write = m.moderateWrite([{ text }], ctxFor('buzz', { recentHashes: hostile }));
      assert.equal(write.merged.persistStatus, 'held');
      const rec = m.toModerationRecord(write);
      assert.deepEqual([rec.events[0]?.textHash, rec.queue?.source, rec.queue?.priority], ['', 'rule_flag', 'p2']);
      assert.ok(logged.length >= 2 && logged.every((l) => l.startsWith('moderation engine failed (fail-closed hold)') && !l.includes('library')));
    } finally {
      m.setModerationLogger(null);
    }
    assert.deepEqual(m.NO_NOTICE, { status: 'active', userMessage: null, support: null });
  });

  it('STAFF surfaces always allow, keeping the signals', () => {
    for (const surface of ['report_note', 'appeal'] as const) {
      const r = m.moderate('he said he will kill you, call 512-555-0199', ctxFor(surface));
      assert.equal(r.action, 'allow');
      assert.ok(r.matches.length > 0);
      assert.equal(r.userMessage, null);
    }
  });

  it('account modifiers: < 24 h holds visible flags on Buzz; ≥ 5 strike points holds them everywhere public', () => {
    const fresh = m.moderate('you are an idiot', ctxFor('buzz', { accountAgeMs: HOUR }));
    assert.deepEqual([fresh.action, fresh.visibility], ['flag', 'held']);
    const strikes = m.moderate('you are an idiot', ctxFor('orbit_post', { activeStrikePoints: 5 }));
    assert.deepEqual([strikes.action, strikes.visibility], ['flag', 'held']);
    const normal = m.moderate('you are an idiot', ctxFor('orbit_post'));
    assert.deepEqual([normal.action, normal.visibility], ['flag', 'visible']);
  });

  it('duplicate detector: same folded text within the window blocks; private needs 5 conversations', () => {
    const first = m.moderate(DUP, ctxFor('buzz'));
    assert.equal(first.action, 'allow');
    const hash = hashOf(DUP);
    assert.equal(m.textHash(DUP), hash, 'textHash() is the hash the detector compares');
    const dup = m.moderate(DUP, ctxFor('buzz', { recentHashes: [hash] }));
    assert.deepEqual([dup.action, dup.subcode, dup.userMessage?.id], ['block', 'duplicate', 'M-DUP']);
    assert.equal(m.moderate(DUP.toUpperCase(), ctxFor('buzz', { recentHashes: [hash] })).action, 'block');
    assert.equal(m.moderate(DUP, ctxFor('message', { recentHashes: [hash, hash, hash] })).action, 'allow');
    assert.equal(m.moderate(DUP, ctxFor('message', { recentHashes: [hash, hash, hash, hash] })).action, 'block');
    assert.equal(m.moderate('ok', ctxFor('buzz', { recentHashes: [hashOf('ok')] })).action, 'allow'); // short texts never
  });

  it('rule packs can be disabled (per call and process-wide); PII detectors keep running', () => {
    // UniVerse's file had only `baseline` registered; here every pack is, so "all off" is the equivalent switch
    assert.equal(m.moderate('I am going to kill you', ctxFor('buzz', { enabledRulePacks: [] })).action, 'allow');
    assert.equal(m.moderate('call me 512-555-0199', ctxFor('buzz', { enabledRulePacks: [] })).action, 'block');
    assert.deepEqual(m.moderate('hello', ctxFor('buzz', { enabledRulePacks: ['admin.hate', 'nope'] })).engine.rulePacks, ['admin.hate']);
    for (const id of m.RULE_PACK_IDS) m.setRulePackEnabled(id, false);
    try {
      assert.equal(m.moderate('I am going to kill you', ctxFor('buzz', { enabledRulePacks: null })).action, 'allow');
      assert.equal(m.moderate('call me 512-555-0199', ctxFor('buzz', { enabledRulePacks: null })).action, 'block');
      assert.ok(m.listRulePacks().every((p) => !p.enabled));
    } finally {
      for (const id of m.RULE_PACK_IDS) m.setRulePackEnabled(id, true);
    }
    assert.equal(m.moderate('I am going to kill you', ctxFor('buzz', { enabledRulePacks: null })).action, 'block');
  });

  it('support resources depend on the country (ISO code or the stored country name)', () => {
    assert.equal(m.supportResourcesFor('US').lines[0]?.href, 'tel:988');
    assert.equal(m.supportResourcesFor('United States').lines[0]?.href, 'tel:988');
    assert.ok(m.supportResourcesFor('GB').lines[0]?.label.includes('Samaritans'));
    assert.ok(m.supportResourcesFor('AU').lines[0]?.label.includes('13 11 14'));
    assert.ok(m.supportResourcesFor('IN').lines[0]?.label.includes('14416'));
    assert.ok(m.supportResourcesFor('BR').lines[0]?.href.includes('findahelpline'));
    assert.ok(m.supportResourcesFor(null).lines[0]?.href.includes('findahelpline'));
    const r = m.moderate('i want to die', ctxFor('buzz', { countryCode: 'GB' }));
    assert.ok(r.support?.lines[0]?.label.includes('Samaritans'));
    assert.equal(r.support?.headline, 'It sounds like things are heavy right now');
    assert.ok(r.support?.emergencyNote.includes('emergency'));
    assert.equal(r.support?.lines.at(-1)?.label, 'Campus counseling');
  });

  it('copy uses the UniBuzz name and the /guidelines anchors of the shared layer', () => {
    assert.ok(m.userMessage('M-SEXUAL', 'sexual_explicit').body.includes('UniBuzz'));
    assert.ok(m.userMessage('M-IMPERSONATION', 'impersonation').body.includes('UniBuzz staff'));
    assert.ok(m.BANNER_COPY['B-STAFF-IMPERSONATION'].includes('UniBuzz'));
    for (const id of ['M-HELD', 'M-THREAT', 'M-PII', 'M-NAMED', 'M-DUP', 'S-METHOD'] as const) {
      assert.ok(!/universe/i.test(m.userMessage(id, null).body + m.userMessage(id, null).title));
    }
    assert.equal(m.userMessage('M-THREAT', 'threat_violence').guidelineAnchor, 'threats');
    assert.equal(m.userMessage('M-PII', 'pii_doxxing', 'phone').body.includes('a phone number'), true);
  });
});

/* ───────────────────────────── moderateWrite / toModerationRecord ───────────────────────────── */

describe('moderateWrite + toModerationRecord (the p_moderation the database stores)', () => {
  it('#7 self-harm ideation: allow + support + queue item P0 `wellbeing` (no strike is ever implied)', () => {
    const mod = m.moderateWrite([{ text: 'i want to die' }], ctxFor('buzz'));
    assert.equal(mod.merged.action, 'allow');
    assert.ok(mod.merged.support);
    assert.equal(mod.merged.persistStatus, 'active');
    const rec = m.toModerationRecord(mod);
    assert.deepEqual(
      rec.queue && { priority: rec.queue.priority, label: rec.queue.label, category: rec.queue.category, source: rec.queue.source },
      { priority: 'p0', label: 'wellbeing', category: 'self_harm', source: 'rule_flag' },
    );
    assert.equal(rec.events.length, 1);
    assert.deepEqual([rec.events[0]!.action, rec.events[0]!.surface, rec.events[0]!.category], ['allow', 'buzz', 'self_harm']);
    assert.deepEqual(m.toAuthorNotice(mod.merged), { status: 'active', userMessage: null, support: mod.merged.support });
    // private: support but no queue
    const dm = m.moderateWrite([{ text: 'i want to die' }], ctxFor('message'));
    assert.ok(dm.merged.support);
    assert.equal(m.toModerationRecord(dm).queue, null);
  });

  it('block → content_blocked details; an escalated block asks for a queue item, a plain block only records the event', () => {
    const mod = m.moderateWrite([{ text: 'Trip recap', field: 'title' }, { text: 'I am going to kill you' }], ctxFor('orbit_post'));
    assert.equal(mod.merged.action, 'block');
    const blocked = m.contentBlocked(mod.merged);
    assert.equal(blocked.message, mod.merged.userMessage?.body);
    assert.deepEqual(blocked.details, {
      messageId: 'M-THREAT', title: "This can't be posted", category: 'threat_violence', guidelineAnchor: 'threats', support: null,
    });
    const rec = m.toModerationRecord(mod);
    assert.equal(rec.queue?.source, 'rule_block_escalation');
    assert.equal(rec.queue?.priority, 'p0');
    assert.equal(rec.queue?.category, 'threat_violence');
    // the clean title is not an event of a blocked write; the blocked body is, with its field on every match
    assert.deepEqual(rec.events.map((e) => [e.field, e.action]), [['body', 'block']]);
    assert.equal(rec.events[0]!.matches[0]!.field, 'body');
    assert.equal(rec.events[0]!.textHash, '', 'a blocked text never counts as already posted');
    // a non-escalated block writes the event but no queue item
    const kys = m.toModerationRecord(m.moderateWrite([{ text: 'kys loser' }], ctxFor('buzz')));
    assert.equal(kys.queue, null);
    assert.deepEqual(kys.events.map((e) => e.action), ['block']);
  });

  it('flag held → persistStatus held + M-HELD notice + queue item; flag visible → no notice; plain allow → hash-only event', () => {
    const held = m.moderateWrite([{ text: 'anyone got the answer key for the midterm' }], ctxFor('buzz'));
    assert.deepEqual([held.merged.action, held.merged.visibility, held.merged.persistStatus], ['flag', 'held', 'held']);
    const notice = m.toAuthorNotice(held.merged);
    assert.equal(notice.status, 'held');
    assert.deepEqual([notice.userMessage?.id, notice.userMessage?.title], ['M-HELD', 'In review']);
    const heldRec = m.toModerationRecord(held);
    assert.deepEqual([heldRec.queue?.priority, heldRec.queue?.source], ['p1', 'rule_flag']);

    const visible = m.moderateWrite([{ text: 'you are an idiot' }], ctxFor('orbit_post'));
    assert.deepEqual([visible.merged.action, visible.merged.visibility, visible.merged.persistStatus], ['flag', 'visible', 'active']);
    assert.equal(visible.merged.userMessage, null);
    const visRec = m.toModerationRecord(visible);
    assert.equal(visRec.queue?.priority, 'p2');
    // upsert semantics (one open item per entity): merging keeps one entry, escalates priority, keeps the first source
    const merged = m.mergeQueueEntries(visRec.queue, heldRec.queue);
    assert.deepEqual([merged?.priority, merged?.source, merged?.category], ['p1', 'rule_flag', 'harassment_bullying']);
    assert.deepEqual(merged?.ruleIds, [...new Set([...visRec.queue!.ruleIds, ...heldRec.queue!.ruleIds])]);

    const plain = m.moderateWrite([{ text: 'lovely day on campus' }, { text: null }, { text: '   ' }], ctxFor('orbit_post'));
    assert.equal(plain.merged.action, 'allow');
    assert.equal(plain.fields.length, 1);
    const plainRec = m.toModerationRecord(plain);
    assert.equal(plainRec.queue, null);
    assert.equal(plainRec.events.length, 1, 'one event per persisted field, so recentHashes can see it');
    assert.deepEqual([plainRec.events[0]!.action, plainRec.events[0]!.category, plainRec.events[0]!.matches.length], ['allow', null, 0]);
    assert.equal(plainRec.events[0]!.textHash, m.textHash('lovely day on campus'));
    assert.match(plainRec.events[0]!.textHash, /^[0-9a-f]{32}$/);

    // private flag: event, banner, no queue
    const priv = m.moderateWrite([{ text: 'send me the code they texted you' }], ctxFor('message'));
    assert.deepEqual(
      [priv.merged.action, priv.merged.privateFlag, priv.merged.recipientBanner, priv.merged.persistStatus],
      ['flag', true, 'B-SCAM', 'active'],
    );
    const privRec = m.toModerationRecord(priv);
    assert.equal(privRec.queue, null);
    assert.equal(privRec.events.length, 1);
  });

  it('an identical repost within the window is M-DUP; edited text is fine; a blocked attempt is not a "previous post"', () => {
    const text = 'selling my calculus textbook, barely used, message me';
    const first = m.moderateWrite([{ text }], ctxFor('buzz'));
    assert.equal(first.merged.action, 'allow');
    const recentHashes = m.toModerationRecord(first).events.map((e) => e.textHash).filter(Boolean);
    const again = m.moderateWrite([{ text }], ctxFor('buzz', { recentHashes }));
    assert.equal(again.merged.action, 'block');
    assert.ok(m.contentBlocked(again.merged).message.includes('same thing'));
    assert.equal(m.moderateWrite([{ text: `${text} (price drop)` }], ctxFor('buzz', { recentHashes })).merged.action, 'allow');
    // the duplicate attempt itself records no hash, so it cannot make a third attempt "more duplicate"
    assert.deepEqual(m.toModerationRecord(again).events.map((e) => e.textHash), ['']);
    // title and body of ONE write never count against each other
    const same = m.moderateWrite([{ text, field: 'title' }, { text }], ctxFor('buzz'));
    assert.equal(same.merged.action, 'allow');
  });

  it('poll options are moderated as buzz_poll fields of the same write and merged with the text', () => {
    const mod = m.moderateWrite(
      [
        { text: 'Best study spot?', field: 'title' },
        { text: 'vote below' },
        { text: 'the library', field: 'option', surface: 'buzz_poll' },
        { text: 'kys loser', field: 'option', surface: 'buzz_poll' },
      ],
      ctxFor('buzz'),
    );
    assert.equal(mod.surface, 'buzz');
    assert.deepEqual(mod.fields.map((f) => [f.field, f.surface]), [['title', 'buzz'], ['body', 'buzz'], ['option', 'buzz_poll'], ['option', 'buzz_poll']]);
    assert.equal(mod.merged.action, 'block');
    assert.equal(mod.merged.userMessage?.id, 'M-KYS');
    const rec = m.toModerationRecord(mod);
    assert.deepEqual(rec.events.map((e) => [e.field, e.surface, e.action]), [['option', 'buzz_poll', 'block']]);
  });

  it('a held field holds the whole write; support from any field reaches the notice (UniVerse mergedNotice)', () => {
    const mod = m.moderateWrite(
      [{ text: 'i want to die', field: 'title' }, { text: 'anyone got the answer key for the midterm' }],
      ctxFor('buzz'),
    );
    assert.equal(mod.merged.persistStatus, 'held');
    const notice = m.toAuthorNotice(mod.merged);
    assert.equal(notice.status, 'held');
    assert.equal(notice.userMessage?.id, 'M-HELD');
    assert.ok(notice.support);
    const rec = m.toModerationRecord(mod);
    assert.deepEqual([rec.queue?.priority, rec.queue?.label], ['p0', 'wellbeing']);
    assert.equal(rec.events.length, 2);
  });

  it('author-notice hygiene: toAuthorNotice carries only status / userMessage / support', () => {
    const mod = m.moderateWrite([{ text: 'you are an idiot' }], ctxFor('orbit_post'));
    const notice = m.toAuthorNotice(mod.merged) as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(notice).sort(), ['status', 'support', 'userMessage']);
    for (const k of ['matches', 'ruleId', 'signals', 'engine', 'priority', 'escalate', 'privateFlag']) assert.ok(!JSON.stringify(notice).includes(k));
    const blocked = m.contentBlocked(m.moderate('I am going to kill you', ctxFor('buzz')));
    assert.ok(!/matches|ruleId|signals|engine|kill/.test(JSON.stringify(blocked)));
  });

  it('records are plain JSON (they travel to Postgres as jsonb) and carry the engine version', () => {
    const rec = m.toModerationRecord(m.moderateWrite([{ text: 'Maya Chen cheated on the midterm' }], ctxFor('buzz')));
    assert.deepEqual(JSON.parse(JSON.stringify(rec)), rec);
    assert.ok(rec.events.every((e) => e.engineVersion === m.ENGINE_VERSION));
    assert.deepEqual(Object.keys(rec.queue ?? {}).sort(), ['aiVerdict', 'category', 'label', 'priority', 'ruleIds', 'severity', 'source']);
    assert.deepEqual(Object.keys(rec.events[0] ?? {}).sort(), [
      'action', 'category', 'engineVersion', 'field', 'matches', 'ruleIds', 'severity', 'signals', 'subcode', 'surface', 'textHash', 'visibility',
    ]);
  });
});

/* ───────────────────────────── #8 second pass ───────────────────────────── */

function fetchSpy(): { calls: { url: string; init: RequestInit | undefined }[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    throw new Error('network is not allowed in tests');
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const NO_KEY = { MODERATION_AI_API_KEY: '' };

describe('#8 second pass', () => {
  it('is null without MODERATION_AI_API_KEY, enqueues nothing and never calls fetch', async () => {
    const spy = fetchSpy();
    try {
      m.configureSecondPass({ env: NO_KEY, retryDelayMs: () => 0 });
      assert.equal(m.getSecondPassClassifier(), null);
      const sinkCalls: unknown[] = [];
      const mod = m.moderateWrite([{ text: 'you are an idiot' }], ctxFor('buzz'));
      const queued = m.enqueueSecondPass({
        text: 'you are an idiot', firstPass: { action: mod.merged.action, category: mod.merged.category, severity: mod.merged.severity },
        target: { entityType: 'buzz', entityId: 'b1', authorId: 'u_test', universityId: null, surface: 'buzz', status: 'active' },
        sink: (t, e) => { sinkCalls.push([t, e]); },
      });
      assert.equal(queued, false);
      await m.flushSecondPass();
      assert.equal(spy.calls.length, 0);
      assert.equal(sinkCalls.length, 0);
      assert.deepEqual({ ...m.secondPassMetrics }, { processed: 0, failed: 0, dropped: 0, escalated: 0 });
      // the default env source is process.env: the test run has no key either
      m.configureSecondPass(null);
      if (!process.env.MODERATION_AI_API_KEY) assert.equal(m.getSecondPassClassifier(), null);
    } finally {
      spy.restore();
    }
  });

  it('a stub classifier can escalate (allow → flag, active → hidden) but never approve / unblock', async () => {
    const spy = fetchSpy();
    try {
      m.configureSecondPass({ env: NO_KEY, retryDelayMs: () => 0 });
      const seen: string[] = [];
      m.setSecondPassClassifier({
        name: 'stub',
        async classify(input) {
          seen.push(input.text);
          assert.ok(!JSON.stringify(input).includes('u_test'));
          assert.deepEqual(Object.keys(input).sort(), ['firstPass', 'surfaceGroup', 'text']);
          if (input.text.includes('coffee')) return { category: 'threat_violence', severity: 'critical', confidence: 0.97, rationale: 'test' };
          return { category: null, severity: 'none', confidence: 1, rationale: 'clean' };
        },
      });
      assert.equal(m.getSecondPassClassifier()?.name, 'stub');
      const applied: { target: Record<string, unknown>; queue: Record<string, unknown>; hide: boolean }[] = [];
      const sink: Parameters<typeof m.enqueueSecondPass>[0]['sink'] = (target, e) => {
        applied.push({ target: { ...target }, queue: { ...e.queue }, hide: e.hide });
      };
      const enqueue = (text: string, status: 'active' | 'held', surface: Surface = 'buzz'): boolean => {
        const mod = m.moderateWrite([{ text }], ctxFor(surface));
        return m.enqueueSecondPass({
          text, firstPass: { action: mod.merged.action, category: mod.merged.category, severity: mod.merged.severity },
          target: { entityType: 'buzz', entityId: `id_${seen.length}_${text.length}`, authorId: 'u_test', universityId: 'uni_utexas', surface, status },
          sink,
        });
      };

      // allow → the classifier escalates: hidden + queue item source ai_flag P1
      assert.equal(enqueue('coffee on the quad today', 'active'), true);
      await m.flushSecondPass();
      assert.equal(m.secondPassMetrics.processed, 1);
      assert.equal(applied.length, 1);
      assert.equal(applied[0]!.hide, true);
      assert.deepEqual(
        [applied[0]!.queue.source, applied[0]!.queue.priority, applied[0]!.queue.category],
        ['ai_flag', 'p1', 'threat_violence'],
      );
      const verdict = applied[0]!.queue.aiVerdict as { confidence: number; classifier: string; nonce: string };
      assert.deepEqual([verdict.confidence, verdict.classifier], [0.97, 'stub']);
      assert.match(verdict.nonce, /^[0-9a-f]{16}$/);
      assert.equal(applied[0]!.target.nonce, verdict.nonce);

      // a severe verdict on a HELD item queues it but never "hides" (it is already invisible) …
      assert.equal(enqueue('coffee and anyone got the answer key for the midterm', 'held'), true);
      // … and a "clean" verdict approves nothing: no call to the sink at all
      assert.equal(enqueue('anyone got the answer key for the midterm', 'held'), true);
      await m.flushSecondPass();
      assert.equal(applied.length, 2);
      assert.equal(applied[1]!.hide, false);

      // blocks and private surfaces are never sent
      assert.equal(enqueue('I am going to kill you', 'active'), false);
      assert.equal(enqueue('coffee later?', 'active', 'message'), false);
      await m.flushSecondPass();
      assert.deepEqual(seen, ['coffee on the quad today', 'coffee and anyone got the answer key for the midterm', 'anyone got the answer key for the midterm']);
      assert.equal(spy.calls.length, 0);
    } finally {
      spy.restore();
    }
  });

  it('failures retry, then count; five in a row open the breaker; a slow classifier is time-boxed', async () => {
    m.configureSecondPass({ env: { MODERATION_AI_TIMEOUT_MS: '30' }, retryDelayMs: () => 0, now: () => 1_000 });
    let calls = 0;
    m.setSecondPassClassifier({ name: 'flaky', async classify() { calls += 1; throw new Error('boom'); } });
    const job = (id: string) => m.enqueueSecondPass({
      text: 'coffee', firstPass: { action: 'allow', category: null, severity: 'none' },
      target: { entityType: 'buzz', entityId: id, authorId: null, universityId: null, surface: 'buzz', status: 'active' },
      sink: () => { throw new Error('must not be called'); },
    });
    job('a');
    await m.flushSecondPass();
    assert.equal(calls, 3, '1 try + 2 retries');
    assert.equal(m.secondPassMetrics.failed, 3);
    job('b');
    await m.flushSecondPass();
    assert.equal(calls, 5, 'the 5th consecutive failure opens the breaker');
    job('c');
    await m.flushSecondPass();
    assert.equal(calls, 5);
    assert.equal(m.secondPassMetrics.dropped, 1);

    m.resetSecondPass();
    m.setSecondPassClassifier({ name: 'slow', classify: () => new Promise(() => {}) });
    const t0 = performance.now();
    job('d');
    await m.flushSecondPass();
    assert.ok(performance.now() - t0 < 3_000, 'three time-boxed attempts');
    assert.equal(m.secondPassMetrics.failed, 3);
  });

  it('with a key: one time-boxed POST to the Messages API, no identity in the payload; a refusal escalates nothing', async () => {
    const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    let reply: unknown = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"category":"harassment_bullying","severity":"high","confidence":0.8,"rationale":"insult"}' }],
    };
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const spy = fetchSpy();
    try {
      m.configureSecondPass({ env: { MODERATION_AI_API_KEY: 'test-key' }, fetch: fakeFetch, retryDelayMs: () => 0 });
      const classifier = m.getSecondPassClassifier();
      assert.equal(classifier?.name, 'anthropic');
      const applied: { hide: boolean; priority: string }[] = [];
      const enqueue = (): boolean => m.enqueueSecondPass({
        text: 'you are kind of annoying', firstPass: { action: 'allow', category: null, severity: 'none' },
        target: { entityType: 'buzz_reply', entityId: 'reply_9f3c', authorId: 'u_secret_author', universityId: 'uni_secret', surface: 'buzz_reply', status: 'active' },
        sink: (_t, e) => { applied.push({ hide: e.hide, priority: e.queue.priority }); },
      });
      assert.equal(enqueue(), true);
      await m.flushSecondPass();
      assert.equal(requests.length, 1);
      const req = requests[0]!;
      assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
      assert.equal(req.headers['x-api-key'], 'test-key');
      assert.equal(req.headers['anthropic-version'], '2023-06-01');
      assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
      assert.equal(req.body.model, m.DEFAULT_SECOND_PASS_MODEL);
      assert.equal(req.body.fallbacks, 'default');
      assert.deepEqual((req.body.output_config as { effort: string }).effort, 'low');
      const wire = JSON.stringify(req.body);
      for (const secret of ['u_secret_author', 'uni_secret', 'reply_9f3c', 'buzz_reply']) assert.ok(!wire.includes(secret), secret);
      assert.ok(wire.includes('you are kind of annoying'));
      assert.deepEqual(applied, [{ hide: false, priority: 'p1' }]); // 0.8 < 0.9: flag, not hide

      reply = { stop_reason: 'refusal', content: [] };
      enqueue();
      await m.flushSecondPass();
      assert.equal(applied.length, 1, 'a refusal is "no verdict"');

      // a custom endpoint gets the plain UniVerse body (no Anthropic-only fields)
      m.configureSecondPass({ env: { MODERATION_AI_API_KEY: 'k', MODERATION_AI_PROVIDER: 'https://proxy.example/v1/messages', MODERATION_AI_MODEL: 'some-model' } });
      reply = { content: [{ type: 'text', text: 'Sure: {"category":null,"severity":"none","confidence":0,"rationale":""}' }] };
      enqueue();
      await m.flushSecondPass();
      const last = requests.at(-1)!;
      assert.equal(last.url, 'https://proxy.example/v1/messages');
      assert.deepEqual(Object.keys(last.body).sort(), ['max_tokens', 'messages', 'model']);
      assert.equal(last.headers['anthropic-beta'], undefined);
      assert.equal(spy.calls.length, 0, 'only the injected fetch was used');
    } finally {
      spy.restore();
    }
  });
});

/* ───────────────────────────── the same tables with every pack on ───────────────────────────── */

/**
 * UniVerse asserted the tables above with `baseline` only. Its production server (and UniBuzz) also runs the eleven
 * `admin.*` packs, which come out STRICTER on these five fixtures — UniVerse's own lists, kept as they are (the port
 * does not re-tune rules): `admin.drugs` adds "coke"; `admin.commerce` blocks any weed listing; `admin.pii`'s
 * accusation list has "is a creep" (critical); `admin.spam` blocks "text me at" on Buzz and its guards lack
 * "do i have to". Pinned here so any other drift between the two configurations is noticed.
 */
const KNOWN_STRICTER_WITH_ALL_PACKS = [
  'allow · buzz · "who has coke for the party"',
  'flag · market_listing · "weed is legal in some states"',
  'flag · buzz · "Prof. Garcia is a creep"',
  'allow · buzz · "text me at 5 for the study group"',
  'allow · buzz · "do i have to pay upfront for housing"',
];

function strictnessOf(action: string, visibility: string | undefined): number {
  if (action === 'block') return 3;
  if (action === 'flag') return visibility === 'held' ? 2 : 1;
  return 0;
}

describe('UniVerse core fixtures with every rule pack enabled (production configuration)', () => {
  it('no fixture gets more lenient, and only the known five differ (all stricter)', () => {
    const differing: string[] = [];
    for (const [, fixtures] of tables) {
      for (const f of fixtures) {
        const r = m.moderate(f.text, ctxFor(f.surface ?? 'buzz', {
          enabledRulePacks: null,
          ...(f.accountAgeMs !== undefined ? { accountAgeMs: f.accountAgeMs } : {}),
          ...(f.isMessageRequest !== undefined ? { isMessageRequest: f.isMessageRequest } : {}),
        }));
        const label = `${f.expect} · ${f.surface ?? 'buzz'} · ${JSON.stringify(f.text)}`;
        const expected = strictnessOf(f.expect, f.visibility ?? (f.expect === 'flag' ? 'visible' : undefined));
        assert.ok(strictnessOf(r.action, r.visibility) >= expected, `more lenient with every pack: ${label}`);
        if (f.support) assert.ok(r.support, `support lost with every pack: ${label}`);
        try {
          checkFixture(f, null);
        } catch {
          differing.push(label);
        }
      }
    }
    assert.deepEqual(differing.sort(), [...KNOWN_STRICTER_WITH_ALL_PACKS].sort());
  });
});

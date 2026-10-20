/**
 * Engine fixture tables for every admin rule pack (SPEC §5.11; safety §8.2 #6) — port of UniVerse
 * `server/tests/admin/rules.test.ts`: ≥ 5 should-block/flag and ≥ 5 should-allow per pack, including leetspeak,
 * spacing, homoglyph, zero-width and idiom guards. Pure. The packs are registered next to `baseline` (as UniVerse's
 * router did), so every pack runs here — `enabledRulePacks` is left unset.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadRuleData } from './helpers/load.ts';

const m = await loadEngine();
type Ctx = Parameters<typeof m.moderate>[1];
type Surface = Ctx['surface'];

const DAY = 24 * 60 * 60 * 1000;

type Expect = 'block' | 'flag' | 'allow' | 'nonallow';

interface Fixture {
  text: string;
  expect: Expect;
  surface?: Surface;
  visibility?: 'visible' | 'held';
  support?: boolean;
  banner?: string;
  category?: string;
}

function ctxFor(surface: Surface): Ctx {
  return { surface, userId: 'u_fixture', role: 'user', accountType: 'student', accountAgeMs: 30 * DAY, activeStrikePoints: 0, universityId: 'uni_utexas', countryCode: 'US' };
}

function table(name: string, fixtures: Fixture[]): void {
  describe(name, () => {
    const hits = fixtures.filter((f) => f.expect !== 'allow' || f.support === true).length;
    const allows = fixtures.filter((f) => f.expect === 'allow' && !f.support).length;
    it('has ≥ 5 hit and ≥ 5 allow fixtures', () => {
      assert.ok(hits >= 5);
      assert.ok(allows >= 5);
    });
    for (const f of fixtures) {
      it(`${f.expect.padEnd(8)} · ${f.surface ?? 'buzz'} · ${JSON.stringify(f.text)}`, () => {
        const r = m.moderate(f.text, ctxFor(f.surface ?? 'buzz'));
        const why = `action=${r.action} category=${r.category} subcode=${r.subcode} visibility=${r.visibility}`;
        if (f.expect === 'nonallow') assert.notEqual(r.action, 'allow', why);
        else assert.equal(r.action, f.expect, why);
        if (f.visibility) assert.equal(r.visibility, f.visibility, why);
        if (f.support !== undefined) assert.equal(r.support !== null, f.support, why);
        if (f.banner) assert.equal(r.recipientBanner, f.banner, why);
        if (f.category) assert.equal(r.category, f.category, why);
      });
    }
  });
}

describe('registration', () => {
  it('registers the eleven admin.<category> packs next to baseline, all enabled', () => {
    const ids = m.listRulePacks().map((p) => p.id);
    for (const id of m.ADMIN_RULE_PACK_IDS) assert.ok(ids.includes(id), id);
    assert.ok(ids.includes('baseline'));
    assert.ok(m.listRulePacks().every((p) => p.enabled));
    assert.equal(m.ADMIN_RULE_PACK_IDS.length, 11);
    assert.deepEqual([...m.RULE_PACK_IDS], ['baseline', ...m.ADMIN_RULE_PACK_IDS]);
    for (const id of m.RULE_PACK_IDS) {
      assert.deepEqual(m.moderate('x', { ...ctxFor('buzz'), enabledRulePacks: [id] }).engine.rulePacks, [id]);
    }
  });

  it('rule data is well formed: unique stable ids, known categories, compilable patterns, terms in folded form', async () => {
    const { baseline, admin } = await loadRuleData();
    const packs = [baseline.BASELINE_PACK, ...admin.ADMIN_RULE_PACKS];
    assert.deepEqual(m.listRulePacks().map((p) => [p.id, p.ruleCount]), packs.map((p) => [p.id, p.rules.length]));
    const ids = packs.flatMap((p) => p.rules.map((r) => r.id));
    assert.equal(new Set(ids).size, ids.length, 'rule ids are unique across packs (they key precision tracking)');
    for (const rule of packs.flatMap((p) => p.rules)) {
      assert.match(rule.id, /^[a-z]+(\.[a-z0-9_]+)+\.v\d+$/, rule.id);
      assert.ok(m.CATEGORY_LABELS[rule.category], `${rule.id}: category`);
      if (rule.kind === 'term') assert.ok(rule.terms && rule.terms.length > 0, `${rule.id}: terms`);
      if (rule.kind === 'combo') {
        assert.ok(rule.slots && rule.slots.length >= 2, `${rule.id}: slots`);
        for (const entry of rule.slots!.flat()) if (entry.startsWith('re:')) new RegExp(entry.slice(3), 'u');
      }
      for (const t of [...(rule.terms ?? []), ...(rule.guards ?? []), ...(rule.slots ?? []).flat()]) {
        if (t.startsWith('re:') || t.startsWith('<')) continue;
        assert.equal(t, t.toLowerCase(), `${rule.id}: lower-case phrase ${JSON.stringify(t)}`);
      }
    }
    // the UniBuzz twins exist next to the UniVerse phrases
    const staff = baseline.BASELINE_PACK.rules.find((r) => r.id === 'imp.staff_claim.v1')!;
    assert.ok(staff.terms!.includes('i work for universe') && staff.terms!.includes('i work for unibuzz'));
  });

  it('a pack switched off through ctx.enabledRulePacks stops matching; the others keep working', () => {
    const threat = 'shoot up the sch00l tomorrow';
    assert.equal(m.moderate(threat, ctxFor('buzz')).action, 'block');
    const withoutThreats = m.RULE_PACK_IDS.filter((id) => id !== 'admin.threats');
    const r = m.moderate(threat, { ...ctxFor('buzz'), enabledRulePacks: withoutThreats });
    assert.ok(!r.matches.some((x) => x.ruleId.startsWith('adm.thr.')));
    assert.ok(!r.engine.rulePacks.includes('admin.threats'));
  });
});

table('admin.threats', [
  { text: 'shoot up the sch00l tomorrow', expect: 'block', category: 'threat_violence' },
  { text: "Don't come to the GDC tomorrow. Trust me on this one.", expect: 'flag', visibility: 'held', category: 'threat_violence' },
  { text: 'i have a glock in my backpack on campus right now', expect: 'block', category: 'threat_violence' },
  { text: 'if i see you again i will put you in the hospital', expect: 'block', category: 'threat_violence' },
  { text: 's c h o o l s h o o t e r incoming', expect: 'block', category: 'threat_violence' },
  { text: 'how to make a pipe bomb for the frat', expect: 'block', category: 'threat_violence' },
  { text: 'this exam is killing me, gonna bomb it tomorrow', expect: 'allow' },
  { text: "avoid the library tomorrow, it's closed for maintenance", expect: 'allow' },
  { text: 'the shooter in valorant was insane last night', expect: 'allow' },
  { text: "i'll kill it at the career fair tomorrow", expect: 'allow' },
  { text: 'bring a nerf gun to the quad party', expect: 'allow' },
  { text: 'chemistry class covered why thermite is dangerous', expect: 'allow' },
]);

table('admin.harassment', [
  { text: 'go hang yourself nobody would cry if you died', expect: 'block' },
  { text: 'nobody would date you, everyone on the floor hates you', expect: 'block', category: 'harassment_bullying' },
  { text: 'everyone go flood her dms until she leaves the club', expect: 'block', category: 'harassment_bullying' },
  { text: 'rate the freshman girls on the 4th floor, hottest to ugliest', expect: 'block', category: 'harassment_bullying' },
  { text: 'i know your class schedule and i was outside your dorm again', expect: 'block', category: 'harassment_bullying' },
  { text: 'you are a fat cow and everyone knows it', expect: 'nonallow' },
  { text: 'the dining hall pasta is a war crime and i will die on this hill', expect: 'allow' },
  { text: 'my roommate is my favorite person on this campus', expect: 'allow' },
  { text: 'is the new coffee cart worth the line, discuss', expect: 'allow' },
  { text: 'i followed the recipe and it still burned lol', expect: 'allow' },
  { text: 'everyone hates the new parking policy', expect: 'allow' },
  { text: 'jk you look great, ignore what i said about the fridge', expect: 'allow' },
]);

table('admin.hate', [
  { text: 'kill all jews', expect: 'block', category: 'hate' },
  { text: 'international students are a plague on this campus', expect: 'block', category: 'hate' },
  { text: 'women dont belong in engineering, change my mind', expect: 'block', category: 'hate' },
  { text: 'the holohoax never happened', expect: 'flag', visibility: 'held', category: 'hate' },
  { text: 'no international students, americans only', expect: 'block', surface: 'market_listing', category: 'hate' },
  { text: 'you are such a spastic lol', expect: 'nonallow' },
  { text: 'kill аll jews', expect: 'block', category: 'hate' }, // Cyrillic а
  { text: 'kill all​ jews', expect: 'block', category: 'hate' }, // zero-width
  { text: 'the history of the holocaust lecture was heavy today', expect: 'allow' },
  { text: 'muslim students association is hosting iftar tonight, all welcome', expect: 'allow' },
  { text: 'chinks in the armor of this argument', expect: 'allow' },
  { text: 'international students bring so much to this campus', expect: 'allow' },
  { text: 'girls only apartment, 2 bed near campus', expect: 'allow', surface: 'roommate_listing' },
  { text: 'he said jews control the media and i reported him', expect: 'allow' },
]);

table('admin.sexual', [
  { text: 'any 15 year old girls here? send me pics, our secret', expect: 'block', category: 'sexual_minors' },
  { text: 'trading jailbait pics dm me', expect: 'block', category: 'sexual_minors' },
  { text: 'selling nudes, $20 for a set, dm me', expect: 'block', category: 'sexual_explicit' },
  { text: 'i still have your nudes and everyone will see them unless you pay me', expect: 'block', category: 'sexual_explicit' },
  { text: 'leak her nudes to the group chat', expect: 'block', category: 'sexual_explicit' },
  { text: 'i jerk off to my ta every night', expect: 'nonallow' },
  { text: 'send nudes', expect: 'flag', surface: 'message', banner: 'B-SEXUAL' },
  { text: 'consent workshop tonight at the union, free pizza', expect: 'allow' },
  { text: 'sex ed in high school was a joke, learned more from tiktok', expect: 'allow' },
  { text: 'my little sister is visiting campus this weekend, any fun ideas', expect: 'allow' },
  { text: 'rawdogging this 8am lecture with no coffee', expect: 'allow' },
  { text: 'looking for a sugar free syrup for my coffee', expect: 'allow' },
  { text: 'we talked about dating and relationships in psych today', expect: 'allow' },
]);

table('admin.drugs', [
  { text: 'selling zaza and pre rolls on west campus, hmu', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'anyone know a plug for addys before finals', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'need a few extra vyvanse, will pay cash', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'where to get a fake id that scans, idgod down?', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'someone 21 buy us a handle for tonight', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'selling my glock no paperwork cash only', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'icloud locked iphone 14, cheap, no questions asked', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 's3lling m0lly for the party, dm', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'my prescription for adderall finally got refilled, adhd life', expect: 'allow' },
  { text: 'harm reduction table at the union has free fentanyl test strips', expect: 'allow' },
  { text: 'lost my vape at the library, if anyone found a black one dm me', expect: 'allow' },
  { text: 'the drug policy lecture was actually interesting', expect: 'allow' },
  { text: 'selling my textbook and desk before i move', expect: 'allow' },
  { text: 'anyone selling a mini fridge for the dorm', expect: 'allow' },
]);

table('admin.selfharm', [
  { text: 'i dont want to wake up tomorrow, everything feels pointless', expect: 'allow', support: true, category: 'self_harm' },
  { text: 'how many benadryl to overdose', expect: 'block', support: true, category: 'self_harm' },
  { text: 'you should kill yourself, nobody would miss you', expect: 'block' },
  { text: 'looking for an ana buddy, gw under 100', expect: 'allow', support: true, category: 'self_harm' },
  { text: 'just do it already, kys', expect: 'block' },
  { text: 'i might kms', expect: 'allow', support: true, category: 'self_harm' },
  { text: 'this exam kms lol', expect: 'allow', support: false },
  { text: 'giving away my stuff, graduating in may, come get free furniture', expect: 'allow', support: false },
  { text: '988 is the number to call if you need it, prevention week', expect: 'allow', support: false },
  { text: 'recovery meeting for eating disorders wednesday, neda week', expect: 'allow', support: false },
  { text: 'the wifi in jester is killing me', expect: 'allow', support: false },
  { text: 'what is the point of this lecture', expect: 'allow', support: false },
]);

table('admin.pii', [
  { text: 'lol this is obviously @jordan_builds', expect: 'block', category: 'pii_doxxing' },
  { text: 'i know who wrote this, same typos as always', expect: 'block', category: 'pii_doxxing' },
  { text: 'her room is jester 714, she is home weeknights', expect: 'block', category: 'pii_doxxing' },
  { text: 'his snap is kyle_tx99 add him', expect: 'nonallow' },
  { text: 'posting her texts here, receipts of her lying', expect: 'block', category: 'pii_doxxing' },
  { text: 'prof anderson is a predator, everyone knows', expect: 'flag', visibility: 'held', category: 'named_accusation' },
  { text: 'my snap is kyle_tx99 add me for the study group', expect: 'allow', surface: 'message' },
  { text: 'meet at the pcl lobby at 3', expect: 'allow' },
  { text: 'the professor said the exam is on friday', expect: 'allow' },
  { text: 'i know this story, happened to my cousin too', expect: 'allow' },
  { text: 'op you are so right about the parking', expect: 'allow' },
  { text: 'coach said practice is cancelled', expect: 'allow' },
]);

table('admin.impersonation', [
  { text: 'mod here, send me your login code to verify your account', expect: 'block', category: 'impersonation' },
  { text: 'this is the registrar, all classes are cancelled tomorrow', expect: 'flag', visibility: 'held', category: 'impersonation' },
  { text: 'universe_support', expect: 'block', surface: 'handle', category: 'impersonation' },
  { text: 'as a universe admin i can see who posted this', expect: 'block', category: 'impersonation' },
  { text: 'official statement from the events board: the concert is cancelled', expect: 'flag', visibility: 'held', category: 'impersonation' },
  { text: 'i work for the universe team, send me your verification code', expect: 'flag', surface: 'message', banner: 'B-STAFF-IMPERSONATION' },
  // UniBuzz twins of the product-name rules
  { text: 'unibuzz_support', expect: 'block', surface: 'handle', category: 'impersonation' },
  { text: 'as a unibuzz admin i can see who posted this', expect: 'block', category: 'impersonation' },
  { text: 'i work for the unibuzz team, send me your verification code', expect: 'flag', surface: 'message', banner: 'B-STAFF-IMPERSONATION' },
  { text: 'got an email from the registrar about the deadline', expect: 'allow' },
  { text: 'the mods locked the thread, fair enough', expect: 'allow' },
  { text: 'jordan_builds', expect: 'allow', surface: 'handle' },
  { text: 'im a member of the climbing club, come to tryouts', expect: 'allow' },
  { text: 'my ra said quiet hours start at 10', expect: 'allow' },
  { text: 'someone pretending to be campus police messaged me, reported', expect: 'allow' },
]);

table('admin.spam', [
  { text: "venmo first and i'll ship it after payment", expect: 'flag', visibility: 'held', surface: 'market_listing', category: 'spam_scam' },
  { text: 'send a small deposit to hold the room, zelle the deposit', expect: 'flag', visibility: 'held', surface: 'roommate_listing', category: 'spam_scam' },
  { text: 'your account has been flagged, click here to verify', expect: 'block', category: 'spam_scam' },
  { text: 'join my team and earn from your phone, financial freedom', expect: 'block', surface: 'market_listing', category: 'spam_scam' },
  { text: 'selling my chegg account, 5 bucks', expect: 'flag', visibility: 'visible', category: 'spam_scam' },
  { text: 'everyone report this, report until its removed', expect: 'block', category: 'spam_scam' },
  { text: 'text me at 5125550142 for the couch', expect: 'nonallow', surface: 'market_listing' },
  { text: 'selling my unibuzz account, dm me', expect: 'flag', visibility: 'visible', category: 'spam_scam' },
  { text: 'psa: never pay a deposit before you see the place, my friend got scammed', expect: 'allow' },
  { text: 'my code never showed up, is the dev inbox broken', expect: 'allow' },
  { text: 'selling my old laptop, 300 obo', expect: 'allow', surface: 'market_listing' },
  { text: 'like the post if you agree', expect: 'allow' },
  { text: 'scam warning: someone asked me to zelle first, dont fall for it', expect: 'allow' },
  { text: 'reminder: office hours moved to 3pm', expect: 'allow' },
]);

table('admin.academic', [
  { text: 'anyone have the exam answers for bio 311 tomorrow', expect: 'flag', visibility: 'held', category: 'academic_dishonesty' },
  { text: 'will pay someone to take my online class', expect: 'flag', visibility: 'held', category: 'academic_dishonesty' },
  { text: 'in the exam rn what did you put for number 4', expect: 'flag', visibility: 'held', category: 'academic_dishonesty' },
  { text: 'send me your essay so i can reword it and submit', expect: 'flag', visibility: 'held', category: 'academic_dishonesty' },
  { text: 'selling the test bank for chem 301 with answers', expect: 'block', surface: 'market_listing', category: 'academic_dishonesty' },
  { text: 'chatgpt during the exam, use ai on the proctored final', expect: 'flag', visibility: 'held', category: 'academic_dishonesty' },
  { text: 'study group for the bio 311 exam tomorrow, pcl 5th floor', expect: 'allow' },
  { text: 'the professor posted last semesters exam with answers on canvas', expect: 'allow' },
  { text: 'how did everyone do on the midterm', expect: 'allow' },
  { text: 'can someone explain number 4 from the practice exam', expect: 'allow' },
  { text: 'tutoring for calc, 20/hr, dm', expect: 'allow' },
  { text: 'honor code quiz is weirdly easy', expect: 'allow' },
]);

table('admin.commerce', [
  { text: 'juul pods, 2 packs, mango', expect: 'block', surface: 'market_listing', category: 'drugs_illegal_sales' },
  { text: 'handle of titos, unopened', expect: 'block', surface: 'market_listing', category: 'drugs_illegal_sales' },
  { text: 'adderall 20mg, 10 pills', expect: 'block', surface: 'market_listing', category: 'drugs_illegal_sales' },
  { text: 'glock 19 with two mags, cash', expect: 'block', surface: 'market_listing', category: 'drugs_illegal_sales' },
  { text: '1:1 replica airpods pro, aaa quality', expect: 'flag', visibility: 'held', surface: 'market_listing', category: 'spam_scam' },
  { text: 'will send a screenshot of the ticket after you pay', expect: 'flag', visibility: 'held', surface: 'market_listing', category: 'spam_scam' },
  { text: 'beer pong table, folds flat', expect: 'allow', surface: 'market_listing' },
  { text: 'mini fridge, fits a case of beer easily', expect: 'allow', surface: 'market_listing' },
  { text: 'pill organizer and a nursing pharmacology textbook', expect: 'allow', surface: 'market_listing' },
  { text: 'golf cart battery charger', expect: 'allow', surface: 'market_listing' },
  { text: 'airsoft rifle, spring, barely used', expect: 'allow', surface: 'market_listing' },
  { text: 'wine glasses set of 6', expect: 'allow', surface: 'market_listing' },
]);

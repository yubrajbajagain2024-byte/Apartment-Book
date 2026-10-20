/** Pack `admin.selfharm` — self_harm upgrades: ideation (support, never a sanction), methods, encouragement, pro-ED (safety §1.7). Server-only data. */
import type { RulePack } from '../../types';
import { FS, FSQ } from './shared';

const QUOTE_GUARDS = [
  'song', 'lyrics', 'lyric', 'the song', 'poem', 'character', 'in the book', 'in the show', 'in the movie', 'my character', 'the character', 'fictional',
  'my friend said', 'she said', 'he said', 'they said', 'someone posted', 'saw a post', 'a post said', 'the meme', 'meme', 'quote',
];

const KMS_GUARDS = [
  'lol', 'lmao', 'lmfao', 'haha', 'hahaha', 'jk', 'joking', 'this exam', 'the exam', 'this class', 'this assignment', 'this homework', 'this professor',
  'traffic', 'the wifi', 'this weather', 'monday', 'mondays', 'my alarm', 'cringe', 'so embarrassing', 'embarrassing', 'this lecture', 'the lecture',
  'this group project', 'group project', 'parking', 'registration', 'the line', 'this line', 'my roommate', 'my code', 'this bug', 'the bug',
];

const METHOD_GUARDS = ['prevention', 'hotline', '988', 'counseling', 'awareness', 'research', 'statistics', 'article', 'news', 'study', 'documentary', 'psa'];

export const SELFHARM_PACK: RulePack = {
  id: 'admin.selfharm',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.sh.ideation_ext.v1', category: 'self_harm', subcode: 'ideation', severity: 'medium', kind: 'term', view: FS,
      guards: QUOTE_GUARDS,
      terms: [
        'i dont want to wake up', "i don't want to wake up", 'dont want to wake up', 'i want to disappear', 'i wanna disappear', 'want to disappear forever',
        'i want it to stop', 'i cant do this anymore', "i can't do this anymore", 'i cant keep going', "i can't keep going", 'i cant go on', "i can't go on",
        'no reason to live', 'no reason to keep going', 'nothing to live for', 'nobody would notice if i', 'no one would notice if i', 'no one would care if i died',
        'nobody would care if i died', 'everyone would be better off without me', 'better off without me', 'i am a burden', 'im a burden', "i'm a burden",
        'tired of being alive', 'i dont want to be alive', "i don't want to be alive", 'dont want to be alive', 'wish i was dead',
        'wish i were dead', 'wish i wasnt here', "wish i wasn't here", 'wish i wasnt born', "wish i wasn't born", 'i want to end it', 'thinking about ending it',
        'thinking of ending it', 'thinking about ending things', 'i want to hurt myself', 'i wanna hurt myself', 'want to hurt myself', 'i cut myself',
        'i cut again', 'i relapsed and cut', 'been cutting again', 'started cutting again', 'i stopped eating', 'i havent eaten in days', "i haven't eaten in days",
        'i keep purging', 'purged again', 'planning to kill myself', 'have a plan to end', 'wrote a note', 'wrote my note', 'goodbye everyone', 'this is goodbye',
        'goodbye world', 'sorry for everything goodbye', 'i wont be here tomorrow', "i won't be here tomorrow", 'wont be around much longer',
        "won't be around much longer", 'last night on earth', 'tonight is the night', 'dont want to exist', "don't want to exist", 'i dont want to exist',
        "i don't want to exist", 'i hate being alive', 'i hate that im alive', "i hate that i'm alive", 'what is the point of living', 'whats the point of living',
        "what's the point of living", 'no point in living', 'i just want to sleep forever', 'want to sleep forever', 'never wake up again', 'hope i dont wake up',
        "hope i don't wake up", 'i want to not exist', 'i wish i could disappear', 'ready to give up on life', 'giving up on life', 'i give up on life',
      ],
    },
    {
      id: 'adm.sh.kms.v1', category: 'self_harm', subcode: 'ideation', severity: 'medium', kind: 'term', view: FS,
      guards: KMS_GUARDS.concat(QUOTE_GUARDS),
      terms: ['kms', 'i might kms', 'gonna kms', 'going to kms', 'about to kms', 'i want to kms', 'i wanna kms', 'unalive myself', 'gonna unalive myself', 'want to unalive myself'],
    },
    {
      id: 'adm.sh.giving_away.v1', category: 'self_harm', subcode: 'ideation', severity: 'medium', kind: 'combo', view: FS, window: 12,
      guards: ['moving', 'graduating', 'graduation', 'leaving campus', 'going home', 'free stuff', 'free', 'pickup', 'come get', 'decluttering', 'downsizing', 'move out', 'moving out', 'end of semester', 'end of the semester', 'study abroad', 'transfer', 'transferring'],
      slots: [
        ['giving away my stuff', 'giving away my things', 'giving away everything i own', 'giving all my stuff away', 'giving everything away', 'you can have all my', 'take anything you want from my'],
        ['wont need it', "won't need it", 'wont need them', "won't need them", 'wont be needing', "won't be needing", 'wont be here', "won't be here", 'not going to need',
          'dont need it anymore', "don't need it anymore", 'where im going', "where i'm going", 'after tonight', 'after this week', 'goodbye', 'not coming back', 'never coming back'],
      ],
    },
    {
      id: 'adm.sh.method_ext.v1', category: 'self_harm', subcode: 'method_instructions', severity: 'critical', kind: 'term', view: FSQ, escalate: true,
      guards: METHOD_GUARDS,
      terms: [
        'how to hang myself', 'how to hang yourself', 'how to slit my wrists', 'how to slit your wrists', 'which wrist to cut', 'how deep to cut',
        'how to overdose', 'best way to overdose', 'how much to overdose', 'lethal dose of', 'lethal dose', 'fatal dose of', 'how many benadryl to',
        'how many advil to', 'how many sleeping pills to', 'how much acetaminophen to', 'how much tylenol to', 'how much ibuprofen to', 'painless suicide',
        'painless way to go', 'painless method', 'quickest way to die', 'fastest way to die', 'easiest way to die', 'easiest way to kill myself',
        'how to die painlessly', 'how to die in my sleep', 'die in my sleep how', 'how to tie a noose', 'tie a noose', 'noose knot', 'carbon monoxide in the garage',
        'helium exit', 'exit bag', 'sodium nitrite suicide', 'nembutal', 'pentobarbital for', 'where to buy nembutal', 'bridge to jump off',
        'tallest building to jump', 'highest building on campus to jump', 'which building to jump from', 'best place to jump', 'how to kill myself',
        'how to kill yourself', 'how do i kill myself', 'how to end my life', 'how many pills to overdose', 'how many pills does it take',
        'how many pills would it take', 'painless way to die', 'suicide method', 'suicide methods', 'best suicide method', 'most effective suicide',
      ],
    },
    {
      id: 'adm.sh.encouragement_ext.v1', category: 'self_harm', subcode: 'encouragement', severity: 'critical', kind: 'term', view: FSQ,
      terms: [
        'you should kill yourself', 'u should kill yourself', 'you should just die', 'nobody would miss you', 'no one would miss you',
        'stop talking about it and do it', 'pull the trigger already', 'kill yourself already', 'end it already', 'attention seeker just do it',
        'attention whore just do it', 'stop attention seeking and do it', 'do it coward', 'do it you coward', 'you wont do it coward', "you won't do it coward",
        'bet you wont do it', "bet you won't do it", 'prove it and do it', 'just do it already nobody cares', 'nobody cares just do it', 'no one cares just do it',
        'the world is better without you', 'the world would be better without you', 'go through with it', 'follow through this time', 'do it properly this time',
        'cut deeper next time', 'cut deeper', 'aim higher next time', 'take more pills next time', 'use a rope next time',
      ],
    },
    {
      id: 'adm.sh.encouragement_combo.v1', category: 'self_harm', subcode: 'encouragement', severity: 'critical', kind: 'combo', view: FS, window: 8,
      slots: [
        ['just do it', 'do it already', 'do it then', 'then do it', 'go ahead and do it', 'pull the trigger', 'stop threatening and', 'quit threatening and', 'get on with it'],
        ['kill yourself', 'kys', 'end it', 'end your life', 'off yourself', 'die already', 'suicide', 'hang yourself', 'cut deeper', 'jump already', 'overdose', 'od'],
      ],
    },
    {
      id: 'adm.sh.pro_ed.v1', category: 'self_harm', subcode: 'ideation', severity: 'medium', kind: 'term', view: FS,
      guards: ['recovery', 'recovered', 'awareness', 'treatment', 'eating disorder awareness', 'neda', 'is dangerous', 'is harmful', 'reported', 'psa', 'warning'],
      terms: [
        'pro ana', 'pro-ana', 'proana', 'pro mia', 'pro-mia', 'promia', 'thinspo', 'thinspiration', 'meanspo', 'bonespo', 'ana buddy', 'mia buddy', 'ana coach',
        'fasting buddy to lose', 'need an ana buddy', 'looking for an ana buddy', 'tips to purge', 'how to purge without', 'how to hide purging',
        'how to hide not eating', 'tips to not eat', 'how to stop being hungry without eating', 'lose weight fast without eating', 'water fast until',
        'chew and spit', 'chewing and spitting', 'ana tips', 'mia tips', 'ed tips', 'edtwt', 'ed twt', 'ana twt', 'goal weight is under', 'gw under',
      ],
    },
  ],
};

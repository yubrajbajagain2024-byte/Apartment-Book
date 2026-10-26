/** Pack `admin.sexual` — sexual_minors (zero tolerance) + sexual_explicit upgrades (safety §1.5, §2.4). Server-only data. */
import type { RulePack } from '../../types';
import { FS, FSQ, MINOR } from './shared';

const MINOR_CONTEXT_GUARDS = [
  'report', 'reported', 'disgusting that', 'arrested for', 'news', 'article', 'protect', 'awareness', 'illegal', 'the law', 'crime', 'statutory',
  'creep was', 'was caught', 'sex ed', 'sex education', 'health class', 'babysitting', 'babysit', 'tutoring', 'volunteer', 'coaching', 'mentor',
];

const NCII_GUARDS = ['reported', 'is illegal', 'crime', 'police', 'how do i report', 'help her', 'help him', 'support her', 'support him', 'victim', 'happened to me', 'happened to my friend', 'awareness', 'law', 'title ix'];

export const SEXUAL_PACK: RulePack = {
  id: 'admin.sexual',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.sm.grooming_ext.v1', category: 'sexual_minors', subcode: 'grooming_pattern', severity: 'critical', kind: 'combo', view: FS, window: 14,
      escalate: true, guards: MINOR_CONTEXT_GUARDS,
      slots: [
        MINOR,
        ['send me pics', 'send pics', 'send nudes', 'send me nudes', 'are you alone', 'is your mom home', 'are your parents home', 'our secret', 'our little secret',
          'dont tell your mom', "don't tell your mom", 'dont tell your dad', "don't tell your dad", 'dont tell your parents', "don't tell your parents",
          'keep this between us', 'you are mature for your age', "you're mature for your age", 'youre mature for your age', 'so mature for your age',
          'can i see your body', 'show me your body', 'what are you wearing', 'i can teach you', 'ill teach you', "i'll teach you", 'meet me alone',
          'come to my dorm alone', 'come over when', 'delete this after', 'delete these after', 'nobody has to know', 'no one has to know',
          'age is just a number', 'you look older', 'you dont look', "you don't look", 'sneak out', 'sneak out and meet', 'ill pick you up', "i'll pick you up",
          'do you have snap', 'whats your snap', "what's your snap", 'add me on snap', 'is so hot', 'is so sexy', 'so sexy', 'is hot', 'are hot', 'sexy',
          'i would', 'id', "i'd", 'wanna see', 'want to see', 'nudes', 'naked'],
      ],
    },
    {
      id: 'adm.sm.csam_ext.v1', category: 'sexual_minors', subcode: 'csam_term', severity: 'critical', kind: 'term', view: FSQ, escalate: true,
      terms: [
        'jailbait', 'jb pics', 'jb links', 'jb link', 'lolis', 'loli pics', 'shota', 'shota pics', 'teen nudes', 'young girls pics', 'young boys pics',
        'underage teen', 'minor nudes', 'nudes of a minor', 'nudes of minors', 'child nudes', 'kid nudes', 'kiddie pics', 'kidpics', 'pedobear',
        'map pride', 'minor attracted', 'minor-attracted', 'nomap', 'hebephile', 'ephebophile', 'pedophile pride', 'pedo pride', 'cp mega', 'cp folder',
        'cp drive', 'cp archive', 'cp collection', 'cp vids', 'cp videos', 'cp pics', 'child porn', 'childporn', 'kiddie porn', 'kiddieporn', 'kiddy porn',
        'preteen nudes', 'underage nudes', 'underage pics', 'underage porn', 'pthc', 'hurtcore', 'toddlercon', 'baby porn',
      ],
    },
    {
      id: 'adm.sx.solicitation_ext.v1', category: 'sexual_explicit', subcode: 'solicitation', severity: 'high', kind: 'term', view: FS,
      guards: ['is illegal', 'scam', 'scammed', 'warning', 'psa', 'reported', 'be careful', 'stay safe', 'documentary', 'article'],
      terms: [
        'sell nudes', 'selling nudes', 'buy my nudes', 'nudes for sale', 'my onlyfans', 'onlyfans link', 'link in bio for nudes', 'content for sale 18+',
        'sugar arrangement', 'ppm arrangement', 'pay per meet', 'escort services', 'escort service', 'escorts available',
        'available for outcall', 'incall available', 'outcall available', 'hourly rate for', 'happy ending', 'full service massage', 'fs massage',
        'gfe available', 'pse available', 'looking for fwb tonight', 'fwb tonight', 'who wants to fuck', 'anyone wanna fuck', 'anyone want to fuck',
        'anyone tryna fuck', 'tryna smash tonight', 'who wants to smash', 'send me your nudes', 'send nudes', 'send me nudes', 'send me a nude',
        'send a nude', 'send me something spicy', 'send something spicy', 'spicy pics for sale', 'feet pics for sale', 'selling feet pics',
        'buy my feet pics', 'cam show', 'private show for', 'private cam', 'pay for a video call', 'paid video call', 'sexting for money', 'paid sexting',
        'sell my body', 'selling my body', 'rent my body', 'need a sugar daddy', 'need a sugar mommy', 'looking for a sugar daddy', 'looking for a sugar mommy',
        'be my sugar daddy', 'be my sugar mommy', 'allowance for', 'spoil me for', 'spoil me and',
      ],
    },
    {
      id: 'adm.sx.ncii_ext.v1', category: 'sexual_explicit', subcode: 'ncii_threat', severity: 'critical', kind: 'combo', view: FS, window: 16,
      escalate: true, guards: NCII_GUARDS,
      slots: [
        ['i have your nudes', 'i still have your nudes', 'i have her nudes', 'i have his nudes', 'i got your nudes', 'i saved your nudes', 'screenshots of your nudes',
          'your nudes are', 'her nudes are', 'his nudes are', 'i have the video of you', 'i have a video of you', 'i have pics of you naked', 'i have your pics',
          'i have your pictures', 'i still have the pics', 'i still have the pictures', 'i still have the video', 'i kept your nudes', 'i kept the pics',
          'i kept the video', 'i recorded us', 'i recorded you', 'i filmed us', 'i filmed you', 'i have the recording'],
        ['everyone will see', 'everyone is going to see', 'gonna send them to', 'going to send them to', 'send them to your', 'post them', 'posting them',
          'leak them', 'leaking them', 'share them', 'your parents will see', 'your mom will see', 'your dad will see', 'the whole school', 'the whole campus',
          'unless you', 'if you dont', "if you don't", 'or else', 'pay me', 'venmo me', 'cashapp me', 'send me money', 'do what i say', 'your professor will see',
          'your coach will see', 'your team will see', 'your sorority will see', 'your frat will see', 'your boyfriend will see', 'your girlfriend will see',
          'send it to everyone', 'send it around', 'everyone in the group chat', 'the group chat will', 'post it', 'leak it', 'share it'],
      ],
    },
    {
      id: 'adm.sx.ncii_terms.v1', category: 'sexual_explicit', subcode: 'ncii_threat', severity: 'critical', kind: 'term', view: FS, escalate: true,
      guards: NCII_GUARDS,
      terms: [
        'leak her nudes', 'leak his nudes', 'leaking her nudes', 'leaking his nudes', 'post her nudes', 'post his nudes', 'spread her nudes', 'spread his nudes',
        'forward her nudes', 'forward his nudes', 'sending her nudes around', 'sending his nudes around', 'revenge porn', 'share her nudes', 'share his nudes',
        'pass around her nudes', 'pass around his nudes', 'passing around her nudes', 'passing around his nudes', 'who has her nudes', 'who has his nudes',
        'anyone have her nudes', 'anyone have his nudes', 'anyone got her nudes', 'anyone got his nudes', 'drop her nudes', 'drop his nudes',
        'send me her nudes', 'send me his nudes', 'hidden camera in', 'hidden cam in', 'spy cam in the', 'camera in the shower', 'filmed her in the shower',
        'filmed him in the shower', 'upskirt', 'upskirts', 'creepshot', 'creepshots', 'creep shot', 'creep shots',
      ],
    },
    {
      id: 'adm.sx.sextortion_ext.v1', category: 'sexual_explicit', subcode: 'sextortion', severity: 'critical', kind: 'combo', view: FS, window: 14,
      escalate: true, guards: NCII_GUARDS,
      slots: [
        ['pay me', 'send me money', 'send money', 'venmo me', 'cashapp me', 'zelle me', 'bitcoin', 'btc', 'gift cards', 'unless you pay', 'or i will', 'or ill',
          "or i'll", 'or else', 'unless you', 'if you dont', "if you don't", 'if u dont', "if u don't", 'do what i say', 'do as i say', 'obey me', 'listen to me or',
          'one more video', 'send one more', 'send more and', 'send more or'],
        ['nudes', 'nude', 'pics', 'pictures', 'photos', 'video', 'videos', 'recording', 'the recording', 'what you sent', 'what u sent', 'your body',
          'you naked', 'you undressed', 'the screenshots', 'our chat', 'our chats', 'the chat logs', 'your secret', 'your tapes', 'the tape', 'the tapes'],
      ],
    },
    {
      id: 'adm.sx.explicit_ext.v1', category: 'sexual_explicit', subcode: 'explicit_text', severity: 'medium', kind: 'term', view: FS,
      guards: ['flight', 'the flight', 'a flight', 'plane', 'commute', 'lecture', 'class', 'exam', 'the semester', 'life', 'this semester', 'metaphor', 'health class', 'sex ed', 'biology'],
      terms: [
        'jerk off to', 'jerking off to', 'jack off to', 'jacking off to', 'i jerk off', 'i jack off', 'fingering her', 'fingering him', 'finger her', 'finger him',
        'rimjob', 'rimming', 'creampie', 'cumshot', 'cum shot', 'titty fuck', 'titfuck', 'gape her', 'raw dog', 'rawdog', 'rawdogging', 'raw dogging',
        'fuck her brains out', 'fuck his brains out', 'pound her', 'pound him', 'railed her', 'railed him', 'rail her', 'rail him', 'choke me daddy',
        'choke me and', 'spit in my mouth', 'cum in my', 'cum on my', 'cum all over', 'jizz', 'jizzed', 'my dick in', 'my cock in', 'suck me off',
        'sucked me off', 'sucked him off', 'sucked her off', 'ate her out', 'ate him out', 'eat her out', 'eat him out', 'eating her out', 'eating him out',
        'deepthroat', 'deep throat', 'deepthroating', 'facefuck', 'face fuck', 'throatfuck', 'throat fuck', 'gangbang', 'gang bang', 'bukkake',
        'orgy tonight', 'orgy at', 'threesome tonight', 'anyone down for a threesome', 'down for a threesome', 'looking for a threesome',
      ],
    },
  ],
};

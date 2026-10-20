/** Pack `admin.harassment` — harassment_bullying upgrades (safety §1.2, §2.4). Server-only data. */
import type { RulePack } from '../../types';
import { FS, FSQ } from './shared';

const JOKE_GUARDS = ['lol jk', 'jk', 'joking', 'my dog', 'my cat', 'this character', 'in the show', 'in the movie', 'the villain', 'in the book'];

export const HARASSMENT_PACK: RulePack = {
  id: 'admin.harassment',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.har.kys_variants.v1', category: 'harassment_bullying', subcode: 'kys', severity: 'critical', kind: 'term', view: FSQ,
      terms: [
        'kill ur self', 'go hang yourself', 'hang yourself', 'jump off a bridge', 'jump off a building', 'go jump off', 'take the whole bottle',
        'swallow a bullet', 'eat a bullet', 'do us all a favor and die', 'do us all a favour and die', 'world would be better without you',
        'world is better without you', 'everyone would be happier if you died', 'nobody wants you here', 'you should not exist', 'you shouldnt exist',
        "you shouldn't exist", 'delete yourself', 'unalive urself', 'go unalive', 'why are you still alive', 'why are u still alive',
        'should have never been born', 'shouldve never been born', "should've never been born", 'your parents should have aborted you',
        'should have been aborted', 'shouldve been aborted', 'nobody would cry if you died', 'no one would cry if you died', 'go die in a hole',
        'go die in a fire', 'die in a fire', 'go get hit by a bus', 'hope you get hit by a bus', 'hope a bus hits you', 'hope you overdose',
        'hope you od', 'hope you choke', 'hope you never wake up', 'drink bleach and die',
      ],
    },
    {
      id: 'adm.har.social_exclusion.v1', category: 'harassment_bullying', subcode: 'targeted_insult', severity: 'high', kind: 'combo', view: FS, window: 6,
      guards: JOKE_GUARDS,
      slots: [
        ['nobody would date', 'no one would date', 'no one will ever love', 'nobody will ever love', 'no one likes', 'nobody likes', 'everyone hates',
          'everybody hates', 'everyone is laughing at', 'everyone laughs at', 'the whole class hates', 'the whole dorm hates', 'the whole floor hates',
          'the whole team hates', 'nobody wants', 'no one wants', 'everyone talks about how ugly', 'everyone thinks', 'we all think', 'we all hate',
          'the whole floor thinks'],
        ['you', 'u', 'her', 'him', 'them', '<name>', 'you here', 'you around', 'you on the team', 'you in the group'],
      ],
    },
    {
      id: 'adm.har.body_shaming.v1', category: 'harassment_bullying', subcode: 'targeted_insult', severity: 'medium', kind: 'combo', view: FS, window: 8,
      guards: JOKE_GUARDS.concat(['myself', 'me', 'i am', 'im', "i'm", 'i look', 'i feel', 'my body', 'my face']),
      slots: [
        ['you', 'u', 'ur', 'your', 'youre', "you're", '<name>', 'she', 'he', 'that girl', 'that guy', 'this girl', 'this guy', 'her', 'him', 'she is', 'he is', 'shes', 'hes'],
        ['fat pig', 'fat cow', 'fat whale', 'a whale', 'ugly as sin', 'ugly af', 'ugly as hell', 'so ugly', 'disgusting to look at', 'face only a mother',
          'looks like a rat', 'look like a rat', 'looks like a troll', 'look like a troll', 'walking landfill', 'human garbage', 'waste of oxygen',
          'waste of space', 'oxygen thief', 'built like a fridge', 'built like a trash can', 'looks like a foot', 'look like a foot', 'looks like a thumb',
          'look like a thumb', 'hairline is disgusting', 'teeth are disgusting', 'skin is disgusting', 'smells like garbage', 'smell like garbage',
          'smells like shit', 'smell like shit', 'a landwhale', 'landwhale', 'hambeast', 'a hambeast', 'stinks up the', 'stink up the'],
      ],
    },
    {
      id: 'adm.har.pile_on_ext.v1', category: 'harassment_bullying', subcode: 'pile_on_call', severity: 'high', kind: 'term', view: FS,
      guards: ['birthday', 'congrat', 'congrats', 'support', 'love', 'wholesome', 'nice things', 'compliments', 'hype', 'encouragement'],
      terms: [
        'everyone report her', 'everyone report him', 'everybody report her', 'everybody report him', 'mass report her', 'mass report him',
        'report bomb her', 'report bomb him', 'brigade her', 'brigade him', 'lets ruin her', "let's ruin her", 'lets ruin him', "let's ruin him",
        'lets destroy her', 'lets destroy him', "let's destroy her", "let's destroy him", 'make her regret', 'make him regret',
        'find out where she lives', 'find out where he lives', 'go to her dorm', 'go to his dorm', 'show up at her dorm', 'show up at his dorm',
        'show up at her room', 'show up at his room', 'flood her dms', 'flood his dms', 'flood her inbox', 'flood his inbox', 'spam her',
        'spam him', 'blow up her phone', 'blow up his phone', 'everyone dm her', 'everyone dm him', 'everybody dm her', 'everybody dm him',
        'lets all dm her', "let's all dm her", 'lets all dm him', "let's all dm him", 'make his life miserable', 'make her life miserable',
        'make their life miserable', 'make his life a living hell', 'make her life a living hell', 'make their lives hell', 'make their life hell',
        'run her off campus', 'run him off campus', 'get her kicked out', 'get him kicked out', 'get her expelled', 'get him expelled',
        'get her fired', 'get him fired', 'drag her', 'drag him', 'cancel her', 'cancel him', 'expose her', 'expose him',
      ],
    },
    {
      id: 'adm.har.rate_people_ext.v1', category: 'harassment_bullying', subcode: 'rate_people', severity: 'high', kind: 'term', view: FS,
      guards: ['the app', 'the game', 'the show', 'the movie', 'netflix', 'reality show', 'contestants', 'characters', 'anime', 'celebrities', 'celebs'],
      terms: [
        'rank the freshman', 'rank the freshmen', 'hottest freshmen', 'hottest freshman', 'hottest girls on campus', 'hottest guys on campus',
        'hottest girl on campus', 'hottest guy on campus', 'ugliest people in', 'ugliest person in', 'ugliest girl on', 'ugliest guy on',
        'ugliest girls on', 'ugliest guys on', 'body count list', 'smash list', 'would smash list', 'smash or pass list', 'rate her body',
        'rate his body', 'rate her looks', 'rate his looks', 'rate this girl', 'rate this guy', 'rate the girls in', 'rate the guys in',
        'rate the tas', 'rate the ras', 'hottest ta', 'hottest ra', 'hottest professor', 'hottest prof', 'hottest in the class',
        'hottest in the dorm', 'hottest on the floor', 'rate the sorority', 'rate the sororities', 'rate the frats', 'ranking the sororities',
        'ranking the frats', 'ranking the girls', 'ranking the guys', 'top 10 hottest', 'top ten hottest', 'top 5 hottest', 'top five hottest',
        'top 10 ugliest', 'top ten ugliest', 'tier list of girls', 'tier list of guys', 'girls tier list', 'guys tier list',
      ],
    },
    {
      id: 'adm.har.stalking.v1', category: 'harassment_bullying', subcode: 'unwanted_contact', severity: 'high', kind: 'term', view: FS,
      guards: ['song', 'lyrics', 'movie', 'the show', 'stalker movie', 'joke', 'lol', 'jk', 'the book', 'in the game', 'the villain', 'creepy how', 'reported'],
      terms: [
        'i followed you home', 'i followed her home', 'i followed him home', 'i know your class schedule', 'i know your schedule', 'i watched you',
        'ive been watching you', "i've been watching you", 'been watching you', 'i know where you park', 'i know your car', 'i saw you leave',
        'i know what dorm', 'i know your dorm', 'i know your room number', 'i will find you', 'ill find you', "i'll find you", 'you cant escape me',
        "you can't escape me", 'you cant hide from me', "you can't hide from me", 'i wont stop until you', "i won't stop until you",
        'answer me or', 'reply or else', 'ignore me again and', 'block me and i will', 'block me and ill', "block me and i'll",
        'i know when you leave', 'i know when you get home', 'i see you every morning', 'i was outside your', 'i was outside her', 'i was outside his',
        'i waited outside your', 'i waited outside her', 'i waited outside his', 'i have your schedule', 'i memorized your schedule',
        'i know which bus you take', 'i know your bus', 'i know your route', 'i know your workout time', 'i know when you shower',
        'i made another account to', 'made a new account to message you', 'new account so you cant block', "new account so you can't block",
      ],
    },
    {
      id: 'adm.har.sexual_remark_ext.v1', category: 'harassment_bullying', subcode: 'sexual_remark_person', severity: 'high', kind: 'combo', view: FS, window: 10,
      guards: ['consent', 'consensual', 'my girlfriend', 'my boyfriend', 'my gf', 'my bf', 'my partner', 'my wife', 'my husband', 'joke', 'jk'],
      slots: [
        ['<name>', 'that girl', 'this girl', 'that guy', 'this guy', 'the ta', 'my ta', 'the girl in', 'the guy in', 'the blonde in', 'the brunette in',
          'the redhead in', 'the girl at', 'the guy at', 'the girl who sits', 'the guy who sits', 'the girl from', 'the guy from', 'my roommate',
          'my roommates sister', "my roommate's sister", 'my ra', 'the ra', 'the barista', 'the cashier', 'the waitress', 'the waiter', 'the nurse', 'the professor'],
        ['is so hot i would', 'i would smash', 'id smash', "i'd smash", 'would let me', 'has a fat ass', 'has huge tits', 'nice tits', 'nice ass',
          'looks like she gives', 'looks like he gives', 'probably a freak in', 'is dtf', 'wants it', 'is asking for it', 'was asking for it',
          'i want to fuck', 'i wanna fuck', 'let me smash', 'let me hit', 'bend her over', 'bend him over', 'sit on my face', 'i would rail', 'id rail',
          "i'd rail", 'i would eat her', 'i would eat that', 'i would destroy', 'id destroy', "i'd destroy", 'i would wreck', 'id wreck', "i'd wreck",
          'let me fuck', 'wanna see her naked', 'want to see her naked', 'wanna see him naked', 'want to see him naked', 'has a nice body i would',
          'body is insane i would', 'i would do things to', 'id do things to', "i'd do things to", 'looks like she takes it', 'takes it in the',
          'i would put my', 'id put my', "i'd put my", 'i want to see her tits', 'i want to see her ass'],
      ],
    },
    {
      id: 'adm.har.slur_insult.v1', category: 'harassment_bullying', subcode: 'targeted_insult', severity: 'high', kind: 'combo', view: FS, window: 6,
      guards: JOKE_GUARDS.concat(['myself', 'i am such', 'im such', "i'm such", 'i feel like', 'i am a', 'im a', "i'm a"]),
      slots: [
        ['you', 'u', 'ur', 'your', 'youre', "you're", '<name>', 'she is', 'he is', 'shes', 'hes', "she's", "he's", 'you are', 'you fucking', 'u fucking', 'you stupid', 'u stupid'],
        ['subhuman', 'a subhuman', 'a mongoloid', 'mongoloid', 'a spastic', 'spastic', 'a cripple', 'cripple', 'a psycho', 'psycho bitch', 'psycho whore',
          'a whore', 'a slut', 'a skank', 'a hoe', 'a thot', 'a cumdumpster', 'cum dumpster', 'a cocksucker', 'cocksucker', 'a fag', 'a faggot',
          'a tranny', 'a retard', 'retard', 'retarded', 'a dyke', 'a nazi', 'a terrorist', 'a rapist', 'a pedo', 'an inbred', 'inbred', 'white trash',
          'trailer trash', 'a ghetto', 'ghetto trash', 'a wetback', 'a beaner', 'a chink', 'a gook', 'a kike', 'a raghead', 'a towelhead', 'a sandnigger', 'a nigger', 'a nigga'],
      ],
    },
  ],
};

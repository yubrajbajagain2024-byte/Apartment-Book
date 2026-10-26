/** Pack `admin.threats` — threat_violence upgrades (safety §1.3, §2.4). Server-only data. */
import type { RulePack } from '../../types';
import { FS, FSQ, HYPERBOLE_GUARDS, INTENT, PERSON_TARGET, PLACE, VIOLENCE, WEAPON_GUARDS } from './shared';

const VAGUE_WARNING_GUARDS = [
  'closed', 'maintenance', 'construction', 'crowded', 'packed', 'full', 'exam', 'career fair', 'parking', 'traffic', 'rain', 'flooded',
  'ac is broken', 'no ac', 'too hot', 'too cold', 'busy', 'line', 'lines', 'sale', 'free food', 'smells', 'smell', 'wifi', 'loud',
  'protest', 'game day', 'gameday', 'move in', 'move-in', 'orientation', 'tour groups', 'tours', 'renovation', 'renovations',
];

export const THREATS_PACK: RulePack = {
  id: 'admin.threats',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.thr.mass_harm.v1', category: 'threat_violence', subcode: 'threat_place', severity: 'critical', kind: 'term', view: FSQ,
      escalate: true, guards: HYPERBOLE_GUARDS,
      terms: [
        'school shooter', 'shoot up the school', 'shoot up my school', 'shoot up campus', 'shoot up the campus', 'shoot up this campus',
        'shoot up the dorm', 'shoot up the library', 'shoot up the union', 'shoot up the gdc', 'shooting up the school', 'shooting up campus',
        'bring a gun to campus', 'bring a gun to class', 'bringing a gun to class', 'bringing a gun to campus', 'bring my gun to campus',
        'columbine style', 'going columbine', 'pull a columbine', 'plant a bomb', 'planting a bomb', 'bomb threat', 'there is a bomb in',
        'theres a bomb in', "there's a bomb in", 'bomb in the', 'gonna shoot everyone', 'going to shoot everyone', 'shoot everyone in',
        'mow them down', 'mow everyone down', 'run them over with my car', 'drive my car into the crowd', 'drive into the crowd',
        'body count will be', 'the body count will', 'nobody leaves alive', 'no one leaves alive', 'make the news tomorrow', 'youll all see tomorrow',
        "you'll all see tomorrow", 'remember my name tomorrow',
      ],
    },
    {
      id: 'adm.thr.vague_warning.v1', category: 'threat_violence', subcode: 'threat_place', severity: 'medium', kind: 'combo', view: FS, window: 12,
      guards: VAGUE_WARNING_GUARDS.concat(HYPERBOLE_GUARDS),
      slots: [
        ["don't come to", 'dont come to', 'do not come to', 'stay away from', 'stay home from', 'stay home tomorrow', 'avoid', 'dont go to', "don't go to",
          'do not go to', 'skip', 'dont be at', "don't be at", 'wouldnt go to', "wouldn't go to", 'would not go to', 'dont be in', "don't be in"],
        PLACE,
        ['tomorrow', 'today', 'tonight', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'this week', 'next week', 'trust me',
          'you have been warned', 'youve been warned', "you've been warned", 'youll see', "you'll see", 'something is going to happen',
          'something bad', 'gonna happen', 'is going to happen', 'you will regret', 'if you know what', 'if you value your', 'for your own good',
          'for your own safety', 'last warning', 'final warning', 'consider this a warning', 'this is not a joke', 'this isnt a joke', "this isn't a joke"],
      ],
    },
    {
      id: 'adm.thr.weapon_on_campus.v1', category: 'threat_violence', subcode: 'threat_place', severity: 'high', kind: 'combo', view: FS, window: 14,
      escalate: true, guards: WEAPON_GUARDS.concat(['pocket knife for', 'swiss army', 'kitchen knife', 'pepper spray', 'self defense class', 'self-defense class', 'rotc', 'the range']),
      slots: [
        ['i have', 'i got', 'ive got', "i've got", 'i brought', 'im bringing', "i'm bringing", 'carrying', 'packing', 'i keep', 'i always carry', 'i carry'],
        ['a gun', 'my gun', 'a glock', 'my glock', 'a pistol', 'my pistol', 'a rifle', 'my rifle', 'an ar', 'my ar', 'a knife', 'my knife', 'a machete',
          'brass knuckles', 'a switchblade', 'my switchblade', 'a shotgun', 'my shotgun', 'a piece', 'my piece', 'a strap', 'my strap', '[gun]', '[knife]'],
        ['in my backpack', 'in my bag', 'in my dorm', 'on campus', 'to class', 'in class', 'to school', 'in my car on campus', 'in the dorm', 'to the lecture',
          'to the party', 'to the game', 'to the tailgate', 'in the library', 'to the frat', 'to his house', 'to her house', 'right now'],
      ],
    },
    {
      id: 'adm.thr.conditional.v1', category: 'threat_violence', subcode: 'threat_person', severity: 'high', kind: 'combo', view: FS, window: 12,
      guards: HYPERBOLE_GUARDS,
      slots: [
        ['if you', 'if u', 'if she', 'if he', 'if they', 'if anyone', 'next time', 'try me', 'say that again', 'do that again', 'touch her again',
          'touch him again', 'come near me again', 'come near her again', 'if i see you', 'if i see him', 'if i see her', 'if i catch you', 'if i catch him',
          'if i catch her', 'when i see you', 'when i see him', 'when i see her', 'when i find you', 'when i find him', 'when i find her'],
        INTENT.concat(['will', 'i will', 'gonna', 'ima', 'imma', "i'm gonna", 'im gonna', 'ill', "i'll"]),
        VIOLENCE,
      ],
    },
    {
      id: 'adm.thr.intent_target_ext.v1', category: 'threat_violence', subcode: 'threat_person', severity: 'critical', kind: 'combo', view: FS, window: 12,
      escalate: true, guards: HYPERBOLE_GUARDS,
      slots: [
        ['i am going to', 'im going to', "i'm going to", 'i will', 'ill', "i'll", 'gonna', 'ima', 'imma', 'about to', 'i plan to', 'planning to', 'i want to', 'i wanna'],
        ['kill', 'murder', 'shoot', 'stab', 'strangle', 'slit the throat of', 'slit his throat', 'slit her throat', 'slit your throat', 'put a bullet in',
          'put a bullet through', 'bash the skull of', 'bash his skull', 'bash her skull', 'bash your skull', 'beat to death', 'stomp out', 'end the life of'],
        PERSON_TARGET.concat(['the ra', 'my ra', 'my ex', 'my roommate', 'the ta', 'my ta', 'the professor', 'my professor', 'the dean', 'the cop', 'the cops']),
      ],
    },
    {
      id: 'adm.thr.glorification_ext.v1', category: 'threat_violence', subcode: 'glorification', severity: 'medium', kind: 'term', view: FS,
      guards: HYPERBOLE_GUARDS.concat(['disgusting', 'horrible', 'awful', 'sad', 'tragic', 'condolences', 'rip', 'prayers']),
      terms: [
        'more people should get shot', 'should have finished the job', 'shooter did nothing wrong', 'the shooter was based', 'the shooter was right',
        'hope someone shoots up', 'hope it gets bombed', 'hope they all die in', 'deserve a bullet', 'deserves a bullet', 'needs a bullet',
        'deserved what he got', 'deserved what she got', 'deserved to get stabbed', 'deserved to get beaten', 'wish someone would shoot',
        'wish someone would bomb', 'wish someone would stab', 'would be funny if someone shot', 'would be funny if someone bombed', 'good riddance he died',
        'good riddance she died', 'glad he got shot', 'glad she got shot', 'glad they got shot', 'glad he got stabbed', 'glad she got stabbed',
      ],
    },
    {
      id: 'adm.thr.weapons_instructions_ext.v1', category: 'threat_violence', subcode: 'weapons_instructions', severity: 'high', kind: 'term', view: FSQ,
      guards: ['chemistry class', 'chem class', 'history class', 'documentary', 'the movie', 'in the show', 'mythbusters', 'in minecraft', 'in the game', 'wikipedia says'],
      terms: [
        'how to make a bomb', 'how to build a bomb', 'pipe bomb', 'make a pipe bomb', 'build a bomb', 'make a gun at home', '3d print a gun',
        '3d printed gun', 'make napalm', 'make thermite', 'homemade explosive', 'homemade explosives', 'how to make explosives', 'pressure cooker bomb',
        'make a molotov', 'molotov cocktail recipe', 'how to make a molotov', 'chlorine gas at home', 'make chlorine gas', 'make mustard gas',
        'make poison gas', 'make ricin', 'extract ricin', 'make a silencer', 'print a suppressor', 'convert to full auto', 'auto sear', 'switch for a glock',
        'glock switch', 'drop in auto sear', 'make a zip gun', 'zip gun', 'make a taser lethal', 'lethal taser',
      ],
    },
  ],
};

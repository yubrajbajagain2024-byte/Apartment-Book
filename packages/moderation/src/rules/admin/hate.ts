/** Pack `admin.hate` — hate upgrades incl. discriminatory listings (safety §1.4, §1.12, §2.4). Server-only data. */
import type { RulePack } from '../../types';
import { COMMERCE_SURFACES, FS, FSQ, GROUP } from './shared';

const CONTEXT_GUARDS = [
  'not saying', 'i dont think', "i don't think", 'people who say', 'anyone who says', 'disgusting that', 'how can anyone', 'reported', 'quote',
  'history class', 'the nazis said', 'propaganda', 'is wrong', 'this is wrong', 'racist to say', 'imagine saying', 'people who think',
  'disgusting', 'history', 'in the 1930s', 'someone said', 'he said', 'she said', 'they said', 'a post said', 'saw a post', 'overheard',
];

export const HATE_PACK: RulePack = {
  id: 'admin.hate',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.hate.slur_ext.v1', category: 'hate', subcode: 'slur', severity: 'critical', kind: 'term', view: FSQ,
      terms: [
        'chinaman', 'chinamen', 'jigaboo', 'jigaboos', 'porch monkey', 'porch monkeys', 'sambo', 'darkie', 'darkies', 'mudslime', 'mudslimes',
        'muzzie', 'muzzies', 'camel jockey', 'camel jockeys', 'curry muncher', 'curry munchers', 'dothead', 'dotheads', 'sand nigger', 'sandnigger',
        'sand niggers', 'shemale', 'shemales', 'wetbacks', 'beaners', 'zipperhead', 'zipperheads', 'slant eye', 'slant eyes', 'slanteye',
        'yellow peril', 'gooks', 'kikes', 'heeb', 'heebs', 'hymie', 'hymies', 'christ killer', 'christ killers', 'oven dodger', 'oven dodgers',
        'ching chong', 'chingchong', 'ching chongs', 'niglet', 'niglets', 'nigglet', 'niggress', 'coontown', 'jungle bunny', 'jungle bunnies',
        'spearchucker', 'spear chucker', 'moon cricket', 'mooncricket', 'tar baby', 'tarbaby', 'ape face', 'monkey face', 'white nigger', 'wigger', 'wiggers',
        'tranners', 'trannie', 'troon', 'troons', 'dykes', 'faggy', 'fagg', 'fagit', 'fagot',
      ],
    },
    {
      id: 'adm.hate.ableist.v1', category: 'hate', subcode: 'ambiguous', severity: 'medium', kind: 'term', view: FS,
      guards: ['fire retardant', 'flame retardant', 'retardation', 'retardant', 'quote', 'someone called', 'called me', 'called him', 'called her', 'reported'],
      terms: ['retard', 'retards', 'retarded', 'mongoloid', 'mongoloids', 'spaz', 'spazz', 'spastic', 'sped kid', 'sped kids', 'window licker', 'window lickers', 'short bus kid', 'short bus kids'],
    },
    {
      id: 'adm.hate.dehumanize_ext.v1', category: 'hate', subcode: 'dehumanization', severity: 'critical', kind: 'combo', view: FS, window: 8,
      guards: CONTEXT_GUARDS,
      slots: [
        GROUP,
        ['are animals', 'are vermin', 'are cockroaches', 'are roaches', 'are subhuman', 'are a disease', 'are a plague', 'are parasites', 'are rats',
          'are apes', 'are monkeys', 'are savages', 'are all criminals', 'are all rapists', 'are all terrorists', 'are all thieves', 'should be exterminated',
          'should all die', 'should all be killed', 'should be wiped out', 'should be gassed', 'need to be gassed', 'deserve to be shot', 'deserve to die',
          'dont deserve to live', "don't deserve to live", 'are not human', 'arent human', "aren't human", 'are less than human', 'are lesser',
          'are inferior', 'ruin everything they touch', 'are a cancer', 'are the cancer of', 'are a virus', 'are the virus', 'are trash', 'are garbage',
          'belong in cages', 'belong in a zoo', 'belong in the zoo', 'are cattle', 'are livestock', 'should be put down', 'need to be put down',
          'should be sterilized', 'need to be sterilized', 'should be bred out', 'are breeding like', 'are an infestation', 'are infesting'],
      ],
    },
    {
      id: 'adm.hate.kill_all.v1', category: 'hate', subcode: 'dehumanization', severity: 'critical', kind: 'combo', view: FS, window: 3,
      guards: CONTEXT_GUARDS,
      slots: [
        ['kill all', 'kill every', 'gas all', 'gas the', 'shoot all', 'shoot every', 'deport all', 'hang all', 'lynch all', 'lynch the', 'burn all', 'burn the', 'exterminate all', 'exterminate the', 'wipe out all', 'wipe out the', 'death to all', 'death to the', 'death to'],
        GROUP,
      ],
    },
    {
      id: 'adm.hate.exclusion_ext.v1', category: 'hate', subcode: 'exclusion_call', severity: 'high', kind: 'combo', view: FS, window: 10,
      guards: CONTEXT_GUARDS,
      slots: [
        GROUP,
        ['should be deported', 'need to be deported', 'deport them all', 'deport all', 'ban them from', 'keep them out of', 'dont let them in',
          "don't let them in", 'shouldnt be at this school', "shouldn't be at this school", 'shouldnt be in this country', "shouldn't be in this country",
          'dont belong in', "don't belong in", 'go back to their country', 'go back to their countries', 'should be segregated', 'need their own school',
          'should not be allowed to', 'shouldnt be allowed to', "shouldn't be allowed to", 'should stay in the kitchen', 'belong in the kitchen',
          'cant be trusted with', "can't be trusted with", 'shouldnt be allowed to vote', "shouldn't be allowed to vote", 'shouldnt be able to vote',
          "shouldn't be able to vote", 'shouldnt be in engineering', "shouldn't be in engineering", 'shouldnt be in stem', "shouldn't be in stem",
          'dont belong in stem', "don't belong in stem", 'dont belong in engineering', "don't belong in engineering", 'should be banned from campus',
          'shouldnt be on campus', "shouldn't be on campus", 'dont deserve to be here', "don't deserve to be here", 'taking our spots', 'are taking our spots',
          'stealing our spots', 'are stealing our spots', 'only got in because', 'shouldnt have gotten in', "shouldn't have gotten in", 'need to leave this campus'],
      ],
    },
    {
      id: 'adm.hate.symbols_ext.v1', category: 'hate', subcode: 'hate_symbol', severity: 'high', kind: 'term', view: FS,
      guards: CONTEXT_GUARDS.concat(['conspiracy theory', 'debunked', 'documentary']),
      terms: [
        'white genocide is real', 'day of the rope', 'we wuz kangz', 'we wuz kings', 'globalist elites control', 'jewish elites control', 'the jews control',
        'jews control the', 'jews run the', 'jews own the', 'jews run hollywood', 'jews control the banks', 'zog', 'zionist occupied government',
        'it was a great replacement', 'the great replacement is real', 'replacement is real', 'white replacement', 'sieg heil', 'heil hitler',
        'hitler was right', 'hitler did nothing wrong', 'hitler had a point', 'hitler should have', 'bring back hitler', 'we need another hitler',
        'need another holocaust', 'finish what hitler', 'finish the job hitler', 'kkk was right', 'the klan was right', 'bring back the klan',
        'bring back slavery', 'slavery should come back', 'should bring back slavery', 'segregation was better', 'bring back segregation',
        'segregation now', 'race mixing is', 'racemixing is', 'blood and soil', 'white power', 'white pride worldwide', 'race war now',
        'total nigger death', 'tnd', '1488', '14 words', 'fourteen words', 'goyim know', 'the goyim', 'shut it down the goyim',
      ],
    },
    {
      id: 'adm.hate.atrocity_denial_ext.v1', category: 'hate', subcode: 'atrocity_denial', severity: 'medium', kind: 'term', view: FS,
      guards: CONTEXT_GUARDS,
      terms: [
        'holocaust didnt happen', "holocaust didn't happen", 'holocaust is a hoax', 'holocaust never happened', 'holocaust is fake', '6 million is a lie',
        'six million is a lie', 'holohoax', 'the holohoax', 'slavery was good for', 'slavery wasnt that bad', "slavery wasn't that bad",
        'slavery was a favor', 'slavery was a favour', 'slaves were treated well', 'the slaves were happy', 'genocide never happened', 'genocide is a myth',
        'armenian genocide is a lie', 'armenian genocide never happened', 'rwanda was exaggerated', 'residential schools were good', 'the trail of tears was',
        'nanking never happened', 'nanjing never happened', 'nanking is a lie', 'uyghurs are fine', 'no camps in xinjiang', 'the camps are a hoax',
        'the holocaust was exaggerated', 'gas chambers are a myth', 'gas chambers never existed', 'no gas chambers',
      ],
    },
    {
      id: 'adm.hate.discrim_listing_ext.v1', category: 'hate', subcode: 'discriminatory_listing', severity: 'high', kind: 'term', view: FS, surfaces: COMMERCE_SURFACES,
      guards: ['dont care about', "don't care about", 'any race', 'all welcome', 'everyone welcome', 'all are welcome', 'regardless of'],
      terms: [
        'no foreigners', 'no internationals', 'no international students', 'americans only', 'whites only', 'white only', 'white people only',
        'asians only', 'asian only', 'no disabled', 'no wheelchairs', 'no muslims', 'christians only', 'christian only', 'straight only',
        'straights only', 'no lgbt', 'no lgbtq', 'no gays', 'no gay people', 'no trans girls', 'no trans guys', 'no trans people', 'cis only',
        'cis girls only', 'cis guys only', 'no blacks', 'no black people', 'no jews', 'jewish only', 'hindus only', 'hindu only', 'no hindus',
        'no indians', 'no chinese', 'no africans', 'no arabs', 'no mexicans', 'no hispanics', 'no latinos', 'no religious people', 'no atheists',
        'must be white', 'must be asian', 'must be christian', 'must be straight', 'must be american', 'must be cis', 'no immigrants',
        'no refugees', 'no koreans', 'no japanese', 'no nigerians', 'no pakistanis', 'no iranians', 'no persians', 'no russians', 'no ukrainians',
        'no israelis', 'no palestinians', 'no zionists', 'no catholics', 'no mormons', 'no autistic', 'no autistics', 'no fat people', 'no fatties',
        'no poor people', 'no ugly people', 'no uglies', 'attractive only', 'hot girls only', 'hot guys only', 'must be hot', 'must be skinny',
      ],
    },
  ],
};

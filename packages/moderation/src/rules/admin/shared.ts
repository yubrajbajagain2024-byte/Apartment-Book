/**
 * Word lists shared by the admin rule packs (SPEC §5.11; safety §2.3 rule syntax). SERVER-ONLY DATA: never imported
 * by shared/ or the client, never echoed in responses or logs. Every list is deliberately phrase-heavy so a single
 * everyday word never fires on its own; single words only appear inside combos with an intent slot.
 */
import type { ModerationRule } from '../../types';

export const FS: ModerationRule['view'] = ['folded', 'spaced'];
export const FSQ: ModerationRule['view'] = ['folded', 'spaced', 'squashed'];

export const ANON_SURFACES: ModerationRule['surfaces'] = ['buzz', 'buzz_reply', 'buzz_poll'];
export const COMMERCE_SURFACES: ModerationRule['surfaces'] = ['market_listing', 'roommate_listing'];

/** Intent to act (first person). */
export const INTENT = [
  'i will', "i'll", 'ill', 'im gonna', "i'm gonna", 'imma', 'ima', 'im going to', "i'm going to", 'about to', 'watch me', 'gonna',
  'i want to', 'i wanna', 'finna', 'bout to', 'i swear i will', 'i swear ill', "i swear i'll", 'i promise i will', 'i might just', 'i should just',
];

export const VIOLENCE = [
  'kill', 'shoot', 'stab', 'murder', 'hurt', 'beat up', 'beat the shit out of', 'bomb', 'blow up', 'attack', 'strangle', 'choke', 'slit',
  'smash your', 'break your', 'cut you', 'end you', 'bury you', 'put you in the hospital', 'put him in the hospital', 'put her in the hospital',
  'make you bleed', 'knock you out', 'knock your teeth out', 'jump you', 'run you over', 'run him over', 'run her over', 'set you on fire',
  'burn your', 'poison you', 'shank', 'curb stomp', 'curbstomp', '[gun]', '[knife]', '[bomb]',
];

export const PERSON_TARGET = [
  'you', 'u', 'ya', 'him', 'her', 'them', 'everyone', 'everybody', 'yall', "y'all", 'my roommate', 'my ex', 'that guy', 'that girl',
  'this guy', 'this girl', 'the ra', 'my ra', 'the ta', 'my ta', 'the prof', 'my prof', 'professor', 'the professor', 'my professor', '<name>',
];

export const PLACE = [
  'campus', 'the campus', 'library', 'the library', 'dorm', 'the dorm', 'dorms', 'the dorms', 'lecture', 'lecture hall', 'the lecture',
  'class', 'the class', 'school', 'the school', 'hall', 'building', 'the building', 'stadium', 'the stadium', 'cafeteria', 'dining hall',
  'quad', 'the quad', 'union', 'the union', 'the game', 'graduation', 'commencement', 'the gdc', 'gdc', 'pcl', 'the pcl', 'welch', 'jester',
  'the rec', 'gregory gym', 'the gym', 'the lab', 'the frat', 'the party', 'the concert', 'the tailgate', 'the career fair',
];

/** Figures of speech that cancel a threat / self-harm hit in the same sentence. */
export const HYPERBOLE_GUARDS = [
  'this exam', 'the exam', 'this test', 'the test', 'the final', 'the midterm', 'this assignment', 'this problem', 'this project',
  'this presentation', 'this interview', 'this workout', 'this semester', 'killing me', 'kill for a', 'kill for some', 'killed it',
  'kill it', 'killing it', 'dead tired', 'shoot my shot', 'bomb exam', 'bombed', 'photo bomb', 'the bomb', 'blow up on', 'blew up on',
  'in the game', 'in valorant', 'in fortnite', 'in smash', 'in mario kart', 'in chess', 'on the court', 'on the field', 'at pool',
  'at ping pong', 'in the debate', 'fantasy football', 'my fantasy', 'in 2k', 'in fifa', 'in the scrim', 'in ranked', 'in the tournament',
  'the movie', 'in the movie', 'the show', 'in the show', 'the book', 'in the book', 'song', 'lyrics', 'video game', 'nerf',
  'water balloon', 'water gun', 'snowball', 'pillow fight', 'joke', 'jk', 'lol', 'lmao', 'with kindness', 'with love', 'with cuteness',
];

export const WEAPON_GUARDS = [
  'nerf', 'water gun', 'glue gun', 'airsoft', 'paintball', 'bb gun', 'toy gun', 'nail gun', 'caulk gun', 'staple gun', 'gun show',
  'gun range', 'shooting range', 'video game', 'valorant', 'fortnite', 'call of duty', 'apex', 'counter strike', 'cs2', 'laser tag',
  'squirt gun', 'foam', 'prop', 'costume', 'cosplay', 'museum', 'history class', 'the movie', 'the show', 'hot glue',
];

export const DRUG_GUARDS = [
  'drug policy', 'harm reduction', 'narcan', 'test kit', 'test kits', 'test strips', 'fentanyl test', 'drug free', 'drug-free',
  'recovery meeting', 'rehab', 'stay away from', 'dont do drugs', "don't do drugs", 'awareness', 'dispensary', 'prescribed',
  'my prescription', 'pharmacy', 'my doctor', 'my psychiatrist', 'refill', 'ran out of my', 'insurance', 'dosage', 'side effects',
  'does anyone else take', 'my adhd', 'i have adhd', 'been on', 'overdose', 'overdosed', "od'd", 'hospital', 'the er', 'be careful',
  'stay safe', 'psa', 'warning', 'laced', 'is it safe', 'counseling', 'sober', 'quitting', 'addiction', 'therapist', 'legal in',
  'legalize', 'legalization', 'documentary', 'article', 'study found', 'research', 'lost my', 'found a', 'someone dropped', 'police',
];

export const MINOR = [
  '10 year old', '11 year old', '12 year old', '13 year old', '14 year old', '15 year old', '16 year old', '17 year old',
  '12yo', '13yo', '14yo', '15yo', '16yo', '17yo', '12 yo', '13 yo', '14 yo', '15 yo', '16 yo', '17 yo', 'middle schooler', 'middle schoolers',
  'high schooler', 'high schoolers', 'high school girl', 'high school girls', 'high school boy', 'high school boys', 'hs girl', 'hs girls',
  'hs boy', 'hs boys', 'freshman in high school', 'high school freshman', 'high school sophomore', 'high school junior', 'high school senior',
  'underage girl', 'underage girls', 'underage boy', 'underage boys', 'underage', 'little girl', 'little boy', 'little girls', 'little boys',
  'my little sister', 'my little brother', 'my cousin who is 14', 'my cousin who is 15', 'my cousin who is 16', 'the kids i babysit', 'the kid i babysit',
  'the kids i coach', 'the kids i tutor', 'the campers', 'my campers', 'the kid i tutor',
];

export const GROUP = [
  'jews', 'the jews', 'jewish people', 'muslims', 'the muslims', 'blacks', 'the blacks', 'black people', 'asians', 'the asians', 'asian people',
  'mexicans', 'the mexicans', 'immigrants', 'the immigrants', 'illegals', 'the illegals', 'gays', 'the gays', 'gay people', 'trans people',
  'the trans', 'transgenders', 'women', 'chinese', 'the chinese', 'chinese people', 'indians', 'the indians', 'indian people', 'arabs',
  'the arabs', 'africans', 'the africans', 'latinos', 'hispanics', 'whites', 'white people', 'christians', 'hindus', 'sikhs', 'disabled people',
  'autistic people', 'retards', 'foreigners', 'the foreigners', 'international students', 'the internationals', 'refugees', 'the refugees',
  'nigerians', 'koreans', 'the koreans', 'japanese people', 'pakistanis', 'iranians', 'persians', 'russians', 'the russians', 'ukrainians',
  'palestinians', 'israelis', 'zionists', 'catholics', 'mormons', 'atheists', 'lesbians', 'bisexuals', 'queers', 'the queers',
  'fat people', 'poor people', 'homeless people', 'the homeless', 'frat guys', 'sorority girls',
];

/** Sale / sourcing intent shared by the drugs and commerce packs. */
export const OFFER = [
  'selling', 'sell', 'sells', 'for sale', 'in stock', 'buying', 'buy', 'dm me for', 'dm for', 'hmu for', 'hmu if you want', 'who has',
  "who's got", 'whos got', 'who sells', 'looking for', 'need some', 'anyone selling', 'anyone have', 'anyone got', 'where can i get',
  'where to get', 'where do i get', 'how much for', 'got some', 'plug', '[plug]', 'hookup for', 'connect for', 'restocked', 'got a plug',
  'need a plug', 'plug for', 'selling some', 'have some', 'i have some', 'anyone want', 'anyone need', 'discreet', 'discrete', 'cash app only',
  'venmo only', 'meet up for', 'meetup for', 'delivery available', 'i deliver', 'i can deliver', 'pickup only', 'per gram', 'a gram',
  'an ounce', 'an oz', 'an 8th', 'an eighth', 'a quarter', 'a zip', 'per pill', 'per tab', 'per bar', 'a pop', 'each pill', 'tryna cop',
  'trying to cop', 'where to cop', 'cop some', 'tryna get', 'looking to buy', 'hook me up with',
];

export const DRUGS = [
  'weed', 'marijuana', 'zaza', 'za', 'edibles', 'thc gummies', 'weed gummies', 'thc', 'shrooms', 'magic mushrooms', 'psilocybin',
  'mushroom chocolate', 'shroom chocolate', 'shroom bars', 'acid tabs', 'lsd', 'lucy', 'some molly', 'molly for', 'molly', 'mdma', 'ecstasy',
  'x pills', 'cocaine', 'coke', 'yayo', 'ket', 'ketamine', 'special k', 'codeine', 'lean', 'wock', 'wockhardt', 'tris', 'fentanyl', 'fent',
  'meth', 'heroin', 'dmt', '2cb', '2c-b', 'nbome', 'tusi', 'pink cocaine', 'nitrous', 'whippets', 'poppers', 'ghb', 'roofies', 'rohypnol',
  '[weed]', '[pill]', '[snow]', '[shroom]', 'xans', 'xanax', 'xanax bars', 'xanny', 'xannies', 'bars', 'footballs', 'blues', 'm30', 'm30s',
  'percs', 'perc 30', 'perc 30s', 'oxys', 'oxy', 'dank', 'carts of', 'thc carts', 'thc cart', 'dab pen', 'dab pens', 'dabs', 'wax pen', 'shatter',
  'delta 8', 'delta-8', 'pre rolls', 'prerolls', 'pre-rolls', 'blunts', 'study drugs', 'study pills',
];

export const RX = [
  'adderall', 'addy', 'addys', 'addies', 'vyvanse', 'ritalin', 'concerta', 'dexedrine', 'focalin', 'modafinil', 'provigil', 'percocet',
  'percs', 'oxycodone', 'oxys', 'oxycontin', 'hydrocodone', 'vicodin', 'norco', 'tramadol', 'ambien', 'klonopin', 'clonazepam', 'valium',
  'diazepam', 'ativan', 'lorazepam', 'xanax', 'alprazolam', 'suboxone', 'subs', 'methadone', 'ozempic', 'wegovy', 'study pills', 'study drugs',
  'propranolol', 'viagra', 'cialis', 'antibiotics', 'amoxicillin', 'tramadol',
];

export const WEAPONS = [
  'glock', 'pistol', 'handgun', 'gun', 'guns', 'ar-15', 'ar15', 'rifle', 'shotgun', 'ammo', 'ammunition', 'switchblade', 'brass knuckles',
  'silencer', 'suppressor', 'ghost gun', 'firearm', 'butterfly knife', 'balisong', 'machete',
];

/** Accusations that should never sit next to a real name on an anonymous surface (safety §2.4 named_accusation). */
export const ACCUSATION_SEVERE = [
  'stole', 'thief', 'stalker', 'stalks', 'stalking', 'predator', 'abuser', 'abused', 'abusive', 'assaulted', 'raped', 'rapist', 'harassed',
  'harasses', 'groped', 'dealer', 'sells drugs', 'sells pills', 'has an std', 'has std', 'has herpes', 'has chlamydia', 'is gay', 'is closeted',
  'is trans', 'slept with', 'hooked up with', 'sleeps around', 'is a whore', 'is a slut', 'is a creep', 'is a pervert', 'is a predator',
  'is a pedo', 'is a pedophile', 'is a rapist', 'sexually harassed', 'hits on students', 'sleeps with students', 'slept with a student',
  'sleeps with his students', 'sleeps with her students', 'is sleeping with', 'is a drunk', 'is an alcoholic', 'is a druggie', 'is a nazi',
  'is a fraud', 'is a scammer', 'takes bribes', 'is corrupt', 'is a thief', 'is a stalker', 'has a criminal record', 'was arrested',
  'abuses', 'abused me', 'assaulted me', 'is abusive', 'bullied me', 'cheats on his wife', 'cheats on her husband', 'is cheating on',
];

export const ACCUSATION_GUARDS = [
  'i was told', 'rumor', 'rumour', 'allegedly', 'the news said', 'article', 'convicted', 'was arrested for', 'was charged', 'police said',
  'was found guilty', 'not saying', 'i dont think', "i don't think", 'in the show', 'in the movie', 'character', 'joke', 'jk', 'lol', 'lmao',
];

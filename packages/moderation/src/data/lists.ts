/**
 * Bundled lists for the PII / spam detectors (safety §2.6–§2.7). SERVER-ONLY: never import from shared/ or the client.
 */

/** TLDs accepted by `pii.email` (common gTLDs, ccTLDs and academic forms). */
export const TLDS: ReadonlySet<string> = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'io', 'co', 'me', 'ai', 'app', 'dev', 'xyz', 'gg', 'tv',
  'cc', 'ly', 'sh', 'us', 'uk', 'ca', 'au', 'nz', 'ie', 'de', 'fr', 'es', 'it', 'nl', 'be', 'ch', 'at', 'se', 'no', 'dk',
  'fi', 'pl', 'cz', 'pt', 'gr', 'ru', 'ua', 'tr', 'il', 'in', 'pk', 'bd', 'lk', 'sg', 'my', 'id', 'ph', 'th', 'vn', 'jp',
  'kr', 'cn', 'hk', 'tw', 'br', 'ar', 'cl', 'mx', 'co', 'pe', 'za', 'ng', 'ke', 'eg', 'ma', 'sa', 'ae', 'qa', 'ac',
  'email', 'mail', 'online', 'site', 'club', 'shop', 'store', 'live', 'life', 'world', 'today', 'news', 'cloud', 'tech',
  'edu.au', 'ac.uk', 'edu.sg', 'ac.in', 'edu.in', 'ac.nz', 'edu.mx', 'edu.br', 'ac.jp', 'edu.cn', 'ac.kr', 'edu.tr',
]);

/** URL shortener domains — any link through one of these is `spam.link_flood` on ANON / COMMERCE. */
export const URL_SHORTENERS: ReadonlySet<string> = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc',
  't.ly', 'rebrand.ly', 'bl.ink', 'snip.ly', 'lnkd.in', 's.id', 'v.gd', 'clck.ru', 'u.to', 'qr.ae', 'adf.ly', 'bc.vc',
  'shorte.st', 'soo.gd', 'tny.im', 'x.co', 'yourls.org', 'zpr.io', 'trib.al', 'dlvr.it', 'ift.tt', 'fb.me', 'amzn.to',
]);

/** Titles that make a following capitalised token a probable name (`pii.full_name`). */
export const NAME_TITLES: ReadonlySet<string> = new Set([
  'prof', 'professor', 'dr', 'dean', 'coach', 'ra', 'ta', 'mr', 'ms', 'mrs', 'mx', 'miss', 'sir', 'madam', 'officer',
]);

/**
 * Given names (international). Lower-cased. A capitalised token in this list that is followed by 1–2 more
 * capitalised tokens is a probable full name. (Bundled subset — ≈ 700 names; safety asks for ≥ 5,000 and the
 * admin slice may register a larger list through a rule pack later.)
 */
export const GIVEN_NAMES: ReadonlySet<string> = new Set(`
aaliyah aaron abby abdul abdullah abel abigail abraham ada adam adan addison adeline adrian adriana ahmed aidan aiden
aisha akira alan albert alejandro alex alexa alexander alexandra alexis alfred ali alice alicia alina alison allison alma
alyssa amanda amara amber amelia amir amy ana anastasia anders andre andrea andreas andres andrew andy angel angela
angelina angie anika anita anjali ann anna anne annie anthony anton antonio anya april arjun arlo arnav arthur arya
asher ashley ashton aubrey audrey august aurora austin ava avery axel ayaan ayesha bailey barbara beatrice bella ben
benjamin bennett bernard beth bianca bill billy blake bobby brad bradley brandon brayden brenda brian brianna brittany
brooke brooklyn bruce bruno bryan caleb callum calvin cameron camila candace carl carla carlos carmen carol caroline
carter casey cassandra catherine cecilia cedric celeste chad chance chandler charles charlie charlotte chase chen
chiara chloe chris christian christina christine christopher cindy claire clara clark claudia clayton clement cody
cole colin connor cooper cora corey courtney craig crystal cynthia daisy dakota dale dalton damian damon dan dana
daniel daniela danielle danny dante daria darius darren dave david dawn dean deborah declan deepak delilah denise
dennis derek desmond devin devon diana diego dilan dmitri dominic don donald donna dorothy douglas drew duncan dustin
dylan easton eddie edgar edith edward edwin elaine eleanor elena eli elias elijah elise eliza elizabeth ella elle ellen
ellie elliot elliott eloise elsa elsie emeka emerson emil emilia emily emma emmanuel eric erica erik erin esme esteban
esther ethan eugene eva evan evelyn everett ezra fabian faith fatima felipe felix fernanda fernando finn fiona florence
frances francesca francis francisco frank franklin fred freddie gabriel gabriela gabriella gael gage gareth gary gavin
gemma genesis george georgia gerald gianna gilbert gina giovanni giselle glen glenn gloria gordon grace graham grant
grayson greg gregory greta guillermo gunnar gus gustavo hailey hamza hana hank hannah harold harper harriet harrison
harry harvey hassan hayden hazel heather hector heidi helen helena henry hiro holly hope howard hudson hugh hugo hunter
ian ibrahim ida imani imogen india ines ingrid ira irene iris isaac isabel isabella isabelle isaiah isla ismael ivan ivy
jack jackson jacob jacqueline jade jaden jai jake jakob james jamie jane janet janice jared jasmine jason javier jax
jay jayden jean jeff jeffrey jenna jennifer jenny jeremiah jeremy jerome jerry jesse jessica jesus jill jim jimmy joan
joanna joaquin jocelyn jodie joe joel joey johan john johnny jon jonah jonas jonathan jordan jorge jose joseph josephine
josh joshua josie joy joyce juan judith judy julia julian juliana julie juliet julio june justin kai kaitlyn kaleb
kamal kara karen karim karina karl kate katelyn katherine kathleen kathryn kathy katie kayla keira keith kelly ken
kendall kendra kennedy kenneth kevin khalid kiara kieran kim kimberly kingston kira kofi kris krista kristen kristin
kyle kylie lachlan laila lana lance landon lara larry laura lauren laurie layla leah leila lena leo leon leonard
leonardo leslie levi lewis liam liana lila liliana lillian lily lina lincoln linda lindsay lisa liv logan lola lorenzo
louis louisa louise luca lucas lucia lucy luis luke luna lydia lyla lynn mabel mack mackenzie maddie madeline madison
mae maggie malcolm malik manuel marc marcel marco marcus margaret margot maria mariah mariam marian marie marina mario
marion marisa mark marley marlon martha martin marvin mary mason mateo matilda matt matthew matthias maura maureen max
maxwell maya megan mehmet mei melanie melissa melody mia micah michael michaela michelle miguel mike mila miles milo
mina miriam mitchell mohamed mohammed molly monica morgan moses muhammad mustafa mya myra nadia naomi natalia natalie
nathan nathaniel neil nelson nia nick nicholas nicolas nicole nikita nikolai nina noah noel noor nora norman nour olga
oliver olivia omar oscar otto owen pablo paige pam pamela paolo parker patricia patrick paul paula paulina pedro penny
percy peter petra peyton philip phoebe pierre piper poppy preston priya quentin quinn rachel rafael ralph ramon randy
raphael raul ray raymond rebecca reese regina reid remi rene rex rhys ricardo richard rick riley rita rob robert
roberto robin rocco roderick rodrigo roger roland roman ron ronald rory rosa rose rosie ross rowan roy ruby rudy russell
ruth ryan ryder sabrina sadie sage sahil sally salma sam samantha samir samuel sandra santiago sara sarah sasha saul
savannah scarlett scott sean sebastian selena serena seth shane shannon sharon shaun shawn sheila shelby sherry
shirley sienna sierra silas simon simone sofia sonia sophia sophie spencer stacy stanley stefan stella stephanie
stephen steve steven stuart sue summer susan suzanne sydney sylvia tamara tanner tanya tara tariq tatiana taylor ted
teresa terry tessa theo theodore theresa thomas tiffany tim timothy tina tobias toby todd tom tomas tommy toni tony
tracy travis trevor trinity tristan troy tyler uma valentina valeria valerie vanessa vera veronica victor victoria
vikram vincent violet virginia vivian vivienne wade walter warren wayne wendy wesley whitney will william willow
wilson winston wyatt xavier yara yasmin yolanda yusuf yvonne zach zachary zain zainab zara zane zoe zoey zola
`.split(/\s+/).filter(Boolean));

/**
 * Stop-list for `pii.full_name`: a capitalised token that ENDS a candidate sequence and is one of these means the
 * sequence is a place / brand / course / public thing, not a person.
 */
export const NAME_STOP_LIST: ReadonlySet<string> = new Set(`
university college school campus hall library center centre building tower dorm dorms stadium arena union commons
plaza square park street avenue road drive lane court boulevard highway bridge station airport city town county state
province country island beach mountain river lake valley bay coast north south east west
america american texas austin dallas houston california stanford berkeley michigan ann arbor york boston chicago
london oxford cambridge toronto zurich munich singapore mumbai melbourne sydney paris berlin tokyo delhi
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august
september october november december spring summer fall winter
google apple amazon microsoft netflix spotify uber lyft tesla meta facebook instagram tiktok snapchat twitter reddit
discord slack zoom canvas blackboard piazza notion github youtube whatsapp telegram venmo zelle paypal cashapp
starbucks chipotle target walmart costco ikea nike adidas samsung sony intel nvidia
football basketball soccer baseball hockey tennis volleyball lacrosse rugby cricket swim swimming track
longhorns wolverines cardinal violets bulldogs tigers eagles bears lions wildcats huskies spartans trojans
science engineering math mathematics physics chemistry biology economics psychology history english philosophy
business finance marketing accounting law medicine nursing design art music theatre dance film architecture
club society association team council board committee office department faculty program course class lecture lab
exam midterm final finals week semester quarter year day night morning evening
everyone everybody anyone someone nobody people students student freshmen freshman sophomore junior senior
day week weekend today tonight tomorrow yesterday
`.split(/\s+/).filter(Boolean));

/** Public figures never count as a private full name. */
export const PUBLIC_FIGURES: ReadonlySet<string> = new Set([
  'taylor swift', 'elon musk', 'joe biden', 'donald trump', 'barack obama', 'kamala harris', 'kanye west', 'drake',
  'lebron james', 'michael jordan', 'tom brady', 'lionel messi', 'cristiano ronaldo', 'serena williams', 'beyonce knowles',
  'harry styles', 'billie eilish', 'olivia rodrigo', 'sabrina carpenter', 'travis kelce', 'patrick mahomes',
  'mark zuckerberg', 'jeff bezos', 'bill gates', 'steve jobs', 'tim cook', 'sam altman', 'jensen huang', 'greg abbott',
  'jordan peterson', 'ben shapiro', 'joe rogan', 'andrew tate', 'mr beast', 'emma watson', 'zendaya coleman',
]);

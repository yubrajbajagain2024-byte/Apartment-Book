/** Pack `admin.commerce` — prohibited items, Rx listings, counterfeits and ticket fraud on Market / Roommates surfaces (safety §1.6, §1.12, §7.4). Server-only data. */
import type { RulePack } from '../../types';
import { COMMERCE_SURFACES, FS, RX, WEAPON_GUARDS, WEAPONS } from './shared';

const ALCOHOL_DECOR_GUARDS = [
  'pong', 'beer pong', 'glasses', 'glass', 'rack', 'fridge', 'mini fridge', 'koozie', 'koozies', 'cooler', 'poster', 'sign', 'neon', 'empty', 'empties',
  'decor', 'decoration', 'costume', 'prop', 'props', 'opener', 'shot glass', 'tap handle', 'kegerator', 'holder', 'book', 'books', 'gin rummy', 'rum cake',
  'flavored', 'flavoured', 'scented', 'candle', 'candles', 'soap', 'lamp', 'shelf', 'shelves', 'cabinet', 'bar cart', 'crate', 'crates', 'case for', 'bottle for',
  'mug', 'mugs', 'stein', 'steins', 'tumbler', 'tumblers', 'flask',
];

const THC_GUARDS = ['golf', 'utility', 'rolling cart', 'kitchen cart', 'bar cart', 'shopping', 'ikea', 'storage', 'laundry', 'microwave cart', 'tv cart', 'coffee cart', 'plant', 'plants', 'garden', 'gardening', 'book', 'books', 'poster', 'shirt', 'hoodie', 'sticker', 'stickers', 'cbd lotion', 'cbd cream', 'cbd balm'];

export const COMMERCE_PACK: RulePack = {
  id: 'admin.commerce',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.com.weapon_listing.v1', category: 'drugs_illegal_sales', subcode: 'weapon_sale', severity: 'high', kind: 'term', view: FS, surfaces: COMMERCE_SURFACES,
      guards: WEAPON_GUARDS.concat(['gun case', 'gun safe', 'holster', 'cleaning kit', 'display case', 'replica', 'prop', 'decorative', 'wall mount']),
      terms: WEAPONS.concat(['9mm', '.22 rifle', '22 rifle', 'ak47', 'ak-47', 'ak 47', 'hunting rifle', 'bolt action', 'revolver', 'derringer', 'stun gun', 'taser gun', 'switch blade', 'throwing knives', 'throwing stars', 'ninja stars', 'shuriken', 'nunchucks', 'nunchaku', 'sword cane', 'cane sword']),
    },
    {
      id: 'adm.com.thc_vape_listing.v1', category: 'drugs_illegal_sales', subcode: 'drug_sale', severity: 'high', kind: 'term', view: FS, surfaces: COMMERCE_SURFACES,
      guards: THC_GUARDS,
      terms: [
        'weed', 'thc', 'thc gummies', 'edibles', 'carts', 'dab pen', 'dab pens', 'dab rig', 'bong', 'bongs', 'delta 8', 'delta-8', 'd8 gummies', 'pre rolls', 'prerolls',
        'pre-rolls', 'kratom', 'whippets', 'whippits', 'whip its', 'nitrous', 'cream chargers', 'vape', 'vapes', 'juul', 'juul pods', 'elf bar', 'elf bars', 'geek bar',
        'geek bars', 'zyn', 'zyns', 'nicotine pouches', 'disposable vape', 'disposable vapes', 'nic vape', 'lost mary', 'breeze pro', 'puff bar', 'puff bars', 'shrooms',
        'shroom bars', 'mushroom chocolate', 'psilocybin', 'lsd', 'acid tabs', 'molly', 'mdma', 'cocaine', 'coke', 'ketamine', 'xanax', 'xans', 'adderall', 'addys',
        'addies', 'percs', 'percocet', 'oxys', 'oxycodone', 'lean', 'codeine', 'fentanyl', 'fent', 'meth', 'heroin', 'poppers', 'ghb', 'roofies', 'hookah tobacco',
        'shisha', 'cigarettes', 'cigs', 'carton of cigs', 'carton of cigarettes', 'cigars', 'black and milds', 'swishers', 'backwoods', 'grabba', 'nicotine',
      ],
    },
    {
      id: 'adm.com.alcohol_listing.v1', category: 'drugs_illegal_sales', subcode: 'alcohol_nicotine_minor', severity: 'high', kind: 'term', view: FS, surfaces: COMMERCE_SURFACES,
      guards: ALCOHOL_DECOR_GUARDS,
      terms: [
        'vodka', 'tequila', 'whiskey', 'whisky', 'bourbon', 'rum', 'gin', 'four loko', 'four lokos', 'white claws', 'white claw', 'hard seltzer', 'hard seltzers',
        'a handle of', 'handles of', 'liquor', 'box of wine', 'bottle of wine', 'bottles of wine', 'case of beer', 'cases of beer', 'pack of beer', 'beer cans',
        'cans of beer', 'keg', 'kegs', 'half keg', 'jungle juice', 'everclear', 'malibu', 'smirnoff', 'titos', "tito's", 'jack daniels', "jack daniel's", 'fireball',
        'hennessy', 'henny', 'moonshine', 'soju', 'sake', 'baijiu', 'twisted tea', 'twisted teas', 'trulys', 'high noons', 'high noon', 'nutrl', 'nutrls',
        'modelos', 'coronas', 'bud lights', 'natty lights', 'natty light', 'busch lights', 'busch light', 'pbr', 'lone stars', 'lone star beer', 'shiners', 'shiner bock',
      ],
    },
    {
      id: 'adm.com.rx_listing.v1', category: 'drugs_illegal_sales', subcode: 'rx_sale', severity: 'high', kind: 'term', view: FS, surfaces: COMMERCE_SURFACES,
      guards: ['case', 'organizer', 'pill organizer', 'bottle organizer', 'book', 'textbook', 'pharmacology', 'nursing', 'study guide', 'flashcards', 'flash cards'],
      terms: RX,
    },
    {
      id: 'adm.com.counterfeit.v1', category: 'spam_scam', subcode: 'counterfeit', severity: 'medium', kind: 'term', view: FS, surfaces: COMMERCE_SURFACES,
      guards: ['not a replica', 'not fake', 'authentic', 'genuine', 'legit check', 'receipt', 'proof of purchase', 'model kit', 'model', 'poster', 'print', 'toy', 'lego', 'diecast', 'die-cast', 'movie prop', 'cosplay'],
      terms: [
        'replica', 'replicas', '1:1 replica', 'aaa quality', 'ua quality', 'unauthorized authentic', 'fake designer', 'fake gucci', 'fake louis', 'fake lv', 'fake rolex',
        'fake airpods', 'knockoff', 'knock off', 'knock-off', 'knockoffs', 'bootleg', 'counterfeit', 'rep sneakers', 'rep shoes', 'rep jordans', 'rep dunks', 'rep yeezys',
        'reps for sale', 'selling reps', 'high quality reps', 'best reps', 'fake yeezys', 'fake jordans', 'fake dunks', 'fake supreme', 'fake off white', 'fake off-white',
        'fake bape', 'fake stussy', 'fake essentials', 'fake chrome hearts', 'fake cartier', 'fake ap', 'fake audemars', 'fake patek', 'fake omega', 'fake tiffany',
        'fake pandora', 'fake dyson', 'fake beats', 'fake bose', 'fake sony', 'fake samsung', 'fake apple', 'fake charger', 'fake chargers', 'fake textbook',
        'photocopied textbook', 'photocopy of the textbook', 'printed copy of the textbook', 'pdf of the textbook printed', 'bound pdf of the textbook',
        'cracked software', 'cracked adobe', 'cracked office', 'cracked windows', 'pirated', 'pirated textbook', 'pirated software', 'keygen', 'license key for sale',
        'lifetime key for', 'shared account access for', 'selling access to my',
      ],
    },
    {
      id: 'adm.com.ticket_fraud.v1', category: 'spam_scam', subcode: 'payment_scam', severity: 'high', kind: 'term', view: FS, surfaces: COMMERCE_SURFACES,
      guards: ['scam', 'scammer', 'scammed', 'warning', 'psa', 'be careful', 'beware', 'reported', 'ticketmaster transfer', 'official transfer', 'transfer through the app', 'transfer in the app'],
      terms: [
        'screenshot of the ticket', 'ill send a screenshot of the ticket', "i'll send a screenshot of the ticket", 'ticket screenshot after payment',
        'transfer after you pay', 'will transfer after payment', 'transfer once you pay', 'pay then i transfer', 'pay first then transfer', 'send payment then i send ticket',
        'pdf ticket after payment', 'i cant transfer through the app', "i can't transfer through the app", 'cant use ticketmaster transfer', "can't use ticketmaster transfer",
        'send half now half later', 'half now half at', 'pay via zelle for the tickets', 'zelle for the tickets first', 'venmo for the tickets first', 'cashapp for the tickets first',
        'i will send the qr after', 'ill send the qr after', "i'll send the qr after", 'qr code after payment', 'qr after you pay', 'screenshot of the qr', 'screenshotted ticket',
        'screenshot ticket for sale', 'ticket is a screenshot', 'tickets are screenshots', 'no transfer just screenshot', 'just a screenshot of the barcode', 'barcode screenshot',
        'pay and ill send the barcode', "pay and i'll send the barcode", 'send the barcode after you pay', 'season ticket screenshot', 'student ticket screenshot',
        'my student ticket screenshot', 'pay before i send the ticket', 'pay before the transfer', 'payment before transfer', 'payment before i transfer',
      ],
    },
  ],
};

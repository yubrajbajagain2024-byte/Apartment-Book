/** Pack `admin.drugs` — drugs_illegal_sales upgrades: slang, sourcing, Rx, fake IDs, weapons, stolen goods (safety §1.6). Server-only data. */
import type { RulePack } from '../../types';
import { DRUG_GUARDS, DRUGS, FS, OFFER, RX, WEAPON_GUARDS, WEAPONS } from './shared';

const STOLEN_GUARDS = [
  'my stolen', 'was stolen', 'got stolen', 'someone stole my', 'if you see', 'lost', 'police report', 'reward', 'help me find', 'looking for my',
  'has anyone seen', 'anyone seen', 'keep an eye out', 'stolen from me', 'stolen from my', 'it was mine', 'was mine',
];

export const DRUGS_PACK: RulePack = {
  id: 'admin.drugs',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.drg.slang_sale.v1', category: 'drugs_illegal_sales', subcode: 'drug_sale', severity: 'high', kind: 'combo', view: FS, window: 12,
      guards: DRUG_GUARDS,
      slots: [OFFER, DRUGS],
    },
    {
      id: 'adm.drg.plug_sourcing_ext.v1', category: 'drugs_illegal_sales', subcode: 'drug_sourcing', severity: 'high', kind: 'combo', view: FS, window: 10,
      guards: DRUG_GUARDS,
      slots: [
        ['plug', '[plug]', 'a plug', 'my plug', 'the plug', 'plugs', 'dealer', 'a dealer', 'connect', 'a connect', 'who sells', 'whos selling', "who's selling",
          'anyone know where', 'where can i find', 'where can i cop', 'where to cop', 'cop some', 'tryna cop', 'trying to cop', 'tryna get', 'trying to get some',
          'looking to buy', 'hook me up with', 'hookup for', 'who got', 'whos got', "who's got", 'who has', 'anyone got', 'anyone have', 'need to find',
          'know a guy for', 'know anyone with', 'know anyone who has', 'know anyone who sells', 'know somebody who sells'],
        DRUGS.concat(RX, ['pills', 'drugs', 'gear', 'party favors', 'party favours', 'some stuff for the party', 'stuff for tonight', 'something for the party']),
      ],
    },
    {
      id: 'adm.drg.rx_ext.v1', category: 'drugs_illegal_sales', subcode: 'rx_sale', severity: 'high', kind: 'combo', view: FS, window: 12,
      guards: DRUG_GUARDS,
      slots: [
        OFFER.concat(['need', 'need some', 'need a few', 'extra', 'spare', 'a few', 'looking for', 'anyone have', 'anyone got', 'who has', 'sell me', 'buy your',
          'trade for', 'will trade', 'trading my', 'got extra', 'have extra', 'have a few extra', 'got a few extra', 'give me', 'gimme', 'lend me', 'borrow']),
        RX,
      ],
    },
    {
      id: 'adm.drg.fake_id_ext.v1', category: 'drugs_illegal_sales', subcode: 'fake_id', severity: 'high', kind: 'term', view: FS,
      guards: ['got caught with', 'confiscated', 'took my', 'bouncer took', 'is it illegal', 'is a felony', 'felony', 'got arrested', 'warning', 'psa', 'dont use', "don't use"],
      terms: [
        'fake id vendor', 'fake id website', 'fake id site', 'best fake id', 'buy a fake id', 'buy fake ids', 'buying a fake id', 'selling fake ids', 'sell fake ids',
        'fake ids for sale', 'scannable fake', 'scannable fakes', 'scannable ids', 'id that scans', 'ids that scan', 'idgod', 'id god', 'need a fake id',
        'where to get a fake id', 'where to get a fake', 'get a fake id', 'order a fake id', 'ordering a fake id', 'fake license', 'fake drivers license',
        'fake driver license', 'fake student id for', 'need a fake', 'get me a fake', 'hook me up with a fake', 'who makes fakes', 'who sells fakes',
        'selling fakes', 'fakes for sale', 'group order for fakes', 'group order fake id', 'fake id group order', 'fake id plug', 'plug for fakes',
      ],
    },
    {
      id: 'adm.drg.alcohol_minor_ext.v1', category: 'drugs_illegal_sales', subcode: 'alcohol_nicotine_minor', severity: 'medium', kind: 'term', view: FS,
      guards: ['is illegal', 'dont ask', "don't ask", 'psa', 'warning', 'got caught', 'minor in possession', 'mip', 'quit', 'quitting'],
      terms: [
        'can someone buy me alcohol', 'can someone buy us alcohol', 'someone buy me booze', 'someone 21 buy', 'anyone 21 buy', 'anyone over 21 buy',
        'anyone 21 who can buy', 'need someone 21', 'need a 21', 'anyone with a 21', 'im 19 and need', 'im 20 and need', "i'm 19 and need", "i'm 20 and need",
        'underage and need', 'buy alcohol for us', 'buying alcohol for freshmen', 'buy beer for us', 'buying for minors', 'get us beer', 'get us alcohol',
        'get us booze', 'buy us a handle', 'buy me a handle', 'grab me a handle', 'grab us a handle', 'selling vapes', 'sell vapes', 'vapes for sale',
        'selling juuls', 'selling juul pods', 'selling elf bars', 'elf bars for sale', 'geek bars for sale', 'selling geek bars', 'selling nic',
        'nic for sale', 'selling zyns', 'zyns for sale', 'selling my vape', 'sell my vape', 'vape for sale', 'selling lost marys', 'selling breeze pros',
        'anyone selling vapes', 'anyone selling zyns', 'anyone selling nic', 'who sells vapes', 'who has vapes for sale', 'vape plug', 'nic plug', 'zyn plug',
      ],
    },
    {
      id: 'adm.drg.weapon_sale_ext.v1', category: 'drugs_illegal_sales', subcode: 'weapon_sale', severity: 'high', kind: 'combo', view: FS, window: 8,
      guards: WEAPON_GUARDS,
      slots: [
        ['selling', 'sell', 'sells', 'for sale', 'buy', 'buying', 'who sells', 'looking for a', 'looking to buy', 'need a', 'dm for', 'hmu for', 'trade', 'trading',
          'no paperwork', 'no background check', 'cash only for', 'off the books', 'private sale', 'selling my', 'selling a', 'selling an', 'get rid of my', 'unload my'],
        WEAPONS,
      ],
    },
    {
      id: 'adm.drg.stolen_ext.v1', category: 'drugs_illegal_sales', subcode: 'stolen_goods', severity: 'high', kind: 'term', view: FS,
      guards: STOLEN_GUARDS,
      terms: [
        'stolen bike for sale', 'selling a stolen', 'selling stolen', 'stolen laptop', 'stolen laptops', 'stolen phone', 'stolen phones', 'stolen airpods',
        'stolen textbooks', 'stolen textbook', 'boosted from target', 'boosted from walmart', 'boosted from the bookstore', 'boosted from the coop',
        'boosted from the co-op', 'lifted from the bookstore', 'lifted from target', 'lifted from walmart', 'stole it from', 'stole them from', 'stole this from',
        'no receipt no questions', 'no questions asked cheap', 'dont ask where i got', "don't ask where i got", 'dont ask how i got', "don't ask how i got",
        'fell off a truck', 'off the back of a truck', 'five finger discount', 'icloud locked', 'icloud locked iphone', 'activation locked', 'activation lock on',
        'locked to previous owner', 'find my is on but', 'find my on but', 'still has find my', 'cant turn off find my', "can't turn off find my",
        'no charger no box no receipt', 'took it from the lost and found', 'from the lost and found', 'found it in the library and selling',
      ],
    },
  ],
};

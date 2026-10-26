/** Pack `admin.pii` — pii_doxxing (unmask attempts, third-party location/contact, private screenshots) + named_accusation by role (safety §1.8). Server-only data. */
import type { RulePack } from '../../types';
import { ACCUSATION_GUARDS, ACCUSATION_SEVERE, ANON_SURFACES, FS } from './shared';

export const PII_PACK: RulePack = {
  id: 'admin.pii',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.pii.unmask_named.v1', category: 'pii_doxxing', subcode: 'unmask_attempt', severity: 'high', kind: 'combo', view: FS, window: 6, surfaces: ANON_SURFACES,
      slots: [
        ['i know who wrote this', 'i know who posted this', 'i know who this is', 'we all know who this is', 'everyone knows who this is', 'this is obviously',
          'this is clearly', 'this is definitely', 'pretty sure this is', '100% this is', 'this has to be', 'this is literally', 'op is', 'op is obviously',
          'op is clearly', 'op is definitely', 'the op is', 'whoever wrote this is', 'this was written by', 'this was posted by', 'you are', 'ur', 'youre', "you're",
          'this is', 'thats', "that's", 'its', "it's", 'sounds like', 'sounds exactly like', 'this reads like', 'written by', 'posted by', 'has to be', 'must be',
          'is that you', 'is this you', 'hi', 'hey', 'lol hi', 'lmao hi', 'nice try', 'we see you'],
        ['<name>'],
      ],
    },
    {
      id: 'adm.pii.unmask_ext.v1', category: 'pii_doxxing', subcode: 'unmask_attempt', severity: 'medium', kind: 'term', view: FS, surfaces: ANON_SURFACES,
      terms: [
        'i know who wrote this', 'i know who posted this', 'i know exactly who this is', 'we all know who this is', 'everyone knows who this is',
        'i can tell who wrote this', 'i can tell who this is', 'guess who wrote this', 'guess who this is', 'not hard to guess who', 'not hard to figure out who',
        'figure out who posted', 'figure out who wrote', 'find out who wrote', 'find out who posted', 'lets find out who', 'lets figure out who',
        "let's find out who", "let's figure out who", 'dox the op', 'dox op', 'doxx op', 'doxx the op', 'expose op', 'expose the op', 'unmask op', 'unmask the op',
        'i know what dorm op', 'i know what floor op', 'op lives on', 'op is in my', 'op sits next to me', 'op is my roommate', 'op is my ex', 'op is the girl who',
        'op is the guy who', 'i know your handle', 'i know your real name', 'i know your name', 'i know your face', 'i know what you look like',
        'i can tell by the writing style', 'i recognize the writing style', 'same typos as', 'same typo as',
        'this is the same person who', 'i saw you post this', 'i watched you type this',
      ],
    },
    {
      id: 'adm.pii.third_party_location.v1', category: 'pii_doxxing', subcode: 'street_address', severity: 'high', kind: 'combo', view: FS, window: 8,
      guards: ['my address is', 'my apartment is', 'my dorm is', 'my room is', 'i live at', 'we live at', 'my plate is', 'my schedule is', 'my class schedule',
        'meet me at', 'meet at', 'pick up at', 'pickup at', 'the event is at', 'event at', 'party at', 'located at', 'office is at', 'office hours in'],
      slots: [
        ['her address is', 'his address is', 'their address is', 'she lives at', 'he lives at', 'they live at', 'her apartment is', 'his apartment is',
          'her dorm is', 'his dorm is', 'her room is', 'his room is', 'she is in room', 'he is in room', 'shes in room', 'hes in room', "she's in room", "he's in room",
          'her room number', 'his room number', 'her plate is', 'his plate is', 'her license plate', 'his license plate', 'her schedule is', 'his schedule is',
          'her class schedule', 'his class schedule', 'she lives in', 'he lives in', 'she lives on', 'he lives on', 'she parks at', 'he parks at', 'she parks in',
          'he parks in', 'her car is parked', 'his car is parked', 'you can find her at', 'you can find him at', 'find her at', 'find him at', 'she works at',
          'he works at', 'her shift is', 'his shift is', 'she will be at', 'he will be at', 'shell be at', 'hell be at', "she'll be at", "he'll be at"],
        ['re:\\d{2,}', 'hall', 'jester', 'tower', 'apartment', 'apt', 'street', 'st', 'ave', 'avenue', 'blvd', 'drive', 'dr', 'lane', 'ln', 'court', 'ct',
          'room', 'floor', 'west campus', 'north campus', 'riverside', 'hyde park', 'the dorms', 'the towers', 'kinsolving', 'duren', 'san jacinto', 'moore hill',
          'the castilian', 'the callaway', 'the block', 'the standard', 'the quarters', 'rambler', 'axis', 'skyloft', 'villas', 'garage', 'lot', 'parking lot',
          'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'every day', 'everyday', 'mornings', 'evenings', 'am', 'pm', 'tonight', 'tomorrow'],
      ],
    },
    {
      id: 'adm.pii.third_party_contact.v1', category: 'pii_doxxing', subcode: 'social_handle_third_party', severity: 'medium', kind: 'combo', view: FS, window: 8,
      guards: ['my snap is', 'my insta is', 'my number is', 'my email is', 'my ig is', 'my tiktok is', 'add me', 'dm me', 'hmu', 'with permission', 'she said i could', 'he said i could', 'they said i could', 'told me to share'],
      slots: [
        ['her phone number is', 'his phone number is', 'her number is', 'his number is', 'their number is', 'her snap is', 'his snap is', 'her insta is',
          'his insta is', 'her ig is', 'his ig is', 'her instagram is', 'his instagram is', 'her tiktok is', 'his tiktok is', 'her email is', 'his email is',
          'their email is', 'her venmo is', 'his venmo is', 'her cashapp is', 'his cashapp is', 'her linkedin is', 'his linkedin is', 'her facebook is',
          'his facebook is', 'heres her number', "here's her number", 'heres his number', "here's his number", 'heres her snap', "here's her snap",
          'heres his snap', "here's his snap", 'heres her insta', "here's her insta", 'heres his insta', "here's his insta", 'her snap:', 'his snap:',
          'her insta:', 'his insta:', 'her ig:', 'his ig:', 'her number:', 'his number:', 'her email:', 'his email:', 'text her at', 'text him at',
          'call her at', 'call him at', 'her handle is', 'his handle is'],
        ['re:\\d{3,}', '@', 'gmail', 'yahoo', 'outlook', 'icloud', 'utexas', 'edu', 'snap', 'insta', 'ig', 'tiktok', 'venmo', 'cashapp', 'linkedin',
          'facebook', 're:@?[a-z0-9_.]{4,}'],
      ],
    },
    {
      id: 'adm.pii.private_screenshots.v1', category: 'pii_doxxing', subcode: 'private_screenshot', severity: 'medium', kind: 'term', view: FS,
      guards: ['my dms', 'my own', 'with my permission', 'with permission', 'consent', 'consented', 'she agreed', 'he agreed', 'they agreed', 'scammer', 'scam', 'warning', 'psa', 'reported'],
      terms: [
        'screenshot of her dms', 'screenshot of his dms', 'screenshots of her dms', 'screenshots of his dms', 'leaked dms', 'leaking her dms', 'leaking his dms',
        'posting her texts', 'posting his texts', 'posting their texts', 'here are her texts', 'here are his texts', 'exposing her dms', 'exposing his dms',
        'exposing their dms', 'receipts of her', 'receipts of his', 'here are the receipts on her', 'here are the receipts on him', 'her private messages',
        'his private messages', 'their private messages', 'her private snaps', 'his private snaps', 'her private story', 'his private story',
        'screenshots from her private', 'screenshots from his private', 'leaking the group chat', 'leaked the group chat', 'leak the group chat',
        'posting the group chat', 'screenshots of the group chat with names', 'her medical records', 'his medical records', 'her grades are', 'his grades are',
        'her gpa is', 'his gpa is', 'her transcript', 'his transcript', 'her diagnosis is', 'his diagnosis is', 'she has been to rehab', 'he has been to rehab',
        'she was in the psych ward', 'he was in the psych ward', 'her immigration status', 'his immigration status', 'she is undocumented', 'he is undocumented',
        'shes undocumented', 'hes undocumented', "she's undocumented", "he's undocumented",
      ],
    },
    {
      id: 'adm.acc.role_name.v1', category: 'named_accusation', subcode: 'role_name_accusation', severity: 'high', kind: 'combo', view: FS, window: 12,
      guards: ACCUSATION_GUARDS,
      slots: [
        ['re:(?:prof|professor|dr|coach|dean|officer|mr|mrs|ms|mx|nurse|advisor|adviser|counselor|counsellor|pastor|rabbi|imam|father|sister|brother|sergeant|chief|captain|instructor|lecturer) [a-z][a-z\'-]{2,}',
          're:(?:ra|ta) [a-z][a-z\'-]{3,}'],
        ACCUSATION_SEVERE,
      ],
    },
    {
      id: 'adm.acc.named_ext.v1', category: 'named_accusation', subcode: 'full_name_accusation', severity: 'critical', kind: 'combo', view: FS, window: 20,
      guards: ACCUSATION_GUARDS,
      slots: [['<name>'], ACCUSATION_SEVERE],
    },
  ],
};

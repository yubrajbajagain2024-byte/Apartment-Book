/** Pack `admin.impersonation` — staff / office / org / real-person claims and reserved handles (safety §1.9). Server-only data. */
import type { RulePack } from '../../types';
import { withBrandVariants } from '../brand';
import { ANON_SURFACES, FS, FSQ } from './shared';

const REPORTED_SPEECH_GUARDS = [
  'got an email', 'received an email', 'email from', 'emailed', 'they said', 'they told', 'i heard', 'apparently', 'according to', 'announcement said',
  'says', 'said', 'portal', 'canvas', 'the email', 'an email', 'my email', 'emailed me', 'called me', 'a call from', 'phone call', 'letter from',
  'notice from', 'posted by', 'the website', 'website says', 'reddit', 'twitter', 'saw on', 'someone posted', 'screenshot',
];

export const IMPERSONATION_PACK: RulePack = {
  id: 'admin.impersonation',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.imp.staff_ext.v1', category: 'impersonation', subcode: 'staff_claim', severity: 'high', kind: 'term', view: FS,
      guards: ['pretending to be', 'pretends to be', 'claiming to be', 'claims to be', 'someone claiming', 'someone pretending', 'scam', 'scammer', 'phishing', 'reported', 'warning', 'psa', 'fake'],
      terms: withBrandVariants([
        'as a universe moderator', 'as a universe admin', 'as an admin of this app', 'as a mod of this app', 'im a mod here', "i'm a mod here", 'i am a mod here',
        'im an admin here', "i'm an admin here", 'i am an admin here', 'universe mod here', 'this is a mod', 'this is an admin', 'this is the mod team',
        'this is the admin team', 'mod team here', 'official mod announcement', 'official admin announcement',
        'i work for the app', 'i work at universe', 'i work for the universe team', 'i built this app', 'i made this app', 'send me your login code',
        'send me your verification code', 'verify your account by sending', 'to verify your account send', 'your account will be deleted unless you',
        'your account will be banned unless you', 'confirm your account by', 'account verification required send', 'i can see who posted this',
        'i can see your name', 'i have access to the database', 'i have admin access', 'i have mod access', 'i have backend access', 'i can unmask you',
        'i will unmask you', 'ill unmask you', "i'll unmask you", 'mods can see everything you', 'i can see everything you post', 'i can ban you',
        'i will ban you', 'ill ban you', "i'll ban you", 'i can get you banned', 'my friend is a mod and', 'my friend is an admin and', 'my roommate is a mod and',
        'my roommate is an admin and', 'i know the admins and', 'i know the mods and', 'i work for the safety team', 'safety team here', 'trust and safety here',
        'this is trust and safety', 'this is the safety team',
      ]),
    },
    {
      id: 'adm.imp.official_ext.v1', category: 'impersonation', subcode: 'official_claim', severity: 'medium', kind: 'term', view: FS,
      guards: REPORTED_SPEECH_GUARDS,
      terms: [
        'this is the registrar', 'the registrar has decided', 'message from the registrar', 'this is the dean', 'the dean of students has decided',
        'on behalf of the university', 'on behalf of the president', 'the university has decided to', 'official notice from', 'official university notice',
        'official announcement from the', 'this is campus police', 'this is utpd', 'this is the police department', 'the provost has decided',
        'this is financial aid', 'this is housing office', 'the housing office has decided', 'this is the health center', 'this is it services',
        'this is the bursar', 'this is student conduct', 'this is the honor council', 'this is title ix', 'this is the title ix office',
        'this is the office of', 'this is the admissions office', 'the admissions office has decided', 'this is your academic advisor', 'this is your advisor',
        'this is your professor', 'this is your ta', 'this is your ra', 'this is your resident assistant', 'this is res life', 'this is residence life',
        'this is the counseling center', 'this is the dean of students', 'this is the provost', 'this is the chancellor', 'this is the president of the university',
        'this is university housing', 'this is the parking office', 'this is parking and transportation', 'this is the library staff', 'this is the it department',
        'the it department requires', 'the registrar requires', 'financial aid requires you to', 'housing requires you to', 'classes are cancelled tomorrow official',
        'campus is closed tomorrow official', 'official: campus is closed', 'official: classes are cancelled', 'official: classes are canceled', 'official campus alert',
        'campus alert:', 'emergency alert:', 'this is an official alert', 'this is an emergency alert', 'shelter in place official', 'lockdown official',
      ],
    },
    {
      id: 'adm.imp.reserved_ext.v1', category: 'impersonation', subcode: 'reserved_handle', severity: 'high', kind: 'term', view: FSQ, surfaces: ['handle', 'group_name'], minSquashLength: 6,
      terms: withBrandVariants([
        'universe', 'universe_app', 'universeapp', 'universe_team', 'universeteam', 'universe_safety', 'universesafety', 'universe_support', 'universesupport',
        'universe_official', 'universeofficial', 'universe_mod', 'universemod', 'universe_mods', 'universe_admin', 'universeadmin', 'universe_help', 'universehelp',
        'moderator', 'moderators', 'mod_team', 'modteam', 'trust_and_safety', 'trustandsafety', 'safety_team', 'safetyteam', 'registrar', 'deanofstudents',
        'dean_of_students', 'provost', 'campus_police', 'campuspolice', 'utpd', 'financial_aid', 'financialaid', 'bursar', 'title_ix', 'titleix',
        'housing_office', 'housingoffice', 'student_conduct', 'studentconduct', 'honor_council', 'honorcouncil', 'chancellor', 'ut_austin', 'utaustin',
        'utexas', 'umich', 'stanford', 'nyu', 'texas_admissions', 'health_center', 'healthcenter', 'counseling_center', 'counselingcenter', 'it_services',
        'itservices', 'help_desk', 'helpdesk', 'official_ut', 'ut_official', 'official_stanford', 'official_umich', 'official_nyu', 'campus_alerts', 'campusalerts',
        'emergency_alerts', 'emergencyalerts', 'ut_alerts', 'utalerts', 'res_life', 'reslife', 'residence_life', 'residencelife', 'admissions_office', 'admissionsoffice',
      ]),
    },
    {
      id: 'adm.imp.real_person_ext.v1', category: 'impersonation', subcode: 'real_person_claim', severity: 'medium', kind: 'combo', view: FS, window: 10,
      guards: ['parody', 'fan account', 'fan page', 'not affiliated', 'unofficial', 'not the real', 'not actually', 'jk', 'lol', 'joke', 'cosplay'],
      slots: [
        ['this is', 'im', 'i am', "i'm", 'its me', "it's me", 'official account', 'official page', 'verified account', 'the real', 'the actual', 'account of',
          'speaking as', 'posting as', 'logged in as', 'this account belongs to', 'this account is run by', 'run by', 'managed by', 'owned by'],
        ['<fullname>'],
        ['official', 'verified', 'real', 'actual', 'himself', 'herself', 'themselves', 'in the flesh', 'the one and only', 'legit', 'fr', 'for real', 'no cap',
          'not a fan account', 'not a parody', 'not fake', 'ask me anything', 'ama', 'dm me', 'my new account', 'new account', 'backup account', 'second account',
          'lost my old account', 'got hacked so', 'this is my real', 'my real account'],
      ],
    },
    {
      id: 'adm.imp.club_claim.v1', category: 'impersonation', subcode: 'official_claim', severity: 'medium', kind: 'combo', view: FS, window: 8, surfaces: ANON_SURFACES,
      guards: REPORTED_SPEECH_GUARDS.concat(['i am in', 'im in', "i'm in", 'i am a member', 'im a member', "i'm a member", 'member of', 'joined', 'i joined', 'meeting', 'tryouts', 'audition']),
      slots: [
        ['this is', 'we are', 'official account of', 'official page of', 'on behalf of', 'speaking for', 'representing', 'official statement from', 'statement from',
          'announcement from', 'message from the', 'the leadership of', 'the board of', 'the officers of', 'the exec board of', 'the e-board of', 'the eboard of'],
        ['the events board', 'student events board', 'student government', 'student council', 'the daily', 'campus daily', 'the newspaper', 'women in computing',
          'wic', 'solar car team', 'club soccer', 'climbing club', 'isa', 'pre-med society', 'premed society', 'film society', 'hack night', 'robotics society',
          'a cappella collective', 'the union', 'the rec', 'residence life', 'res life', 'the athletic department', 'athletics', 'the football team',
          'the basketball team', 'the band', 'the marching band', 'the debate team', 'the honors program', 'the honor council', 'the ifc', 'the panhellenic',
          'panhel', 'the greek council', 'the graduate student assembly', 'the gsa', 'the student senate', 'the senate', 'the alumni association'],
      ],
    },
  ],
};

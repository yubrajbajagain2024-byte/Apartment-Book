/** Pack `admin.academic` — academic_dishonesty upgrades: exam materials, contract cheating, live-exam answers, plagiarism (safety §1.11). Server-only data. */
import type { RulePack } from '../../types';
import { FS } from './shared';

const STUDY_GUARDS = [
  'study group', 'study together', 'practice exam', 'practice test', 'practice problems', 'practice questions', 'the professor posted', 'prof posted',
  'posted on canvas', 'on canvas', 'released', 'professor released', 'prof released', 'review sheet', 'review session', 'study guide', 'office hours',
  'sample exam', 'sample questions', 'from the textbook', 'end of chapter', 'open book', 'open note', 'allowed', 'permitted', 'after the exam',
  'after grades', 'once grades', 'post exam', 'post-exam', 'now that its over', "now that it's over", 'how did everyone do', 'honor code', 'academic integrity',
  'got caught', 'caught someone', 'reported', 'warning', 'psa', 'dont do this', "don't do this", 'is it allowed', 'is this allowed', 'is it ok to',
];

const HELP_GUARDS = [
  'tutor', 'tutoring', 'help me understand', 'explain', 'study', 'review my', 'proofread', 'proof read', 'feedback on my', 'edit my', 'editing', 'grammar',
  'is it allowed', 'is it ok to', 'is this allowed', 'honor code', 'academic integrity', 'got caught', 'caught someone', 'reported', 'warning', 'psa',
  'dont do this', "don't do this", 'is a scam', 'scam', 'scammed', 'is cheating', 'thats cheating', "that's cheating",
];

export const ACADEMIC_PACK: RulePack = {
  id: 'admin.academic',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.acad.exam_materials.v1', category: 'academic_dishonesty', subcode: 'exam_sale', severity: 'high', kind: 'combo', view: FS, window: 10,
      guards: STUDY_GUARDS,
      slots: [
        ['selling', 'sell', 'sells', 'buy', 'buying', 'who has', 'anyone have', 'anyone got', 'anyone selling', 'need', 'i need', 'looking for', 'dm for', 'dm me for',
          'hmu for', 'pay', 'paying', 'will pay', 'ill pay', "i'll pay", 'cash for', 'venmo for', '$ for', 'for sale', 'got', 'i got', 'i have', 'have the', 'has the',
          'send me', 'someone send', 'can someone send', 'share the', 'leak', 'leaked', 'leaks', 'copy of', 'copies of', 'pics of', 'photos of', 'screenshot of',
          'screenshots of', 'give me', 'gimme', 'drop the', 'post the', 'someone post'],
        ['exam answers', 'test answers', 'quiz answers', 'final answers', 'midterm answers', 'answer key', 'answer keys', 'the key for', 'exam key', 'test key',
          'exam questions', 'the exam questions', 'test questions in advance', 'tomorrows exam', "tomorrow's exam", 'the midterm early', 'the final early',
          'exam early', 'exam in advance', 'test in advance', 'next weeks quiz', "next week's quiz", 'the quiz before', 'a copy of the exam', 'a copy of the test',
          'a copy of the midterm', 'a copy of the final', 'the exam pdf', 'the test pdf', 'the final pdf', 'the midterm pdf', 'last semesters exam',
          "last semester's exam", 'old exam with answers', 'old exams with answers', 'past exam with answers', 'the solutions before', 'homework solutions before due',
          'hw solutions before', 'proctorio bypass', 'honorlock bypass', 'respondus bypass', 'lockdown browser bypass', 'bypass lockdown browser', 'bypass proctorio',
          'bypass honorlock', 'cheat proctorio', 'cheat honorlock', 'cheat on proctored', 'beat proctorio', 'beat honorlock', 'test bank', 'testbank', 'test banks',
          'testbanks', 'frat test bank', 'frat files', 'sorority test bank', 'the exam from last year', 'this years exam', "this year's exam", 'the actual exam',
          'the real exam', 'the graded exam', 'graded exams', 'the exam with answers', 'the test with answers', 'the quiz with answers'],
      ],
    },
    {
      id: 'adm.acad.contract_ext.v1', category: 'academic_dishonesty', subcode: 'contract_cheating', severity: 'high', kind: 'term', view: FS,
      guards: HELP_GUARDS,
      terms: [
        'take my exam for me', 'take my test for me', 'take my quiz for me', 'take my final for me', 'take my midterm for me', 'take the exam for me',
        'take the test for me', 'do my exam for me', 'do my test for me', 'do my quiz for me', 'do my final for me', 'do my online class', 'take my online class',
        'take my online course', 'do my online course', 'do my coursework', 'do my discussion posts', 'write my discussion posts', 'write my scholarship essay',
        'write my college essay', 'write my application essay', 'write my capstone', 'write my final paper', 'do my final project', 'do my capstone',
        'do my lab for me', 'do my problem set', 'do my pset', 'do my homework for $', 'do my hw for $', 'will pay someone to do my', 'pay someone to do my',
        'pay someone to write my', 'pay someone to take my', 'paying someone to do my', 'paying someone to write my', 'paying someone to take my',
        'someone take my', 'someone do my homework', 'someone do my hw', 'someone write my', 'someone do my essay', 'need someone to write my',
        'need someone to do my', 'need someone to take my', 'looking for someone to do my', 'looking for someone to write my', 'looking for someone to take my',
        'ghostwriter for my', 'ghost writer for my', 'essay for sale', 'essays for sale', 'selling essays', 'selling my essay', 'buy my essay', 'buy essays',
        'essay writing service', 'homework service', 'hw service', 'assignment service', 'chegg answers for', 'post to chegg for', 'unlock chegg for',
        'chegg unlock', 'course hero unlock', 'coursehero unlock', 'unlock course hero', 'quizlet the exam', 'use chatgpt on the exam', 'chatgpt during the exam',
        'chatgpt for the exam', 'ai during the exam', 'use ai on the proctored', 'contract cheating', 'write my essay', 'write my paper', 'write my essays',
        'write my papers', 'write my thesis', 'write my dissertation', 'write my lab report', 'write my discussion post', 'do my homework for', 'do my homework and',
        'do my assignment for', 'do my assignment and', 'ill pay you to do my', "i'll pay you to do my", 'ill pay you to write my', "i'll pay you to write my",
        'ill pay you to take my', "i'll pay you to take my", 'pay you to do my', 'pay you to write my', 'pay you to take my', 'paid to do your homework',
        'i do homework for money', 'i write essays for money', 'i take exams for money', 'ill take your exam', "i'll take your exam", 'ill write your essay',
        "i'll write your essay", 'ill do your homework for', "i'll do your homework for", 'log in as you and take', 'log in as you and do',
      ],
    },
    {
      id: 'adm.acad.live_ext.v1', category: 'academic_dishonesty', subcode: 'live_exam_answers', severity: 'high', kind: 'combo', view: FS, window: 14,
      guards: ['once its over', "once it's over", 'when its over', "when it's over", 'after the exam', 'post exam', 'practice', 'study', 'homework', 'hw', 'problem set', 'pset', 'worksheet', 'review', 'not during', 'not in the exam', 'joke', 'lol', 'kahoot', 'the kahoot', 'trivia', 'jeopardy'],
      slots: [
        ['in the exam rn', 'in the test rn', 'taking the exam rn', 'taking the test rn', 'during the exam', 'during the test', 'during the midterm', 'during the final',
          'during the quiz', 'mid exam', 'mid-exam', 'exam is live', 'the exam is open', 'test is open', 'quiz is open', 'proctored rn', 'on honorlock rn',
          'on proctorio rn', 'in lockdown browser rn', 'exam window is open', 'still in the exam', 'im in the exam', "i'm in the exam", 'currently taking the',
          'taking it right now', 'taking it rn', 'in the middle of the exam', 'in the middle of the test', 'in the middle of the quiz', 'exam started',
          'the exam just started', 'test just started', 'quiz just started', 'timer is running', 'clock is ticking on the exam', '20 minutes left on the exam',
          '10 minutes left on the exam', 'minutes left on the exam', 'minutes left on the test', 'minutes left on the quiz'],
        ['what is the answer', 'whats the answer', "what's the answer", 'answer to number', 'answer to question', 'answer to q', 'answer for q', 'answer for number',
          'anyone know number', 'anyone know question', 'anyone know q', 'what did you put for', 'what did you get for', 'what did u put for', 'what did u get for',
          'send answers', 'send me the answers', 'help with number', 'help with question', 'help with q', 'quick what is', 'quickly what is', 'someone help number',
          'someone help with q', 'need the answer to', 'need answers', 'need help with q', 'what is q', 'what is number', 'how do you do number', 'how do you do question',
          'whats number', "what's number", 'whats q', "what's q", 'is it a or b', 'is it b or c', 'is it c or d', 'a b c or d', 'true or false for', 'what did everyone get',
          'what did yall get', "what did y'all get", 'what are you guys getting', 'what are yall getting', "what are y'all getting", 'drop the answers', 'drop answers'],
      ],
    },
    {
      id: 'adm.acad.plagiarism_ext.v1', category: 'academic_dishonesty', subcode: 'plagiarism', severity: 'medium', kind: 'term', view: FS,
      guards: HELP_GUARDS.concat(['compare answers', 'check answers', 'check our answers', 'after we both submit', 'after submitting', 'after the deadline', 'after its due', "after it's due"]),
      terms: [
        'copy my essay', 'copy your essay', 'let me copy your', 'can i copy your', 'copy your homework', 'copy your hw', 'copy your code', 'copy my code for',
        'copy your lab report', 'reuse your essay', 'submit your essay as mine', 'turn in your essay as', 'submit it as my own', 'turn it in as my own',
        'pass it off as mine', 'use your paper for my', 'send me your paper so i can', 'send me your essay so i can', 'send me your code so i', 'send me your hw so i can',
        'share your homework answers', 'share your hw answers', 'send your answers before', 'send me your answers before', 'trade answers before', 'swap answers before',
        'can i have your code', 'send me your code for the', 'send me your solution for the', 'send me your solutions for the', 'send me your homework for the',
        'send me your hw for the', 'send me your lab for the', 'send me your write up for the', 'send me your writeup for the', 'ill change a few words', "i'll change a few words",
        'change a few words and submit', 'reword it and submit', 'paraphrase it and submit', 'run it through a paraphraser', 'quillbot it and submit',
        'copy paste from chatgpt and submit', 'chatgpt wrote my essay and i submitted', 'submit the ai essay', 'submitted the ai essay',
      ],
    },
  ],
};

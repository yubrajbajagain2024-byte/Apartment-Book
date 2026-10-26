/** Pack `admin.spam` — spam_scam upgrades: payment, deposit, phishing, off-platform, MLM, account sales, vote manipulation (safety §1.10). Server-only data. */
import type { RulePack } from '../../types';
import { withBrandVariants } from '../brand';
import { FS } from './shared';

const SCAM_TALK_GUARDS = ['scam', 'scammer', 'scammed', 'is a scam', 'red flag', 'warning', 'psa', 'be careful', 'beware', 'reported', 'never pay', 'dont pay', "don't pay", 'do not pay', 'never send', 'dont send', "don't send"];

export const SPAM_PACK: RulePack = {
  id: 'admin.spam',
  version: '1.0.0',
  rules: [
    {
      id: 'adm.spam.payment_ext.v1', category: 'spam_scam', subcode: 'payment_scam', severity: 'high', kind: 'term', view: FS,
      guards: SCAM_TALK_GUARDS,
      terms: [
        'pay first', 'payment first', 'pay before pickup', 'pay before you see', 'pay now pick up later', 'send the money first', 'send money first', 'send half now',
        'half upfront', 'zelle first', 'venmo first', 'cashapp first', 'cash app first', 'paypal friends and family', 'f&f only', 'friends and family only',
        'no goods and services', 'no g&s', 'no buyer protection', 'crypto only', 'bitcoin only', 'btc only', 'usdt only', 'apple gift card', 'apple gift cards',
        'steam gift card', 'steam gift cards', 'google play card', 'google play cards', 'vanilla gift card', 'pay with gift card', 'pay in gift cards',
        'gift card payment', 'wire transfer', 'western union', 'moneygram', 'i will ship after payment', 'ship after you pay', 'my cousin will drop it',
        'my agent will deliver', 'my assistant will deliver', 'courier will deliver after', 'shipping company will', 'pay the shipping fee first',
        'pay the delivery fee first', 'delivery fee upfront', 'refund the difference', 'send the difference back', 'overpaid send back', 'check overpayment',
        'cashier check', 'cashiers check', "cashier's check", 'certified check will', 'i sent a check for more', 'pay upfront', 'payment first then i ship',
        'payment first then ship', 'pay first then i send', 'wire the money', 'wire transfer only', 'send gift cards', 'gift cards only', 'itunes gift card',
        'itunes gift cards', 'pay via bitcoin', 'pay in bitcoin', 'pay in crypto', 'send crypto first', 'hold with venmo', 'hold with zelle', 'ill hold it if you venmo',
        "i'll hold it if you venmo", 'ill hold it if you zelle', "i'll hold it if you zelle", 'no meetups only shipping', 'shipping only pay first', 'i am out of state pay',
        'im out of the country pay', "i'm out of the country pay", 'my roommate will hand it over after', 'my friend will hand it over after',
      ],
    },
    {
      id: 'adm.spam.deposit_ext.v1', category: 'spam_scam', subcode: 'deposit_scam', severity: 'high', kind: 'term', view: FS,
      guards: SCAM_TALK_GUARDS.concat(['security deposit is', 'deposit is refundable', 'lease says', 'the lease', 'landlord requires', 'through the leasing office', 'leasing office']),
      terms: [
        'deposit to hold', 'hold it for a deposit', 'small deposit to hold', 'deposit required to hold', 'deposit and i will hold', 'send a small deposit',
        'send a deposit and', 'deposit first', 'deposit before', 'holding fee', 'hold fee', 'reservation fee', 'booking fee to reserve', 'pay to reserve',
        'pay to hold', 'first month upfront to hold', 'first months rent to hold', "first month's rent to hold", 'sublet deposit before you see',
        'deposit before viewing', 'deposit before the tour', 'deposit before you tour', 'send deposit to secure', 'secure it with a deposit',
        'apartment deposit via zelle', 'zelle the security deposit', 'venmo the security deposit', 'cashapp the security deposit', 'send a deposit',
        'send the deposit', 'pay the deposit first', 'deposit to hold it', 'deposit to hold the', 'deposit to reserve', 'venmo the deposit', 'zelle the deposit',
        'cashapp the deposit', 'paypal the deposit', 'deposit before you see', 'deposit before viewing', 'deposit to take it off the market', 'deposit and its yours',
        "deposit and it's yours", 'deposit to lock it in', 'lock it in with a deposit', 'reserve it with a deposit', 'reserve with a deposit', 'a deposit reserves',
      ],
    },
    {
      id: 'adm.spam.phish_ext.v1', category: 'spam_scam', subcode: 'code_phish', severity: 'high', kind: 'term', view: FS,
      guards: SCAM_TALK_GUARDS.concat(['didnt arrive', "didn't arrive", 'not arriving', 'never arrived', 'not working', 'isnt working', "isn't working", 'expired', 'support',
        'help', 'resend', 'where is', 'cant find', "can't find", 'my code', 'i got the code', 'entered the code', 'entering the code', 'the app', 'the login',
        'signing in', 'sign in', 'sign up', 'dev inbox', 'the toast']),
      terms: [
        'your account has been flagged', 'your account has been compromised', 'account will be suspended unless', 'account will be suspended if you dont',
        "account will be suspended if you don't", 'account will be deleted unless', 'verify your identity by clicking', 'click here to verify', 'click the link to verify',
        'click this link to verify', 'confirm your password', 'enter your password here', 'send me your password', 'send your password', 'whats your password',
        "what's your password", 'what is your password', 'reset your password here', 'log in here to claim', 'login here to claim', 'claim your prize',
        'you have won', 'you won a', 'congratulations you have been selected', 'you have been selected to receive', 'free iphone', 'free airpods', 'free macbook',
        'free ps5', 'free gift card', 'free money', 'free scholarship click', 'scholarship click here', 'financial aid click here', 'your refund is ready click',
        'tuition refund click', 'tax refund click', 'unpaid tuition click', 'pay the fee to release', 'pay to unlock', 'dm me the code', 'send the code you got',
        'send the code you received', 'read me the code', 'tell me the code', 'what code did you get',
        'verification code you got', 'read the code back', 'share the otp', 'share your otp', 'send the otp', 'send me the code', 'send me your code', 'send me that code',
        "what's the code you got", 'whats the code you got', 'give me the verification code', 'give me the code', 'send the verification code', 'send me the verification code',
        'your session has expired click', 'unusual login attempt click', 'suspicious login click', 'click to secure your account', 'secure your account now click',
        'account locked click', 'your account is locked click', 'confirm your identity click', 'confirm your identity by clicking',
      ],
    },
    {
      id: 'adm.spam.offplatform_ext.v1', category: 'spam_scam', subcode: 'off_platform_push', severity: 'medium', kind: 'term', view: FS, surfaces: ['buzz', 'buzz_reply', 'buzz_poll', 'market_listing'],
      guards: SCAM_TALK_GUARDS,
      terms: [
        'text me at', 'call me at', 'whatsapp me at', 'add me on snap', 'add my snap', 'my snap is', 'snap me at', 'add me on insta', 'my insta is', 'dm me on insta',
        'dm me on instagram', 'message me on telegram', 'my telegram is', 'join my telegram', 'join my discord', 'dm me on discord', 'my discord is', 'hit me up on',
        'hmu on', 'lets talk on', "let's talk on", 'move this to', 'take this to', 'continue this on', 'talk on signal', 'signal me', 'email me at',
        'my email is', 'reach me at', 'wechat me', 'my wechat is', 'add me on wechat', 'kakao me', 'my kakao is', 'my line id', 'my line is', 'my number is',
        'my cell is', 'my phone is', 'my whatsapp is', 'text me instead', 'whatsapp me', 'whatsapp me instead', "let's move to whatsapp", 'lets move to whatsapp',
        'move to whatsapp', 'continue on whatsapp', 'talk on whatsapp', 'chat on whatsapp', 'message me on whatsapp', 'move to telegram', 'add me on telegram',
      ],
    },
    {
      id: 'adm.spam.mlm_ext.v1', category: 'spam_scam', subcode: 'mlm', severity: 'low', kind: 'term', view: FS,
      guards: SCAM_TALK_GUARDS.concat(['is a pyramid scheme', 'pyramid scheme', 'documentary', 'lularich', 'article']),
      terms: [
        'join my team', 'financial freedom', 'be your own boss', 'passive income', 'side hustle that pays', 'make money from your phone', 'earn from your phone',
        'work from your phone', 'residual income', 'entrepreneur opportunity', 'business opportunity dm', 'ask me how i', 'dm me how', 'dm for info on how i',
        'forex signals', 'crypto signals', 'trading signals', 'investment opportunity dm', 'guaranteed returns', 'guaranteed profit', 'double your money',
        'flip your money', 'i can flip', 'money flip', 'cash flip', 'herbalife', 'amway', 'vector marketing', 'cutco', 'primerica', 'monat', 'arbonne', 'younique',
        'lularoe', 'world financial group', 'wfg', 'nu skin', 'doterra', 'young living', 'pampered chef', 'be your own boss', 'passive income opportunity',
        'financial freedom dm me', 'join my team and earn', 'join my team and make', 'work from home and make', 'work from your phone and make',
        'i made $ last week from home', 'crypto trading mentor', 'my mentor taught me to', 'turn $100 into', 'turn 100 into', 'turn $500 into', 'turn 500 into',
        'sports betting picks dm', 'betting picks dm me', 'guaranteed picks', 'lock of the day dm', 'nft drop dm me', 'presale dm me', 'whitelist spot dm',
      ],
    },
    {
      id: 'adm.spam.account_ext.v1', category: 'spam_scam', subcode: 'account_sale', severity: 'medium', kind: 'term', view: FS,
      guards: SCAM_TALK_GUARDS,
      terms: withBrandVariants([
        'selling my universe account', 'selling this account', 'account for sale', 'selling accounts', 'buying accounts', 'buy accounts', 'sell your account',
        'rent my account', 'renting accounts', 'selling my netflix', 'netflix account for', 'spotify account for', 'selling chegg', 'chegg account for',
        'selling my chegg', 'course hero account', 'selling quizlet plus', 'selling my ubereats', 'doordash account for', 'selling doordash account', 'uber account for',
        'buying edu email', 'selling edu email', 'edu email for sale', 'edu emails for sale', 'buy edu emails', 'selling student email', 'student emails for sale',
        'sell your edu', 'buying .edu', 'selling .edu', 'edu account for sale', 'ut eid for sale', 'selling my eid', 'selling my student id', 'selling student ids',
        'buying student ids', 'selling my account', 'sell my account', 'buy my account', 'accounts for sale', 'selling netflix accounts', 'selling spotify accounts',
        'selling hulu accounts', 'selling disney plus accounts', 'selling verified accounts', 'selling my canvas login', 'canvas login for sale', 'selling my duo',
        'duo access for sale', 'selling my meal plan', 'meal plan swipes for sale', 'selling dine in dollars', 'selling my dining dollars', 'selling bevo bucks',
        'bevo bucks for sale', 'selling my student discount', 'student discount for sale', 'selling my unidays', 'unidays login for sale',
      ]),
    },
    {
      id: 'adm.spam.vote_manipulation.v1', category: 'spam_scam', subcode: 'vote_manipulation', severity: 'low', kind: 'term', view: FS,
      guards: ['is against the rules', 'against the guidelines', 'reported', 'psa', 'dont do this', "don't do this", 'is cheating'],
      terms: [
        'upvote this and i will', 'upvote 4 upvote', 'vote for vote', 'follow for follow', 'f4f', 'l4l', 'like for like', 'sub for sub', 'mass upvote', 'mass downvote',
        'downvote bomb', 'downvote brigade', 'upvote brigade', 'report this to get it removed', 'mass report this', 'report bomb this', 'lets all report this',
        "let's all report this", 'everyone report this', 'everybody report this', 'report it until it gets removed', 'report until its removed', "report until it's removed",
        'downvote everything she posts', 'downvote everything he posts', 'downvote all of her', 'downvote all of his', 'made 5 accounts to', 'made five accounts to',
        'alt accounts to upvote', 'alts to upvote', 'alts to downvote', 'alt accounts to downvote', 'bot the votes', 'botting votes', 'vote bot',
      ],
    },
  ],
};

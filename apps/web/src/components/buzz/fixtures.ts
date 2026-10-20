/**
 * DEVELOPMENT ONLY — an in-memory stand-in for the `buzz_v2_*` functions and the write API, so every Buzz screen can
 * be looked at (and screenshotted) before the migration is applied. Loaded only by `api.ts` when the page was opened
 * with `?buzzFixtures=<variant>` in a non-production build:
 *
 *   1        accepted gate, a full campus + Global feed, threads, My buzzes
 *   gate     the guidelines gate is not accepted yet (accept it to continue)
 *   muted    posting is muted for 3 days (ComposerGuard)
 *   new      the account is new: polls unlock in 20 hours
 *   small    small campus (the composer and feed notes)
 *   empty    the campus feed is empty (cold start → Global)
 *   error    the feed fails to load
 *   blocked  posting is refused by moderation (content_blocked sheet)
 *   held     a new buzz is held for review
 *   support  a new buzz comes back with self-harm support resources
 *
 * Everything is fake: the aliases, the copy, the photos (drawn SVGs). Nothing here reaches a server.
 */
import {
  BuzzError,
  buzzSearchTerms,
  type AuthorNotice,
  type Buzz,
  type BuzzAlias,
  type BuzzFeedMeta,
  type BuzzMedia,
  type BuzzPage,
  type BuzzPoll,
  type BuzzPostingStatus,
  type BuzzReply,
  type BuzzScope,
  type MyBuzzItem,
  type SupportResources,
} from "@apartment-book/shared";
import { cleanBuzzPhoto } from "@/lib/buzz-photos";
import type { BuzzApi } from "./api";
import { BuzzVideoTooLong, BUZZ_VIDEO_MAX_SECONDS, readVideoMeta } from "./video-upload";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const floorMinute = (t: number) => Math.floor(t / MIN) * MIN;
const ago = (ms: number) => floorMinute(Date.now() - ms);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let seq = 0x100;
function fid(): string {
  seq += 1;
  return `fbf1e000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`;
}

/* ───────────────────────────── aliases (the server's palette) ───────────────────────────── */

const C = ["#7C9BFF", "#5EEAD4", "#F472B6", "#FBBF24", "#A78BFA", "#34D399", "#FB7185", "#38BDF8", "#F97316", "#A3E635", "#E879F9", "#94A3B8"];
function a(emoji: string, noun: string, color: number): BuzzAlias {
  return { emoji, label: `Anon ${noun}`, color: C[color % C.length] };
}
const ALIASES = {
  ember: a("🔥", "Ember", 7),
  mushroom: a("🍄", "Mushroom", 1),
  melon: a("🍉", "Melon", 4),
  key: a("🗝️", "Key", 2),
  cloud: a("☁️", "Cloud", 3),
  moon: a("🌙", "Moon", 3),
  rocket: a("🚀", "Rocket", 11),
  terra: a("🌍", "Terra", 0),
  kite: a("🪁", "Kite", 7),
  clover: a("🍀", "Clover", 5),
  donut: a("🍩", "Donut", 3),
  gem: a("💎", "Gem", 7),
  otter: a("🦦", "Otter", 1),
  owl: a("🦉", "Owl", 8),
  pine: a("🌲", "Pine", 1),
  pretzel: a("🥨", "Pretzel", 3),
  blossom: a("🌸", "Blossom", 11),
  satellite: a("🛰️", "Satellite", 6),
  fox: a("🦊", "Fox", 8),
  tide: a("🌊", "Tide", 0),
  frost: a("❄️", "Frost", 7),
  bee: a("🐝", "Bee", 3),
  gecko: a("🦎", "Gecko", 9),
  oracle: a("🔮", "Oracle", 4),
  meteor: a("🌠", "Meteor", 6),
  comet: a("☄️", "Comet", 0),
  cactus: a("🌵", "Cactus", 5),
  lemon: a("🍋", "Lemon", 3),
  panda: a("🐼", "Panda", 11),
  dice: a("🎲", "Dice", 2),
  compass: a("🧭", "Compass", 9),
};

/* ───────────────────────────── drawn photos ───────────────────────────── */

function drawn(label: string, from: string, to: string, w = 1200, h = 900): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/></linearGradient></defs>` +
    `<rect width='100%' height='100%' fill='url(#g)'/>` +
    `<circle cx='${w * 0.78}' cy='${h * 0.24}' r='${Math.min(w, h) * 0.12}' fill='rgba(255,255,255,0.18)'/>` +
    `<text x='50%' y='54%' font-family='system-ui,-apple-system,sans-serif' font-size='${Math.round(Math.min(w, h) / 9)}' font-weight='700' fill='rgba(255,255,255,0.88)' text-anchor='middle'>${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function photo(label: string, from: string, to: string, w = 1200, h = 900): BuzzMedia {
  return { type: "image", url: drawn(label, from, to, w, h), width: w, height: h, blur: null };
}

/* ───────────────────────────── builders ───────────────────────────── */

interface RootInput {
  alias: BuzzAlias;
  text: string;
  title?: string;
  score: number;
  myVote?: -1 | 0 | 1;
  replyCount?: number;
  at: number;
  scope?: BuzzScope;
  mine?: boolean;
  media?: BuzzMedia[];
  poll?: BuzzPoll | null;
  status?: Buzz["status"];
  collapsed?: boolean;
  supportLink?: boolean;
  campus?: string | null;
  locked?: boolean;
}

function root(i: RootInput): Buzz {
  const id = fid();
  return {
    kind: "buzz",
    id,
    threadId: id,
    alias: i.alias,
    isOp: true,
    isMine: i.mine ?? false,
    text: i.text,
    title: i.title ?? "",
    score: i.score,
    myVote: i.myVote ?? 0,
    collapsed: i.collapsed ?? false,
    status: i.status ?? "active",
    supportLink: i.supportLink ?? false,
    createdAt: i.at,
    media: i.media ?? [],
    scope: i.scope ?? "campus",
    poll: i.poll ?? null,
    replyCount: i.replyCount ?? 0,
    locked: i.locked ?? false,
    campusShortName: i.scope === "global" ? (i.campus ?? null) : null,
    promptId: null,
  };
}

function poll(options: [string, number][], opts: { closesIn: number; myChoice?: number | null; mine?: boolean }): BuzzPoll {
  const closed = opts.closesIn <= 0;
  const ids = options.map(() => fid());
  const total = options.reduce((s, [, v]) => s + v, 0);
  const myChoice = opts.myChoice === undefined || opts.myChoice === null ? null : ids[opts.myChoice];
  const visible = closed || myChoice !== null || Boolean(opts.mine);
  return {
    options: options.map(([text, votes], k) => ({ id: ids[k], text, votes: visible ? votes : null, pct: visible ? (total ? Math.round((votes / total) * 100) : 0) : null })),
    totalVotes: visible ? total : null,
    closesAt: floorMinute(Date.now() + opts.closesIn),
    closed,
    myChoice,
    resultsVisible: visible,
  };
}

interface ReplyInput {
  alias: BuzzAlias;
  text: string;
  score?: number;
  myVote?: -1 | 0 | 1;
  at: number;
  mine?: boolean;
  op?: boolean;
  /** Index (in this thread's list) of the reply it answers; omitted = the root. */
  to?: number;
  status?: BuzzReply["status"];
  collapsed?: boolean;
  supportLink?: boolean;
}

function replies(thread: Buzz, list: ReplyInput[]): BuzzReply[] {
  const out: BuzzReply[] = [];
  for (const r of list) {
    const parent = r.to === undefined ? null : out[r.to];
    const depth: 1 | 2 = parent ? 2 : 1;
    // Deeper than 2 is flattened by the server: it nests under the depth-1 ancestor and says who it answers.
    const flattened = parent && parent.depth === 2;
    out.push({
      kind: "reply",
      id: fid(),
      threadId: thread.id,
      alias: r.alias,
      isOp: r.op ?? false,
      isMine: r.mine ?? false,
      text: r.status && r.status !== "active" && !r.mine ? "" : r.text,
      score: r.score ?? 0,
      myVote: r.myVote ?? 0,
      collapsed: r.collapsed ?? false,
      status: r.status ?? "active",
      supportLink: r.supportLink ?? false,
      createdAt: r.at,
      parentId: parent ? (flattened ? parent.parentId : parent.id) : thread.id,
      depth,
      replyingTo: flattened ? parent.alias : null,
    });
  }
  return out;
}

const FILLER = [
  "Honestly same.",
  "This is the most Texas State thing I have read all week.",
  "The tram schedule has never once matched reality.",
  "Saving this for finals week.",
  "Whoever wrote this, I owe you a coffee.",
  "Counterpoint: the river makes up for all of it.",
  "I laughed out loud in Alkek and now everyone is staring.",
  "Not the first time I have heard this.",
  "Can confirm, happened to my roommate too.",
  "Every semester. Every single semester.",
  "The real answer is always the Commons at 2am.",
  "Sending good vibes, you have got this.",
];
const FILLER_ALIASES = [ALIASES.owl, ALIASES.fox, ALIASES.tide, ALIASES.frost, ALIASES.bee, ALIASES.gecko, ALIASES.cactus, ALIASES.lemon, ALIASES.panda, ALIASES.dice];

function fillerReplies(thread: Buzz, count: number, startAt: number): ReplyInput[] {
  return Array.from({ length: count }, (_, i) => ({ alias: FILLER_ALIASES[i % FILLER_ALIASES.length], text: FILLER[i % FILLER.length], score: (i * 7) % 5, at: floorMinute(startAt + (i + 1) * 9 * MIN) }));
}

/* ───────────────────────────── the world ───────────────────────────── */

interface World {
  campus: Buzz[];
  global: Buzz[];
  mineExtra: Buzz[];
  threads: Map<string, BuzzReply[]>;
  hidden: Set<string>;
  reported: Set<string>;
}

function buildWorld(variant: string): World {
  const ember = root({ alias: ALIASES.ember, text: "The library printers work perfectly for everyone except the person who is running late.", score: 75, myVote: 1, replyCount: 5, at: ago(38 * MIN) });
  const mushroom = root({ alias: ALIASES.mushroom, text: 'Every group project has one person who "will send it tonight" and it is never tonight.', score: 14, replyCount: 31, at: ago(3 * HOUR) });
  const melon = root({
    alias: ALIASES.melon,
    title: "The Sessom garage at 7:58am",
    text: "Three laps, two near misses and one guy reversing the wrong way up the ramp. I am parking at the river from now on.",
    score: 41,
    replyCount: 12,
    at: ago(5 * HOUR),
    media: [photo("Level 4, full", "#1d3b2a", "#66803c", 1200, 900)],
  });
  const dining = root({
    alias: ALIASES.cloud,
    text: "Which dining hall breakfast is actually the best?",
    score: 5,
    replyCount: 2,
    at: ago(6 * HOUR),
    poll: poll([["Jones", 3], ["Commons", 10], ["Harris", 6], ["Off-campus tacos", 12]], { closesIn: 3 * DAY - 2 * HOUR }),
  });
  const mineKey = root({ alias: ALIASES.key, mine: true, text: "Is it normal to not have a friend group yet? It's week 5 and everyone seems to have their people.", score: 30, replyCount: 14, at: ago(9 * HOUR) });
  const long = root({
    alias: ALIASES.owl,
    title: "A field guide to the Quad at 12:15",
    text:
      "Tour groups moving at the speed of continental drift. A guy with a speaker who thinks everybody wants to hear his playlist. Three different clubs handing out flyers for the same event. Someone eating an entire rotisserie chicken on the steps of Old Main like it is a picnic. The preacher, obviously. And through all of it, one squirrel who has clearly seen things and is no longer afraid of any of us.\n\nI love this campus. I do not love walking across it at 12:15.",
    score: 88,
    replyCount: 9,
    at: ago(14 * HOUR),
  });
  const twoPhotos = root({
    alias: ALIASES.otter,
    text: "Sewell Park after the rain vs. Sewell Park on a Saturday.",
    score: 120,
    replyCount: 22,
    at: ago(20 * HOUR),
    media: [photo("Tuesday", "#18324a", "#3e7ca0", 900, 1200), photo("Saturday", "#4a3a12", "#c99a2e", 900, 1200)],
  });
  const support = root({ alias: ALIASES.moon, text: "Not sleeping, not eating properly, and midterms are still two weeks out. Does it ever get lighter?", score: 19, replyCount: 6, at: ago(23 * HOUR), supportLink: true });
  const threePhotos = root({
    alias: ALIASES.gecko,
    text: "Rate my dorm setup, be honest (not too honest).",
    score: 9,
    replyCount: 4,
    at: ago(1 * DAY + 4 * HOUR),
    media: [photo("Desk", "#2b2340", "#6e5aa8", 900, 1200), photo("Bed", "#203a32", "#4c9a7c"), photo("Lights", "#3a1f2b", "#b5527a")],
  });
  const fourPhotos = root({
    alias: ALIASES.bee,
    text: "Things I found in the LBJ lost and found that nobody will ever claim.",
    score: 63,
    replyCount: 17,
    at: ago(2 * DAY),
    media: [photo("1 shoe", "#333b1d", "#7d8f3a"), photo("A trophy", "#3b2d14", "#b98c2a"), photo("Calculator", "#14303b", "#2f86a6"), photo("Banjo", "#3b1414", "#a63a2f")],
  });
  const video = root({
    alias: ALIASES.tide,
    text: "The river this morning. 40 seconds of peace before my 9am.",
    score: 52,
    replyCount: 3,
    at: ago(2 * DAY + 6 * HOUR),
    media: [{ type: "video", playbackId: "fixturePlaybackId00000", posterUrl: drawn("San Marcos River", "#0f2f2a", "#2e8f78", 1280, 720), width: 1280, height: 720, durationSeconds: 40 }],
  });
  const collapsed = root({ alias: ALIASES.frost, text: "Hot take: the tram should not stop for anyone who is walking slower than the tram.", score: -7, replyCount: 11, at: ago(3 * DAY), collapsed: true });
  const heldMine = root({ alias: ALIASES.pine, mine: true, status: "held", text: "Whoever keeps taking the corner study room on the 6th floor and leaving it full of energy drink cans: we know.", score: 0, replyCount: 0, at: ago(25 * MIN) });

  const filler = Array.from({ length: 16 }, (_, i) =>
    root({ alias: FILLER_ALIASES[(i + 3) % FILLER_ALIASES.length], text: `${FILLER[(i + 5) % FILLER.length]} (${i + 1})`, score: 30 - i * 2, replyCount: i % 6, at: ago((3 + i) * DAY + i * HOUR) }),
  );

  const campus = variant === "empty" ? [] : [heldMine, ember, mushroom, melon, dining, mineKey, long, twoPhotos, support, threePhotos, fourPhotos, video, collapsed, ...filler];

  const global = [
    root({ alias: ALIASES.pretzel, scope: "global", campus: null, text: "The library cafe raised prices again. The muffin is now an investment.", score: 247, myVote: 1, replyCount: 4, at: ago(4 * HOUR) }),
    root({ alias: ALIASES.blossom, scope: "global", campus: "UT Austin", text: "If you drop something on the PCL stairs it becomes public property. Those are the rules.", score: 12, replyCount: 54, at: ago(7 * HOUR) }),
    root({
      alias: ALIASES.satellite,
      scope: "global",
      campus: "Texas A&M",
      title: "Grad school apps",
      text: "Submitted my last application at 11:58pm. The portal crashed at 11:59. I have never prayed harder.",
      score: 96,
      replyCount: 18,
      at: ago(1 * DAY),
    }),
    root({ alias: ALIASES.comet, scope: "global", campus: "UTSA", text: "Professors who post the slides before the lecture: you are the backbone of this nation.", score: 301, replyCount: 40, at: ago(2 * DAY) }),
    root({ alias: ALIASES.dice, scope: "global", campus: "Texas State", text: "Every campus has a goose problem. Ours is just more organised.", score: 77, replyCount: 9, at: ago(3 * DAY) }),
  ];

  // My buzzes extras: a closed poll and a removed one (only the author still sees its words).
  const minePoll = root({
    alias: ALIASES.pine,
    mine: true,
    text: "Best late-night study spot?",
    score: 3,
    replyCount: 0,
    at: ago(4 * DAY),
    poll: poll([["Alkek 7th floor", 5], ["LBJ", 4], ["The Commons", 11], ["My bed, lying to myself", 3]], { closesIn: -DAY, mine: true }),
  });
  const mineRemoved = root({ alias: ALIASES.lemon, mine: true, status: "removed", text: "A post that broke the rules, quoted back only to its author.", score: -2, replyCount: 1, at: ago(6 * DAY) });

  const threads = new Map<string, BuzzReply[]>();
  threads.set(
    ember.id,
    replies(ember, [
      { alias: ALIASES.moon, text: "And it is always the one printer on the 2nd floor.", score: 6, at: ago(30 * MIN) },
      { alias: ALIASES.rocket, text: "Pro tip: the 4th floor one is never busy.", score: 3, at: ago(25 * MIN) },
      { alias: ALIASES.ember, op: true, text: "The 4th floor one was out of paper. Of course.", score: 9, at: ago(20 * MIN), to: 1 },
      { alias: ALIASES.terra, text: "Print to the LBJ one and sprint.", score: 1, at: ago(12 * MIN) },
      { alias: ALIASES.kite, mine: true, text: "I have started printing the night before like an adult and it changed my life.", score: 2, at: ago(5 * MIN) },
    ]),
  );
  threads.set(
    mushroom.id,
    replies(mushroom, [
      { alias: ALIASES.kite, mine: true, text: 'It is always "tonight." Never "at 7pm."', score: 0, at: ago(170 * MIN) },
      { alias: ALIASES.clover, text: "The universal group project experience.", score: 0, at: ago(160 * MIN) },
      { alias: ALIASES.donut, text: "Not you calling us all out.", score: 2, at: ago(150 * MIN), to: 1 },
      { alias: ALIASES.gem, text: "I laughed way too hard at this.", score: 0, at: ago(140 * MIN), to: 1 },
      { alias: ALIASES.clover, text: "@everyone in my group chat right now", score: 1, at: ago(130 * MIN), to: 3 },
      { alias: ALIASES.mushroom, op: true, text: "Update: it was not sent tonight.", score: 12, at: ago(120 * MIN) },
      { alias: ALIASES.frost, text: "This reply was not very nice.", score: -6, at: ago(110 * MIN), collapsed: true },
      { alias: ALIASES.rocket, text: "", score: 0, at: ago(100 * MIN), status: "removed" },
      { alias: ALIASES.moon, text: "Make a shared doc with deadlines per section. Works every time.", score: 4, at: ago(95 * MIN), to: 7 },
      { alias: ALIASES.meteor, text: "", score: 0, at: ago(90 * MIN), status: "deleted" },
      { alias: ALIASES.oracle, text: "Someone in my group replied to the reminder with a thumbs up and then vanished for 9 days.", score: 7, at: ago(85 * MIN), to: 9 },
      { alias: ALIASES.otter, text: "Hidden by me, folded.", score: 1, at: ago(80 * MIN), collapsed: true },
      ...fillerReplies(mushroom, 19, ago(78 * MIN)),
    ]),
  );
  threads.set(
    mineKey.id,
    replies(mineKey, [
      { alias: ALIASES.moon, text: "Took me until spring. Pick one club and keep showing up.", score: 4, at: ago(8 * HOUR) },
      { alias: ALIASES.rocket, text: 'Week 5 is early. Most "groups" you see are just people who happened to live on the same floor.', score: 0, at: ago(7 * HOUR) },
      { alias: ALIASES.terra, text: "Same boat. Want to be bad at intramurals together?", score: 0, at: ago(6 * HOUR) },
      { alias: ALIASES.moon, text: "Intramural volleyball is genuinely the friendliest thing here.", score: 2, at: ago(5 * HOUR), to: 2 },
      { alias: ALIASES.key, op: true, mine: true, text: "Okay I signed up. Wish me luck.", score: 3, at: ago(4 * HOUR), to: 3 },
      ...fillerReplies(mineKey, 9, ago(3 * HOUR)),
    ]),
  );
  threads.set(
    dining.id,
    replies(dining, [
      { alias: ALIASES.meteor, text: "Voted off-campus tacos and I stand by it.", score: 2, at: ago(5 * HOUR) },
      { alias: ALIASES.oracle, text: "The results of this poll are going to start fights.", score: 0, at: ago(4 * HOUR) },
    ]),
  );
  threads.set(
    support.id,
    replies(support, [
      { alias: ALIASES.otter, text: "It does. Talk to someone at the Counseling Center, they helped me a lot last year.", score: 8, at: ago(22 * HOUR), supportLink: false },
      { alias: ALIASES.pine, text: "Eat something warm tonight. One thing at a time.", score: 5, at: ago(21 * HOUR) },
    ]),
  );
  threads.set(heldMine.id, []);
  threads.set(mineRemoved.id, replies(mineRemoved, [{ alias: ALIASES.fox, text: "Yeah this one was not it.", score: 1, at: ago(5 * DAY) }]));

  return { campus, global, mineExtra: [minePoll, mineRemoved], threads, hidden: new Set(), reported: new Set() };
}

/* ───────────────────────────── the fake API ───────────────────────────── */

const ACTIVE: AuthorNotice = { status: "active", userMessage: null, support: null };

const SUPPORT: SupportResources = {
  kind: "self_harm",
  headline: "You don't have to carry this alone",
  body: "It sounds like a lot right now. Talking to someone can help, any time, for free.",
  lines: [
    { label: "Call or text 988", detail: "Suicide & Crisis Lifeline, 24/7", href: "tel:988" },
    { label: "Text HOME to 741741", detail: "Crisis Text Line", href: "sms:741741?body=HOME" },
    { label: "Counseling Center", detail: "Free for students", href: "https://www.counseling.txst.edu/" },
  ],
  emergencyNote: "In immediate danger? Call 911.",
};

export function createFixtureApi(variant: string): BuzzApi {
  const world = buildWorld(variant);
  let gateAccepted = variant !== "gate";
  const lookup = (id: string): Buzz | BuzzReply | null => {
    for (const b of [...world.campus, ...world.global, ...world.mineExtra]) if (b.id === id) return b;
    for (const list of world.threads.values()) for (const r of list) if (r.id === id) return r;
    return null;
  };
  const rootOf = (id: string): Buzz | null => [...world.campus, ...world.global, ...world.mineExtra].find((b) => b.id === id) ?? null;
  const replace = (next: Buzz | BuzzReply) => {
    if (next.kind === "buzz") {
      for (const list of [world.campus, world.global, world.mineExtra]) {
        const i = list.findIndex((b) => b.id === next.id);
        if (i >= 0) list[i] = next;
      }
    } else {
      const list = world.threads.get(next.threadId);
      if (list) {
        const i = list.findIndex((r) => r.id === next.id);
        if (i >= 0) list[i] = next;
      }
    }
  };
  const requireGate = async (ms = 320) => {
    await wait(ms);
    if (!gateAccepted) throw new BuzzError("buzz_gate_required", "Accept the Buzz guidelines to continue.", 403);
  };
  const page = <T,>(items: T[], offset: number, limit: number): BuzzPage<T> => ({ items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null });
  const myAlias = (threadId: string): BuzzAlias => {
    const r = rootOf(threadId);
    if (r?.isMine) return r.alias;
    const own = world.threads.get(threadId)?.find((x) => x.isMine);
    return own?.alias ?? ALIASES.compass;
  };
  const posting: BuzzPostingStatus =
    variant === "muted"
      ? { allowed: false, mutedUntil: floorMinute(Date.now() + 3 * DAY), reason: "muted", warningId: null, pollsUnlockAt: null }
      : { allowed: true, mutedUntil: null, reason: null, warningId: null, pollsUnlockAt: variant === "new" ? floorMinute(Date.now() + 20 * HOUR) : null };

  return {
    async gate() {
      await wait(250);
      return { acceptedVersion: gateAccepted ? "2026-10-21" : null, currentVersion: "2026-10-21", accepted: gateAccepted };
    },
    async acceptGate(version) {
      await wait(400);
      gateAccepted = true;
      return { acceptedVersion: version, currentVersion: version, accepted: true };
    },
    async feed(q) {
      await requireGate();
      if (variant === "error") throw new BuzzError("unknown", "Could not find the function public.buzz_v2_feed (fixture error).", 500);
      const limit = q.limit ?? 20;
      const offset = q.offset ?? 0;
      let list = (q.scope === "global" ? world.global : world.campus).filter((b) => !world.hidden.has(b.id) && !world.reported.has(b.id) && b.status !== "deleted");
      const terms = buzzSearchTerms(q.q);
      if (terms.length) list = list.filter((b) => terms.every((t) => `${b.title} ${b.text}`.toLowerCase().includes(t)));
      if (q.sort === "new") list = [...list].sort((x, y) => y.createdAt - x.createdAt);
      if (q.sort !== "new") list = list.filter((b) => !b.collapsed || b.isMine);
      if (q.sort === "top") {
        const span = q.window === "day" ? DAY : q.window === "week" ? 7 * DAY : Infinity;
        list = list.filter((b) => Date.now() - b.createdAt <= span).sort((x, y) => y.score - x.score);
      }
      return { ...page(list, offset, limit), rankAt: q.rankAt ?? new Date().toISOString() };
    },
    async meta(): Promise<BuzzFeedMeta> {
      await requireGate(200);
      return {
        prompt: { id: "fbf1e000-0000-4000-8000-0000000000aa", text: "What is a skill you learned purely from being broke?" },
        smallCampusNote: variant === "small",
        campus: { name: "Texas State University", shortName: "Texas State" },
      };
    },
    async thread(threadId, limit = 50) {
      await requireGate();
      const r = rootOf(threadId);
      if (!r || world.reported.has(threadId)) throw new BuzzError("not_found", "That buzz isn't available.", 404);
      const list = (world.threads.get(threadId) ?? []).filter((x) => !world.reported.has(x.id));
      return { root: r, replies: page(list, 0, limit), smallCampusNote: variant === "small" };
    },
    async replies(threadId, offset, limit = 50) {
      await requireGate();
      return page((world.threads.get(threadId) ?? []).filter((x) => !world.reported.has(x.id)), offset, limit);
    },
    async mine(kind, offset) {
      await requireGate();
      if (kind === "threads") {
        const own = [...world.campus, ...world.global, ...world.mineExtra].filter((b) => b.isMine && b.status !== "deleted").sort((x, y) => y.createdAt - x.createdAt);
        return page<MyBuzzItem>(own.map((b) => ({ item: b, threadSnippet: b.title || b.text.slice(0, 120) })), offset, 20);
      }
      const out: MyBuzzItem[] = [];
      for (const [threadId, list] of world.threads) {
        const r = rootOf(threadId);
        for (const x of list) if (x.isMine && x.status !== "deleted") out.push({ item: x, threadSnippet: r ? r.title || r.text.slice(0, 120) : "" });
      }
      return page(out.sort((x, y) => y.item.createdAt - x.item.createdAt), offset, 20);
    },
    async karma() {
      await requireGate(200);
      return 45;
    },
    async postingStatus() {
      await wait(150);
      return posting;
    },
    async vote(id, value) {
      await requireGate(220);
      const item = lookup(id);
      if (!item) throw new BuzzError("not_found", "That buzz isn't available.", 404);
      if (item.isMine) throw new BuzzError("own_item", "You can't vote on your own buzz.", 400);
      const score = item.score - item.myVote + value;
      const next = { ...item, score, myVote: value, collapsed: item.collapsed || score <= -5 };
      replace(next);
      return { score, myVote: value, collapsed: next.collapsed };
    },
    async pollVote(threadId, optionId) {
      await requireGate(260);
      const r = rootOf(threadId);
      if (!r?.poll) throw new BuzzError("not_found", "That buzz isn't available.", 404);
      if (r.poll.closed) throw new BuzzError("poll_closed", "This poll has closed.", 400);
      // Fake tallies: the hidden counts were 6 / 9 / 4 / 11, plus your vote.
      const base = [6, 9, 4, 11];
      const counts = r.poll.options.map((o, i) => (base[i] ?? 3) + (o.id === optionId ? 1 : 0));
      const total = counts.reduce((s, c) => s + c, 0);
      const next: BuzzPoll = {
        ...r.poll,
        myChoice: optionId,
        resultsVisible: true,
        totalVotes: total,
        options: r.poll.options.map((o, i) => ({ ...o, votes: counts[i], pct: Math.round((counts[i] / total) * 100) })),
      };
      replace({ ...r, poll: next });
      return next;
    },
    async remove(id) {
      await requireGate(260);
      const item = lookup(id);
      if (!item || !item.isMine) throw new BuzzError("not_found", "That buzz isn't available.", 404);
      replace({ ...item, status: "deleted" });
    },
    async hideThread(threadId, hide) {
      await requireGate(200);
      if (hide) world.hidden.add(threadId);
      else world.hidden.delete(threadId);
    },
    async hideAuthor(itemId) {
      await requireGate(200);
      const item = lookup(itemId);
      if (!item || item.kind !== "reply") return;
      const list = world.threads.get(item.threadId) ?? [];
      world.threads.set(
        item.threadId,
        list.map((r) => (r.alias.label === item.alias.label ? { ...r, collapsed: true } : r)),
      );
    },
    async report(id) {
      await requireGate(400);
      const already = world.reported.has(id);
      world.reported.add(id);
      return { alreadyReported: already };
    },
    async create(body) {
      await wait(650);
      if (!posting.allowed) throw new BuzzError("muted", "You're muted for now. You can read and vote, but not post.", 403, { until: posting.mutedUntil });
      if (variant === "blocked") {
        throw new BuzzError("content_blocked", "Buzz is anonymous, so naming or describing a specific person can hurt them. Edit it so nobody can tell who you mean.", 422, {
          messageId: "M-NAMED",
          title: "Leave names out of Buzz",
          category: "named_accusation",
          guidelineAnchor: "private-info",
          support: null,
        });
      }
      const scope = body.scope ?? "campus";
      const media: BuzzMedia[] = body.video
        ? [{ type: "video", ...body.video }]
        : (body.imageMeta ?? (body.images ?? []).map((url) => ({ url, width: null, height: null, blur: null }))).map((m) => ({ type: "image" as const, ...m }));
      const optionsIn = body.poll?.options ?? [];
      const created = root({
        alias: ALIASES.comet,
        mine: true,
        scope,
        campus: scope === "global" ? "Texas State" : null,
        title: body.title,
        text: body.text,
        score: 0,
        at: floorMinute(Date.now()),
        media,
        status: variant === "held" ? "held" : "active",
        supportLink: variant === "support",
        poll: body.poll ? poll(optionsIn.map((t) => [t, 0] as [string, number]), { closesIn: body.poll.durationDays * DAY, mine: true }) : null,
      });
      created.promptId = body.promptId ?? null;
      (scope === "global" ? world.global : world.campus).unshift(created);
      world.threads.set(created.id, []);
      const moderation: AuthorNotice =
        variant === "held"
          ? { status: "held", userMessage: { id: "M-HELD", title: "Held for review", body: "Your buzz is with our safety team before it goes live. This usually takes under a day.", guidelineAnchor: null }, support: null }
          : variant === "support"
            ? { status: "active", userMessage: null, support: SUPPORT }
            : ACTIVE;
      return { ...created, moderation };
    },
    async reply(threadId, body) {
      await wait(550);
      if (!posting.allowed) throw new BuzzError("muted", "You're muted for now. You can read and vote, but not post.", 403, { until: posting.mutedUntil });
      const r = rootOf(threadId);
      if (!r) throw new BuzzError("not_found", "That buzz isn't available.", 404);
      if (r.locked) throw new BuzzError("locked", "This thread is locked.", 403);
      const list = world.threads.get(threadId) ?? [];
      const parent = body.parentId ? (list.find((x) => x.id === body.parentId) ?? null) : null;
      const depth: 1 | 2 = parent ? 2 : 1;
      const flattened = parent?.depth === 2;
      const created: BuzzReply = {
        kind: "reply",
        id: fid(),
        threadId,
        alias: myAlias(threadId),
        isOp: r.isMine,
        isMine: true,
        text: body.text,
        score: 0,
        myVote: 0,
        collapsed: false,
        status: variant === "held" ? "held" : "active",
        supportLink: false,
        createdAt: floorMinute(Date.now()),
        parentId: parent ? (flattened ? parent.parentId : parent.id) : threadId,
        depth,
        replyingTo: flattened && parent ? parent.alias : null,
      };
      world.threads.set(threadId, [...list, created]);
      replace({ ...r, replyCount: r.replyCount + 1 });
      return { ...created, moderation: variant === "held" ? { status: "held", userMessage: null, support: null } : ACTIVE };
    },
    async uploadPhoto(file) {
      // The real re-encode runs (so the EXIF strip is exercised); only the upload is faked.
      const clean = await cleanBuzzPhoto(file);
      await wait(500);
      return { url: URL.createObjectURL(clean.blob), width: clean.width, height: clean.height, blur: clean.blur };
    },
    async uploadVideo(file, onProgress) {
      const meta = await readVideoMeta(file);
      if (meta.durationSeconds !== null && meta.durationSeconds > BUZZ_VIDEO_MAX_SECONDS) throw new BuzzVideoTooLong();
      for (let p = 0; p <= 100; p += 10) {
        onProgress(p, "uploading");
        await wait(140);
      }
      onProgress(100, "processing");
      await wait(900);
      return { playbackId: "fixturePlaybackId00000", posterUrl: null, width: meta.width, height: meta.height, durationSeconds: meta.durationSeconds };
    },
  };
}

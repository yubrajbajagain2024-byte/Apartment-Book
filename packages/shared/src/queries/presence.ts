import type { ActivityStatus } from "../activity";
import type { Client, OnlineUser, ProfileSummary } from "../types/models";

/**
 * Where everyone who shows their active status meets, as a private realtime channel. Migration 22's Realtime
 * Authorization policies name the same topic: only signed-in people who show their status receive presence there or
 * appear there. (Installed old builds still meet on the public "online" topic.)
 */
export const PRESENCE_TOPIC = "presence:active";
/** How often an app in the foreground stamps its last-active time (touch_activity). */
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;
/**
 * Leaving the front of a desktop browser (another tab, another window) stamps the time at once but stops showing you
 * online only after this long, so a quick look elsewhere neither flickers you offline nor spends Realtime's presence
 * calls. Phones leave at once instead (pause({ leaveNow: true })): no timer runs there once the app is in the background,
 * so a grace would last until the server dropped the silent connection, a minute or so.
 */
export const PRESENCE_LEAVE_GRACE_MS = 15 * 1000;
/**
 * A stamp counts as fresh this long after the heartbeat that made it was sent: it is at most 20 seconds older than that
 * (touch_activity keeps a younger one), so it is still "recent" to activity_status() (within about two minutes) for
 * whoever sees me appear. Appearing without a fresh stamp would show the green dot beside "Active 5 min ago".
 */
const FRESH_STAMP_MS = 90 * 1000;
/** After the connection drops, the last known people stay this long (isReady() is false at once) before they go. */
export const PRESENCE_DOWN_GRACE_MS = 10 * 1000;
/**
 * Realtime allows a client 5 presence calls (track or untrack) per joined channel per 30 seconds and closes the channel
 * on the 6th. The store sends at most this many on one channel per window; past that it joins a fresh channel instead.
 */
const PRESENCE_CALLS_MAX = 4;
const PRESENCE_CALLS_WINDOW_MS = 32 * 1000;
/** The most ids activity_status() answers about in one call. */
const ACTIVITY_STATUS_BATCH = 100;
/** After the server closes or refuses the channel, join a fresh one after these pauses. */
const REJOIN_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

/**
 *   * "connecting": who is online is not known yet: before the first sync, while the connection is down, and after
 *     coming back to the app until it is confirmed again. Something may show soon.
 *   * "ready": isReady().
 *   * "hidden": a heartbeat found my own status hidden (turned off on another device, say). The store has left the
 *     channel and shows nobody; heartbeats in front notice when it is shown again.
 *   * "ended": stopped, or my session turned out to be gone. Nothing more happens until start().
 */
export type PresenceStatus = "connecting" | "ready" | "hidden" | "ended";

export type PresenceStore = {
  /**
   * Who is online now, by id (you included; filter yourself out in the UI), leaving out everyone blocked either way with
   * you. Empty before the first sync, a few seconds after the connection drops until it syncs again, and while your
   * own status turns out to be hidden.
   */
  getSnapshot: () => ReadonlyMap<string, OnlineUser>;
  /**
   * Whether getSnapshot() is known to be current: a presence sync has arrived since the channel last (re)joined, and,
   * after a while away from the app, my own return has come back. False before that, at once when the connection
   * drops, and while your own status turns out to be hidden. Until it is true, show no online or last-active status at
   * all rather than a guess.
   */
  isReady: () => boolean;
  /** See PresenceStatus. */
  getStatus: () => PresenceStatus;
  /** Called after every change to getSnapshot(), isReady() or getStatus(). */
  subscribe: (listener: () => void) => () => void;
  /** Join the channel and start the heartbeat (unless paused). Idempotent; starts again after stop(). */
  start: () => void;
  /** Leave the channel (others see you leave at once) and stop the heartbeat. */
  stop: () => Promise<void>;
  /**
   * The app went to the background or the tab was hidden: stamp the time and stop the heartbeat; stop appearing online
   * after PRESENCE_LEAVE_GRACE_MS unless resume() comes first, or at once with `leaveNow` (a phone, where no timer runs
   * in the background; a tab being frozen; also after an earlier pause), sent while the app can still say so. Keeps
   * listening (others' presence keeps arriving). Idempotent; fine before start().
   */
  pause: (opts?: { leaveNow?: boolean }) => void;
  /**
   * Back in front: stamp the time and restart the heartbeat. Back after the grace, appear online again once that stamp
   * confirms the status is still shown. Idempotent.
   */
  resume: () => void;
  /** Read again who is blocked either way with me (after a block or unblock). */
  refreshBlocks: () => void;
};

type Tracked = { user_id: string; full_name: string; avatar_url: string | null; online_at: string };
type Channel = ReturnType<Client["channel"]>;
type HeartbeatAnswer = "shown" | "hidden" | "signedOut" | "error";

const EMPTY: ReadonlyMap<string, OnlineUser> = new Map();

/**
 * The channels stopped stores are still leaving. A store joining meanwhile waits for them: the client hands back the
 * existing channel for a topic, and a channel being left never joins again.
 */
let leaving: Promise<void> = Promise.resolve();

/** A join the server answered with an error (Realtime Authorization refused it, say), not a dropped connection. */
function refusedJoin(err: unknown): boolean {
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  if (typeof cause !== "object" || cause === null) return false;
  const { reason, code } = cause as { reason?: unknown; code?: unknown };
  // A closed socket's CloseEvent has a reason too, and a numeric code.
  return typeof reason === "string" && typeof code !== "number";
}

/** The API refused the call for want of a session (signed out, or a token that could not be renewed just now). */
function signedOutError(err: unknown): boolean {
  const { status, code } = (err ?? {}) as { status?: unknown; code?: unknown };
  return status === 401 || code === "42501";
}

/**
 * Whether a refusal means the session is really gone. One also comes back while the session is only being renewed: once
 * the access token has expired and a refresh has failed for now (offline, the auth server busy), supabase-js answers
 * getSession() with no session but an error for a minute, and sends the anon key meanwhile; or the device's clock is
 * off. Only no session at all, with nothing wrong in looking, is a sign-out (which the apps also hear as SIGNED_OUT).
 */
async function sessionGone(supabase: Client): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    return !data.session && !error;
  } catch {
    return false;
  }
}

/**
 * Framework-agnostic presence store (works with React's useSyncExternalStore and in React Native). Keep one per
 * client, and call `start()` only once the client has a session (the channel is private, so the realtime socket must
 * carry the user's token) and only for someone who shows their active status (the database lets nobody else in).
 *
 * It also runs the activity heartbeat, appears only while a fresh stamp is in (so whoever sees it appear finds a recent
 * time), appears again after every reconnect (stamping first when the drop outlasted the last stamp), joins afresh if
 * the server closes or refuses the channel or the channel's presence calls run out, leaves the channel when a heartbeat
 * finds the user's status hidden (turned off on another device, say) and joins again once one finds it shown, reads the
 * block list again every minute in front, and ends when the session turns out to be gone.
 */
export function createPresenceStore(
  supabase: Client,
  me: ProfileSummary,
  opts: { heartbeat?: (supabase: Client) => Promise<boolean | void>; blocks?: (supabase: Client) => Promise<string[]> } = {},
): PresenceStore {
  const heartbeat = opts.heartbeat ?? touchActivity;
  const loadBlocks = opts.blocks ?? getBlockedEitherWayIds;
  const listeners = new Set<() => void>();

  // What the UI sees.
  let users = EMPTY;
  let ready = false;
  let status: PresenceStatus = "connecting";

  // Lifecycle.
  let started = false;
  /** Stopped, or the session turned out to be gone. */
  let ended = false;
  /** In the background, or the tab is hidden. */
  let paused = false;
  let pausedAt = 0;
  /** Paused for longer than the grace: no longer shown online. */
  let away = false;
  /** The latest heartbeat's answer: does the database show my status? */
  let shown = true;
  /**
   * A heartbeat made in front has answered since the store started, came back from away or rejoined after a drop, with
   * a stamp still fresh (needed to appear).
   */
  let confirmed = false;
  /** When the latest heartbeat that went through (answered shown) was sent. */
  let stampedAt = Number.NEGATIVE_INFINITY;
  /** The latest heartbeat has not answered yet. */
  let beating = false;

  // The channel.
  let channel: Channel | null = null;
  /** The channel has joined and not failed since, so tracking reaches the server. */
  let joined = false;
  /** A presence sync has arrived since the channel (re)joined. */
  let synced = false;
  let tracked = false;
  /** Track again even though tracked (back after a while: the echo of a fresh track proves the connection is alive). */
  let forceTrack = false;
  /** Not ready until my own latest track comes back in a sync. */
  let awaitOwn = false;
  let ownOnlineAt: string | null = null;
  /** The server refused the last join: check with a heartbeat before joining again. */
  let checkBeforeJoin = false;
  /** When this join's presence calls went out (Realtime's per-channel limit). */
  let calls: number[] = [];
  let rejoins = 0;
  /** A join has succeeded since start(): a later one is a rejoin, which also reads the block list again. */
  let joinedBefore = false;

  // People blocked either way with me, left out of the snapshot.
  let blocked: ReadonlySet<string> = new Set();
  let blocksLoaded = false;
  let blocksAsked = 0;

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  let downTimer: ReturnType<typeof setTimeout> | null = null;
  /** Moves on with every heartbeat (and stop): only the latest heartbeat's answer counts. */
  let beats = 0;

  const publish = (nextUsers: ReadonlyMap<string, OnlineUser> = users) => {
    const nextReady = started && !ended && shown && joined && synced && blocksLoaded && !awaitOwn;
    const nextStatus: PresenceStatus = ended ? "ended" : !shown ? "hidden" : nextReady ? "ready" : "connecting";
    if (nextUsers === users && nextReady === ready && nextStatus === status) return;
    users = nextUsers;
    ready = nextReady;
    status = nextStatus;
    listeners.forEach((l) => l());
  };

  const usersOf = (c: Channel): ReadonlyMap<string, OnlineUser> => {
    const next = new Map<string, OnlineUser>();
    for (const metas of Object.values(c.presenceState<Tracked>())) {
      for (const meta of metas) {
        if (!meta.user_id || blocked.has(meta.user_id)) continue;
        // Someone on several devices counts once, from their earliest.
        const existing = next.get(meta.user_id);
        if (!existing || existing.onlineAt > meta.online_at) {
          next.set(meta.user_id, { id: meta.user_id, full_name: meta.full_name, avatar_url: meta.avatar_url, onlineAt: meta.online_at });
        }
      }
    }
    return next;
  };
  /** Publish the channel's people again (after a sync, or a change of who is blocked). */
  const rebuild = () => {
    if (!channel || !synced || !shown) return publish();
    // Until the block list is in, nobody: it could hold any of them.
    const next = blocksLoaded ? usersOf(channel) : EMPTY;
    publish(sameUsers(next, users) ? users : next);
  };

  const clearTimer = (t: ReturnType<typeof setTimeout> | null) => {
    if (t) clearTimeout(t);
    return null;
  };

  /**
   * Track or untrack so the server matches what is wanted, within Realtime's presence-call limit. With no call left on
   * this channel, leave it and join a fresh one rather than wait for the window: leaving is not a presence call and the
   * server drops my presence at once, and the new channel comes with a new budget. A call put off until later needs a
   * timer, and none runs once a phone has the app in the background or a mobile browser freezes the tab: I would stay
   * online until the server dropped the silent connection. Back in front, waiting kept the store not ready (no status
   * shown anywhere) for up to half a minute.
   */
  const syncTracking = () => {
    const c = channel;
    if (!c || !joined) return;
    const want = started && !ended && shown && confirmed && !away;
    if (want ? tracked && !forceTrack : !tracked) return;
    const now = Date.now();
    calls = calls.filter((t) => now - t < PRESENCE_CALLS_WINDOW_MS);
    if (calls.length >= PRESENCE_CALLS_MAX) {
      channel = null;
      void leave(c);
      goDown();
      // Joined, the fresh channel appears (or not) as wanted by then: SUBSCRIBED brings syncTracking() back.
      joinSoon();
      return;
    }
    calls.push(now);
    if (want) {
      tracked = true;
      forceTrack = false;
      ownOnlineAt = new Date(now).toISOString();
      const payload: Tracked = { user_id: me.id, full_name: me.full_name, avatar_url: me.avatar_url, online_at: ownOnlineAt };
      void c.track(payload).catch(() => {});
    } else {
      tracked = false;
      void c.untrack().catch(() => {});
    }
  };

  const leave = (c: Channel) => {
    const left = supabase.removeChannel(c).then(
      () => {},
      () => {},
    );
    leaving = Promise.all([leaving, left]).then(() => {});
    return left;
  };

  const onSync = (c: Channel) => {
    if (c !== channel || ended || !shown) return;
    synced = true;
    rejoins = 0;
    downTimer = clearTimer(downTimer);
    if (awaitOwn && ownOnlineAt && (c.presenceState<Tracked>()[me.id] ?? []).some((m) => m.online_at === ownOnlineAt)) awaitOwn = false;
    rebuild();
  };

  /** The connection dropped or the channel ended: not ready at once; the last known people go after a grace. */
  const goDown = () => {
    joined = false;
    synced = false;
    tracked = false;
    forceTrack = false;
    if (!downTimer && users !== EMPTY) {
      downTimer = setTimeout(() => {
        downTimer = null;
        if (!synced) publish(EMPTY);
      }, PRESENCE_DOWN_GRACE_MS);
    }
    publish();
  };

  const join = () => {
    if (!started || ended || !shown || channel) return;
    const c = supabase.channel(PRESENCE_TOPIC, { config: { private: true, presence: { key: me.id } } });
    channel = c;
    joined = false;
    synced = false;
    tracked = false;
    c.on("presence", { event: "sync" }, () => onSync(c)).subscribe((state, err) => {
      if (c !== channel) return;
      if (state === "SUBSCRIBED") {
        // Joined, or joined again after a drop (a new server process: a new presence-call budget): the server has
        // forgotten me, so appear again. The presence state that follows makes the store ready.
        joined = true;
        synced = false;
        tracked = false;
        calls = [];
        const rejoined = joinedBefore;
        joinedBefore = true;
        if (rejoined) refreshBlocks();
        if (!paused) {
          // Back after a drop that outlasted my last stamp (every heartbeat meanwhile failed): stamp again before
          // appearing, or I would come back beside an old time. And a first join with no stamp in yet asks for one now
          // rather than at the next minute.
          if (rejoined && Date.now() - stampedAt >= FRESH_STAMP_MS) confirmed = false;
          if (!confirmed && (rejoined || !beating)) {
            stopHeartbeat();
            startHeartbeat();
          }
        }
        syncTracking();
        publish();
        return;
      }
      // CHANNEL_ERROR or TIMED_OUT (realtime-js joins again by itself) or CLOSED.
      goDown();
      if (state === "CLOSED") {
        // The server ended the channel (an expired token, too many presence calls) and nothing joins it again.
        channel = null;
        scheduleRejoin();
      } else if (state === "CHANNEL_ERROR" && refusedJoin(err)) {
        // Refused (hidden on another device, signed out elsewhere, ...): realtime-js would ask again and again. Leave,
        // and let a heartbeat say what changed (in front only: a heartbeat stamps the time).
        channel = null;
        void leave(c);
        checkBeforeJoin = true;
        if (!paused) beat();
      }
    });
  };
  /** Join once any channel on the topic still being left is gone. */
  const joinSoon = () => {
    void leaving.then(join);
  };
  const scheduleRejoin = () => {
    if (rejoinTimer || !started || ended) return;
    const delay = REJOIN_DELAYS_MS[Math.min(rejoins++, REJOIN_DELAYS_MS.length - 1)];
    rejoinTimer = setTimeout(() => {
      rejoinTimer = null;
      joinSoon();
    }, delay);
  };

  /** Everything off: timers, the heartbeat's answers, the channel. Returns the leave in flight, if any. */
  const teardown = (): Promise<void> | null => {
    stopHeartbeat();
    leaveTimer = clearTimer(leaveTimer);
    rejoinTimer = clearTimer(rejoinTimer);
    downTimer = clearTimer(downTimer);
    beats++;
    beating = false;
    blocksAsked++;
    rejoins = 0;
    checkBeforeJoin = false;
    awaitOwn = false;
    forceTrack = false;
    joined = false;
    synced = false;
    tracked = false;
    calls = [];
    const c = channel;
    channel = null;
    return c ? leave(c) : null;
  };

  const onAnswer = (answer: HeartbeatAnswer, inFront: boolean, sentAt: number) => {
    if (!started || ended) return;
    if (answer === "signedOut") {
      // The session is gone (signed out here or elsewhere): stop, and stop asking.
      void teardown();
      started = false;
      ended = true;
      publish(EMPTY);
      return;
    }
    if (answer === "hidden") {
      // Hidden on another device: leave the channel (others see me go at once) and show nobody. Heartbeats in front
      // keep asking, and the first that finds it shown again joins again.
      shown = false;
      confirmed = false;
      awaitOwn = false;
      checkBeforeJoin = false;
      rejoinTimer = clearTimer(rejoinTimer);
      downTimer = clearTimer(downTimer);
      const c = channel;
      channel = null;
      joined = false;
      synced = false;
      tracked = false;
      if (c) void leave(c);
      publish(EMPTY);
      return;
    }
    // Shown, or the heartbeat failed (offline, say): a failure is no sign of a hide, so it lets the store go on, and
    // appear too as long as the last stamp that went through is still fresh.
    if (answer === "shown") {
      shown = true;
      stampedAt = sentAt;
    }
    if (inFront && Date.now() - stampedAt < FRESH_STAMP_MS) confirmed = true;
    if (shown && !channel && !rejoinTimer) {
      if (checkBeforeJoin) {
        checkBeforeJoin = false;
        scheduleRejoin();
      } else {
        joinSoon();
      }
    }
    syncTracking();
    publish();
  };

  const beat = () => {
    const n = ++beats;
    const inFront = !paused;
    const sentAt = Date.now();
    beating = true;
    Promise.resolve()
      .then(() => heartbeat(supabase))
      .then(
        (answer): HeartbeatAnswer => (answer === false ? "hidden" : "shown"),
        async (e): Promise<HeartbeatAnswer> => (signedOutError(e) && (await sessionGone(supabase)) ? "signedOut" : "error"),
      )
      .then((answer) => {
        if (n !== beats) return;
        beating = false;
        onAnswer(answer, inFront, sentAt);
      });
  };
  const startHeartbeat = () => {
    if (heartbeatTimer) return;
    beat();
    heartbeatTimer = setInterval(() => {
      beat();
      // A block or unblock made by the other person, or on another device, is not heard of otherwise while in front.
      refreshBlocks();
    }, PRESENCE_HEARTBEAT_MS);
  };
  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  const goAway = () => {
    if (!paused || away) return;
    away = true;
    confirmed = false;
    syncTracking();
    publish();
  };

  function refreshBlocks() {
    if (!started || ended) return;
    const asked = ++blocksAsked;
    Promise.resolve()
      .then(() => loadBlocks(supabase))
      .then(
        (ids) => {
          if (asked !== blocksAsked) return;
          blocked = new Set(ids);
          blocksLoaded = true;
          rebuild();
        },
        () => {
          // Could not ask (offline, say): leave out whoever was known, or nobody, rather than show no one at all.
          if (asked !== blocksAsked) return;
          blocksLoaded = true;
          rebuild();
        },
      );
  }

  return {
    getSnapshot: () => users,
    isReady: () => ready,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      ended = false;
      shown = true;
      confirmed = false;
      awaitOwn = false;
      checkBeforeJoin = false;
      joinedBefore = false;
      // Started in the background (by a notification, say): it listens, but appears only once the app is opened.
      away = paused;
      publish();
      joinSoon();
      refreshBlocks();
      if (!paused) startHeartbeat();
    },
    async stop() {
      const left = teardown();
      started = false;
      ended = true;
      publish(EMPTY);
      if (left) await left;
    },
    pause(opts = {}) {
      if (!paused) {
        paused = true;
        pausedAt = Date.now();
        if (started) {
          stopHeartbeat();
          // When I left.
          beat();
          leaveTimer = clearTimer(leaveTimer);
          if (!opts.leaveNow) {
            leaveTimer = setTimeout(() => {
              leaveTimer = null;
              goAway();
            }, PRESENCE_LEAVE_GRACE_MS);
          }
        }
      }
      // A phone in the background runs no timer until it is back, and a frozen tab none at all: stop appearing now,
      // while this code still runs.
      if (opts.leaveNow && started) {
        leaveTimer = clearTimer(leaveTimer);
        goAway();
      }
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (!started) {
        away = false;
        return;
      }
      leaveTimer = clearTimer(leaveTimer);
      // Back after a while (timers may not have run in the background): the status may have been hidden elsewhere
      // meanwhile, and what presence says may be stale. Appear again only once the stamp below confirms the status, and
      // trust presence again only once that return comes back.
      if (away || Date.now() - pausedAt >= PRESENCE_LEAVE_GRACE_MS) {
        away = false;
        confirmed = false;
        awaitOwn = true;
        forceTrack = true;
        refreshBlocks();
      }
      startHeartbeat();
      publish();
    },
    refreshBlocks,
  };
}

function sameUsers(a: ReadonlyMap<string, OnlineUser>, b: ReadonlyMap<string, OnlineUser>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, u] of a) {
    const v = b.get(id);
    if (!v || v.onlineAt !== u.onlineAt || v.full_name !== u.full_name || v.avatar_url !== u.avatar_url) return false;
  }
  return true;
}

/**
 * Stamp my last-active time: the heartbeat the presence store runs (on start and resume, every minute in front, and on
 * pause). The database stamps nothing for someone who hides their active status, and the answer says whether I show it.
 * A refusal throws with the HTTP status (401 signed out).
 */
export async function touchActivity(supabase: Client): Promise<boolean> {
  const { data, error, status } = await supabase.rpc("touch_activity");
  if (error) throw Object.assign(new Error(error.message), { code: error.code, status });
  return data === true;
}

/** Ids of everyone blocked either way with me (the presence store leaves them out). */
export async function getBlockedEitherWayIds(supabase: Client): Promise<string[]> {
  const { data, error } = await supabase.rpc("blocked_either_way_ids");
  if (error) throw error;
  return (data ?? []).filter((id): id is string => typeof id === "string");
}

/**
 * When each of these people was last active, to the minute, and whether that is recent, for activityLine(). Every id
 * asked about is in the answer: null when there is nothing to show. The database leaves out people who hide their
 * status, are blocked either way or share no chat with me, and everyone while I hide mine; someone who shares a chat
 * with me but has not written to me there comes back only while recent, with no time (lastActiveAt null). Signed out,
 * the API refuses, and this throws.
 */
export async function getActivityStatusMany(supabase: Client, userIds: string[]): Promise<Record<string, ActivityStatus | null>> {
  const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
  const out: Record<string, ActivityStatus | null> = {};
  for (const id of ids) out[id] = null;
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ACTIVITY_STATUS_BATCH) batches.push(ids.slice(i, i + ACTIVITY_STATUS_BATCH));
  const answers = await Promise.all(batches.map((batch) => supabase.rpc("activity_status", { p_user_ids: batch })));
  for (const { data, error } of answers) {
    if (error) throw error;
    for (const row of data ?? []) if (row.user_id in out) out[row.user_id] = { lastActiveAt: row.last_active_at ?? null, recent: row.recent === true };
  }
  return out;
}

/** What there is to show about one person's activity (see getActivityStatusMany), or null for nothing. */
export async function getActivityStatus(supabase: Client, userId: string): Promise<ActivityStatus | null> {
  return (await getActivityStatusMany(supabase, [userId]))[userId] ?? null;
}

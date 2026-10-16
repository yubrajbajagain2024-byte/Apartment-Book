// Unit tests for activity status (migration 22): the "Active 5 min ago" labels (src/activity.ts) and the presence store
// and activity queries (src/queries/presence.ts) against a fake Supabase client. Run: npm run test:shared
// "Yesterday" is a date on the device's calendar: pin the time zone, so these tests read the same on any machine.
process.env.TZ = "America/Chicago";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ACTIVITY_LABEL_REFRESH_MS, ACTIVITY_REFETCH_MS, activityLabel, activityLine } from "../src/activity.ts";
import {
  PRESENCE_DOWN_GRACE_MS,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LEAVE_GRACE_MS,
  PRESENCE_TOPIC,
  createPresenceStore,
  getActivityStatus,
  getActivityStatusMany,
  getBlockedEitherWayIds,
  touchActivity,
} from "../src/queries/presence.ts";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();

// --- labels --------------------------------------------------------------------------------------------------------
test("activityLabel: the Messenger-style examples", () => {
  assert.equal(activityLabel(ago(1 * MINUTE), NOW), "Active 1 min ago");
  assert.equal(activityLabel(ago(5 * MINUTE), NOW), "Active 5 min ago");
  assert.equal(activityLabel(ago(30 * MINUTE), NOW), "Active 30 min ago");
  assert.equal(activityLabel(ago(1 * HOUR), NOW), "Active 1 hour ago");
  assert.equal(activityLabel(ago(3 * HOUR), NOW), "Active 3 hours ago");
  assert.equal(activityLabel(ago(30 * HOUR), NOW), "Active yesterday");
  assert.equal(activityLabel(ago(2 * DAY), NOW), "Active 2 days ago");
});

test("activityLabel: never 0 min; each step starts exactly on its boundary (from a day on, at local midnight)", () => {
  // NOW is 07:00 on Sunday 11 October here (Chicago).
  assert.equal(activityLabel(ago(0), NOW), "Active 1 min ago");
  assert.equal(activityLabel(ago(59 * SECOND), NOW), "Active 1 min ago");
  assert.equal(activityLabel(ago(2 * MINUTE - 1), NOW), "Active 1 min ago");
  assert.equal(activityLabel(ago(2 * MINUTE), NOW), "Active 2 min ago");
  assert.equal(activityLabel(ago(HOUR - 1), NOW), "Active 59 min ago");
  assert.equal(activityLabel(ago(2 * HOUR - 1), NOW), "Active 1 hour ago");
  assert.equal(activityLabel(ago(2 * HOUR), NOW), "Active 2 hours ago");
  assert.equal(activityLabel(ago(DAY - 1), NOW), "Active 23 hours ago", "under a day: hours, even on yesterday's date");
  assert.equal(activityLabel(ago(DAY), NOW), "Active yesterday");
  assert.equal(activityLabel(ago(DAY + 7 * HOUR), NOW), "Active yesterday", "Saturday 00:00");
  assert.equal(activityLabel(ago(DAY + 7 * HOUR + 1), NOW), "Active 2 days ago", "Friday 23:59:59.999");
  assert.equal(activityLabel(ago(2 * DAY - 1), NOW), "Active 2 days ago");
  assert.equal(activityLabel(ago(3 * DAY - 1), NOW), "Active 3 days ago");
  assert.equal(activityLabel(ago(400 * DAY), NOW), "Active 400 days ago");
});

test("activityLabel: 'yesterday' is the date before today on this device, not any time 24 to 48 hours ago", () => {
  // Wednesday 14 October, 09:00 in Chicago.
  const wed = Date.parse("2026-10-14T14:00:00Z");
  const at = (iso) => activityLabel(iso, wed);
  assert.equal(at("2026-10-13T15:00:00Z"), "Active 23 hours ago", "Tuesday 10:00");
  assert.equal(at("2026-10-13T13:00:00Z"), "Active yesterday", "Tuesday 08:00 (25 hours)");
  assert.equal(at("2026-10-13T04:30:00Z"), "Active 2 days ago", "Monday 23:30 (33.5 hours)");
  assert.equal(at("2026-10-12T15:00:00Z"), "Active 2 days ago", "Monday 10:00 (47 hours)");
  assert.equal(at("2026-10-12T04:00:00Z"), "Active 3 days ago", "Sunday 23:00 (58 hours)");
  // The night the clocks go back (Sunday 1 November) lasts 25 hours: a full day can stay on the same date.
  assert.equal(activityLabel("2026-11-01T05:00:00Z", Date.parse("2026-11-02T05:30:00Z")), "Active 24 hours ago", "00:00 to 23:30 the same Sunday");
  assert.equal(activityLabel("2026-10-31T05:00:00Z", Date.parse("2026-11-02T05:30:00Z")), "Active yesterday", "Saturday 00:00 to Sunday 23:30");
  // And the Sunday they go forward (8 March) lasts 23 hours: exactly a day before Monday 00:30 is Saturday 23:30.
  assert.equal(activityLabel("2026-03-08T05:30:00Z", Date.parse("2026-03-09T05:30:00Z")), "Active 2 days ago", "Saturday 23:30 to Monday 00:30");
});

test("activityLabel: a few minutes ahead of this clock is skew (1 min); further ahead, nothing", () => {
  assert.equal(activityLabel(ago(-30 * SECOND), NOW), "Active 1 min ago");
  assert.equal(activityLabel(ago(-5 * MINUTE), NOW), "Active 1 min ago");
  assert.equal(activityLabel(ago(-5 * MINUTE - 1), NOW), null);
  assert.equal(activityLabel(ago(-DAY), NOW), null);
});

test("activityLabel: nothing for a missing or unreadable time; the database's format and a Date for now both work", () => {
  for (const bad of [null, undefined, "", "yesterday", "2026-13-45T99:00:00Z"]) assert.equal(activityLabel(bad, NOW), null, String(bad));
  assert.equal(activityLabel(ago(MINUTE), Number.NaN), null);
  assert.equal(activityLabel("2026-10-11T11:55:00+00:00", NOW), "Active 5 min ago");
  assert.equal(activityLabel("2026-10-11T11:55:00+00:00", new Date(NOW)), "Active 5 min ago");
  assert.equal(activityLabel(new Date(Date.now() - 3 * HOUR).toISOString()), "Active 3 hours ago", "now defaults to the clock");
});

test("activityLine: nothing until presence is ready or without a time (blocked, hidden, never written to you)", () => {
  const activity = { lastActiveAt: ago(5 * MINUTE), recent: false };
  assert.equal(activityLine({ ready: false, online: true, activity: { ...activity, recent: true } }, NOW), null);
  assert.equal(activityLine({ ready: false, online: false, activity }, NOW), null);
  assert.equal(activityLine({ ready: true, online: true, activity: null }, NOW), null, "presence alone knows nothing of blocks");
  assert.equal(activityLine({ ready: true, online: false, activity: undefined }, NOW), null);
  assert.deepEqual(activityLine({ ready: true, online: false, activity }, NOW), { label: "Active 5 min ago", online: false });
  assert.equal(activityLine({ ready: true, online: false, activity: { lastActiveAt: ago(-HOUR), recent: false } }, NOW), null, "too far ahead");
  assert.equal(ACTIVITY_LABEL_REFRESH_MS, 30 * SECOND);
  assert.equal(ACTIVITY_REFETCH_MS, 60 * SECOND);
});

test("activityLine: 'Active now' needs presence and a recent stamp; when they disagree the stamp is what shows", () => {
  const recent = { lastActiveAt: ago(1 * MINUTE), recent: true };
  assert.deepEqual(activityLine({ ready: true, online: true, activity: recent }, NOW), { label: "Active now", online: true });
  // Presence says online, but nobody stamped for 3 hours: someone claimed their id on the channel (or a stamp is late).
  assert.deepEqual(activityLine({ ready: true, online: true, activity: { lastActiveAt: ago(3 * HOUR), recent: false } }, NOW), { label: "Active 3 hours ago", online: false });
  // Recent but not in presence: they just left.
  assert.deepEqual(activityLine({ ready: true, online: false, activity: recent }, NOW), { label: "Active 1 min ago", online: false });
});

test("activityLine: someone who shares a chat but has not written to you (no time): 'Active now' while online, otherwise nothing", () => {
  const noTime = { lastActiveAt: null, recent: true };
  assert.deepEqual(activityLine({ ready: true, online: true, activity: noTime }, NOW), { label: "Active now", online: true });
  assert.equal(activityLine({ ready: true, online: false, activity: noTime }, NOW), null, "they just left: no time to say when");
  assert.equal(activityLine({ ready: false, online: true, activity: noTime }, NOW), null, "not before presence is known");
  assert.equal(activityLine({ ready: true, online: true, activity: { lastActiveAt: null, recent: false } }, NOW), null, "a claim nobody stamped");
});

// --- a fake Supabase client ----------------------------------------------------------------------------------------
const ME = { id: "a1a1a1a1-0000-4000-8000-000000000001", full_name: "Maya Patel", avatar_url: null };
const OTHER = "b2b2b2b2-0000-4000-8000-000000000002";
const THIRD = "c3c3c3c3-0000-4000-8000-000000000003";
const meta = (id, onlineAt, name = "Someone") => ({ user_id: id, full_name: name, avatar_url: null, online_at: onlineAt, presence_ref: "r" });
const refusal = () => new Error("Unauthorized: You do not have permissions to read from this Channel topic: presence:active", { cause: { reason: "Unauthorized: You do not have permissions to read from this Channel topic: presence:active" } });

function fakeClient({ shown = true } = {}) {
  const client = {
    shown,
    touches: 0,
    /** When set, touch_activity answers only once it settles. */
    touchGate: null,
    /** When set, touch_activity fails with it (an { error, status } answer). */
    touchFailure: null,
    blockedIds: [],
    blockFailure: false,
    blockAsks: 0,
    channels: [],
    removed: [],
    pendingRemoval: null,
    rpcCalls: [],
    statusRows: () => [],
    rpcError: null,
    /** What auth.getSession() answers: the session (null when there is none) and an error (a refresh that failed). */
    session: { user: { id: ME.id }, access_token: "token" },
    sessionError: null,
    auth: {
      getSession: async () => ({ data: { session: client.session }, error: client.sessionError }),
    },
    channel(topic, opts) {
      const ch = {
        topic,
        opts,
        handlers: {},
        state: {},
        tracks: [],
        untracks: 0,
        /** Every presence call in order: "track" / "untrack". */
        presenceCalls: [],
        /** When each of them was sent. */
        callTimes: [],
        statusCallback: null,
        on(type, filter, cb) {
          this.handlers[`${type}:${filter.event}`] = cb;
          return this;
        },
        subscribe(cb) {
          this.statusCallback = cb;
          return this;
        },
        presenceState() {
          return this.state;
        },
        async track(payload) {
          this.tracks.push(payload);
          this.presenceCalls.push("track");
          this.callTimes.push(Date.now());
          return "ok";
        },
        async untrack() {
          this.untracks++;
          this.presenceCalls.push("untrack");
          this.callTimes.push(Date.now());
          return "ok";
        },
        // Test side: what the server would do.
        status(s, err) {
          this.statusCallback(s, err);
        },
        sync(state) {
          this.state = state;
          this.handlers["presence:sync"]?.();
        },
        /** The server echoes my latest track back (with whoever else is there). */
        echo(others = {}) {
          const mine = this.tracks.at(-1);
          this.sync({ ...others, [ME.id]: [meta(ME.id, mine.online_at, ME.full_name)] });
        },
      };
      client.channels.push(ch);
      return ch;
    },
    async removeChannel(ch) {
      client.removed.push(ch);
      if (client.pendingRemoval) await client.pendingRemoval;
      return "ok";
    },
    async rpc(name, args) {
      client.rpcCalls.push({ name, args });
      if (name === "touch_activity") {
        if (client.touchGate) await client.touchGate;
        client.touches++;
        if (client.touchFailure) return { data: null, ...client.touchFailure };
        if (client.rpcError) return { data: null, error: client.rpcError, status: 0 };
        return { data: client.shown, error: null, status: 200 };
      }
      if (name === "blocked_either_way_ids") {
        client.blockAsks++;
        if (client.blockFailure) return { data: null, error: { message: "offline" } };
        return { data: [...client.blockedIds], error: null };
      }
      if (client.rpcError) return { data: null, error: client.rpcError };
      if (name === "activity_status") return { data: client.statusRows(args.p_user_ids), error: null };
      return { data: null, error: new Error(`unexpected rpc ${name}`) };
    },
  };
  return client;
}
// Lets promises settle (setImmediate is left alone when the timers are mocked).
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};
const mocked = new WeakSet();
const mockTime = (t) => {
  if (mocked.has(t)) return;
  mocked.add(t);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: NOW });
};
const tick = async (t, ms) => {
  t.mock.timers.tick(ms);
  await flush();
};
const started = async (t, opts) => {
  mockTime(t);
  const client = fakeClient(opts);
  const store = createPresenceStore(client, ME);
  let changes = 0;
  store.subscribe(() => changes++);
  store.start();
  await flush();
  return { client, store, ch: client.channels[0], changes: () => changes };
};
/** Started, joined, appeared and synced: the usual state in front. */
const live = async (t, opts) => {
  const s = await started(t, opts);
  s.ch.status("SUBSCRIBED");
  await flush();
  s.ch.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z", "Omar")] });
  assert.equal(s.store.isReady(), true, "setup: ready");
  return s;
};

// --- the store -----------------------------------------------------------------------------------------------------
test("store: joins presence:active as a private channel keyed by my id; nothing is known until the first sync", async (t) => {
  const { store, ch, changes } = await started(t);
  assert.equal(PRESENCE_TOPIC, "presence:active");
  assert.equal(ch.topic, PRESENCE_TOPIC);
  assert.deepEqual(ch.opts, { config: { private: true, presence: { key: ME.id } } });
  assert.equal(store.isReady(), false);
  assert.equal(store.getStatus(), "connecting");
  assert.equal(store.getSnapshot().size, 0);
  ch.status("SUBSCRIBED");
  assert.equal(ch.tracks.length, 1);
  assert.deepEqual({ ...ch.tracks[0], online_at: "x" }, { user_id: ME.id, full_name: ME.full_name, avatar_url: null, online_at: "x" });
  assert.equal(store.isReady(), false, "joined, but the presence state has not arrived");
  ch.sync({ [ME.id]: [meta(ME.id, "2026-10-11T12:00:00Z", ME.full_name)], [OTHER]: [meta(OTHER, "2026-10-11T11:30:00Z", "Omar"), meta(OTHER, "2026-10-11T11:00:00Z", "Omar")] });
  assert.equal(store.isReady(), true);
  assert.equal(store.getStatus(), "ready");
  assert.deepEqual([...store.getSnapshot().keys()].sort(), [ME.id, OTHER].sort());
  assert.equal(store.getSnapshot().get(OTHER).onlineAt, "2026-10-11T11:00:00Z", "two devices count once, from the earliest");
  assert.ok(changes() >= 1);
});

test("store: appears only once its first stamp is in, so whoever sees it appear finds a fresh time", async (t) => {
  mockTime(t);
  const client = fakeClient();
  let release;
  client.touchGate = new Promise((r) => (release = r));
  const store = createPresenceStore(client, ME);
  store.start();
  await flush();
  const ch = client.channels[0];
  ch.status("SUBSCRIBED");
  await flush();
  assert.equal(ch.tracks.length, 0, "joined, but the stamp is still on its way");
  client.touchGate = null;
  release();
  await flush();
  assert.equal(client.touches, 1);
  assert.equal(ch.tracks.length, 1, "appears once the stamp is in");
  await store.stop();
});

test("store: an error or a timeout makes it not ready at once, keeps the people it knew for a few seconds, then empties; every rejoin appears again", async (t) => {
  const { store, ch } = await live(t);
  for (const failure of ["CHANNEL_ERROR", "TIMED_OUT"]) {
    const before = store.getSnapshot();
    ch.status(failure);
    assert.equal(store.isReady(), false, failure);
    assert.equal(store.getSnapshot(), before, `${failure}: the dots stay for now`);
    await tick(t, PRESENCE_DOWN_GRACE_MS - 1);
    assert.equal(store.getSnapshot(), before);
    await tick(t, 1);
    assert.equal(store.getSnapshot().size, 0, `${failure}: emptied after the grace`);
    const tracks = ch.tracks.length;
    ch.status("SUBSCRIBED");
    assert.equal(ch.tracks.length, tracks + 1, `tracked again after ${failure}`);
    assert.equal(store.isReady(), false, "not until the presence state arrives");
    ch.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
    assert.equal(store.isReady(), true);
  }
  // Back within the grace: nothing blinks.
  const before = store.getSnapshot();
  ch.status("CHANNEL_ERROR");
  ch.status("SUBSCRIBED");
  ch.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), true);
  assert.deepEqual([...store.getSnapshot().keys()].sort(), [...before.keys()].sort());
  await tick(t, PRESENCE_DOWN_GRACE_MS);
  assert.ok(store.getSnapshot().size > 0, "a sync in time keeps them");
  await store.stop();
});

test("store: a channel the server closed is replaced by a fresh one after a pause that grows, and resets once it works", async (t) => {
  const { client, store, ch } = await started(t);
  ch.status("SUBSCRIBED");
  ch.sync({});
  ch.status("CLOSED");
  assert.equal(store.isReady(), false);
  await tick(t, 999);
  assert.equal(client.channels.length, 1);
  await tick(t, 1);
  assert.equal(client.channels.length, 2);
  const second = client.channels[1];
  assert.equal(second.topic, PRESENCE_TOPIC);
  second.status("CLOSED");
  await tick(t, 1999);
  assert.equal(client.channels.length, 2, "the second pause is longer");
  await tick(t, 1);
  const third = client.channels[2];
  third.status("SUBSCRIBED");
  assert.equal(third.tracks.length, 1);
  third.sync({});
  assert.equal(store.isReady(), true);
  third.status("CLOSED");
  await tick(t, 1000);
  assert.equal(client.channels.length, 4, "back to the shortest pause after a sync");
  const fourth = client.channels[3];
  fourth.status("SUBSCRIBED");
  fourth.sync({});
  // Old channels' late news is ignored.
  ch.sync({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  ch.status("CHANNEL_ERROR");
  ch.status("SUBSCRIBED");
  ch.status("CLOSED");
  await tick(t, 30 * SECOND);
  assert.equal(store.isReady(), true);
  assert.equal(store.getSnapshot().size, 0);
  assert.equal(client.channels.length, 4);
  assert.deepEqual([ch.tracks.length, fourth.tracks.length], [1, 1], "each channel appeared once");
  await store.stop();
});

test("store: the heartbeat stamps on start and every minute in front; pause stamps once more and stops it; resume stamps and restarts it", async (t) => {
  const { client, store, ch } = await live(t);
  assert.equal(PRESENCE_HEARTBEAT_MS, 60 * SECOND);
  assert.equal(client.touches, 1, "on start");
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(client.touches, 2);
  store.pause();
  await flush();
  assert.equal(client.touches, 3, "the time I left");
  await tick(t, 5 * PRESENCE_HEARTBEAT_MS);
  assert.equal(client.touches, 3, "no heartbeat in the background");
  assert.equal(client.removed.length, 0, "still in the channel");
  store.pause();
  await flush();
  assert.equal(client.touches, 3, "pause is idempotent");
  store.resume();
  await flush();
  assert.equal(client.touches, 4, "stamped on resume");
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(client.touches, 5);
  store.resume();
  await flush();
  assert.equal(client.touches, 5, "resume is idempotent");
  assert.ok(ch.tracks.length >= 1);
  await store.stop();
});

test("store: leaving the front keeps me online for a short grace: a quick switch sends no presence call; after the grace I stop appearing", async (t) => {
  const { client, store, ch } = await live(t);
  assert.equal(PRESENCE_LEAVE_GRACE_MS, 15 * SECOND);
  const calls = () => ch.presenceCalls.join(",");
  // Another tab for a few seconds, a photo picker, a glance at a notification: nothing changes for anyone.
  for (let i = 0; i < 6; i++) {
    store.pause();
    await tick(t, 5 * SECOND);
    store.resume();
    await tick(t, 1 * SECOND);
  }
  assert.equal(calls(), "track", "no presence call for quick switches");
  assert.equal(store.isReady(), true, "nothing to wait for after a quick switch");
  assert.ok(client.touches >= 13, "but every leave and return is stamped");
  // Gone for longer: untracked once the grace is over.
  store.pause();
  await tick(t, PRESENCE_LEAVE_GRACE_MS - 1);
  assert.equal(calls(), "track");
  await tick(t, 1);
  assert.equal(calls(), "track,untrack");
  ch.sync({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), true, "still listening in the background");
  await store.stop();
});

test("store: back after the grace, it appears again only once the heartbeat says the status is still shown, and is not ready until that return comes back", async (t) => {
  const { client, store, ch } = await live(t);
  store.pause();
  await tick(t, PRESENCE_LEAVE_GRACE_MS + 5 * SECOND);
  assert.equal(ch.presenceCalls.join(","), "track,untrack");
  let release;
  client.touchGate = new Promise((r) => (release = r));
  store.resume();
  await flush();
  assert.equal(store.isReady(), false, "what presence says may be stale");
  assert.equal(ch.presenceCalls.join(","), "track,untrack", "not before the stamp answers");
  client.touchGate = null;
  release();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack,track");
  ch.sync({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), false, "someone else's news is not my return");
  ch.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), true);
  await store.stop();
});

test("store: hidden on another device while away: coming back never appears, not even for a moment, and the channel is left", async (t) => {
  const { client, store, ch } = await live(t);
  store.pause();
  await tick(t, PRESENCE_LEAVE_GRACE_MS + SECOND);
  client.shown = false;
  store.resume();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack", "no track after the hide");
  assert.deepEqual(client.removed, [ch], "left the channel");
  assert.equal(store.getStatus(), "hidden");
  assert.equal(store.getSnapshot().size, 0);
  await store.stop();
});

test("store: back after the grace with a failing heartbeat (offline, say), it appears anyway: a failure is no sign of a hide", async (t) => {
  const { client, store, ch } = await live(t);
  store.pause();
  await tick(t, PRESENCE_LEAVE_GRACE_MS + SECOND);
  client.rpcError = new Error("Failed to fetch");
  store.resume();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack,track");
  await store.stop();
});

test("store: back after a long time in which no timer ran (the phone slept), it tracks again to prove the connection, and waits for it", async (t) => {
  const { client, store, ch } = await live(t);
  store.pause();
  // The leave timer never fired (the app was suspended), but the clock moved on.
  t.mock.timers.setTime(NOW + 10 * MINUTE);
  let release;
  client.touchGate = new Promise((r) => (release = r));
  store.resume();
  await flush();
  assert.equal(store.isReady(), false);
  assert.equal(ch.presenceCalls.join(","), "track", "nothing before the stamp confirms the status");
  // The connection comes back while the stamp is still on its way: rejoined, but still not appearing.
  ch.status("CHANNEL_ERROR");
  ch.status("SUBSCRIBED");
  assert.equal(ch.presenceCalls.join(","), "track", "a rejoin does not appear before the stamp either");
  client.touchGate = null;
  release();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,track", "a fresh track once the stamp is in");
  ch.echo();
  assert.equal(store.isReady(), true);
  assert.ok(client.touches >= 3);
  await store.stop();
});

test("store: back after a long sleep, hidden on another device meanwhile: no track at all, the channel is left", async (t) => {
  const { client, store, ch } = await live(t);
  store.pause();
  t.mock.timers.setTime(NOW + 10 * MINUTE);
  client.shown = false;
  store.resume();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track", "never re-announced");
  assert.deepEqual(client.removed, [ch], "left: the server drops my presence");
  assert.equal(store.getStatus(), "hidden");
  await store.stop();
});

/** The most presence calls one channel sent within any 32 seconds. */
const mostInWindow = (ch) => Math.max(0, ...ch.callTimes.map((t0) => ch.callTimes.filter((t) => t >= t0 && t - t0 < 32 * SECOND).length));

test("store: never more than 4 presence calls in 32 seconds on one channel (Realtime closes it on the 6th in 30); with none left it leaves that channel and appears on a fresh one at once, rather than wait for the window", async (t) => {
  const { client, store, ch } = await live(t);
  const others = { [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] };
  const away = async () => {
    store.pause();
    await tick(t, PRESENCE_LEAVE_GRACE_MS);
    store.resume();
    await flush();
  };
  await away(); // untrack at 15 s, track at 15 s
  assert.equal(ch.presenceCalls.join(","), "track,untrack,track");
  store.pause();
  await tick(t, PRESENCE_LEAVE_GRACE_MS); // untrack at 30 s: the 4th call
  assert.equal(ch.presenceCalls.length, 4);
  store.resume();
  await flush();
  assert.equal(ch.presenceCalls.length, 4, "no 5th call on that channel within the window");
  assert.deepEqual(client.removed, [ch], "left instead, which is no presence call");
  assert.equal(store.isReady(), false);
  const fresh = client.channels[1];
  assert.ok(fresh && fresh !== ch, "a fresh channel joins");
  fresh.status("SUBSCRIBED");
  await flush();
  assert.equal(fresh.presenceCalls.join(","), "track", "and appears at once: a fresh channel has a fresh budget");
  fresh.echo(others);
  assert.equal(store.isReady(), true);
  // Coming and going keeps every channel within the limit, and always ends as wanted.
  const subscribed = new Set([ch, fresh]);
  const settle = async () => {
    for (const c of client.channels) {
      if (subscribed.has(c) || client.removed.includes(c)) continue;
      subscribed.add(c);
      c.status("SUBSCRIBED");
      await flush();
    }
    if (client.channels.at(-1).tracks.length) client.channels.at(-1).echo(others);
    await flush();
  };
  for (let i = 0; i < 6; i++) {
    store.pause();
    await tick(t, PRESENCE_LEAVE_GRACE_MS);
    await settle();
    store.resume();
    await flush();
    await settle();
  }
  assert.ok(client.channels.length > 2, "joined afresh again when the calls ran out");
  for (const c of client.channels) assert.ok(mostInWindow(c) <= 4, `a channel sent ${mostInWindow(c)} presence calls within 32 s`);
  assert.equal(client.channels.at(-1).presenceCalls.at(-1), "track", "ends up appearing");
  assert.equal(store.isReady(), true);
  await store.stop();
});

test("store: a phone leaving with no presence call left (out and back twice within half a minute) leaves the channel at once, while the app still runs: nothing waits for a timer, which never runs in the background; back in front it appears at once on a fresh channel", async (t) => {
  const { client, store, ch } = await live(t);
  const others = { [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] };
  await tick(t, 2 * MINUTE); // the first track has left the window
  const out = async () => {
    store.pause({ leaveNow: true });
    await flush();
  };
  const back = async (c) => {
    store.resume();
    await flush();
    c.echo(others);
    await flush();
  };
  for (let i = 0; i < 2; i++) {
    await out();
    await tick(t, 3 * SECOND);
    await back(ch);
    await tick(t, 3 * SECOND);
  }
  assert.equal(ch.presenceCalls.join(","), "track,untrack,track,untrack,track");
  store.pause({ leaveNow: true });
  assert.deepEqual(client.removed, [ch], "left the channel: the server drops my presence at once");
  assert.equal(store.isReady(), false, "from that moment, what presence says is not known to be current");
  await flush();
  assert.equal(ch.presenceCalls.length, 5, "no 5th call within the window");
  // The phone suspends the app: from here on no timer runs, and nothing waits for one.
  t.mock.timers.setTime(Date.now() + 2 * MINUTE);
  await flush();
  const fresh = client.channels[1];
  assert.ok(fresh, "a fresh channel, still listening");
  fresh.status("SUBSCRIBED");
  await flush();
  fresh.sync(others);
  assert.equal(fresh.presenceCalls.length, 0, "not appearing while away");
  assert.ok(store.getSnapshot().has(OTHER), "others' presence still arrives");
  assert.equal(store.isReady(), true, "listening on the fresh channel");
  // Back in front: it stamps, then appears at once on the fresh channel, and is ready once that comes back.
  await back(fresh);
  assert.equal(fresh.presenceCalls.join(","), "track");
  assert.equal(store.isReady(), true);
  await store.stop();
});

test("store: back in front with no presence call left on the channel (appeared, out and back, out again, back within half a minute) it appears at once on a fresh channel, rather than show no status for up to half a minute", async (t) => {
  const { client, store, ch } = await live(t); // appeared: the 1st call
  const others = { [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] };
  store.pause({ leaveNow: true });
  await flush();
  await tick(t, 2 * SECOND);
  store.resume();
  await flush();
  ch.echo(others);
  await tick(t, 2 * SECOND);
  store.pause({ leaveNow: true }); // the 4th call
  await flush();
  await tick(t, 2 * SECOND);
  store.resume();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack,track,untrack", "no 5th call on that channel");
  assert.deepEqual(client.removed, [ch]);
  // Should the fresh channel be slow to join, the people it knew go after the same grace as after a drop.
  assert.ok(store.getSnapshot().has(OTHER));
  await tick(t, PRESENCE_DOWN_GRACE_MS);
  assert.equal(store.getSnapshot().size, 0);
  const fresh = client.channels[1];
  fresh.status("SUBSCRIBED");
  await flush();
  assert.equal(fresh.presenceCalls.join(","), "track", "appears at once");
  fresh.echo(others);
  assert.equal(store.isReady(), true, "ready within a round trip of joining");
  assert.ok(store.getSnapshot().has(OTHER));
  await store.stop();
});

test("store: a heartbeat that finds my status hidden (turned off elsewhere) leaves the channel and shows nobody; in front it keeps asking, and shown again it joins afresh and appears", async (t) => {
  const { client, store, ch } = await live(t);
  client.shown = false;
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.deepEqual(client.removed, [ch], "left the channel: others see me go at once");
  assert.equal(ch.untracks, 0, "no presence call needed");
  assert.equal(store.isReady(), false);
  assert.equal(store.getStatus(), "hidden");
  assert.equal(store.getSnapshot().size, 0);
  ch.sync({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), false, "the old channel's news is ignored");
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(client.channels.length, 1, "no join while hidden");
  client.shown = true;
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(client.channels.length, 2, "joined afresh");
  const fresh = client.channels[1];
  fresh.status("SUBSCRIBED");
  assert.equal(fresh.tracks.length, 1);
  fresh.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), true);
  assert.equal(store.getSnapshot().size, 2);
  await store.stop();
});

test("store: a refused join is left (no endless retries); a heartbeat says why: shown again joins after a pause, hidden waits for a shown answer", async (t) => {
  const { client, store, ch } = await started(t);
  const touches = client.touches;
  ch.status("CHANNEL_ERROR", refusal());
  await flush();
  assert.deepEqual(client.removed, [ch], "the refused channel is left, which stops realtime-js asking again and again");
  assert.equal(client.touches, touches + 1, "a heartbeat asks what changed");
  await tick(t, 1000);
  assert.equal(client.channels.length, 2, "shown: a fresh join after a pause");
  // Refused again, and this time the status turns out hidden.
  client.shown = false;
  client.channels[1].status("CHANNEL_ERROR", refusal());
  await flush();
  assert.equal(store.getStatus(), "hidden");
  await tick(t, 5 * SECOND);
  assert.equal(client.channels.length, 2, "no joining while hidden");
  // A dropped connection is not a refusal: realtime-js rejoins it by itself.
  client.shown = true;
  await tick(t, PRESENCE_HEARTBEAT_MS);
  await tick(t, 2 * SECOND);
  const third = client.channels.at(-1);
  third.status("CHANNEL_ERROR", new Error("socket closed: 1006", { cause: { code: 1006, reason: "" } }));
  await flush();
  assert.ok(!client.removed.includes(third), "kept for realtime-js to rejoin");
  await store.stop();
});

test("store: refused while in the background, it asks nothing (a heartbeat would stamp) until the app is back", async (t) => {
  const { client, store, ch } = await live(t);
  store.pause();
  await tick(t, PRESENCE_LEAVE_GRACE_MS);
  const touches = client.touches;
  ch.status("CLOSED");
  await tick(t, 1000);
  const second = client.channels[1];
  second.status("CHANNEL_ERROR", refusal());
  await tick(t, 60 * SECOND);
  assert.equal(client.touches, touches, "no stamp in the background");
  assert.equal(client.channels.length, 2, "no joining either");
  store.resume();
  await flush();
  assert.equal(client.touches, touches + 1);
  await tick(t, 2000);
  assert.equal(client.channels.length, 3, "back in front and shown: joins again (after the next, longer pause)");
  await store.stop();
});

test("store: a heartbeat refused for want of a session, with no session left at all (signed out here or elsewhere), ends the store: channel left, no more heartbeats or joins; start() starts again", async (t) => {
  const { client, store, ch } = await live(t);
  client.touchFailure = { error: { message: "permission denied for function touch_activity", code: "42501" }, status: 401 };
  client.session = null;
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(store.getStatus(), "ended");
  assert.deepEqual(client.removed, [ch]);
  assert.equal(store.getSnapshot().size, 0);
  const touches = client.touches;
  await tick(t, 10 * PRESENCE_HEARTBEAT_MS);
  assert.equal(client.touches, touches, "no more heartbeats");
  assert.equal(client.channels.length, 1, "no more joins");
  client.touchFailure = null;
  client.session = { user: { id: ME.id } };
  store.start();
  await flush();
  assert.equal(client.channels.length, 2);
  assert.equal(store.getStatus(), "connecting");
  await store.stop();
});

test("store: a refusal while the session is only being renewed (no session for now, with the error saying why; supabase-js sent the anon key) or with the session still there (a clock off) does not end the store: it carries on, and is back once heartbeats go through", async (t) => {
  const refused = { error: { message: "permission denied for function touch_activity", code: "42501" }, status: 401 };
  for (const [what, session, sessionError] of [["being renewed", null, { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }], ["still there", { user: { id: ME.id } }, null]]) {
    const { client, store, ch } = await live(t);
    client.touchFailure = refused;
    client.session = session;
    client.sessionError = sessionError;
    await tick(t, PRESENCE_HEARTBEAT_MS);
    assert.notEqual(store.getStatus(), "ended", what);
    assert.equal(client.removed.length, 0, `${what}: the channel is kept`);
    const touches = client.touches;
    await tick(t, PRESENCE_HEARTBEAT_MS);
    assert.equal(client.touches, touches + 1, `${what}: heartbeats go on`);
    // Realtime, handed the anon key too, ends the channel; the store joins afresh, and the renewal goes through.
    ch.status("CLOSED");
    client.touchFailure = null;
    client.session = { user: { id: ME.id } };
    client.sessionError = null;
    await tick(t, 1000);
    const fresh = client.channels.at(-1);
    assert.notEqual(fresh, ch, `${what}: joined afresh`);
    fresh.status("SUBSCRIBED");
    await flush();
    assert.ok(fresh.tracks.length >= 1, `${what}: appears again`);
    fresh.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
    assert.equal(store.isReady(), true, what);
    await store.stop();
  }
});

test("store: pause({ leaveNow }) (a phone going to the background, where no timer runs) stamps and stops appearing at once, still listening; back in front it stamps first and appears once that is in", async (t) => {
  const { client, store, ch } = await live(t);
  const touches = client.touches;
  store.pause({ leaveNow: true });
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack", "left at once");
  assert.equal(client.touches, touches + 1, "stamped as it went");
  assert.equal(client.removed.length, 0, "still in the channel");
  ch.sync({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), true, "others' presence still arrives");
  let release;
  client.touchGate = new Promise((r) => (release = r));
  store.resume();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack", "not before the stamp is in");
  assert.equal(store.isReady(), false);
  client.touchGate = null;
  release();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack,track");
  ch.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), true);
  await store.stop();
});

test("store: leaveNow after a plain pause (a hidden tab then frozen) leaves at once without stamping twice; before start() it leaves nothing to undo", async (t) => {
  const { client, store, ch } = await live(t);
  store.pause();
  await tick(t, 3 * SECOND);
  const touches = client.touches;
  store.pause({ leaveNow: true });
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack");
  assert.equal(client.touches, touches, "already stamped when it was hidden");
  await tick(t, PRESENCE_LEAVE_GRACE_MS);
  assert.equal(ch.presenceCalls.join(","), "track,untrack", "the grace's own leave does not come again");
  await store.stop();
  mockTime(t);
  const early = createPresenceStore(fakeClient(), ME);
  early.pause({ leaveNow: true });
  early.start();
  await flush();
  assert.equal(early.isReady(), false);
  await early.stop();
});

test("store: after a drop that outlasted the last stamp (every heartbeat failing meanwhile), the rejoin stamps first and appears only once that stamp is in", async (t) => {
  const { client, store, ch } = await live(t);
  const asks = () => client.rpcCalls.filter((c) => c.name === "touch_activity").length;
  ch.status("CHANNEL_ERROR");
  client.rpcError = new Error("Failed to fetch");
  await tick(t, 5 * PRESENCE_HEARTBEAT_MS);
  client.rpcError = null;
  let release;
  client.touchGate = new Promise((r) => (release = r));
  const before = asks();
  ch.status("SUBSCRIBED");
  await flush();
  assert.equal(asks(), before + 1, "a stamp asked for at once, not at the next minute");
  assert.equal(ch.presenceCalls.join(","), "track", "no appearing beside a five-minute-old time");
  client.touchGate = null;
  release();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,track", "appears once the stamp is in");
  await store.stop();
});

test("store: a short drop (the last stamp still fresh) appears again at once, with no extra stamp", async (t) => {
  const { client, store, ch } = await live(t);
  const asks = () => client.rpcCalls.filter((c) => c.name === "touch_activity").length;
  const before = asks();
  ch.status("CHANNEL_ERROR");
  await tick(t, 5 * SECOND);
  ch.status("SUBSCRIBED");
  assert.equal(ch.presenceCalls.join(","), "track,track");
  await flush();
  assert.equal(asks(), before);
  await store.stop();
});

test("store: a failed heartbeat lets the store appear only while its last stamp is fresh: back after a long time with the heartbeat failing, it waits for one to go through", async (t) => {
  const { client, store, ch } = await live(t);
  store.pause();
  await tick(t, 10 * MINUTE);
  assert.equal(ch.presenceCalls.join(","), "track,untrack");
  client.rpcError = new Error("Failed to fetch");
  store.resume();
  await flush();
  assert.equal(ch.presenceCalls.join(","), "track,untrack", "the last stamp is ten minutes old");
  client.rpcError = null;
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(ch.presenceCalls.join(","), "track,untrack,track", "appears with the next stamp");
  await store.stop();
});

test("store: started with its first stamp failing (offline, say), a join does not appear; it asks for a stamp at once and appears once one goes through", async (t) => {
  mockTime(t);
  const client = fakeClient();
  client.rpcError = new Error("Failed to fetch");
  const store = createPresenceStore(client, ME);
  store.start();
  await flush();
  const ch = client.channels[0];
  client.rpcError = null;
  const asks = () => client.rpcCalls.filter((c) => c.name === "touch_activity").length;
  const before = asks();
  ch.status("SUBSCRIBED");
  await flush();
  assert.equal(asks(), before + 1, "asked on joining");
  assert.equal(ch.presenceCalls.join(","), "track");
  await store.stop();
});

test("store: in front, the block list is read again with every heartbeat, so a block or unblock made by the other person (or on another device) shows within a minute; not in the background", async (t) => {
  const { client, store } = await live(t);
  assert.equal(client.blockAsks, 1);
  client.blockedIds = [OTHER];
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(client.blockAsks, 2);
  assert.equal(store.getSnapshot().has(OTHER), false, "blocked elsewhere: left out");
  client.blockedIds = [];
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(store.getSnapshot().has(OTHER), true, "unblocked elsewhere: back");
  store.pause();
  const asked = client.blockAsks;
  await tick(t, 3 * PRESENCE_HEARTBEAT_MS);
  assert.equal(client.blockAsks, asked, "nothing asked in the background");
  await store.stop();
});

test("store: a failing heartbeat changes nothing", async (t) => {
  const { client, store, ch } = await live(t);
  client.rpcError = new Error("offline");
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(store.isReady(), true);
  assert.equal(ch.untracks, 0);
  assert.equal(client.removed.length, 0);
  await store.stop();
});

test("store: paused before it joins, it listens but does not appear (or stamp) until resumed", async (t) => {
  mockTime(t);
  const client = fakeClient();
  const store = createPresenceStore(client, ME);
  store.pause();
  store.start();
  await flush();
  const ch = client.channels[0];
  ch.status("SUBSCRIBED");
  ch.sync({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(ch.tracks.length, 0);
  assert.equal(client.touches, 0);
  assert.equal(store.isReady(), true, "others' presence still counts");
  store.resume();
  await flush();
  assert.equal(client.touches, 1);
  assert.equal(ch.tracks.length, 1);
  assert.equal(store.isReady(), false, "until my own arrival comes back");
  ch.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")] });
  assert.equal(store.isReady(), true);
  await store.stop();
});

test("store: people blocked either way are left out; nobody shows before the block list is in; refreshBlocks reads it again; without a list everyone shows", async (t) => {
  mockTime(t);
  const client = fakeClient();
  client.blockedIds = [THIRD];
  let release;
  const gate = new Promise((r) => (release = r));
  const store = createPresenceStore(client, ME, {
    blocks: async (c) => {
      await gate;
      const { data, error } = await c.rpc("blocked_either_way_ids");
      if (error) throw error;
      return data;
    },
  });
  store.start();
  await flush();
  const ch = client.channels[0];
  ch.status("SUBSCRIBED");
  await flush();
  ch.echo({ [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z")], [THIRD]: [meta(THIRD, "2026-10-11T11:00:00Z")] });
  assert.equal(store.getSnapshot().size, 0, "nobody until the block list is in");
  assert.equal(store.isReady(), false);
  release();
  await flush();
  assert.deepEqual([...store.getSnapshot().keys()].sort(), [ME.id, OTHER].sort(), "the blocked one is left out");
  assert.equal(store.isReady(), true);
  client.blockedIds = [OTHER];
  store.refreshBlocks();
  await flush();
  assert.deepEqual([...store.getSnapshot().keys()].sort(), [ME.id, THIRD].sort());
  client.blockFailure = true;
  client.blockedIds = [];
  store.refreshBlocks();
  await flush();
  assert.deepEqual([...store.getSnapshot().keys()].sort(), [ME.id, THIRD].sort(), "a failed read keeps the list it had");
  await store.stop();
  // The default reads blocked_either_way_ids(), once at start and again on every rejoin.
  const plain = await live(t);
  assert.equal(plain.client.blockAsks, 1);
  plain.ch.status("CHANNEL_ERROR");
  plain.ch.status("SUBSCRIBED");
  await flush();
  assert.equal(plain.client.blockAsks, 2);
  await plain.store.stop();
});

test("store: stop leaves the channel, empties it and stops the heartbeat; a start meanwhile waits until the old channel is gone", async (t) => {
  const { client, store, ch } = await live(t);
  let release;
  client.pendingRemoval = new Promise((r) => (release = r));
  const stopping = store.stop();
  assert.deepEqual(client.removed, [ch]);
  assert.equal(store.isReady(), false);
  assert.equal(store.getStatus(), "ended");
  assert.equal(store.getSnapshot().size, 0);
  const touches = client.touches;
  await tick(t, 3 * PRESENCE_HEARTBEAT_MS);
  assert.equal(client.touches, touches, "no heartbeat after stop");
  // Another store for the same client (the provider re-created it) and this one restarted: both wait for the leave.
  const next = createPresenceStore(client, ME);
  next.start();
  await flush();
  assert.equal(client.channels.length, 1, "nothing joins while the old channel is being left");
  release();
  await stopping;
  await flush();
  assert.equal(client.channels.length, 2);
  await next.stop();
});

test("store: start is idempotent, stop then start again joins once, and a stop before the join prevents it", async (t) => {
  mockTime(t);
  const client = fakeClient();
  const store = createPresenceStore(client, ME);
  store.start();
  store.start();
  await flush();
  assert.equal(client.channels.length, 1);
  await store.stop();
  store.start();
  await flush();
  assert.equal(client.channels.length, 2);
  await store.stop();
  store.start();
  void store.stop();
  await flush();
  assert.equal(client.channels.length, 2, "stopped before it could join");
  await store.stop();
});

test("store: listeners hear changes only, and can unsubscribe", async (t) => {
  const { store, ch, changes } = await live(t);
  const state = { [OTHER]: [meta(OTHER, "2026-10-11T11:00:00Z", "Omar")] };
  const after = changes();
  const snapshot = store.getSnapshot();
  ch.echo(state);
  assert.equal(changes(), after, "the same people again is no change");
  assert.equal(store.getSnapshot(), snapshot);
  let other = 0;
  const unsubscribe = store.subscribe(() => other++);
  ch.sync({});
  assert.equal(other, 1);
  unsubscribe();
  ch.echo(state);
  assert.equal(other, 1);
  await store.stop();
});

test("store: the heartbeat can be swapped (a void answer means shown)", async (t) => {
  mockTime(t);
  const client = fakeClient();
  let beats = 0;
  const store = createPresenceStore(client, ME, { heartbeat: async () => { beats++; } });
  store.start();
  await flush();
  client.channels[0].status("SUBSCRIBED");
  await tick(t, PRESENCE_HEARTBEAT_MS);
  assert.equal(beats, 2);
  assert.equal(client.touches, 0);
  assert.equal(client.channels[0].tracks.length, 1);
  assert.equal(client.channels[0].untracks, 0);
  await store.stop();
});

// --- queries -------------------------------------------------------------------------------------------------------
test("touchActivity: the database's answer (do I show my status); errors thrown with the HTTP status", async () => {
  const client = fakeClient();
  assert.equal(await touchActivity(client), true);
  client.shown = false;
  assert.equal(await touchActivity(client), false);
  client.shown = null;
  assert.equal(await touchActivity(client), false);
  client.touchFailure = { error: { message: "permission denied for function touch_activity", code: "42501" }, status: 401 };
  await assert.rejects(() => touchActivity(client), (e) => /permission denied/.test(e.message) && e.status === 401 && e.code === "42501");
});

test("getActivityStatusMany: every id asked about, null without a time, with whether it is recent; repeats and empty ids dropped; batches of 100", async () => {
  const client = fakeClient();
  const ids = Array.from({ length: 230 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  client.statusRows = (asked) => asked.filter((_, i) => i % 2 === 0).map((id, i) => ({ user_id: id, last_active_at: "2026-10-11T11:55:00+00:00", recent: i === 0 }));
  const got = await getActivityStatusMany(client, [...ids, ids[0], "", ids[1]]);
  assert.equal(Object.keys(got).length, 230);
  assert.deepEqual(client.rpcCalls.map((c) => c.args.p_user_ids.length), [100, 100, 30]);
  assert.deepEqual(got[ids[0]], { lastActiveAt: "2026-10-11T11:55:00+00:00", recent: true });
  assert.equal(got[ids[1]], null);
  assert.deepEqual(got[ids[202]], { lastActiveAt: "2026-10-11T11:55:00+00:00", recent: false });
  client.statusRows = () => [{ user_id: "someone-else", last_active_at: "2026-10-11T11:55:00+00:00", recent: true }];
  assert.deepEqual(await getActivityStatusMany(client, [ids[0]]), { [ids[0]]: null }, "rows not asked about are ignored");
  // Someone who has not written to me: recent, with no time.
  client.statusRows = (asked) => asked.map((id) => ({ user_id: id, last_active_at: null, recent: true }));
  assert.deepEqual(await getActivityStatusMany(client, [ids[0]]), { [ids[0]]: { lastActiveAt: null, recent: true } });
});

test("getActivityStatusMany: no request for no ids; errors thrown; getActivityStatus for one", async () => {
  const client = fakeClient();
  assert.deepEqual(await getActivityStatusMany(client, []), {});
  assert.equal(client.rpcCalls.length, 0);
  client.statusRows = (asked) => asked.map((id) => ({ user_id: id, last_active_at: "2026-10-11T11:00:00+00:00", recent: false }));
  assert.deepEqual(await getActivityStatus(client, OTHER), { lastActiveAt: "2026-10-11T11:00:00+00:00", recent: false });
  client.statusRows = () => [];
  assert.equal(await getActivityStatus(client, OTHER), null);
  client.rpcError = new Error("permission denied for function activity_status");
  await assert.rejects(() => getActivityStatusMany(client, [OTHER]), /permission denied/);
});

test("getBlockedEitherWayIds: the ids, nothing else; errors thrown", async () => {
  const client = fakeClient();
  client.blockedIds = [OTHER, THIRD];
  assert.deepEqual(await getBlockedEitherWayIds(client), [OTHER, THIRD]);
  client.blockFailure = true;
  await assert.rejects(() => getBlockedEitherWayIds(client));
});

test("the topic is the one migration 22's realtime policies name", () => {
  const sql = fs.readFileSync(new URL("../../../supabase/migrations/20261011000000_activity_status.sql", import.meta.url), "utf8");
  const topics = [...sql.matchAll(/realtime\.topic\(\)\) = '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(topics, [PRESENCE_TOPIC, PRESENCE_TOPIC]);
});

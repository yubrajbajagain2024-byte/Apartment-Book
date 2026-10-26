"use client";

/**
 * Every Buzz call the website makes, in one place. The real implementation is the shared data layer
 * (`@apartment-book/shared` → `buzz_v2_*` RPCs with the signed-in browser client, writes through `POST /api/buzz…`
 * with the session cookie). Nothing else in `components/buzz` talks to Supabase.
 *
 * Development only: `?buzzFixtures=1` (or `gate`, `muted`, `new`, `small`, `empty`, `error`, `blocked`, `held`,
 * `support`) swaps in an in-memory fake (`fixtures.ts`) so every screen can be checked without the database. The
 * switch is compiled out of production builds (`process.env.NODE_ENV` is a build-time constant there).
 */
import {
  acceptBuzzGate,
  createBuzzPost,
  createBuzzReply,
  deleteBuzzItem,
  getBuzzFeed,
  getBuzzGate,
  getBuzzKarma,
  getBuzzMeta,
  getBuzzPostingStatus,
  getBuzzReplies,
  getBuzzThread,
  hideBuzzAuthor,
  hideBuzzThread,
  listMyBuzz,
  reportBuzzItem,
  voteBuzzItem,
  voteBuzzPoll,
  type Buzz,
  type BuzzFeedMeta,
  type BuzzFeedPage,
  type BuzzFeedQuery,
  type BuzzGateState,
  type BuzzPage,
  type BuzzPoll,
  type BuzzPostingStatus,
  type BuzzReply,
  type BuzzReportReason,
  type BuzzScope,
  type BuzzThread,
  type BuzzVoteState,
  type CreateBuzzReplyRequest,
  type CreateBuzzRequest,
  type MyBuzzItem,
  type MyBuzzKind,
  type PhotoMeta,
  type WithModeration,
} from "@apartment-book/shared";
import { uploadBuzzPhoto } from "@/lib/buzz-photos";
import { createClient } from "@/lib/supabase/client";
import { uploadBuzzVideo, type UploadedBuzzVideo } from "./video-upload";

export interface BuzzApi {
  gate(): Promise<BuzzGateState>;
  acceptGate(version: string): Promise<BuzzGateState>;
  feed(q: BuzzFeedQuery): Promise<BuzzFeedPage>;
  meta(scope: BuzzScope): Promise<BuzzFeedMeta>;
  thread(threadId: string, limit?: number): Promise<BuzzThread>;
  replies(threadId: string, offset: number, limit?: number): Promise<BuzzPage<BuzzReply>>;
  mine(kind: MyBuzzKind, offset: number): Promise<BuzzPage<MyBuzzItem>>;
  karma(): Promise<number>;
  postingStatus(): Promise<BuzzPostingStatus>;
  vote(id: string, value: -1 | 0 | 1): Promise<BuzzVoteState>;
  pollVote(threadId: string, optionId: string): Promise<BuzzPoll>;
  remove(id: string): Promise<void>;
  hideThread(threadId: string, hide: boolean): Promise<void>;
  hideAuthor(itemId: string): Promise<void>;
  report(id: string, reason: BuzzReportReason, note: string | null): Promise<{ alreadyReported: boolean }>;
  create(body: CreateBuzzRequest): Promise<WithModeration<Buzz>>;
  reply(threadId: string, body: CreateBuzzReplyRequest): Promise<WithModeration<BuzzReply>>;
  /** Re-encodes on the device (no EXIF) and uploads to the anonymous `buzz/anon/` folder. */
  uploadPhoto(file: File): Promise<PhotoMeta>;
  /** One Mux upload; resolves once the video is ready to stream. */
  uploadVideo(file: File, onProgress: (percent: number, phase: "uploading" | "processing") => void): Promise<UploadedBuzzVideo>;
}

const real: BuzzApi = {
  gate: () => getBuzzGate(createClient()),
  acceptGate: (version) => acceptBuzzGate(createClient(), version),
  feed: (q) => getBuzzFeed(createClient(), q),
  meta: (scope) => getBuzzMeta(createClient(), scope),
  thread: (threadId, limit) => getBuzzThread(createClient(), threadId, limit),
  replies: (threadId, offset, limit) => getBuzzReplies(createClient(), threadId, offset, limit),
  mine: (kind, offset) => listMyBuzz(createClient(), kind, offset),
  karma: () => getBuzzKarma(createClient()),
  postingStatus: () => getBuzzPostingStatus(createClient()),
  vote: (id, value) => voteBuzzItem(createClient(), id, value),
  pollVote: (threadId, optionId) => voteBuzzPoll(createClient(), threadId, optionId),
  remove: (id) => deleteBuzzItem(createClient(), id),
  hideThread: (threadId, hide) => hideBuzzThread(createClient(), threadId, hide),
  hideAuthor: (itemId) => hideBuzzAuthor(createClient(), itemId),
  report: (id, reason, note) => reportBuzzItem(createClient(), id, reason, note),
  // Same origin: the session cookie identifies the writer; the route moderates the text first.
  create: (body) => createBuzzPost({ baseUrl: "" }, body),
  reply: (threadId, body) => createBuzzReply({ baseUrl: "" }, threadId, body),
  uploadPhoto: (file) => uploadBuzzPhoto(createClient(), file),
  uploadVideo: (file, onProgress) => uploadBuzzVideo(file, onProgress),
};

/* ───────────────────────────── development fixtures ───────────────────────────── */

let fixtureVariant: string | null = null;
let fixtureApi: Promise<BuzzApi> | null = null;

/** Turns fixture mode on for this tab (development builds only). It stays on across client-side navigation. */
export function enableBuzzFixtures(variant: string | null | undefined): void {
  if (process.env.NODE_ENV === "production" || !variant) return;
  if (variant === fixtureVariant) return;
  fixtureVariant = variant;
  fixtureApi = null;
}

/** The fixture variant in use, or null (always null in production). */
export function buzzFixtureVariant(): string | null {
  return process.env.NODE_ENV === "production" ? null : fixtureVariant;
}

function impl(): BuzzApi | Promise<BuzzApi> {
  if (process.env.NODE_ENV !== "production" && fixtureVariant) {
    const variant = fixtureVariant;
    fixtureApi ??= import("./fixtures").then((m) => m.createFixtureApi(variant));
    return fixtureApi;
  }
  return real;
}

function route<K extends keyof BuzzApi>(key: K): BuzzApi[K] {
  type Args = Parameters<BuzzApi[K]>;
  type Result = ReturnType<BuzzApi[K]>;
  const call = async (...args: Args) => {
    const api = await impl();
    return (api[key] as (...a: Args) => Result)(...args);
  };
  return call as unknown as BuzzApi[K];
}

/** Use this, never `real` directly: it is the fixture fake in development fixture mode. */
export const buzzApi: BuzzApi = {
  gate: route("gate"),
  acceptGate: route("acceptGate"),
  feed: route("feed"),
  meta: route("meta"),
  thread: route("thread"),
  replies: route("replies"),
  mine: route("mine"),
  karma: route("karma"),
  postingStatus: route("postingStatus"),
  vote: route("vote"),
  pollVote: route("pollVote"),
  remove: route("remove"),
  hideThread: route("hideThread"),
  hideAuthor: route("hideAuthor"),
  report: route("report"),
  create: route("create"),
  reply: route("reply"),
  uploadPhoto: route("uploadPhoto"),
  uploadVideo: route("uploadVideo"),
};

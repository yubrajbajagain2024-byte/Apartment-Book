import "server-only";

import { z } from "zod";
import { BUZZ_CATEGORIES, BUZZ_CATEGORY_COPY, BUZZ_COMPOSER_COPY, BUZZ_LIMITS, BUZZ_POLL_DURATIONS, type BuzzCategory, type BuzzPollDuration, type CreateBuzzReplyRequest, type CreateBuzzRequest } from "@apartment-book/shared";

/**
 * Request bodies of the Buzz write API (`CreateBuzzRequest` / `CreateBuzzReplyRequest` in packages/shared), ported from
 * UniVerse `createBuzzSchema` / `createReplySchema`. Limits come from `BUZZ_LIMITS`. Unknown keys are dropped, so
 * nothing but these fields reaches the database. The database re-checks everything (`buzz_v2_create` /
 * `buzz_v2_reply`); these checks only answer early, before the text is moderated.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The anonymous Buzz photo folder (the database also checks the storage origin and that the caller uploaded it). */
const BUZZ_PHOTO_URL = /^https?:\/\/[^\s/]+(?::\d+)?\/storage\/v1\/object\/public\/uploads\/buzz\/anon\/[a-f0-9]{32,64}\.(?:jpg|jpeg|png|webp)$/;
const MUX_PLAYBACK_ID = /^[A-Za-z0-9]{8,120}$/;

const uuid = z.string().regex(UUID_RE, "That buzz isn't available.");
const dimension = (max: number) => z.number().positive().max(max).nullable().optional().transform((v) => v ?? null);

const photoUrl = z.string().max(1000).regex(BUZZ_PHOTO_URL, "Buzz photos must be uploaded anonymously.");
const category = z.enum(BUZZ_CATEGORIES.map((c) => c.value) as [BuzzCategory, ...BuzzCategory[]], { error: BUZZ_CATEGORY_COPY.invalid });

const imageMeta = z.object({
  url: z.string().max(1000),
  width: dimension(50_000),
  height: dimension(50_000),
  blur: z.string().max(4000).nullable().optional().transform((v) => v ?? null),
});

const video = z.object({
  playbackId: z.string().regex(MUX_PLAYBACK_ID, "That video isn't ready yet."),
  posterUrl: z.string().max(300).nullable().optional().transform((v) => v ?? null),
  width: dimension(20_000),
  height: dimension(20_000),
  // the database allows 60.5 s (encoders round); the composer rejects anything longer before uploading
  durationSeconds: z.number().nonnegative().max(BUZZ_LIMITS.videoMaxSeconds + 0.5, BUZZ_COMPOSER_COPY.videoTooLong).nullable().optional().transform((v) => v ?? null),
});

const poll = z.object({
  options: z
    .array(z.string().trim().min(1, "Poll options can't be empty.").max(BUZZ_LIMITS.pollOptionText))
    .min(BUZZ_LIMITS.pollMinOptions, `Add at least ${BUZZ_LIMITS.pollMinOptions} options.`)
    .max(BUZZ_LIMITS.pollMaxOptions, `Polls have at most ${BUZZ_LIMITS.pollMaxOptions} options.`)
    .refine((o) => new Set(o.map((s) => s.toLowerCase())).size === o.length, "Poll options must be different."),
  durationDays: z
    .number()
    .refine((d): d is BuzzPollDuration => (BUZZ_POLL_DURATIONS as readonly number[]).includes(d), "Polls run for 1, 3 or 7 days."),
});

export const createBuzzSchema = z
  .object({
    text: z.string().trim().max(BUZZ_LIMITS.text).default(""),
    title: z.string().trim().max(BUZZ_LIMITS.title).optional(),
    scope: z.enum(["campus", "global"]).default("campus"),
    category: category.nullable().optional(),
    images: z.array(photoUrl).max(BUZZ_LIMITS.images, `You can attach up to ${BUZZ_LIMITS.images} photos.`).optional(),
    imageMeta: z.array(imageMeta).max(BUZZ_LIMITS.images).optional(),
    video: video.optional(),
    poll: poll.optional(),
    promptId: z.string().regex(UUID_RE, "That prompt has expired.").optional(),
  })
  .refine((b) => b.text.length > 0 || (b.title ?? "").length > 0, { message: "Say something first.", path: ["text"] })
  .refine((b) => !(b.video && b.images && b.images.length > 0), { message: "Add photos or one video, not both.", path: ["video"] });

export const createReplySchema = z.object({
  text: z.string().trim().min(1, "Say something first.").max(BUZZ_LIMITS.replyText),
  parentId: uuid.optional(),
});

export type ParsedCreateBuzz = z.output<typeof createBuzzSchema>;
export type ParsedCreateReply = z.output<typeof createReplySchema>;

/** What `buzz_v2_create` receives as `p_input`: the parsed request, trimmed, unknown keys dropped. */
export function toCreateInput(b: ParsedCreateBuzz): CreateBuzzRequest {
  const out: CreateBuzzRequest = { text: b.text, scope: b.scope };
  if (b.title) out.title = b.title;
  if (b.category) out.category = b.category;
  if (b.images?.length) out.images = b.images;
  if (b.imageMeta?.length) out.imageMeta = b.imageMeta;
  if (b.video) out.video = b.video;
  if (b.poll) out.poll = { options: b.poll.options, durationDays: b.poll.durationDays as BuzzPollDuration };
  if (b.promptId) out.promptId = b.promptId;
  return out;
}

/** What `buzz_v2_reply` receives as `p_input`. */
export function toReplyInput(b: ParsedCreateReply): CreateBuzzReplyRequest {
  return b.parentId ? { text: b.text, parentId: b.parentId } : { text: b.text };
}

/** zod's failure → the 400 message (the first problem, in words) and details (UniVerse: `flatten()`). */
export function describeIssues(error: z.ZodError): { message: string; details: unknown } {
  const first = error.issues[0];
  return { message: first?.message || "Check the post and try again.", details: z.flattenError(error) };
}

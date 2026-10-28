import { MAX_VIDEO_DURATION_SECONDS, MUX_IMAGE_BASE, MUX_STREAM_BASE, MUX_WEBHOOK_TOLERANCE_SECONDS, type PostAudience } from "./constants";
import type { FeedMedia, FeedPostWithAuthor, ListingVideo, PostEngagement, PosterSummary, Reel } from "./types/models";
import { photosFor } from "./utils";

export function muxPlaybackUrl(playbackId: string): string {
  return `${MUX_STREAM_BASE}/${playbackId}.m3u8`;
}

/** Still frame from the video, used as the poster while it loads. */
export function muxPosterUrl(playbackId: string, seconds = 1, width = 1080): string {
  return `${MUX_IMAGE_BASE}/${playbackId}/thumbnail.jpg?time=${seconds}&width=${width}&fit_mode=preserve`;
}

/** Parse the videos jsonb column into typed entries (bad rows are dropped). */
export function videosFor(videos: unknown): ListingVideo[] {
  if (!Array.isArray(videos)) return [];
  return videos.filter((v): v is ListingVideo => Boolean(v) && typeof v === "object" && typeof (v as ListingVideo).media_id === "string" && typeof (v as ListingVideo).playback_id === "string");
}

/** Build a post's media strip: videos first, then photos. */
export function listingMedia(images: string[], imageMeta: unknown, videos?: unknown): FeedMedia[] {
  const clips: FeedMedia[] = videosFor(videos).map((v) => ({
    type: "video",
    playbackUrl: muxPlaybackUrl(v.playback_id),
    poster: v.poster_url ?? muxPosterUrl(v.playback_id),
    width: v.width,
    height: v.height,
    durationSeconds: v.duration_seconds,
  }));
  const photos: FeedMedia[] = photosFor(images, imageMeta).map((p) => ({ type: "photo", url: p.url, width: p.width, height: p.height, blur: p.blur }));
  return [...clips, ...photos];
}

export function hasVideo(media: FeedMedia[]): boolean {
  return media.some((m) => m.type === "video");
}

/** True when the poster signed up with a verified university email. */
export function isVerifiedPoster(poster: PosterSummary | null | undefined): boolean {
  return Boolean(poster?.university?.email_domain);
}

/** "0.4 mi from campus · San Marcos" style subtitle for post headers. */
export function posterSubtitle(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(" · ");
}

/**
 * A posted reel as the vertical Reels viewer shows it, built from its row in a feed (For you, Posts) and the counts that
 * row already has, so tapping the reel opens it at once with nothing to wait for. The same shape reels_feed returns for
 * it (see listReels). Null for a plain post, or a reel whose video is not ready yet.
 */
export function reelFromFeedPost(post: FeedPostWithAuthor, engagement: PostEngagement, savedByMe: boolean): Reel | null {
  if (post.kind !== "reel") return null;
  const video = videosFor(post.videos)[0];
  if (!video) return null;
  return {
    sourceType: "post",
    sourceId: post.id,
    author: { id: post.author.id, name: post.author.full_name, avatarUrl: post.author.avatar_url, verified: isVerifiedPoster(post.author) },
    title: post.title ?? null,
    caption: post.body,
    video,
    createdAt: post.created_at,
    likes: engagement.likes,
    comments: engagement.comments,
    likedByMe: engagement.likedByMe,
    savedByMe,
    link: post.link_url ?? null,
    commentsOff: post.comments_off ?? false,
    audience: (post.audience ?? "global") as PostAudience,
  };
}

/**
 * The video provider's webhook signature header, "t=<unix seconds>,v1=<hex>[,v1=<hex>…]": when it was signed and its
 * signatures, or null when the header is not one.
 */
export function parseMuxSignature(header: string | null | undefined): { timestamp: number; signatures: string[] } | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[a-f0-9]{64}$/.test(value)) signatures.push(value);
  }
  return timestamp !== null && signatures.length > 0 ? { timestamp, signatures } : null;
}

/** Whether a signed webhook is recent enough to accept: signed within `tolerance` seconds of now (an older one is a replay). */
export function muxSignatureFresh(timestamp: number, nowSeconds: number, tolerance: number = MUX_WEBHOOK_TOLERANCE_SECONDS): boolean {
  return Number.isFinite(timestamp) && Math.abs(nowSeconds - timestamp) <= tolerance;
}

/** Whether a video is longer than anyone may upload (the server refuses it, and so does the database). */
export function videoTooLong(durationSeconds: number | null | undefined): boolean {
  return typeof durationSeconds === "number" && durationSeconds > MAX_VIDEO_DURATION_SECONDS;
}

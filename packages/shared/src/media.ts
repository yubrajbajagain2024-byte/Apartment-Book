import { MUX_IMAGE_BASE, MUX_STREAM_BASE } from "./constants";
import type { FeedMedia, ListingVideo, PosterSummary } from "./types/models";
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

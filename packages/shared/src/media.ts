import type { FeedMedia, PosterSummary } from "./types/models";
import { photosFor } from "./utils";

/** Build a post's media strip from its stored photos (videos are added by the video pipeline). */
export function listingMedia(images: string[], imageMeta: unknown): FeedMedia[] {
  return photosFor(images, imageMeta).map((p) => ({ type: "photo", url: p.url, width: p.width, height: p.height, blur: p.blur }));
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

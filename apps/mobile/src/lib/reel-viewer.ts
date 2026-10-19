import type { useRouter } from "expo-router";
import {
  getFeedPostsByIds,
  getPostEngagementMany,
  getSavedIds,
  isVerifiedPoster,
  listForYou,
  listingMedia,
  muxPlaybackUrl,
  muxPosterUrl,
  reelFromFeedPost,
  type FeedMedia,
  type FeedPostWithAuthor,
  type ListingVideo,
  type PostEngagement,
  type Reel,
} from "@apartment-book/shared";
import { supabase } from "./supabase";

/** expo-router does not export its router type: this is what useRouter() hands out. */
type Router = ReturnType<typeof useRouter>;

/**
 * One page of the full-screen viewer (app/reels/[id].tsx): a reel (a posted reel or a listing's video tour, one video)
 * or a post with its photos and videos, which the page swipes through sideways. Author, words, counts and saved are a
 * Reel's, so every page has the same rail: like, comments, share, save, the profile and "…".
 */
export type ViewerItem = Omit<Reel, "video"> & {
  /** A reel or an ordinary post; listing tours count as reels. */
  kind: "reel" | "post";
  /** What the page shows, in the post's own order (videos, then photos): a reel's one video. */
  media: FeedMedia[];
  /** The reel's video as the Reels feed gives it; null for a post. */
  video: ListingVideo | null;
};

/**
 * A page as it is handed to the viewer: ready (`item`), or only a post's id, loaded when the page comes near (a profile
 * square or a chat card knows little more). `thumb` shows while it loads; `gone` marks a post that has been deleted.
 */
export type ViewerEntry = {
  key: string;
  id: string;
  item: ViewerItem | null;
  thumb: string | null;
  gone?: boolean;
  /** The photo or video to start on (the one showing in the feed when it was tapped). */
  slide?: number;
  /** Where that video had got to in the feed when it was tapped (seconds): the viewer goes on from there. */
  startAt?: number;
};

/**
 * What the viewer opens on: the pages, the one tapped, and what follows the last of them. A reel goes on into the
 * Reels feed ("reels"); a post from a list goes on through that list (`more` hands over its next pages, if any), and
 * stops at its end ("end"). A list that follows the Campus | Global choice (For you) passes `rescope`: the viewer then
 * shows the toggle, and after a change the pages after the one on screen come from `rescope`'s list instead.
 */
export type ViewerSource = {
  entries: ViewerEntry[];
  index: number;
  /** Where the tapped picture sits on screen: the viewer zooms open from it, and back into it on the way out. */
  origin?: ViewerOrigin;
  then: "reels" | "end" | { more: () => Promise<ViewerEntry[]>; rescope?: (universityId: string | undefined, seen: Set<string>) => () => Promise<ViewerEntry[]> };
};

const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

/** A tapped picture's frame in window points, and its corner radius. */
export type ViewerOrigin = { x: number; y: number; width: number; height: number; radius: number };

/** Measures where a tapped view sits on screen (undefined when it cannot be measured), for the viewer to zoom open from. */
export function measureOrigin(view: { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void } | null, radius = 0): Promise<ViewerOrigin | undefined> {
  return new Promise((resolve) => {
    if (!view) return resolve(undefined);
    view.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height, radius } : undefined));
  });
}

export const viewerKey = (item: Pick<ViewerItem, "sourceType" | "sourceId">) => `${item.sourceType}:${item.sourceId}`;

/** A reel's video as one slide. */
export function videoMedia(video: ListingVideo): FeedMedia {
  return { type: "video", playbackUrl: muxPlaybackUrl(video.playback_id), poster: video.poster_url ?? muxPosterUrl(video.playback_id), width: video.width, height: video.height, durationSeconds: video.duration_seconds };
}

/** The picture that stands for a page: the first photo, or the first video's still. */
export function viewerThumb(media: FeedMedia[]): string | null {
  const first = media[0];
  if (!first) return null;
  return first.type === "photo" ? first.url : first.poster;
}

export function viewerItemFromReel(reel: Reel): ViewerItem {
  return { ...reel, kind: "reel", media: [videoMedia(reel.video)] };
}

/** A Reel (from the Reels feed) or a page already built: the page. */
export function asViewerItem(reel: Reel | ViewerItem): ViewerItem {
  return "media" in reel && Array.isArray(reel.media) ? (reel as ViewerItem) : viewerItemFromReel(reel as Reel);
}

/** True when a post has something to show full screen; a words-only post keeps its own screen. */
export function postHasMedia(post: Pick<FeedPostWithAuthor, "images" | "image_meta" | "videos">): boolean {
  return listingMedia(post.images, post.image_meta, post.videos).length > 0;
}

/** A feed post (a reel, or a post with photos, videos or both) as a page, with the counts the caller already has. Null for a words-only post. */
export function viewerItemFromPost(post: FeedPostWithAuthor, engagement: PostEngagement, saved: boolean): ViewerItem | null {
  if (post.kind === "reel") {
    const reel = reelFromFeedPost(post, engagement, saved);
    if (reel) return viewerItemFromReel(reel);
  }
  const media = listingMedia(post.images, post.image_meta, post.videos);
  if (media.length === 0) return null;
  return {
    sourceType: "post",
    sourceId: post.id,
    author: { id: post.author.id, name: post.author.full_name, avatarUrl: post.author.avatar_url, verified: isVerifiedPoster(post.author) },
    title: null,
    caption: post.body ?? "",
    createdAt: post.created_at,
    likes: engagement.likes,
    comments: engagement.comments,
    likedByMe: engagement.likedByMe,
    savedByMe: saved,
    kind: post.kind === "reel" ? "reel" : "post",
    media,
    video: null,
  };
}

export function entryOf(item: ViewerItem, slide?: number, startAt?: number): ViewerEntry {
  return { key: viewerKey(item), id: item.sourceId, item, thumb: viewerThumb(item.media), slide, startAt };
}

/** A Mux video's still at a given moment (its poster's own link, with the time changed); any other poster as it is. */
export function posterAt(poster: string, seconds: number): string {
  if (!poster.startsWith("https://image.mux.com/")) return poster;
  const time = Math.max(0, Math.round(seconds * 10) / 10);
  return /[?&]time=/.test(poster) ? poster.replace(/([?&]time=)[^&]*/, `$1${time}`) : `${poster}${poster.includes("?") ? "&" : "?"}time=${time}`;
}

/** A post known only by its id (a profile square, a chat card, a saved row): loaded when its page comes near. */
export function entryForPost(id: string, thumb: string | null): ViewerEntry {
  return { key: `post:${id}`, id, item: null, thumb };
}

/**
 * Posts as pages, with their counts and whether you saved them, in one round trip each. A post that no longer exists
 * (or turned out to be words only) comes back null.
 */
export async function loadViewerItems(ids: string[], userId: string | null): Promise<Record<string, ViewerItem | null>> {
  const out: Record<string, ViewerItem | null> = {};
  if (ids.length === 0) return out;
  const [posts, engagement, saved] = await Promise.all([
    getFeedPostsByIds(supabase, ids),
    getPostEngagementMany(supabase, "post", ids).catch(() => ({}) as Record<string, PostEngagement>),
    userId ? getSavedIds(supabase, userId, "post").catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  for (const id of ids) out[id] = null;
  for (const post of posts) out[post.id] = viewerItemFromPost(post, engagement[post.id] ?? NO_ENGAGEMENT, saved.has(post.id));
  return out;
}

/** Feed posts as pages, with their counts and saved state fetched together; words-only posts are left out. */
export async function itemsForPosts(posts: FeedPostWithAuthor[], userId: string | null): Promise<ViewerItem[]> {
  const shown = posts.filter(postHasMedia);
  if (shown.length === 0) return [];
  const ids = shown.map((p) => p.id);
  const [engagement, saved] = await Promise.all([
    getPostEngagementMany(supabase, "post", ids).catch(() => ({}) as Record<string, PostEngagement>),
    userId ? getSavedIds(supabase, userId, "post").catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  return shown.map((p) => viewerItemFromPost(p, engagement[p.id] ?? NO_ENGAGEMENT, saved.has(p.id))).filter((i): i is ViewerItem => i !== null);
}

/**
 * What follows For you's pages in the viewer: its next pages, in order, words-only posts skipped (a page of nothing but
 * words is passed over for the one after). `page` is the last page the feed has loaded; `seen` the posts it already shows.
 */
export function forYouAfter(opts: { universityId: string | undefined; userId: string | null; page: number; hasMore: boolean; seen: Set<string> }): () => Promise<ViewerEntry[]> {
  let next = opts.page + 1;
  let more = opts.hasMore;
  const seen = new Set(opts.seen);
  return async () => {
    while (more) {
      const result = await listForYou(supabase, { universityId: opts.universityId, page: next });
      next = result.page + 1;
      more = result.hasMore;
      const fresh = result.items.filter((p) => !seen.has(p.id));
      fresh.forEach((p) => seen.add(p.id));
      const items = await itemsForPosts(fresh, opts.userId);
      if (items.length > 0) return items.map((item) => entryOf(item));
    }
    return [];
  };
}

/**
 * Opens the viewer the way Instagram opens what you tap: the source's pages are handed over here, so the page tapped
 * shows at once with the counts its row already had (no spinner), and the pages around it are ready to swipe to. A
 * viewer opened some other way (a link) finds nothing here and fetches the post by its id instead.
 */
let handed: { id: string; source: ViewerSource } | null = null;

export function openViewer(router: Router, source: ViewerSource) {
  const entry = source.entries[source.index];
  if (!entry) return;
  handed = { id: entry.id, source };
  router.push({ pathname: "/reels/[id]", params: { id: entry.id } });
}

/** A reel tapped in a feed: that reel (going on from `startAt`, where it was playing), then the Reels feed behind it (only reels, like Instagram). */
export function openReel(router: Router, reel: Reel, origin?: ViewerOrigin, startAt?: number) {
  openViewer(router, { entries: [entryOf(viewerItemFromReel(reel), undefined, startAt)], index: 0, then: "reels", origin });
}

/** What was handed over for this id, if that is what was handed over last. Left in place until `dropHanded`, so a render that runs twice reads the same thing. */
export function peekHanded(id: string): ViewerSource | null {
  return handed && handed.id === id ? handed.source : null;
}

/** Forgets what was handed over for this id (the viewer leaving). */
export function dropHanded(id: string) {
  if (handed && handed.id === id) handed = null;
}

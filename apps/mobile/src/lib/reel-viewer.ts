import type { useRouter } from "expo-router";
import type { VideoPlayer } from "expo-video";
import { lendPlayer, returnPlayer } from "./video-handoff";
import {
  BUZZ_PAGE_SIZE,
  getFeedPostsByIds,
  getPostEngagementMany,
  getSavedIds,
  isVerifiedPoster,
  listBuzz,
  listForYou,
  listingMedia,
  muxPlaybackUrl,
  muxPosterUrl,
  reelFromFeedPost,
  type BuzzFilters,
  type BuzzPost,
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
 * One page of the full-screen viewer (app/reels/[id].tsx): a reel (a posted reel or a listing's video tour, one video),
 * a post with its photos and videos, which the page swipes through sideways, or an anonymous Buzz thread with its media.
 * Author, words, counts and saved are a Reel's, so every page of a post has the same rail: like, comments, share, save,
 * the profile and "…". A Buzz page (`buzz`) has nobody's name and is voted on instead (see ReelItem).
 */
export type ViewerItem = Omit<Reel, "video" | "sourceType"> & {
  sourceType: Reel["sourceType"] | "buzz";
  /** A reel or an ordinary post; listing tours count as reels. */
  kind: "reel" | "post";
  /** What the page shows, in the post's own order (videos, then photos): a reel's one video. */
  media: FeedMedia[];
  /** The reel's video as the Reels feed gives it; null for a post. */
  video: ListingVideo | null;
  /**
   * An anonymous Buzz thread (`sourceType` "buzz"): its topic, its score and your vote, its reply count, whether it is
   * yours. Its `author` is a placeholder that is never shown: the app is never told who wrote a thread.
   */
  buzz?: BuzzPost;
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
  /** The feed's own player for that video (iOS), to play on in the viewer without a reload (see video-handoff.ts). */
  player?: VideoPlayer;
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
  /** Opened from a Buzz thread's own screen: its replies are right behind the viewer, which closes onto them. */
  repliesBehind?: boolean;
};

const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

/** A tapped picture's frame in window points and its corner radius, and the band of it not under a floating bar (`clip`). */
export type ViewerOrigin = { x: number; y: number; width: number; height: number; radius: number; clip?: { top: number; bottom: number } };

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

/** A Buzz thread with photos or videos as a page: anonymous, voted on, its replies on its own screen. Null without media. */
export function viewerItemFromBuzz(post: BuzzPost): ViewerItem | null {
  const media = listingMedia(post.images, post.imageMeta, post.videos);
  if (media.length === 0) return null;
  return {
    sourceType: "buzz",
    sourceId: post.id,
    author: { id: "", name: "Anonymous", avatarUrl: null, verified: false },
    title: post.title,
    caption: post.body.trim(),
    createdAt: post.createdAt,
    likes: 0,
    comments: post.commentCount,
    likedByMe: false,
    savedByMe: false,
    kind: "post",
    media,
    video: null,
    buzz: post,
  };
}

/** At most this many of the Buzz list's pages are read for one batch: Buzz is mostly words, threads with media far apart. */
const BUZZ_SCAN_PAGES = 4;

/**
 * What follows the Buzz list's pages in the viewer: its next pages with the same filters, from `offset` (what the list
 * has loaded), threads with nothing to show full screen passed over. A batch that finds none in BUZZ_SCAN_PAGES pages
 * ends the viewer's pages there rather than reading on through a feed of words.
 */
export function buzzAfter(opts: { filters: BuzzFilters; offset: number; seen: Set<string> }): () => Promise<ViewerEntry[]> {
  let offset = opts.offset;
  let more = true;
  const seen = new Set(opts.seen);
  return async () => {
    for (let scanned = 0; more && scanned < BUZZ_SCAN_PAGES; scanned++) {
      const page = await listBuzz(supabase, { ...opts.filters, limit: BUZZ_PAGE_SIZE, offset });
      offset += page.length;
      more = page.length >= BUZZ_PAGE_SIZE;
      const fresh = page.filter((p) => !seen.has(p.id));
      fresh.forEach((p) => seen.add(p.id));
      const items = fresh.map(viewerItemFromBuzz).filter((i): i is ViewerItem => i !== null);
      if (items.length > 0) return items.map((item) => entryOf(item));
    }
    return [];
  };
}

export function entryOf(item: ViewerItem, slide?: number, startAt?: number, player?: VideoPlayer): ViewerEntry {
  return { key: viewerKey(item), id: item.sourceId, item, thumb: viewerThumb(item.media), slide, startAt, player };
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
let handed: { id: string; source: ViewerSource; read: boolean } | null = null;

/** The feed players handed over with these pages (see video-handoff.ts). */
function eachPlayer(source: ViewerSource, act: (player: VideoPlayer) => void) {
  source.entries.forEach((e) => e.player && act(e.player));
}

export function openViewer(router: Router, source: ViewerSource) {
  const entry = source.entries[source.index];
  if (!entry) return;
  // Pages handed over to a viewer that never came up (a second tap overtook it) give back what they borrowed.
  if (handed && !handed.read) eachPlayer(handed.source, returnPlayer);
  handed = { id: entry.id, source, read: false };
  // Borrowed now, just before the screen changes, while the feed still plays it: the feed leaves it alone from here (its
  // losing focus never pauses it), and the viewer gives it back as it goes.
  eachPlayer(source, lendPlayer);
  router.push({ pathname: "/reels/[id]", params: { id: entry.id } });
}

/** A reel tapped in a feed: that reel (going on from `startAt`, where it was playing), then the Reels feed behind it (only reels, like Instagram). */
export function openReel(router: Router, reel: Reel, origin?: ViewerOrigin, startAt?: number, player?: VideoPlayer) {
  openViewer(router, { entries: [entryOf(viewerItemFromReel(reel), undefined, startAt, player)], index: 0, then: "reels", origin });
}

/** What was handed over for this id, if that is what was handed over last. Left in place until `dropHanded`, so a render that runs twice reads the same thing. */
export function peekHanded(id: string): ViewerSource | null {
  if (!handed || handed.id !== id) return null;
  handed.read = true;
  return handed.source;
}

/** Forgets what was handed over for this id (the viewer leaving). */
export function dropHanded(id: string) {
  if (handed && handed.id === id) handed = null;
}

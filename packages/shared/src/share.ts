import type { FeedMedia, FeedPostWithAuthor, Reel, SavedTargetType, SharedPost, SharedPostKind } from "./types/models";

const KINDS: SharedPostKind[] = ["post", "reel", "listing"];
const TARGETS = ["post", "apartment", "roommate", "item"] as const;
const BASES: Record<SharedPost["target_type"], string> = { post: "/posts", apartment: "/apartments", roommate: "/roommates", item: "/marketplace" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A regex rather than `new URL`: React Native's URL does not implement `protocol`.
const HTTPS = /^https:\/\/[^\s/?#]+[^\s]*$/i;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const https = (v: unknown): string | null => {
  const s = str(v);
  return s && HTTPS.test(s) ? s : null;
};

/** Where the shared thing lives on the website, always rebuilt from its type and id: a stored path is never trusted. */
export function sharedPostPath(shared: Pick<SharedPost, "target_type" | "target_id">): string {
  return `${BASES[shared.target_type]}/${shared.target_id}`;
}

/**
 * The snapshot stored on a message, if it is one. Anything malformed (old rows, hand-made JSON) reads as "no share".
 * Anyone in a chat can write this JSON, so nothing in it is taken on trust: the link is rebuilt from the type and id,
 * the id must be a UUID, and pictures are kept only when they are https URLs.
 */
export function sharedPostOf(value: unknown): SharedPost | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const target_type = str(v.target_type);
  const target_id = str(v.target_id);
  if (!target_type || !target_id || !(TARGETS as readonly string[]).includes(target_type) || !UUID.test(target_id)) return null;
  const type = target_type as SharedPost["target_type"];
  const stated = str(v.kind);
  // A listing is always a listing; a post is a post or a reel.
  const kind: SharedPostKind = type !== "post" ? "listing" : stated === "reel" ? "reel" : stated && (KINDS as string[]).includes(stated) && stated !== "listing" ? (stated as SharedPostKind) : "post";
  const author = v.author && typeof v.author === "object" ? (v.author as Record<string, unknown>) : null;
  return {
    target_type: type,
    target_id,
    kind,
    path: sharedPostPath({ target_type: type, target_id }),
    title: str(v.title),
    caption: str(v.caption),
    image_url: https(v.image_url),
    author: { id: str(author?.id) ?? "", name: str(author?.name) ?? "Someone", avatar_url: https(author?.avatar_url) },
  };
}

/** The first picture, or a still from the first video, of the media a card already shows; else the post's first image. */
function firstFrame(post: Pick<FeedPostWithAuthor, "images">, media?: FeedMedia[]): string | null {
  for (const m of media ?? []) {
    if (m.type === "photo") return m.url;
    if (m.type === "video" && m.poster) return m.poster;
  }
  return post.images?.[0] ?? null;
}

/** A post or reel from the feed, as it will appear in the chat. Pass the card's media so a video post gets its poster. */
export function sharedPostFromFeedPost(post: FeedPostWithAuthor, media?: FeedMedia[]): SharedPost {
  return {
    target_type: "post",
    target_id: post.id,
    kind: post.kind === "reel" ? "reel" : "post",
    path: sharedPostPath({ target_type: "post", target_id: post.id }),
    title: null,
    caption: post.body?.trim() ? post.body.trim() : null,
    image_url: firstFrame(post, media),
    author: { id: post.author.id, name: post.author.full_name, avatar_url: post.author.avatar_url },
  };
}

/** An item of the Reels feed: a posted reel, or a listing's video tour (which opens the listing). */
export function sharedPostFromReel(reel: Reel): SharedPost {
  const listing = reel.sourceType !== "post";
  return {
    target_type: reel.sourceType,
    target_id: reel.sourceId,
    kind: listing ? "listing" : "reel",
    path: sharedPostPath({ target_type: reel.sourceType, target_id: reel.sourceId }),
    title: reel.title,
    caption: reel.caption?.trim() ? reel.caption.trim() : null,
    image_url: reel.video.poster_url ?? null,
    author: { id: reel.author.id, name: reel.author.name, avatar_url: reel.author.avatarUrl },
  };
}

/** An apartment, roommate or marketplace listing from its detail page. */
export function sharedPostFromListing(input: { targetType: SavedTargetType; targetId: string; title: string; caption?: string | null; imageUrl?: string | null; author: { id: string; name: string; avatar_url: string | null } }): SharedPost {
  return {
    target_type: input.targetType,
    target_id: input.targetId,
    kind: "listing",
    path: sharedPostPath({ target_type: input.targetType, target_id: input.targetId }),
    title: input.title,
    caption: input.caption?.trim() ? input.caption.trim() : null,
    image_url: input.imageUrl ?? null,
    author: input.author,
  };
}

/** The inbox line for a share without words; the same text the database writes into last_message_preview. */
export function sharedPostPreview(shared: Pick<SharedPost, "kind">): string {
  return shared.kind === "reel" ? "Sent a reel" : shared.kind === "listing" ? "Sent a listing" : "Sent a post";
}

/** The card's footer: what tapping it opens. */
export function sharedPostLabel(shared: Pick<SharedPost, "kind">): string {
  return shared.kind === "reel" ? "View reel" : shared.kind === "listing" ? "View listing" : "View post";
}

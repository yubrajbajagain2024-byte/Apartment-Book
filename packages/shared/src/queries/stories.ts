import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostAudience } from "../constants";
import type { Story, StoryAuthor } from "../stories";
import type { Database } from "../types/database";
import type { ListingVideo, PhotoMeta } from "../types/models";
import { isMissingRelation } from "./profile-page";

type Client = SupabaseClient<Database>;

/**
 * A story with its author and what the database lets the caller know of its views: every view for the author's own,
 * only their own row for anyone else's (the select policy). PostgREST names the joins by the foreign keys.
 */
const STORY_SELECT = "id, author_id, kind, image_url, image_meta, video, audience, created_at, expires_at, author:profiles!stories_author_id_fkey(id, full_name, avatar_url), views:story_views(viewer_id)";
/** With migration 62: the likes the caller may read (every like of their own story, only their own of anyone else's). */
const STORY_SELECT_LIKES = `${STORY_SELECT}, likes:story_likes(user_id)`;

type StoryRow = {
  id: string;
  author_id: string;
  kind: string;
  image_url: string | null;
  image_meta: unknown;
  video: unknown;
  audience: string;
  created_at: string;
  expires_at: string;
  author: StoryAuthor | null;
  views: { viewer_id: string }[] | null;
  likes?: { user_id: string }[] | null;
};

function storyOf(row: StoryRow, meId: string | null): Story | null {
  if (!row.author) return null;
  const views = row.views ?? [];
  const mine = row.author_id === meId;
  const meta = (row.image_meta ?? null) as Partial<PhotoMeta> | null;
  return {
    id: row.id,
    author: row.author,
    kind: row.kind === "video" ? "video" : "photo",
    photo: row.image_url ? { url: row.image_url, width: meta?.width ?? null, height: meta?.height ?? null, blur: meta?.blur ?? null } : null,
    video: (row.video as ListingVideo | null) ?? null,
    audience: row.audience as PostAudience,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    seen: !mine && views.some((v) => v.viewer_id === meId),
    views: mine ? views.length : 0,
    liked: !mine && (row.likes ?? []).some((l) => l.user_id === meId),
    likes: mine ? (row.likes ?? []).length : 0,
  };
}

/**
 * Every story the caller may see right now (the database applies the audience, the expiry and blocks), oldest first.
 * On a database without migration 58 there are none.
 */
export async function listStories(supabase: Client, meId: string | null): Promise<Story[]> {
  const read = (select: string) => supabase.from("stories").select(select).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }).limit(500);
  let { data, error } = await read(STORY_SELECT_LIKES);
  // Before migration 62 there are no likes to embed: the stories still come, unliked.
  if (error && isMissingRelation(error)) ({ data, error } = await read(STORY_SELECT));
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as StoryRow[]).map((r) => storyOf(r, meId)).filter((s): s is Story => s !== null);
}

export type StoryInput = {
  /** One or the other. */
  photo?: PhotoMeta | null;
  video?: ListingVideo | null;
  audience: PostAudience;
  /** The people a "Selected people" story is shown to (50 at most). */
  viewerIds?: string[];
  /** The author's university, for a campus-only story (the database checks it against the verified campus). */
  universityId?: string | null;
};

/** Shares a story: the row (the database stamps the author, the clock and the 24 hours), then its picked people. */
export async function createStory(supabase: Client, userId: string, input: StoryInput): Promise<string> {
  const kind = input.video ? "video" : "photo";
  if (kind === "photo" && !input.photo) throw new Error("A story needs a photo or a video.");
  const { data, error } = await supabase
    .from("stories")
    .insert({
      author_id: userId,
      kind,
      image_url: kind === "photo" ? input.photo!.url : null,
      image_meta: kind === "photo" ? ({ width: input.photo!.width, height: input.photo!.height, blur: input.photo!.blur } as never) : null,
      video: kind === "video" ? (input.video as never) : null,
      audience: input.audience,
      university_id: input.audience === "campus" ? (input.universityId ?? null) : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (input.audience === "selected") {
    const { error: pickError } = await supabase.rpc("set_story_viewers", { p_story_id: data.id, p_user_ids: input.viewerIds ?? [] });
    if (pickError) throw pickError;
  }
  return data.id;
}

/** The caller has watched this story: recorded once; false when nothing was recorded (their own, or one they may not see). */
export async function markStorySeen(supabase: Client, storyId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("mark_story_seen", { p_story_id: storyId });
  if (error) throw error;
  return data === true;
}

/** One person who has seen the caller's story, and whether they liked it (migration 62; false before it). */
export type StoryViewer = { viewer: StoryAuthor; at: string; liked: boolean };

/** Who has seen the caller's story, newest first, each marked if they liked it (the database answers only the author). */
export async function listStoryViewers(supabase: Client, storyId: string): Promise<StoryViewer[]> {
  const [views, likes] = await Promise.all([
    supabase.from("story_views").select("created_at, viewer:profiles!story_views_viewer_id_fkey(id, full_name, avatar_url)").eq("story_id", storyId).order("created_at", { ascending: false }).limit(200),
    supabase.from("story_likes").select("user_id").eq("story_id", storyId).limit(1000),
  ]);
  if (views.error) throw views.error;
  // The likes are a mark beside the list: a database without them (before migration 62) still lists the views.
  if (likes.error && !isMissingRelation(likes.error)) throw likes.error;
  const liked = new Set((likes.data ?? []).map((l) => l.user_id));
  return ((views.data ?? []) as unknown as { created_at: string; viewer: StoryAuthor | null }[])
    .filter((r) => r.viewer)
    .map((r) => ({ viewer: r.viewer!, at: r.created_at, liked: liked.has(r.viewer!.id) }));
}

/** A heart on someone else's story; liking twice is one like. The database refuses one's own and any story out of sight. */
export async function likeStory(supabase: Client, userId: string, storyId: string): Promise<void> {
  const { error } = await supabase.from("story_likes").upsert({ story_id: storyId, user_id: userId }, { onConflict: "story_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function unlikeStory(supabase: Client, userId: string, storyId: string): Promise<void> {
  const { error } = await supabase.from("story_likes").delete().eq("story_id", storyId).eq("user_id", userId);
  if (error) throw error;
}

/** The people whose stories the caller has muted (none before migration 62): their stories stay out of the tray. */
export async function listStoryMutes(supabase: Client, userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("story_mutes").select("author_id").eq("user_id", userId).limit(2000);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => r.author_id);
}

/** Mute or unmute someone's stories. The muted person is never told: the rows are the caller's alone. */
export async function setStoryMuted(supabase: Client, userId: string, authorId: string, muted: boolean): Promise<void> {
  const { error } = muted
    ? await supabase.from("story_mutes").upsert({ user_id: userId, author_id: authorId }, { onConflict: "user_id,author_id", ignoreDuplicates: true })
    : await supabase.from("story_mutes").delete().eq("user_id", userId).eq("author_id", authorId);
  if (error) throw error;
}

/** The author takes a story down before its time. */
export async function deleteStory(supabase: Client, storyId: string): Promise<void> {
  const { error } = await supabase.from("stories").delete().eq("id", storyId);
  if (error) throw error;
}

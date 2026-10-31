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
  };
}

/**
 * Every story the caller may see right now (the database applies the audience, the expiry and blocks), oldest first.
 * On a database without migration 58 there are none.
 */
export async function listStories(supabase: Client, meId: string | null): Promise<Story[]> {
  const { data, error } = await supabase.from("stories").select(STORY_SELECT).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }).limit(500);
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

export type StoryViewer = { viewer: StoryAuthor; at: string };

/** Who has seen the caller's story, newest first (the database answers only the author). */
export async function listStoryViewers(supabase: Client, storyId: string): Promise<StoryViewer[]> {
  const { data, error } = await supabase.from("story_views").select("created_at, viewer:profiles!story_views_viewer_id_fkey(id, full_name, avatar_url)").eq("story_id", storyId).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as { created_at: string; viewer: StoryAuthor | null }[]).filter((r) => r.viewer).map((r) => ({ viewer: r.viewer!, at: r.created_at }));
}

/** The author takes a story down before its time. */
export async function deleteStory(supabase: Client, storyId: string): Promise<void> {
  const { error } = await supabase.from("stories").delete().eq("id", storyId);
  if (error) throw error;
}

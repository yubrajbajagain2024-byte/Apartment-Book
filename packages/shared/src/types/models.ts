import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database";

/** A typed Supabase client. Works in the browser, on the server and in React Native. */
export type Client = SupabaseClient<Database>;

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];

export type University = Tables<"universities">;
export type Profile = Tables<"profiles">;
export type Apartment = Tables<"apartments">;
export type RoommatePost = Tables<"roommate_posts">;
export type Item = Tables<"items">;
export type SavedListing = Tables<"saved_listings">;
export type Conversation = Tables<"conversations">;
export type ConversationMember = Tables<"conversation_members">;
export type Message = Tables<"messages">;
export type DevicePushToken = Tables<"device_push_tokens">;
export type Media = Tables<"media">;
export type MediaStatus = "uploading" | "processing" | "ready" | "failed";

/** Snapshot of a ready video stored on a listing (videos jsonb). */
export type ListingVideo = {
  media_id: string;
  playback_id: string;
  poster_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
};
export type Notification = Tables<"notifications">;
export type NotificationType = "message" | "listing_saved" | "nearby_listing" | "system";
export type NotificationWithActor = Notification & { actor: ProfileSummary | null };
export type PushPlatform = "ios" | "android" | "web";

export type ListingStatus = Enums<"listing_status">;
export type ItemCondition = Enums<"item_condition">;
export type ItemStatus = Enums<"item_status">;
export type RoommatePostType = Enums<"roommate_post_type">;
export type ConversationType = Enums<"conversation_type">;
export type GenderPref = Enums<"gender_pref">;

export type SavedTargetType = "apartment" | "item" | "roommate";

/** The small slice of a profile shown next to listings and messages. */
export type ProfileSummary = Pick<Profile, "id" | "full_name" | "avatar_url">;
export type UniversitySummary = Pick<University, "id" | "name" | "latitude" | "longitude">;

/** What we know about one uploaded photo. Width/height keep layouts stable; blur is a tiny data URL shown while the photo loads. */
export type PhotoMeta = {
  url: string;
  width: number | null;
  height: number | null;
  blur: string | null;
};

/** A point on the map (WGS84). */
export type LatLng = { latitude: number; longitude: number };

export type ProfileWithUniversity = Profile & {
  university: (UniversitySummary & { email_domain: string | null }) | null;
};

/** Who posted something, with enough to show the "verified .edu" badge. */
export type PosterSummary = ProfileSummary & {
  university: { email_domain: string | null } | null;
};

export type ApartmentWithOwner = Apartment & {
  owner: PosterSummary;
  university: UniversitySummary | null;
};

export type RoommatePostWithAuthor = RoommatePost & {
  author: PosterSummary;
  university: UniversitySummary | null;
};

export type ItemWithSeller = Item & {
  seller: PosterSummary;
  university: UniversitySummary | null;
};

/** One item in a post's media strip. Videos arrive with the video pipeline. */
export type FeedMedia =
  | { type: "photo"; url: string; width: number | null; height: number | null; blur: string | null }
  | { type: "video"; playbackUrl: string; poster: string | null; width: number | null; height: number | null; durationSeconds: number | null };

export type MessageWithSender = Message & {
  sender: ProfileSummary | null;
};

/** One row of the conversation list, ready to render. */
export type ConversationSummary = {
  id: string;
  type: ConversationType;
  name: string | null;
  createdBy: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  members: ProfileSummary[];
  /** Everyone except the current user. */
  otherMembers: ProfileSummary[];
  unreadCount: number;
  /** Group name, or the other person's name for direct chats. */
  title: string;
};

export type Paginated<T> = {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

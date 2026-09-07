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

/** A point on the map (WGS84). */
export type LatLng = { latitude: number; longitude: number };

export type ProfileWithUniversity = Profile & {
  university: (UniversitySummary & { email_domain: string | null }) | null;
};

export type ApartmentWithOwner = Apartment & {
  owner: ProfileSummary;
  university: UniversitySummary | null;
};

export type RoommatePostWithAuthor = RoommatePost & {
  author: ProfileSummary;
  university: UniversitySummary | null;
};

export type ItemWithSeller = Item & {
  seller: ProfileSummary;
  university: UniversitySummary | null;
};

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

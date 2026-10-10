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
export type PostLike = Tables<"post_likes">;
export type PostComment = Tables<"post_comments">;
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
export type NotificationType = "message" | "listing_saved" | "nearby_listing" | "system" | "like" | "comment" | "follow";
export type NotificationWithActor = Notification & { actor: ProfileSummary | null };
export type PushPlatform = "ios" | "android" | "web";

export type ListingStatus = Enums<"listing_status">;
export type ItemCondition = Enums<"item_condition">;
export type ItemStatus = Enums<"item_status">;
export type RoommatePostType = Enums<"roommate_post_type">;
export type ConversationType = Enums<"conversation_type">;
export type GenderPref = Enums<"gender_pref">;

export type SavedTargetType = "apartment" | "item" | "roommate";
/** Everything that can be liked, commented on, saved or viewed: listings plus Home-feed posts and reels. */
export type PostTargetType = SavedTargetType | "post";

/** The small slice of a profile shown next to listings and messages. */
export type ProfileSummary = Pick<Profile, "id" | "full_name" | "avatar_url">;

export type FeedPost = Tables<"feed_posts">;
export type FeedPostKind = "post" | "reel";
/** A Home-feed post or reel with its author (identified, unlike Buzz). */
export type FeedPostWithAuthor = FeedPost & { author: PosterSummary; university: { id: string; name: string } | null };

/** One item of the vertical Reels feed: a posted reel or a listing's video tour. */
export type Reel = {
  sourceType: "post" | "apartment" | "roommate";
  sourceId: string;
  author: { id: string; name: string; avatarUrl: string | null; verified: boolean };
  /** Listing title for video tours; null for posted reels. */
  title: string | null;
  caption: string;
  video: ListingVideo;
  createdAt: string;
  likes: number;
  comments: number;
  likedByMe: boolean;
  savedByMe: boolean;
};

export type BuzzTopic = "thoughts" | "experience" | "advice" | "question" | "housing" | "campus" | "rant" | "other";
export type BuzzSort = "hot" | "new" | "top";
/**
 * An anonymous Buzz thread as other people see it. There is deliberately no
 * author here: the server never sends it. `alias` ("Student 48213") is stable
 * inside one thread and different in every other thread.
 */
export type BuzzPost = {
  id: string;
  topic: BuzzTopic;
  title: string;
  body: string;
  images: string[];
  imageMeta: unknown;
  videos: unknown;
  universityId: string | null;
  score: number;
  commentCount: number;
  createdAt: string;
  /** 1 upvoted, -1 downvoted, 0 no vote. */
  myVote: -1 | 0 | 1;
  isMine: boolean;
  alias: string;
};
export type BuzzComment = { id: string; parentId: string | null; body: string; createdAt: string; alias: string; isOp: boolean; isMine: boolean; score: number; myVote: -1 | 0 | 1 };
/** How replies under a thread are ordered (within each level of the tree). */
export type BuzzCommentSort = "best" | "new" | "old";
/** A reply placed in the thread tree: `depth` 0 is a reply to the thread itself. */
export type BuzzCommentNode = BuzzComment & { depth: number; replyCount: number };

/** A comment with who wrote it. */
export type PostCommentWithAuthor = PostComment & { author: ProfileSummary };
/** Thumbs up / down on a comment: the score and the viewer's own vote. */
/** `likes` is the heart count everyone sees; `score` (likes minus dislikes) is kept for ranking. */
export type CommentVote = { score: number; likes: number; myVote: -1 | 0 | 1 };
/** A comment placed in its thread: `depth` 0 answers the post, 1 answers a comment, and so on. */
export type PostCommentNode = PostCommentWithAuthor & { depth: number; replyCount: number; myVote: -1 | 0 | 1 };

/** Like/comment counts for a post plus whether the current user liked it. */
export type PostEngagement = { likes: number; comments: number; likedByMe: boolean };
/** Someone who liked a post, for the "Liked by Maya and others" line. */
export type PostLiker = { id: string; name: string; avatarUrl: string | null };
/** The newest likers (up to 3) and the newest comment of a post, shown under it in the Posts feed. */
export type PostPreview = { likers: PostLiker[]; lastComment: PostCommentWithAuthor | null };
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

/** Who can see a part of a profile: everyone, friends (they follow each other) or only its owner. */
export type ProfileVisibility = "public" | "friends" | "private";
/** The profile tabs whose visibility the owner chooses. */
export type ProfileSection = "classes" | "saved" | "liked";
/** May the person looking see each of those tabs? (The owner always may.) */
export type ProfileSectionAccess = Record<ProfileSection, boolean>;
export type ProfileClass = Tables<"profile_classes">;
/** The numbers under the profile photo. Followers and following come from FollowStats. */
export type ProfileStats = { posts: number; reels: number; likesReceived: number };
export type ProfileTileType = "post" | "reel" | "apartment" | "roommate" | "item";
/** One square of a profile grid (Posts, Reels, Saved, Liked) or a card of the Listings row. */
export type ProfileTile = {
  key: string;
  type: ProfileTileType;
  id: string;
  /** Website path; the app maps it onto its own screens. */
  href: string;
  imageUrl: string | null;
  /** For a words-only post, or the title of a listing. */
  text: string | null;
  isVideo: boolean;
  multiPhoto: boolean;
  pinned: boolean;
  /** Views of a post or reel; null when not counted (listings). */
  views: number | null;
};

/** What a shared post, reel or listing looks like inside a chat message: a snapshot taken when it was sent, so the card
 * renders without another query and still reads sensibly if the original is deleted. `path` is the website path, which the
 * app maps onto its own screens. */
export type SharedPostKind = "post" | "reel" | "listing";
export type SharedPost = {
  target_type: PostTargetType;
  target_id: string;
  kind: SharedPostKind;
  path: string;
  title: string | null;
  caption: string | null;
  image_url: string | null;
  author: { id: string; name: string; avatar_url: string | null };
};

export type MessageWithSender = Message & {
  sender: ProfileSummary | null;
};

/** What a conversation member has received and read, plus when they were last active. */
export type MemberStatus = {
  lastReadAt: string;
  lastDeliveredAt: string;
  lastSeenAt: string | null;
};

/** Someone currently connected, as broadcast over the presence channel. */
export type OnlineUser = ProfileSummary & { onlineAt: string };

/** Delivery state of one of your own messages, Messenger style. */
export type MessageReceipt = "sending" | "sent" | "delivered" | "seen";

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
  /** Read/delivered/active times per member id, for receipts and "Active 5m ago". */
  memberStatus: Record<string, MemberStatus>;
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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostAudience } from "../constants";
import type { Database, Json } from "./database";
import type { MessageAttachment } from "../message-media";

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
/**
 * `attachments` is optional: rows from a database without migration 20 have none. The shared queries always fill it.
 * `snap` too (migration 28): read it with snapOf().
 */
export type Message = Omit<Tables<"messages">, "attachments" | "snap" | "reply_to" | "call"> & { attachments?: MessageAttachment[]; snap?: Json | null; reply_to?: Json | null; call?: Json | null };
export type DevicePushToken = Tables<"device_push_tokens">;
export type Media = Tables<"media">;
/** Migration 39: the business portal. */
export type Business = Tables<"businesses">;
export type BusinessMember = Tables<"business_members">;
export type BusinessInvite = Tables<"business_invites">;
export type Deal = Tables<"deals">;
/** What a listing or a chat shows of the business behind it. */
export type BusinessSummary = Pick<Business, "id" | "name" | "logo_url" | "verified_partner">;
/** `sponsored`: a paid promotion is running now (the deal_sponsored computed field); missing before migration 39. */
export type DealWithBusiness = Deal & { business: BusinessSummary | null; sponsored?: boolean };
export type ListingPromotion = Tables<"listing_promotions">;
export type AdminPromotionRow = Database["public"]["Functions"]["admin_list_promotions"]["Returns"][number];
/** A listing or deal of a business that an admin can promote. */
export type PromotionTarget = Database["public"]["Functions"]["admin_business_targets"]["Returns"][number];
export type BusinessMemberWithProfile = BusinessMember & { profile: ProfileSummary | null };
/** The signed-in person's business and their place on its team. */
export type MyBusiness = { business: Business; role: "owner" | "staff" };
export type BusinessListingStats = Database["public"]["Functions"]["business_listing_stats"]["Returns"][number];
export type BusinessDealStats = Database["public"]["Functions"]["business_deal_stats"]["Returns"][number];
export type BusinessOverview = Database["public"]["Functions"]["business_overview"]["Returns"][number];
export type AdminBusinessRow = Database["public"]["Functions"]["admin_list_businesses"]["Returns"][number];
export type BusinessDecision = "approved" | "rejected" | "suspended" | "pending";
/** What a student may open a chat with a business from. */
export type InquiryTargetType = "apartment" | "deal";
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
export type NotificationType = "message" | "listing_saved" | "nearby_listing" | "system" | "like" | "comment" | "follow" | "snap" | "snap_activity" | "call";
export type NotificationWithActor = Notification & { actor: ProfileSummary | null };
/** Something a person has muted: a person's messages anywhere, one chat, or every group chat; `until` null is until unmuted. */
export type NotificationMute = Tables<"notification_mutes">;
export type MuteScope = "user" | "conversation" | "all_groups";
export type MuteDuration = "1h" | "8h" | "24h" | "forever";
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
  /** The listing's title for a video tour; a posted reel's own title (migration 44), or null when it has none. */
  title: string | null;
  /** A posted reel's link (migration 44); null for video tours and reels without one. */
  link: string | null;
  /** A posted reel nobody may comment on (migration 44). Missing means comments are on. */
  commentsOff?: boolean;
  /** Who can see a posted reel (migration 44). Missing means Global, as for every video tour. */
  audience?: PostAudience;
  caption: string;
  video: ListingVideo;
  createdAt: string;
  likes: number;
  comments: number;
  likedByMe: boolean;
  savedByMe: boolean;
};


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
  /** The business it was posted for from the portal (migration 39); missing on a database before it, null for a student's own. */
  business?: BusinessSummary | null;
  /** A paid promotion is running now (the listing_sponsored computed field). The only thing that makes a listing "Sponsored". */
  sponsored?: boolean;
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
export type ProfileSection = "classes" | "saved" | "liked" | "listings";
/** May the person looking see each of those tabs? (The owner always may.) */
export type ProfileSectionAccess = Record<ProfileSection, boolean>;
/** What a profile's Followers and Following counts open: your own lists, the friends you share, or a log-in prompt. */
export type FollowListView = "own" | "mutual" | "signed-out";
export type ProfileClass = Tables<"profile_classes">;
/** One section of one course, one semester, one campus: the class behind a course chat. */
export type CourseGroup = Tables<"course_groups">;
/** The numbers under the profile photo. Followers and following come from FollowStats. */
export type ProfileStats = { posts: number; reels: number; likesReceived: number };
export type ProfileTileType = "post" | "reel" | "apartment" | "roommate" | "item";
/** One square of a profile grid (Posts, Reels, Saved, Liked, Listings). */
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

/**
 * What a conversation member has received and read. When they were last active is private (migration 22): ask
 * getActivityStatusMany().
 */
export type MemberStatus = {
  lastReadAt: string;
  lastDeliveredAt: string;
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
  /** Read/delivered times per member id, for receipts. */
  memberStatus: Record<string, MemberStatus>;
  unreadCount: number;
  /** A course chat: the section of the course, one semester, that fills it from the class list. Null for any other chat. */
  courseGroup: Pick<CourseGroup, "id" | "term" | "code" | "section"> | null;
  /** An inquiry chat (migration 39): the business the student is talking to, whose team makes up the other side. Null for any other chat. */
  business: BusinessSummary | null;
  /** Group name, the business's name for an inquiry, or the other person's name for direct chats. */
  title: string;
};

export type Paginated<T> = {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// ---------------------------------------------------------------------------
// Two-factor sign-in for staff (Supabase Auth TOTP; the same shapes as CampConnect Admin's)
// ---------------------------------------------------------------------------
export type MfaFactorSummary = { id: string; friendlyName: string | null; status: "verified" | "unverified"; createdAt: string };
/** enrolled = a verified authenticator exists; verified = this session passed it (aal2) and it still exists, the rule staff_mfa_verified() applies in SQL. */
export type MfaStatus = { currentLevel: "aal1" | "aal2"; nextLevel: "aal1" | "aal2"; verified: boolean; enrolled: boolean; factors: MfaFactorSummary[] };
/** What to show while the user adds the authenticator: QR code (SVG data URL), the secret to type by hand and the otpauth URI. */
export type TotpEnrollment = { factorId: string; qrCode: string; secret: string; uri: string };

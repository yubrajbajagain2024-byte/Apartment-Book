import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostAudience, AUTO_HIDE_STATUSES, MEDIA_JOB_KINDS, MODERATION_TARGET_TYPES, REPORT_DECISIONS, AdminStaffRole } from "../constants";
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
/** A place on a business's team (migration 49; v1's "staff" became "editor"). */
export type BusinessTeamRole = "owner" | "admin" | "editor" | "analyst";
/** What a role may do, as business_can() decides it in the database (the table in migration 49's header). */
export type BusinessCapability = "view" | "analytics" | "publish" | "reply" | "manage_team" | "edit_profile" | "manage_ads";
/** The signed-in person's business and their place on its team. */
export type MyBusiness = { business: Business; role: BusinessTeamRole };
export type BusinessListingStats = Database["public"]["Functions"]["business_listing_stats"]["Returns"][number];
export type BusinessDealStats = Database["public"]["Functions"]["business_deal_stats"]["Returns"][number];
export type BusinessOverview = Database["public"]["Functions"]["business_overview"]["Returns"][number];
export type AdminBusinessRow = Database["public"]["Functions"]["admin_list_businesses"]["Returns"][number];
export type BusinessDecision = "approved" | "rejected" | "suspended" | "pending";
/** What a student may open a chat with a business from: a listing, a post, the business's profile or one of its ads (migration 50). */
export type InquiryTargetType = "apartment" | "deal" | "business" | "ad";

// --- UniBuzz Business v2 (migrations 49 and 50) ------------------------------------------------------------------
/** A business post: the deals table, which holds every kind since migration 50. */
export type BusinessPost = Deal;
export type PostKind = "update" | "product" | "service" | "deal" | "event" | "promotion";
/** One item of a post's or an ad's media: a photo, or a video with the provider's numbers. */
export type BusinessMediaItem =
  | { type: "image"; url: string; width?: number | null; height?: number | null }
  | { type: "video"; media_id: string; playback_id?: string | null; poster_url?: string | null; width?: number | null; height?: number | null; duration_seconds?: number | null };
export type Ad = Tables<"ads">;
export type AdStatus = "draft" | "pending_review" | "scheduled" | "active" | "paused" | "completed" | "rejected";
export type AdPlacement = "for_you" | "reels" | "housing";
export type AdObjective = "awareness" | "traffic" | "engagement" | "messages";
export type AdCta = "learn_more" | "shop_now" | "order_now" | "book_now" | "sign_up" | "get_offer" | "view_listing" | "message" | "visit_profile";
/** What a listing or post an ad promotes brings to the ad's card (ads_for_feed's `promoted`). */
export type PromotedSummary =
  | { type: "apartment"; id: string; title: string; price: number; currency: string; city: string | null; bedrooms: number; bathrooms: number; images: string[]; image_meta: Json }
  | { type: "deal"; id: string; title: string; kind: PostKind; discount_label: string | null; media: BusinessMediaItem[]; price_cents: number | null; currency: string; link_url: string | null; event_at: string | null };
/** An ad as students get it (ads_for_feed): no budget, no targeting, the business's name and label. */
export type FeedAd = Omit<Database["public"]["Functions"]["ads_for_feed"]["Returns"][number], "media" | "promoted"> & {
  media: BusinessMediaItem[];
  promoted: PromotedSummary | null;
};
export type AdminAdRow = Database["public"]["Functions"]["admin_list_ads"]["Returns"][number];
export type BusinessAdStats = Database["public"]["Functions"]["business_ad_stats"]["Returns"][number];
export type BusinessDailyStats = Database["public"]["Functions"]["business_daily_stats"]["Returns"][number];
export type BusinessAnalyticsOverview = Database["public"]["Functions"]["business_analytics_overview"]["Returns"][number];
export type BusinessAuditRow = Database["public"]["Functions"]["business_audit"]["Returns"][number];
export type BusinessReportRow = Database["public"]["Functions"]["admin_list_business_reports"]["Returns"][number];
export type SavedAd = Database["public"]["Functions"]["my_saved_ads"]["Returns"][number];
export type BusinessReportReason = "spam" | "misleading" | "offensive" | "scam" | "discrimination" | "prohibited" | "other";
export type BusinessEventKind = "impression" | "click" | "save" | "profile_visit" | "inquiry";
export type BusinessEventPlacement = AdPlacement | "profile" | "deals" | "other";
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
/** `business` and `ad` (migrations 49 and 50) go to a business's team: reviews, roles and campaign changes; their links are portal paths. */
export type NotificationType = "message" | "listing_saved" | "nearby_listing" | "system" | "like" | "comment" | "follow" | "snap" | "snap_activity" | "call" | "business" | "ad";
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
  /** Null on an anonymous post (is_anonymous): nobody but its poster can tell who wrote it. */
  author: PosterSummary | null;
  university: UniversitySummary | null;
};

export type ItemWithSeller = Item & {
  /** Null on an anonymous item (is_anonymous), as for roommate posts. */
  seller: PosterSummary | null;
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
  /** Who posted it; for an anonymous listing just { id: "", name: "Anonymous" } (the database drops its sender's copy). */
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
  /** A chat with an anonymous listing's poster (20261105000000_anonymous_listings.sql). Null for any other chat. */
  anonymous: ChatAnonymity | null;
  /** Group name, the business's name for an inquiry, "Anonymous poster" while one is hidden, or the other person's name for direct chats. */
  title: string;
};

/**
 * The anonymous side of a chat started from an anonymous listing: `role` is which side you are on (the poster, or the
 * person who wrote to them); `hidden`, whether the poster is still hidden from that person (the poster's choice, for
 * this one chat: revealListingIdentity()). `target` is the listing, its title when you can still see it.
 */
export type ChatAnonymity = {
  role: "poster" | "asker";
  hidden: boolean;
  revealedAt: string | null;
  target: { type: "roommate" | "item"; id: string; title: string | null } | null;
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
// CampConnect Admin (apps/admin): its staff (owner > admin > moderator), invitations and audit log

/** The signed-in user's place on the team (from admin_me). lastOwner: the only owner, who cannot step back until there is another. */
export type StaffAccess = { userId: string; role: AdminStaffRole; mfaVerified: boolean; mfaEnrolled: boolean; lastOwner: boolean };
/** mfaEnrolled is null when the caller may not know: moderators see it on their own row only. */
export type StaffMember = { userId: string; email: string | null; fullName: string; avatarUrl: string | null; role: AdminStaffRole; grantedBy: string | null; grantedByName: string | null; createdAt: string; mfaEnrolled: boolean | null };
/** A role promised to an email address that has not confirmed an account yet. */
export type StaffInvite = {
  email: string;
  role: AdminStaffRole;
  invitedBy: string | null;
  invitedByName: string | null;
  createdAt: string;
  /** Null for the first-owner bootstrap invitation, which does not expire. */
  expiresAt: string | null;
  expired: boolean;
  /** Whether the invitation email went out: not_sent (never tried or this app cannot send), sent, failed. */
  emailStatus: InviteEmailStatus;
  emailSentAt: string | null;
  emailAttempts: number;
  emailError: string | null;
  /** The email created the invitee's account (waiting for them to open the link). */
  accountCreated: boolean;
};
export type InviteEmailStatus = "not_sent" | "sent" | "failed";
export type AuditEntry = { id: number; actorId: string | null; actorEmail: string | null; actorName: string | null; action: string; targetType: string | null; targetId: string | null; details: Record<string, unknown>; createdAt: string };
export type MfaFactorSummary = { id: string; friendlyName: string | null; status: "verified" | "unverified"; createdAt: string };
/** enrolled = a verified authenticator exists; verified = this session passed it (aal2) and it still exists, the rule staff_mfa_verified() applies in SQL. */
export type MfaStatus = { currentLevel: "aal1" | "aal2"; nextLevel: "aal1" | "aal2"; verified: boolean; enrolled: boolean; factors: MfaFactorSummary[] };
/** What to show while the user adds the authenticator: QR code (SVG data URL), the secret to type by hand and the otpauth URI. */
export type TotpEnrollment = { factorId: string; qrCode: string; secret: string; uri: string };

// ---------------------------------------------------------------------------
// Admin section: moderation (suspensions, hidden content, reports, media jobs)
// ---------------------------------------------------------------------------
/** The eight kinds of content staff can hide, restore and delete. The names reports.target_type uses, minus 'profile'. */
export type ModerationTargetType = (typeof MODERATION_TARGET_TYPES)[number]["value"];
/** What staff decided when they closed a report. */
export type ReportDecision = (typeof REPORT_DECISIONS)[number]["value"];
/** "actioned" is Trust & Safety's word (production's console and the auto-hide backstop) for a report staff acted on. */
export type ReportStatus = "open" | "reviewed" | "actioned" | "dismissed";
export type MediaJobKind = (typeof MEDIA_JOB_KINDS)[number]["value"];

/** One suspension as the staff list shows it (admin_restrictions_list). `reason` is shown to the person; `internalNote` only to staff. */
export type AccountRestriction = {
  id: string;
  userId: string;
  fullName: string;
  email: string | null;
  kind: string;
  reason: string;
  internalNote: string | null;
  /** Null: until lifted. */
  expiresAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  liftedAt: string | null;
  liftedByName: string | null;
  liftNote: string | null;
  /** Neither lifted nor expired. */
  active: boolean;
};
/** The signed-in user's own active suspension (my_restriction), behind the "Your account is suspended" notice. */
export type MyRestriction = { kind: string; reason: string; expiresAt: string | null; createdAt: string };
/** One hit of the staff people search (admin_user_search). */
export type UserSearchResult = {
  userId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  universityName: string | null;
  createdAt: string;
  suspended: boolean;
  staffRole: AdminStaffRole | null;
};
/** One entry of a person's suspension history (admin_user_get.restrictions). */
export type UserRestriction = {
  id: string;
  kind: string;
  reason: string;
  internalNote: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  liftedAt: string | null;
  liftedBy: string | null;
  liftedByName: string | null;
  liftNote: string | null;
  active: boolean;
};
/** Everything on one person's admin page (admin_user_get). Reports against Buzz content are not counted: Buzz authorship only ever shows through getContentSnapshot. */
export type UserDetail = {
  userId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  program: string | null;
  university: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  staffRole: AdminStaffRole | null;
  /** From auth.users: Supabase refuses sign-in while this is in the future. Set by every suspension, cleared when it is lifted. */
  bannedUntil: string | null;
  counts: { apartments: number; items: number; roommatePosts: number; posts: number; comments: number; reportsFiled: number; reportsAgainst: number };
  activeRestriction: Omit<UserRestriction, "liftedAt" | "liftedBy" | "liftedByName" | "liftNote" | "active"> | null;
  /** Newest first. */
  restrictions: UserRestriction[];
};
/** One shape for every kind of content on the review screen (admin_content_get). For Buzz the author is revealed on purpose, and the look is logged. */
export type ContentSnapshot = {
  targetType: ModerationTargetType;
  targetId: string;
  authorId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
  /** Listings and Buzz threads have one; posts, comments and messages do not. */
  title: string | null;
  body: string;
  images: string[];
  /** The row's `videos` jsonb as stored (ListingVideo-shaped for listings, posts and Buzz). */
  videos: unknown[];
  /** Type-specific fields: price, status, category, conversation_id, alias, score... */
  extra: Record<string, unknown>;
};
/** One row of the report queue (admin_reports_list). targetAuthorId is null for Buzz targets: the list never reveals Buzz authors. */
export type ReportRow = {
  id: string;
  reporterId: string;
  reporterName: string | null;
  reporterEmail: string | null;
  targetType: ModerationTargetType | "profile";
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  decision: ReportDecision | null;
  notes: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** The title, or the first 140 characters of the content (the name, for a profile); empty once it is gone. */
  targetPreview: string;
  /** Hidden content, or a suspended profile. */
  targetHidden: boolean;
  targetExists: boolean;
  targetAuthorId: string | null;
};
/** One job of the media clean-up queue (media_jobs). */
export type MediaJob = {
  id: number;
  kind: MediaJobKind;
  /** Storage path, folder prefix or Mux asset id, depending on the kind. */
  ref: string;
  targetType: string | null;
  targetId: string | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  /** When a worker last claimed it; a retry is refused while a claim is fresh and unreported. */
  claimedAt: string | null;
  createdAt: string;
  doneAt: string | null;
};
/** failing: still pending after three or more attempts. */
export type MediaJobStats = { pending: number; failing: number; done: number };

// ---------------------------------------------------------------------------
// Admin app: dashboard queries (migration 16)
// ---------------------------------------------------------------------------
/** Counts for the overview page (admin_overview_stats). */
export type OverviewStats = {
  usersTotal: number;
  usersNew7d: number;
  usersActive24h: number;
  suspendedActive: number;
  reportsOpen: number;
  reportsClosed7d: number;
  hiddenContent: number;
  listingsTotal: number;
  postsTotal: number;
  buzzTotal: number;
  mediaPending: number;
  mediaFailing: number;
  staffTotal: number;
};
/** One row when browsing people (admin_users_list), newest sign-up first. */
export type AdminUserRow = {
  userId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  universityName: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  suspended: boolean;
  staffRole: AdminStaffRole | null;
};
export type AutoHideStatus = (typeof AUTO_HIDE_STATUSES)[number]["value"];
/**
 * Content hidden automatically by reports (admin_auto_hidden_list, migration 20261110000000_report_auto_hide.sql on main).
 * source "report_threshold": 10 different eligible people reported it; "trust_safety": Trust & Safety's own Buzz threshold.
 * Buzz rows never carry an author.
 */
export type AutoHiddenRow = {
  id: string;
  targetType: ModerationTargetType;
  targetId: string;
  source: "report_threshold" | "trust_safety";
  reporterCount: number;
  /** How many of those reporters gave each reason. */
  reasons: Record<string, number>;
  hiddenAt: string;
  createdAt: string;
  status: AutoHideStatus;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  targetExists: boolean;
  targetHidden: boolean;
  title: string | null;
  preview: string;
  authorId: string | null;
  authorName: string | null;
};
export type AutoHiddenCounts = Record<AutoHideStatus, number>;

/** One hidden row (admin_hidden_content_list). Buzz rows carry no author and show the published time. */
export type HiddenContentRow = {
  targetType: ModerationTargetType;
  targetId: string;
  hiddenAt: string;
  hiddenReason: string | null;
  title: string | null;
  preview: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
};

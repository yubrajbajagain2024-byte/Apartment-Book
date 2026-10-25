import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database";
import type { MEDIA_JOB_KINDS, MODERATION_TARGET_TYPES, REPORT_DECISIONS, StaffRole } from "../constants";

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
export type NotificationType = "message" | "listing_saved" | "nearby_listing" | "system" | "like" | "comment";
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

// ---------------------------------------------------------------------------
// Admin section: staff, audit log and two-factor authentication
// ---------------------------------------------------------------------------
/** The signed-in user's place on the team (from admin_me). lastOwner: the only owner, who cannot step back until there is another. */
export type StaffAccess = { userId: string; role: StaffRole; mfaVerified: boolean; mfaEnrolled: boolean; lastOwner: boolean };
/** mfaEnrolled is null when the caller may not know: moderators see it on their own row only. */
export type StaffMember = { userId: string; email: string | null; fullName: string; avatarUrl: string | null; role: StaffRole; grantedBy: string | null; grantedByName: string | null; createdAt: string; mfaEnrolled: boolean | null };
/** A role promised to an email address that has not confirmed an account yet. */
export type StaffInvite = { email: string; role: StaffRole; invitedBy: string | null; invitedByName: string | null; createdAt: string };
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
export type ReportStatus = "open" | "reviewed" | "dismissed";
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
  staffRole: StaffRole | null;
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
  staffRole: StaffRole | null;
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
  staffRole: StaffRole | null;
};
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

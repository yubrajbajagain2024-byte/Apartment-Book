import { z } from "zod";
import {
  AD_CAPTION_MAX,
  AD_CTA_VALUES,
  AD_HEADLINE_MAX,
  AD_OBJECTIVE_VALUES,
  AMENITY_VALUES,
  BUSINESS_CATEGORY_VALUES,
  BUSINESS_INVITE_ROLE_VALUES,
  BUSINESS_MEDIA_MAX,
  BUSINESS_REPORT_REASONS,
  CLEANLINESS_LEVELS,
  CURRENCIES,
  DEAL_STATUS_VALUES,
  DEFAULT_LISTING_AUDIENCE,
  DEFAULT_POST_AUDIENCE,
  ITEM_CATEGORY_VALUES,
  LISTING_AUDIENCE_VALUES,
  MAX_POST_VIEWERS,
  POST_AUDIENCE_VALUES,
  POST_KIND_VALUES,
  POST_TITLE_MAX,
  SLEEP_SCHEDULES,
} from "../constants";
import {
  formBoolean,
  imageMeta,
  imageUrls,
  listingVideos,
  optionalDate,
  optionalNumber,
  optionalText,
  optionalUrl,
  optionalUuid,
} from "./common";

export * from "./common";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
/**
 * Sign-up form. Pass the university email domains that are allowed to register
 * (from `allowed_email_domains()`); an empty list allows any address.
 */
export function createSignUpSchema(allowedDomains: string[]) {
  const domains = allowedDomains.map((d) => d.toLowerCase().replace(/^@/, ""));
  const hint =
    domains.length === 1
      ? `Use your @${domains[0]} email address`
      : `Use your university email address (${domains.map((d) => `@${d}`).join(", ")})`;
  return z.object({
    fullName: z.string().trim().min(2, "Enter your name").max(80),
    email: z
      .email({ error: "Enter a valid email address" })
      .trim()
      .toLowerCase()
      .refine((email) => domains.length === 0 || domains.includes(email.split("@")[1] ?? ""), { error: hint }),
    password: z.string().min(8, "Password must be at least 8 characters").max(72),
  });
}
export const signUpSchema = createSignUpSchema([]);
export type SignUpInput = z.infer<typeof signUpSchema>;

/** Optional map pin: both coordinates or neither. */
const coordinateFields = {
  latitude: optionalNumber({ min: -90, max: 90 }),
  longitude: optionalNumber({ min: -180, max: 180 }),
};
const bothOrNeither = (v: { latitude?: number; longitude?: number }) =>
  (v.latitude === undefined) === (v.longitude === undefined);
const coordinateError = { error: "Pin the location on the map or clear the pin", path: ["latitude"] };

export const signInSchema = z.object({
  email: z.email({ error: "Enter a valid email address" }).trim().toLowerCase(),
  password: z.string().min(1, "Enter your password"),
});
export type SignInInput = z.infer<typeof signInSchema>;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(80),
  universityId: optionalUuid,
  program: optionalText(120),
  graduationYear: optionalNumber({ min: 2000, max: 2100, int: true }),
  bio: optionalText(600),
  avatarUrl: optionalUrl,
  notifyNearbyListings: formBoolean,
  showActiveStatus: formBoolean,
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const universitySchema = z.object({
  name: z.string().trim().min(3, "Enter the university name").max(160),
  city: optionalText(120),
  country: optionalText(120),
});
export type UniversityInput = z.infer<typeof universitySchema>;

// ---------------------------------------------------------------------------
// Apartments
// ---------------------------------------------------------------------------
export const apartmentSchema = z.object({
  title: z.string().trim().min(5, "Give the listing a short title").max(120),
  description: z.string().trim().min(20, "Describe the place in at least 20 characters").max(4000),
  pricePerMonth: z.coerce.number({ error: "Enter the monthly rent" }).min(0).max(1_000_000),
  currency: z.enum(CURRENCIES),
  address: z.string().trim().min(5, "Enter the address").max(240),
  city: optionalText(120),
  universityId: optionalUuid,
  distanceKm: optionalNumber({ min: 0, max: 500 }),
  bedrooms: z.coerce.number().int().min(0).max(20),
  bathrooms: z.coerce.number().min(0).max(20),
  furnished: formBoolean,
  utilitiesIncluded: formBoolean,
  petsAllowed: formBoolean,
  availableFrom: optionalDate,
  leaseMonths: optionalNumber({ min: 1, max: 60, int: true }),
  amenities: z.preprocess(
    (v) => (Array.isArray(v) ? v : v ? [v] : []),
    z.array(z.enum(AMENITY_VALUES)),
  ),
  images: imageUrls,
  imageMeta,
  videos: listingVideos,
  mapUrl: optionalUrl,
  contactPhone: optionalText(40),
  ...coordinateFields,
}).refine(bothOrNeither, coordinateError);
export type ApartmentInput = z.infer<typeof apartmentSchema>;

// ---------------------------------------------------------------------------
// Roommates
// ---------------------------------------------------------------------------
/**
 * Who a roommate post or Marketplace item is for, and whether it carries its poster's name (20261105000000_anonymous_listings.sql).
 * Left out (the website's forms), a listing is Global and under its poster's name, as every listing before. Both are
 * set when it is posted: an edit never changes them.
 */
const listingPrivacyFields = {
  isAnonymous: z.boolean().default(false),
  audience: z.enum(LISTING_AUDIENCE_VALUES).default(DEFAULT_LISTING_AUDIENCE),
};
const campusHasUniversity = (v: { audience: string; universityId?: string }) => v.audience !== "campus" || Boolean(v.universityId);
const campusError = { error: "Campus-only listings need a confirmed university email on your account", path: ["audience"] };

export const roommatePostSchema = z
  .object({
    postType: z.enum(["has_room", "needs_room"], { error: "Choose what you are looking for" }),
    title: z.string().trim().min(5, "Give your post a short title").max(120),
    description: z.string().trim().min(20, "Tell people a bit about yourself (20+ characters)").max(4000),
    universityId: optionalUuid,
    budgetMin: optionalNumber({ min: 0, max: 1_000_000 }),
    budgetMax: optionalNumber({ min: 0, max: 1_000_000 }),
    currency: z.enum(CURRENCIES),
    moveInDate: optionalDate,
    location: optionalText(160),
    genderPreference: z.enum(["any", "male", "female", "nonbinary"]),
    smokingOk: formBoolean,
    petsOk: formBoolean,
    sleepSchedule: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(SLEEP_SCHEDULES).optional(),
    ),
    cleanliness: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(CLEANLINESS_LEVELS).optional(),
    ),
    images: imageUrls,
    imageMeta,
    videos: listingVideos,
    ...coordinateFields,
    ...listingPrivacyFields,
  })
  .refine(
    (v) => v.budgetMin === undefined || v.budgetMax === undefined || v.budgetMin <= v.budgetMax,
    { error: "Minimum budget cannot be higher than maximum budget", path: ["budgetMax"] },
  )
  .refine(bothOrNeither, coordinateError)
  .refine(campusHasUniversity, campusError);
export type RoommatePostInput = z.infer<typeof roommatePostSchema>;

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------
export const itemSchema = z
  .object({
    title: z.string().trim().min(3, "Give the item a short title").max(120),
    description: z.string().trim().min(10, "Describe the item in at least 10 characters").max(4000),
    price: z.coerce.number({ error: "Enter a price (0 for free)" }).min(0).max(1_000_000),
    currency: z.enum(CURRENCIES),
    category: z.enum(ITEM_CATEGORY_VALUES, { error: "Choose a category" }),
    condition: z.enum(["new", "like_new", "good", "fair", "poor"]),
    universityId: optionalUuid,
    pickupLocation: optionalText(160),
    images: imageUrls,
    imageMeta,
    /** One video at most (migration 43, marketplace video). Empty when the form has none, as the web's form never does. */
    videos: listingVideos.refine((v) => v.length <= 1, { error: "One video per item" }),
    ...listingPrivacyFields,
  })
  .refine(campusHasUniversity, campusError);
export type ItemInput = z.infer<typeof itemSchema>;

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------
export const messageSchema = z.object({
  content: z.string().trim().min(1, "Type a message").max(4000),
  imageUrl: optionalUrl,
});
export type MessageInput = z.infer<typeof messageSchema>;

export const groupSchema = z.object({
  name: z.string().trim().min(2, "Give the group a name").max(80),
  memberIds: z.array(z.uuid()).min(1, "Add at least one member").max(50),
});
export type GroupInput = z.infer<typeof groupSchema>;

// ---------------------------------------------------------------------------
// Likes and comments
// ---------------------------------------------------------------------------
export const commentSchema = z.object({
  body: z.string().trim().min(1, "Write a comment").max(1000, "Keep comments under 1,000 characters"),
});
export type CommentInput = z.infer<typeof commentSchema>;

// ---------------------------------------------------------------------------
// Home feed: posts, reels and anonymous Buzz
// ---------------------------------------------------------------------------
/**
 * What the composer's publish screen adds to a post or reel (migration 44): a title, one link, who can see it (with the
 * people picked for "Selected people") and whether others can comment. All optional: left alone, a post is Global with
 * comments on, as before.
 */
const postDetailFields = {
  title: optionalText(POST_TITLE_MAX),
  // A link with a space in it passes the URL check but not the database's: it is refused here, in words.
  linkUrl: optionalUrl.refine((v) => v === undefined || !/\s/.test(v), { error: "A link can't have spaces in it" }),
  audience: z.enum(POST_AUDIENCE_VALUES).default(DEFAULT_POST_AUDIENCE),
  viewerIds: z.array(z.uuid()).max(MAX_POST_VIEWERS, { error: `Choose up to ${MAX_POST_VIEWERS} people` }).default([]),
  commentsOff: z.boolean().default(false),
};
/** "Selected people" needs at least one person, and "Campus only" a campus to be limited to. */
const pickedSomeone = { error: "Choose who can see it", path: ["viewerIds"] };
const hasCampus = { error: "Campus-only posts need a confirmed university email on your account", path: ["audience"] };

export const feedPostSchema = z
  .object({
    body: z.string().trim().max(4000, "Keep posts under 4,000 characters").default(""),
    universityId: optionalUuid,
    images: imageUrls,
    imageMeta,
    videos: listingVideos,
    ...postDetailFields,
  })
  .refine((v) => v.body.length > 0 || Boolean(v.title) || v.images.length > 0 || v.videos.length > 0, { error: "Write something or add a photo or video", path: ["body"] })
  .refine((v) => v.audience !== "selected" || v.viewerIds.length > 0, pickedSomeone)
  .refine((v) => v.audience !== "campus" || Boolean(v.universityId), hasCampus);
export type FeedPostInput = z.infer<typeof feedPostSchema>;

export const reelSchema = z
  .object({
    body: z.string().trim().max(2200, "Keep captions under 2,200 characters").default(""),
    universityId: optionalUuid,
    videos: listingVideos.refine((v) => v.length === 1, { error: "Add one video for your reel" }),
    ...postDetailFields,
  })
  .refine((v) => v.audience !== "selected" || v.viewerIds.length > 0, pickedSomeone)
  .refine((v) => v.audience !== "campus" || Boolean(v.universityId), hasCampus);
export type ReelInput = z.infer<typeof reelSchema>;

// ---------------------------------------------------------------------------
// Push notifications (mobile apps)
// ---------------------------------------------------------------------------
export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(500),
  platform: z.enum(["ios", "android", "web"]),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

// ---------------------------------------------------------------------------
// Business portal (migration 39)
// ---------------------------------------------------------------------------
/** A business signing up: the account, and what the pending business starts as. Any email address. */
export const businessSignUpSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(80),
  email: z.email({ error: "Enter a valid email address" }).trim().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  businessName: z.string().trim().min(2, "Enter the business's name").max(120),
  category: z.enum(BUSINESS_CATEGORY_VALUES, { error: "Choose a category" }),
  website: optionalUrl,
  phone: optionalText(40),
  city: optionalText(120),
  universityId: optionalUuid,
});
export type BusinessSignUpInput = z.infer<typeof businessSignUpSchema>;

/** Joining a team from an invite link: the token names the business and the address. */
export const businessJoinSchema = z.object({
  token: z.string().trim().min(16, "This invite link is not complete").max(128),
  fullName: z.string().trim().min(2, "Enter your name").max(80),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});
export type BusinessJoinInput = z.infer<typeof businessJoinSchema>;

const uuidList = z.preprocess(
  (v) => (Array.isArray(v) ? v : v ? [v] : []),
  z.array(z.uuid()).max(50),
);

/** The business profile the owner edits. */
export const businessProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter the business's name").max(120),
  category: z.enum(BUSINESS_CATEGORY_VALUES, { error: "Choose a category" }),
  description: z.string().trim().max(2000).optional().default(""),
  website: optionalUrl,
  phone: optionalText(40),
  contactEmail: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.email({ error: "Enter a valid email address" }).trim().toLowerCase().optional()),
  address: optionalText(240),
  city: optionalText(120),
  logoUrl: optionalUrl,
  universityIds: uuidList,
});
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

const emptyToNothing = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/**
 * A post's or an ad's media from the uploaders (migration 50): a JSON list of photos ({type: "image", url}) and at most
 * one video ({type: "video", media_id}); the database checks the rest (who uploaded it, its size and orientation).
 */
export const businessMediaSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") return [];
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },
  z
    .array(
      z.union([
        z.object({ type: z.literal("image"), url: z.url({ protocol: /^https$/, error: "Photos need an https address" }).max(2000), width: z.number().int().positive().nullish(), height: z.number().int().positive().nullish() }),
        z.object({ type: z.literal("video"), media_id: z.uuid() }),
      ]),
      { error: "Add photos or a video" },
    )
    .max(BUSINESS_MEDIA_MAX, `Add ${BUSINESS_MEDIA_MAX} photos at most`)
    .refine((m) => m.filter((x) => x.type === "video").length <= 1, "Add one video at most")
    .refine((m) => !m.some((x) => x.type === "video") || m.every((x) => x.type === "video"), "Use either photos or one video, not both"),
);
export type BusinessMediaInput = z.infer<typeof businessMediaSchema>;

/** Money typed in a form ("4.50", "$1,200") as cents; empty is none. */
export const optionalCents = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).replace(/[$,\s]/g, "");
  if (text === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) : value;
}, z.number({ error: "Enter an amount like 4.50" }).int().min(0, "The amount cannot be negative").max(100_000_000).optional());

/** A moment from the browser as an ISO timestamp with its offset (the form turns local time into one); empty is none. */
export const optionalIsoTime = z.preprocess(emptyToNothing, z.iso.datetime({ offset: true, error: "Choose a date and time" }).optional());

/**
 * A post (v1's deal; every kind since migration 50). Empty universityIds = every campus. `imageUrl` is v1's single
 * picture; `media` replaces it when given.
 */
export const dealSchema = z
  .object({
    title: z.string().trim().min(2, "Give the post a title").max(120),
    description: z.string().trim().max(2000).optional().default(""),
    kind: z.enum(POST_KIND_VALUES).default("deal"),
    discountLabel: optionalText(60),
    code: optionalText(60),
    linkUrl: optionalUrl,
    imageUrl: optionalUrl,
    media: businessMediaSchema.optional(),
    price: optionalCents,
    eventAt: optionalIsoTime,
    universityIds: uuidList,
    startsAt: optionalDate,
    endsAt: optionalDate,
    status: z.enum(DEAL_STATUS_VALUES).default("active"),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { error: "The end date must be after the start date", path: ["endsAt"] })
  .refine((v) => v.kind !== "event" || Boolean(v.eventAt), { error: "Say when the event is", path: ["eventAt"] });
export type DealInput = z.infer<typeof dealSchema>;

export const businessInviteSchema = z.object({
  email: z.email({ error: "Enter a valid email address" }).trim().toLowerCase(),
  /** Migration 49: what the invite joins as. */
  role: z.enum(BUSINESS_INVITE_ROLE_VALUES, { error: "Choose a role" }).default("editor"),
});

// ---------------------------------------------------------------------------
// Ads (migration 50)
// ---------------------------------------------------------------------------
const placementList = z.preprocess(
  (v) => (Array.isArray(v) ? v : v ? [v] : []),
  z.array(z.enum(["for_you", "reels", "housing"])).max(3),
);

/**
 * An ad draft from the Ads Manager. A draft may be unfinished: what still stops it from being submitted is the
 * database's ad_problems(), which the editor shows. `promoted` is "deal:<id>" or "apartment:<id>".
 */
export const adDraftSchema = z
  .object({
    name: z.string().trim().min(2, "Name the ad (only your team sees it)").max(80),
    objective: z.enum(AD_OBJECTIVE_VALUES).default("awareness"),
    placements: placementList,
    universityIds: uuidList,
    headline: optionalText(AD_HEADLINE_MAX),
    caption: z.string().trim().max(AD_CAPTION_MAX).optional().default(""),
    media: businessMediaSchema,
    cta: z.enum(AD_CTA_VALUES).default("learn_more"),
    ctaUrl: z.preprocess(emptyToNothing, z.url({ protocol: /^https$/, error: "Use a link starting with https://" }).max(2000).optional()),
    promoted: z.preprocess(emptyToNothing, z.string().regex(/^(deal|apartment):[0-9a-f-]{36}$/i, "Choose a post or a listing").optional()),
    budget: optionalCents,
    startsAt: optionalIsoTime,
    endsAt: optionalIsoTime,
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { error: "The end must be after the start", path: ["endsAt"] });
export type AdDraftInput = z.infer<typeof adDraftSchema>;

/** The UniBuzz team approves an ad by recording its payment (no payment provider yet). */
export const adApprovalSchema = z.object({
  amount: z.preprocess((v) => (v === undefined || v === null ? undefined : v), optionalCents.refine((c) => c !== undefined && c > 0, "Enter the amount received")),
  currency: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"), z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code")),
  paymentReference: z.string().trim().min(3, "Enter the invoice or receipt number").max(200),
  note: optionalText(1000),
  fairHousingChecked: formBoolean,
});
export type AdApprovalInput = z.infer<typeof adApprovalSchema>;

/** A rejection or a pause by the UniBuzz team: the business reads the reason. */
export const adReasonSchema = z.object({ reason: z.string().trim().min(5, "Say why (the business reads it)").max(1000) });

const REPORT_REASON_VALUES = BUSINESS_REPORT_REASONS.map((r) => r.value) as [string, ...string[]];
/** A student's report of an ad, a post or a business. */
export const businessReportSchema = z.object({
  reason: z.enum(REPORT_REASON_VALUES, { error: "Choose a reason" }),
  details: optionalText(1000),
});

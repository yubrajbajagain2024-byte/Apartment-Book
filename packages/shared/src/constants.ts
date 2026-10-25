export const APP_NAME = "Apartment Book";
export const APP_TAGLINE =
  "Apartments, roommates and move-in essentials for university students.";

export const DEFAULT_PAGE_SIZE = 12;
export const MESSAGES_PAGE_SIZE = 50;
export const MAX_IMAGES_PER_LISTING = 12;
/** Originals are stored untouched; 25 MB covers phone and camera photos. */
export const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024;
export const STORAGE_BUCKET = "uploads";

export const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "NZD", "NPR", "INR", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ITEM_CATEGORIES = [
  { value: "mattress_bedding", label: "Mattress & bedding" },
  { value: "furniture", label: "Furniture" },
  { value: "desk_chair", label: "Desk & chair" },
  { value: "kitchen", label: "Kitchen & appliances" },
  { value: "electronics", label: "Electronics" },
  { value: "textbooks", label: "Textbooks" },
  { value: "decor", label: "Decor & lighting" },
  { value: "storage", label: "Storage & organisation" },
  { value: "bikes_transport", label: "Bikes & transport" },
  { value: "clothing", label: "Clothing" },
  { value: "sports", label: "Sports & fitness" },
  { value: "other", label: "Other" },
] as const;
export type ItemCategoryValue = (typeof ITEM_CATEGORIES)[number]["value"];
export const ITEM_CATEGORY_VALUES = ITEM_CATEGORIES.map((c) => c.value) as [
  ItemCategoryValue,
  ...ItemCategoryValue[],
];

export const ITEM_CONDITIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
] as const;

export const ITEM_STATUSES = [
  { value: "available", label: "Available" },
  { value: "sold", label: "Sold" },
  { value: "archived", label: "Archived" },
] as const;

export const LISTING_STATUSES = [
  { value: "active", label: "Active" },
  { value: "rented", label: "Rented" },
  { value: "archived", label: "Archived" },
] as const;

export const AMENITIES = [
  { value: "wifi", label: "Wi-Fi" },
  { value: "laundry", label: "Laundry" },
  { value: "parking", label: "Parking" },
  { value: "gym", label: "Gym" },
  { value: "ac", label: "Air conditioning" },
  { value: "heating", label: "Heating" },
  { value: "dishwasher", label: "Dishwasher" },
  { value: "balcony", label: "Balcony" },
  { value: "study_room", label: "Study room" },
  { value: "security", label: "Security" },
  { value: "bike_storage", label: "Bike storage" },
  { value: "elevator", label: "Elevator" },
] as const;
export type AmenityValue = (typeof AMENITIES)[number]["value"];
export const AMENITY_VALUES = AMENITIES.map((a) => a.value) as [AmenityValue, ...AmenityValue[]];

export const ROOMMATE_POST_TYPES = [
  { value: "has_room", label: "I have a room, looking for a roommate" },
  { value: "needs_room", label: "I'm looking for a room / roommates" },
] as const;

export const GENDER_PREFERENCES = [
  { value: "any", label: "Any" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "nonbinary", label: "Non-binary" },
] as const;

export const SLEEP_SCHEDULES = ["Early bird", "Night owl", "Flexible"] as const;
export const CLEANLINESS_LEVELS = ["Very tidy", "Average", "Relaxed"] as const;

export const APARTMENT_SORTS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "distance", label: "Closest to campus" },
] as const;
export type ApartmentSort = (typeof APARTMENT_SORTS)[number]["value"];

export const ITEM_SORTS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
] as const;
export type ItemSort = (typeof ITEM_SORTS)[number]["value"];

export function labelFor<T extends readonly { value: string; label: string }[]>(
  options: T,
  value: string | null | undefined,
): string {
  if (!value) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Distances are shown in miles (US campus) but stored in kilometres. */
export const DISTANCE_UNIT: "mi" | "km" = "mi";
export const KM_PER_MILE = 1.609344;
/** "Within N miles of campus" filter options. */
export const RADIUS_OPTIONS_MILES = [1, 2, 5, 10] as const;

/** Texas State University, San Marcos: the default map centre when nothing else is known. */
export const DEFAULT_MAP_CENTER = { latitude: 29.8884, longitude: -97.9384 } as const;
export const DEFAULT_MAP_ZOOM = 13;

/** OpenStreetMap tiles are free for light use; switch to a provider key for heavy traffic. */
export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Push token platforms accepted by the device_push_tokens table. */
export const PUSH_PLATFORMS = ["ios", "android", "web"] as const;

/** Video */
export const MAX_VIDEOS_PER_LISTING = 3;
export const MAX_VIDEO_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
export const MUX_STREAM_BASE = "https://stream.mux.com";
export const MUX_IMAGE_BASE = "https://image.mux.com";

/** What to film for an apartment tour, shown as a checklist while recording. */
export const TOUR_CHECKLIST = [
  { key: "door", label: "Front door", hint: "Start outside and walk in" },
  { key: "living", label: "Living room", hint: "Slow pan across the room" },
  { key: "kitchen", label: "Kitchen", hint: "Counters, appliances, storage" },
  { key: "bedroom", label: "Bedroom", hint: "Bed area, closet, window" },
  { key: "bathroom", label: "Bathroom", hint: "Shower, sink, toilet" },
  { key: "view", label: "View from the window", hint: "What do you see outside?" },
] as const;

/** Home feed */
export const MAX_IMAGES_PER_POST = 12;
export const MAX_IMAGES_PER_BUZZ = 6;
export const REELS_PAGE_SIZE = 8;
export const BUZZ_PAGE_SIZE = 20;
/** The three sections of Home, left to right (like TikTok's top tabs). Posts is the landing tab. */
export const HOME_SECTIONS = [
  { value: "reels", label: "Reels" },
  { value: "buzz", label: "Buzz" },
  { value: "posts", label: "Posts" },
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number]["value"];
export const DEFAULT_HOME_SECTION: HomeSection = "posts";

export const BUZZ_TOPICS = [
  { value: "thoughts", label: "Thoughts" },
  { value: "experience", label: "Experiences" },
  { value: "advice", label: "Advice" },
  { value: "question", label: "Questions" },
  { value: "housing", label: "Housing" },
  { value: "campus", label: "Campus life" },
  { value: "rant", label: "Rants" },
  { value: "other", label: "Other" },
] as const;
export const BUZZ_TOPIC_VALUES = BUZZ_TOPICS.map((t) => t.value) as [(typeof BUZZ_TOPICS)[number]["value"], ...(typeof BUZZ_TOPICS)[number]["value"][]];
export const BUZZ_SORTS = [
  { value: "hot", label: "Hot" },
  { value: "new", label: "New" },
  { value: "top", label: "Top" },
] as const;
/** Buzz photos are re-encoded on the device before upload so camera metadata (GPS, device) cannot identify the author. */
export const BUZZ_IMAGE_MAX_DIMENSION = 2560;
export const BUZZ_IMAGE_QUALITY = 0.9;

/** Staff roles for the admin app (owner > admin > moderator). The database enforces them; these drive the UI. */
export const STAFF_ROLES = [
  { value: "owner", label: "Owner", description: "Everything, including adding and removing owners and admins." },
  { value: "admin", label: "Admin", description: "Runs the admin section day to day and manages moderators." },
  { value: "moderator", label: "Moderator", description: "Reviews reports and content. Cannot change the team." },
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number]["value"];
export const STAFF_ROLE_VALUES = STAFF_ROLES.map((r) => r.value) as [StaffRole, ...StaffRole[]];
export const STAFF_ROLE_RANK: Record<StaffRole, number> = { owner: 3, admin: 2, moderator: 1 };

/** The eight kinds of content staff can hide, restore and delete: the names reports.target_type uses ('profile' is handled by suspension instead). */
export const MODERATION_TARGET_TYPES = [
  { value: "apartment", label: "Apartment listing" },
  { value: "item", label: "Marketplace item" },
  { value: "roommate", label: "Roommate post" },
  { value: "post", label: "Post or reel" },
  { value: "comment", label: "Comment" },
  { value: "message", label: "Message" },
  { value: "buzz", label: "Buzz thread" },
  { value: "buzz_comment", label: "Buzz reply" },
] as const;
export const MODERATION_TARGET_TYPE_VALUES = MODERATION_TARGET_TYPES.map((t) => t.value) as [(typeof MODERATION_TARGET_TYPES)[number]["value"], ...(typeof MODERATION_TARGET_TYPES)[number]["value"][]];

/** What staff record when they close a report (reports.decision). "Dismissed" sets the report's status to dismissed; every other decision sets it to reviewed. */
export const REPORT_DECISIONS = [
  { value: "dismissed", label: "Dismissed" },
  { value: "content_hidden", label: "Content hidden" },
  { value: "content_deleted", label: "Content deleted" },
  { value: "user_suspended", label: "User suspended" },
  { value: "warning", label: "Warning given" },
  { value: "no_action", label: "No action needed" },
] as const;
export const REPORT_DECISION_VALUES = REPORT_DECISIONS.map((d) => d.value) as [(typeof REPORT_DECISIONS)[number]["value"], ...(typeof REPORT_DECISIONS)[number]["value"][]];

/** The media clean-up queue (media_jobs.kind): work on storage and Mux that SQL cannot do itself, performed by the app-side worker with the service role. */
export const MEDIA_JOB_KINDS = [
  { value: "quarantine", label: "Move a hidden photo out of the public bucket" },
  { value: "release", label: "Move a restored photo back to the public bucket" },
  { value: "delete_object", label: "Remove a deleted photo from storage" },
  { value: "delete_prefix", label: "Remove everything a deleted account uploaded to one folder" },
  { value: "mux_disable", label: "Turn off playback of a hidden video" },
  { value: "mux_enable", label: "Turn playback of a restored video back on" },
  { value: "mux_delete", label: "Delete a removed video from Mux" },
] as const;
export const MEDIA_JOB_KIND_VALUES = MEDIA_JOB_KINDS.map((k) => k.value) as [(typeof MEDIA_JOB_KINDS)[number]["value"], ...(typeof MEDIA_JOB_KINDS)[number]["value"][]];

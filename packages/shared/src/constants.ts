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
/**
 * The sections of Home, left to right, like TikTok's top tabs: swiping the page moves between them.
 * "For you" is the landing tab and blends the other three (see blendForYou).
 */
export const HOME_SECTIONS = [
  { value: "foryou", label: "For you" },
  { value: "buzz", label: "Buzz" },
  { value: "posts", label: "Posts" },
  { value: "reels", label: "Reels" },
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number]["value"];
export const DEFAULT_HOME_SECTION: HomeSection = "foryou";
/**
 * Where a Home section lives on the website. The landing section keeps the clean "/" address, the others
 * use ?tab=. Extra parameters (for example { university: "all" }) are kept; empty ones are dropped.
 */
export function homeSectionHref(section: HomeSection, params: Record<string, string | undefined | null> = {}): string {
  const query = new URLSearchParams();
  if (section !== DEFAULT_HOME_SECTION) query.set("tab", section);
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const s = query.toString();
  return s ? `/?${s}` : "/";
}
/**
 * How many rows of each kind one page of "For you" asks for: posts carry the feed, Buzz threads and reels
 * are spread between them. A full page is 11 rows.
 */
export const FOR_YOU_PAGE = { posts: 6, buzz: 3, reels: 2 } as const;

/**
 * The two halves of the Housing tab, left to right. Apartments is the landing half; swiping the page moves
 * between them. On the website each half keeps its own address (/apartments, /roommates), so listing links,
 * filters and saved searches are unchanged.
 */
export const HOUSING_SECTIONS = [
  { value: "apartments", label: "Apartments" },
  { value: "roommates", label: "Roommates" },
] as const;
export type HousingSection = (typeof HOUSING_SECTIONS)[number]["value"];
export const DEFAULT_HOUSING_SECTION: HousingSection = "apartments";
/** Where a Housing section lives on the website, with optional query parameters (empty ones are dropped). */
export function housingSectionHref(section: HousingSection, params: Record<string, string | undefined | null> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const s = query.toString();
  return s ? `/${section}?${s}` : `/${section}`;
}

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

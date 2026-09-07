import { z } from "zod";
import {
  AMENITY_VALUES,
  CLEANLINESS_LEVELS,
  CURRENCIES,
  ITEM_CATEGORY_VALUES,
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
  })
  .refine(
    (v) => v.budgetMin === undefined || v.budgetMax === undefined || v.budgetMin <= v.budgetMax,
    { error: "Minimum budget cannot be higher than maximum budget", path: ["budgetMax"] },
  )
  .refine(bothOrNeither, coordinateError);
export type RoommatePostInput = z.infer<typeof roommatePostSchema>;

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------
export const itemSchema = z.object({
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
});
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
// Push notifications (mobile apps)
// ---------------------------------------------------------------------------
export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(500),
  platform: z.enum(["ios", "android", "web"]),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

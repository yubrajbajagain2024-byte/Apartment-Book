import { itemSchema, roommatePostSchema, startingAudience, type ItemInput, type ListingAudience, type ListingVideo, type PhotoMeta, type RoommatePostInput } from "@apartment-book/shared";
import type { ComposeState, ListingMode } from "./compose-store";

/**
 * A roommate post or a Marketplace item, from the create flow's session to what the schema checks (the same schema and
 * rules the old forms used, and the website's forms still do). Each step checks its own fields: Details the title and
 * the description (and that a campus-only listing has a campus), the form the rest; Post checks everything again.
 */
export type ListingErrors = Partial<Record<string, string>>;

/** Which fields each step answers for: an issue on a field of a later step waits for that step. */
const DETAILS_FIELDS = ["title", "description", "audience"];

/** Words that change with the kind of listing. */
export const LISTING_WORDS: Record<ListingMode, { screen: string; noun: string; titleHint: string; aboutHint: string; aboutLabel: string }> = {
  roommate: {
    screen: "New roommate post",
    noun: "post",
    titleHint: "Quiet CS student looking for a room from January",
    aboutHint: "About you and what you want: your schedule, your habits, what matters to you in a roommate…",
    aboutLabel: "About you",
  },
  item: {
    screen: "Sell an item",
    noun: "listing",
    titleHint: "Queen mattress, 1 year old",
    aboutHint: "Size, brand, any wear, why you're selling…",
    aboutLabel: "Description",
  },
};

/** Who sees it, unless chosen: the poster's campus when they have one (as for posts), else everyone. */
export function listingAudienceOf(s: Pick<ComposeState, "audience">, campusId: string | null): ListingAudience {
  const chosen = s.audience ?? startingAudience(campusId);
  return chosen === "selected" ? "global" : chosen;
}

/** The schema's input. `media` are the uploaded photos and video (none yet while the steps are being filled in). */
export function listingInput(s: ComposeState, opts: { campusId: string | null; profileUniversityId: string | null; photos?: PhotoMeta[]; video?: ListingVideo | null }) {
  const audience = listingAudienceOf(s, opts.campusId);
  // A campus-only listing belongs to the verified campus; any other keeps the profile's university, as listings always have.
  const universityId = (audience === "campus" ? opts.campusId : opts.profileUniversityId) ?? undefined;
  const photos = opts.photos ?? [];
  const media = { images: photos.map((p) => p.url), imageMeta: photos.map((p) => JSON.stringify(p)), videos: opts.video ? [JSON.stringify(opts.video)] : [] };
  const f = s.listing;
  const common = { title: s.title, description: s.caption, currency: "USD", universityId, isAnonymous: s.anonymous, audience, ...media };
  if (s.mode === "roommate") {
    return {
      ...common,
      postType: f.postType,
      budgetMin: f.budgetMin || undefined,
      budgetMax: f.budgetMax || undefined,
      moveInDate: f.moveInDate || undefined,
      location: f.location || undefined,
      genderPreference: f.genderPreference,
      smokingOk: f.smokingOk,
      petsOk: f.petsOk,
      sleepSchedule: f.sleepSchedule,
      cleanliness: f.cleanliness,
    };
  }
  // An empty price is no price ("Enter a price (0 for free)"), never a silent 0: free is a choice (the switch, or 0).
  return { ...common, price: f.price.trim() === "" ? undefined : f.price, category: f.category, condition: f.condition, pickupLocation: f.pickupLocation || undefined };
}

export type ParsedListing = { ok: true; mode: "roommate"; data: RoommatePostInput } | { ok: true; mode: "item"; data: ItemInput } | { ok: false; errors: ListingErrors; first: string };

/** Checks the whole listing; each field's first problem, and the first of all. */
export function parseListing(s: ComposeState, opts: Parameters<typeof listingInput>[1]): ParsedListing {
  const input = listingInput(s, opts);
  const parsed = s.mode === "roommate" ? roommatePostSchema.safeParse(input) : itemSchema.safeParse(input);
  if (parsed.success) return s.mode === "roommate" ? { ok: true, mode: "roommate", data: parsed.data as RoommatePostInput } : { ok: true, mode: "item", data: parsed.data as ItemInput };
  const errors: ListingErrors = {};
  for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  return { ok: false, errors, first: parsed.error.issues[0]?.message ?? "Please check your listing" };
}

/** The problems a step answers for: Details its words and audience, the form everything else. */
export function stepErrors(s: ComposeState, step: "details" | "form", opts: Parameters<typeof listingInput>[1]): ListingErrors {
  const result = parseListing(s, opts);
  if (result.ok) return {};
  const own = Object.entries(result.errors).filter(([field]) => (step === "details" ? DETAILS_FIELDS.includes(field) : !DETAILS_FIELDS.includes(field)));
  return Object.fromEntries(own);
}

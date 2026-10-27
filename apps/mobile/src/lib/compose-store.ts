import { useSyncExternalStore } from "react";
import { MAX_IMAGES_PER_LISTING, MAX_IMAGES_PER_POST, type PostAudience } from "@apartment-book/shared";

/**
 * The post or reel being made, from the camera to the Post button. One in-memory session for the whole create flow
 * (app/compose): the camera, the gallery, the editor and the publish screen are all views over it, so going back and
 * forth between them (or popping back to the camera to add another shot) never loses a photo or a word. A saved draft
 * is this same state written to the phone (lib/compose-drafts.ts).
 */
export type ComposeMode = "post" | "reel" | ListingMode;

/**
 * A roommate post or a Marketplace item, made in the same flow (Explore's +): the camera and the editor as for a post,
 * then the listing's own steps (app/compose/listing*.tsx): title, description, who sees it and whether it carries the
 * poster's name; the listing's form; a preview and Post.
 */
export type ListingMode = "roommate" | "item";
export const isListing = (mode: ComposeMode): mode is ListingMode => mode === "roommate" || mode === "item";

/** The rest of a listing's fields, as typed (the schema reads them when it is posted): a roommate post's, then an item's. */
export type ListingForm = {
  postType: "needs_room" | "has_room";
  budgetMin: string;
  budgetMax: string;
  /** YYYY-MM-DD, or "" for none. */
  moveInDate: string;
  location: string;
  genderPreference: "any" | "male" | "female" | "nonbinary";
  sleepSchedule: string;
  cleanliness: string;
  smokingOk: boolean;
  petsOk: boolean;
  price: string;
  category: string;
  condition: "new" | "like_new" | "good" | "fair" | "poor";
  pickupLocation: string;
};

export const BLANK_LISTING: ListingForm = {
  postType: "needs_room",
  budgetMin: "",
  budgetMax: "",
  moveInDate: "",
  location: "",
  genderPreference: "any",
  sleepSchedule: "",
  cleanliness: "",
  smokingOk: false,
  petsOk: false,
  price: "",
  category: "",
  condition: "good",
  pickupLocation: "",
};

/** A text laid over a photo in the editor, baked into the picture when the editor moves on. */
export type TextOverlay = {
  id: string;
  text: string;
  color: string;
  /** "plain" draws the words with a shadow; "filled" puts them on a rounded block of `color` (the words in black or white). */
  style: "plain" | "filled";
  /** Centre of the text as a share of the photo's width and height (0 to 1), and its scale (1 = the default size). */
  x: number;
  y: number;
  scale: number;
};

/** A photo's crop: turned by `rotation` first, then cut to `rect` (shares of the turned photo's width and height). */
export type CropSpec = {
  rotation: 0 | 90 | 180 | 270;
  /** The frame's shape (width / height), or null for the photo's own. */
  aspect: number | null;
  rect: { x: number; y: number; width: number; height: number };
};

export type ComposeMedia = {
  /** Stable for the life of the item, edits included. */
  id: string;
  kind: "photo" | "video";
  /** The file that is posted (file://): the camera's shot, the library's copy, or the edited result with its texts. */
  uri: string;
  /** The photo as it came, so a crop can always start over from all of it. Same as `uri` for videos. */
  originalUri: string;
  /** The photo after its crop, before its texts: what the editor draws the texts over. */
  baseUri: string;
  crop: CropSpec | null;
  width: number;
  height: number;
  /** Seconds, for videos. */
  duration: number | null;
  mimeType: string | null;
  fileName: string | null;
  /** A still to show for a video (thumbnails, the publish screen's cover): a local JPEG. */
  thumbUri: string | null;
  /** Where in the video its cover frame is (seconds); the poster is taken from there once the video is processed. */
  coverTime: number;
  /** A photo's texts, kept apart from `baseUri` so they can still be moved; `uri` has them drawn in. */
  texts: TextOverlay[];
};

/** Someone picked for a "Selected people" post, with what the picker shows of them. */
export type ComposeViewer = { id: string; full_name: string; avatar_url: string | null; username: string | null };

export type ComposeState = {
  mode: ComposeMode;
  media: ComposeMedia[];
  title: string;
  caption: string;
  link: string;
  /** Who can see it; null until chosen, which means the author's campus (Global without one): see startingAudience. */
  audience: PostAudience | null;
  /** The people a "Selected people" post is shown to. */
  viewers: ComposeViewer[];
  commentsOff: boolean;
  /** Copy the photos and video to the phone's library once posted. */
  saveToDevice: boolean;
  /** After posting: open the share sheet to send it to friends, and/or the system share sheet for other apps. */
  shareToFriends: boolean;
  shareToApps: boolean;
  /** The draft this session was opened from (deleted once posted), or null. */
  draftId: string | null;
  /** The camera was opened from the editor's "+": a shot is added to what is there instead of starting over. */
  adding: boolean;
  /** A listing's form (roommate and item modes; kept blank otherwise). */
  listing: ListingForm;
  /** A listing posted without the poster's name: nobody but them can tell it is theirs (the database keeps it apart). */
  anonymous: boolean;
};

/** A reel is one video of up to three minutes (the reel schema's one video); a post up to 12 photos and one video. */
export const REEL_MAX_SECONDS = 180;
export const POST_MAX_PHOTOS = MAX_IMAGES_PER_POST;
export const POST_MAX_VIDEOS = 1;
/** A listing: its photos (the listing limit) and one video, as the listing forms always took. */
export const LISTING_MAX_PHOTOS = MAX_IMAGES_PER_LISTING;

function blank(mode: ComposeMode): ComposeState {
  return {
    mode,
    media: [],
    title: "",
    caption: "",
    link: "",
    audience: null,
    viewers: [],
    commentsOff: false,
    saveToDevice: false,
    shareToFriends: false,
    shareToApps: false,
    draftId: null,
    adding: false,
    listing: { ...BLANK_LISTING },
    anonymous: false,
  };
}

let state: ComposeState = blank("post");
const listeners = new Set<() => void>();

function emit(next: ComposeState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Videos first, as a published post shows them (listingMedia puts videos before photos), so the strip matches the post. */
function ordered(media: ComposeMedia[]): ComposeMedia[] {
  return [...media.filter((m) => m.kind === "video"), ...media.filter((m) => m.kind === "photo")];
}

export const compose = {
  get: (): ComposeState => state,
  /** A fresh session in `mode`: everything from the last one is dropped. */
  start(mode: ComposeMode) {
    emit(blank(mode));
  },
  /** A saved draft, as it was. */
  restore(saved: ComposeState) {
    // Drafts saved before listings came along have no listing fields: blank ones.
    emit({ ...blank(saved.mode), ...saved, listing: { ...BLANK_LISTING, ...saved.listing }, media: ordered(saved.media), adding: false });
  },
  /** Changes some of a listing's fields. */
  updateListing(patch: Partial<ListingForm>) {
    emit({ ...state, listing: { ...state.listing, ...patch } });
  },
  update(patch: Partial<ComposeState>) {
    emit({ ...state, ...patch });
  },
  /** Switches between Post and Reel on the camera. Only while nothing has been picked: what is there decides otherwise. */
  setMode(mode: ComposeMode) {
    if (state.mode !== mode && state.media.length === 0) emit({ ...state, mode });
  },
  /** Adds what the camera or the gallery produced, up to what the mode allows (anything over is left out). */
  add(items: ComposeMedia[]) {
    const room = roomFor(state);
    let photos = room.photos;
    let videos = room.videos;
    const kept = items.filter((m) => {
      if (m.kind === "photo" && photos > 0) return photos-- > 0;
      if (m.kind === "video" && videos > 0) return videos-- > 0;
      return false;
    });
    emit({ ...state, media: ordered([...state.media, ...kept]), adding: false });
    return kept.length;
  },
  replace(id: string, next: Partial<ComposeMedia>) {
    emit({ ...state, media: state.media.map((m) => (m.id === id ? { ...m, ...next } : m)) });
  },
  remove(id: string) {
    emit({ ...state, media: state.media.filter((m) => m.id !== id) });
  },
};

/** The whole session, kept current. */
export function useCompose(): ComposeState {
  return useSyncExternalStore(subscribe, compose.get, compose.get);
}

/** How many more photos and videos fit: a reel takes one video and nothing else, a post 12 photos and one video. */
export function roomFor(s: Pick<ComposeState, "mode" | "media">): { photos: number; videos: number } {
  const photos = s.media.filter((m) => m.kind === "photo").length;
  const videos = s.media.filter((m) => m.kind === "video").length;
  if (s.mode === "reel") return { photos: 0, videos: Math.max(0, 1 - videos) };
  if (isListing(s.mode)) return { photos: Math.max(0, LISTING_MAX_PHOTOS - photos), videos: Math.max(0, POST_MAX_VIDEOS - videos) };
  return { photos: Math.max(0, POST_MAX_PHOTOS - photos), videos: Math.max(0, POST_MAX_VIDEOS - videos) };
}

/** Whether the session holds anything worth asking about before it is thrown away. */
export function hasWork(s: ComposeState): boolean {
  return s.media.length > 0 || s.title.trim() !== "" || s.caption.trim() !== "" || s.link.trim() !== "" || JSON.stringify(s.listing) !== JSON.stringify(BLANK_LISTING);
}

/** "post", "reel", "roommate post", "listing": what the flow's words call it. */
export function composeNoun(mode: ComposeMode): string {
  return mode === "roommate" ? "roommate post" : mode === "item" ? "listing" : mode;
}

let seq = 0;
/** An id for a new item or text, unique for the life of the app. */
export function localId(prefix = "m"): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

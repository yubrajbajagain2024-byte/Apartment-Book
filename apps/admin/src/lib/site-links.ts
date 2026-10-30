import { MODERATION_TARGET_TYPE_VALUES, type ModerationTargetType } from "@apartment-book/shared";
import { getMainSiteUrl } from "@/lib/env";
import { UUID_RE } from "@/lib/utils";

/** Public page of a piece of content on the student website, or null when it has no page of its own. */
export function siteUrlFor(targetType: ModerationTargetType | "profile", id: string): string | null {
  const base = getMainSiteUrl();
  switch (targetType) {
    case "apartment":
      return `${base}/apartments/${id}`;
    case "item":
      return `${base}/marketplace/${id}`;
    case "roommate":
      return `${base}/roommates/${id}`;
    case "post":
      return `${base}/posts/${id}`;
    case "buzz":
      return `${base}/buzz/${id}`;
    case "profile":
      return `${base}/profile/${id}`;
    default:
      return null;
  }
}

const PATH_TYPES: Record<string, ModerationTargetType | "profile"> = {
  apartments: "apartment",
  marketplace: "item",
  roommates: "roommate",
  posts: "post",
  buzz: "buzz",
  profile: "profile",
};

/**
 * Understand what staff paste into the content lookup: a website URL
 * (https://site/apartments/<id>), "type:<id>" or a bare id (with the chosen type).
 */
export function parseContentRef(input: string, fallbackType: ModerationTargetType): { type: ModerationTargetType | "profile"; id: string } | null {
  const text = input.trim();
  if (!text) return null;
  if (UUID_RE.test(text)) return { type: fallbackType, id: text };
  const typed = text.match(/^([a-z_]+):([0-9a-f-]{36})$/i);
  if (typed) {
    const type = typed[1].toLowerCase();
    if (type === "profile" || (MODERATION_TARGET_TYPE_VALUES as readonly string[]).includes(type)) {
      return UUID_RE.test(typed[2]) ? { type: type as ModerationTargetType | "profile", id: typed[2] } : null;
    }
    return null;
  }
  try {
    const url = new URL(text);
    const parts = url.pathname.split("/").filter(Boolean);
    const type = PATH_TYPES[parts[0] ?? ""];
    const id = parts[1];
    if (type && id && UUID_RE.test(id)) return { type, id };
  } catch {
    // not a URL
  }
  return null;
}

/** "apartments/<uid>/photo.jpg" from a public URL of the uploads bucket, or null. Mirrors storage_path_from_url in SQL (any host). */
export function storagePathFromUrl(url: string): string | null {
  const marker = "/storage/v1/object/public/uploads/";
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const raw = url.slice(index + marker.length).split("?")[0];
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return raw || null;
  }
}

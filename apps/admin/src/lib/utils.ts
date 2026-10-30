import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { formatDate, timeAgo } from "@apartment-book/shared";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Read FormData into a plain object; keys listed in `arrays` are collected with getAll(). */
export function formToObject(formData: FormData, arrays: string[] = []): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const arraySet = new Set(arrays);
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    result[key] = arraySet.has(key) ? formData.getAll(key) : formData.get(key);
  }
  for (const key of arrays) if (!(key in result)) result[key] = [];
  return result;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string") return error;
  return fallback;
}

/**
 * Only allow same-site relative paths for post-login redirects. Browsers (and Next's
 * server-action redirect) parse the value as a URL: tabs and newlines are dropped and a
 * backslash reads as a slash, so "/\evil.com" or "/<tab>/evil.com" would leave the site.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || next[0] !== "/" || next[1] === "/" || next[1] === "\\") return fallback;
  try {
    if (new URL(next, "http://x").origin !== "http://x") return fallback;
  } catch {
    return fallback;
  }
  return next;
}

/**
 * Only http(s) URLs are rendered or linked. Image and avatar columns are written by users
 * through the API (any string), and a javascript: href on the review screen would run in
 * this origin the moment a staff member clicked a photo.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Mux playback ids are opaque alphanumerics; anything else is not put into a stream or poster URL. */
export function safePlaybackId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9]{8,128}$/.test(value) ? value : null;
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** "3" -> "3 reports", "1" -> "1 report". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Date/number formatting lives in the shared package so the mobile app can reuse it.
export { formatDate, formatMessageTime, timeAgo } from "@apartment-book/shared";

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

/** Only allow same-site relative paths for post-login redirects. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function numberParam(value: string | string[] | undefined): number | undefined {
  const raw = firstParam(value);
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

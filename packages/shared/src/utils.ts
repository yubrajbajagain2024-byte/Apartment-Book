import type { LatLng } from "./types/models";

/** Escape a user search string so it is safe inside a PostgREST `or(...)` filter. */
export function sanitizeSearch(q: string | undefined | null): string {
  if (!q) return "";
  return q.replace(/[%_,()"'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Build an ilike pattern across several columns for `.or()`. */
export function searchOrFilter(columns: string[], q: string): string {
  const pattern = `%${q}%`;
  return columns.map((c) => `${c}.ilike."${pattern}"`).join(",");
}

export function formatPrice(amount: number | null | undefined, currency = "USD"): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** Great-circle distance in kilometres between two points (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function kmToMiles(km: number): number {
  return km / 1.609344;
}

export function milesToKm(miles: number): number {
  return miles * 1.609344;
}

/** "0.4 mi", "2 mi", "12 km" … according to DISTANCE_UNIT. */
export function formatDistance(km: number | null | undefined, unit: "mi" | "km" = "mi"): string {
  if (km === null || km === undefined || Number.isNaN(km)) return "";
  const value = unit === "mi" ? kmToMiles(km) : km;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${unit}`;
}

export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const safePage = Math.max(1, Math.floor(page || 1));
  const from = (safePage - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function conversationTitle(
  type: "direct" | "group",
  name: string | null,
  otherMembers: { full_name: string }[],
): string {
  if (type === "group") return name || "Group chat";
  if (otherMembers.length === 0) return "Deleted user";
  return otherMembers.map((m) => m.full_name).join(", ");
}

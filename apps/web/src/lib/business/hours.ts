import { businessHoursStatus, parseBusinessHours, type BusinessHours, type HoursStatus } from "@apartment-book/shared";

/**
 * A business's hours as stored, and whether it is open at the moment the page is made (the profile's panel keeps the
 * status current after that). Null hours on a business without any, or a database without migration 57.
 */
export function hoursNow(raw: unknown): { hours: BusinessHours | null; status: HoursStatus | null } {
  const hours = parseBusinessHours(raw);
  return { hours, status: businessHoursStatus(hours, new Date()) };
}

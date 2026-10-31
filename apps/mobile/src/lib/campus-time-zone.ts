import { getUniversityTimeZone } from "@apartment-book/shared";
import { useQuery } from "./hooks";
import { supabase } from "./supabase";

/** Zones already read this session: a campus's zone does not change while the app runs. */
const known = new Map<string, string>();

/** The phone's own zone, for someone with no campus and for a database before migration 61. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * The clock a campus's events are shown on (universities.timezone, migration 61), read once per campus; the phone's
 * zone until it is known, and for good when there is no campus. A student abroad for a semester still sees "7 PM" for
 * a 7 PM event back on campus.
 */
export function useCampusTimeZone(universityId: string | null | undefined): string {
  const { data } = useQuery(async () => {
    if (!universityId) return null;
    const hit = known.get(universityId);
    if (hit) return hit;
    const zone = await getUniversityTimeZone(supabase, universityId);
    if (zone) known.set(universityId, zone);
    return zone;
  }, [universityId]);
  return (universityId ? (known.get(universityId) ?? data) : null) ?? deviceTimeZone();
}

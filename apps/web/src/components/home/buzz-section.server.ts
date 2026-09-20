import type { User } from "@supabase/supabase-js";
import { BUZZ_SORTS, BUZZ_TOPICS, listBuzz, type BuzzFilters, type BuzzSort, type BuzzTopic, type Client, type ProfileWithUniversity } from "@apartment-book/shared";
import { firstParam } from "@/lib/utils";
import type { BuzzFeedProps } from "./buzz-feed";

type HomeSearchParams = { [key: string]: string | string[] | undefined };

/**
 * First page of Home → Buzz. Reads ?sort=hot|new|top, ?topic=, ?q= and ?university=all.
 * Buzz is anonymous: only what the buzz_* database functions return (alias, isMine) reaches the page.
 */
export async function loadBuzzSection(supabase: Client, user: User | null, profile: ProfileWithUniversity | null, params: HomeSearchParams): Promise<BuzzFeedProps> {
  const sortParam = firstParam(params.sort);
  const topicParam = firstParam(params.topic);
  const sort: BuzzSort = BUZZ_SORTS.find((s) => s.value === sortParam)?.value ?? "hot";
  const topic: BuzzTopic | undefined = BUZZ_TOPICS.find((t) => t.value === topicParam)?.value;
  const q = firstParam(params.q)?.trim().slice(0, 100) || undefined;
  // The student's own campus until they pick "All universities".
  const universityId = firstParam(params.university) === "all" ? undefined : profile?.university_id || undefined;

  const filters: BuzzFilters = { universityId, topic, sort, q };
  const initial = await listBuzz(supabase, filters);

  return { initial, filters, signedIn: Boolean(user), scope: { universityName: universityId ? (profile?.university?.name ?? null) : null, hasHomeUniversity: Boolean(profile?.university_id) } };
}

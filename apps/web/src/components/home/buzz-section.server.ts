import type { User } from "@supabase/supabase-js";
import type { Client, ProfileWithUniversity } from "@apartment-book/shared";
import { firstParam } from "@/lib/utils";
import type { BuzzFeedProps } from "./buzz-feed";

type HomeSearchParams = { [key: string]: string | string[] | undefined };

/**
 * Home → Buzz. Nothing about Buzz is read on the server: the pane checks the guidelines gate in the browser first and
 * makes no other Buzz request until it is accepted (UniVerse SPEC §5.3), then reads through the buzz_v2_* functions.
 * The server only says who is signed in (to start from a clean Buzz state on a change of account), the university
 * name until the feed's own meta arrives, and whether /buzz/new sent the visitor here to write (?compose=1).
 */
export async function loadBuzzSection(_supabase: Client, user: User | null, profile: ProfileWithUniversity | null, params: HomeSearchParams): Promise<BuzzFeedProps> {
  const university = profile?.university ?? null;
  return {
    // Constant on purpose: Home keys the section on its filters, and the pane keeps its own sort / scope.
    filters: { section: "buzz" },
    userId: user?.id ?? null,
    compose: firstParam(params.compose) === "1",
    campusFallback: university ? { name: university.name, shortName: university.name } : null,
    // Development only: ?buzzFixtures=… renders Buzz from fixtures (components/buzz/fixtures.ts).
    fixtures: process.env.NODE_ENV !== "production" ? (firstParam(params.buzzFixtures) ?? null) : null,
  };
}

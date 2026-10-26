/**
 * DEVELOPMENT ONLY: Buzz on sample data, for trying every Buzz screen in Expo before the Buzz migration is on a
 * database. Turn it on with a line in `apps/mobile/.env.local` (git ignores it), then restart Expo with `--clear`:
 *
 *   EXPO_PUBLIC_BUZZ_FIXTURES=1        (or gate, muted, new, small, empty, error, blocked, held, support)
 *
 * The Buzz database calls (`buzz_v2_*`, and Account status's) are answered from `@apartment-book/shared/buzz-fixtures`,
 * new buzzes and replies by a stand-in for the website's write API, and photos and videos stay on the phone. Everything
 * else in the app still talks to the real backend. Installed only by lib/supabase, and only when `__DEV__`.
 */
import { BuzzError } from "@apartment-book/shared";
import { createBuzzFixtures, type BuzzFixtureApi } from "@apartment-book/shared/buzz-fixtures";
import { devOverrides } from "./dev-overrides";

type Args = Record<string, unknown>;

function handlers(api: BuzzFixtureApi): Record<string, (a: Args) => Promise<unknown>> {
  return {
    buzz_v2_gate: () => api.gate(),
    buzz_v2_accept_gate: (a) => api.acceptGate(String(a.p_version)),
    buzz_v2_feed: (a) =>
      api.feed({
        scope: a.p_scope as "campus" | "global",
        sort: a.p_sort as "hot" | "new" | "top",
        window: a.p_window as "day" | "week" | "all",
        q: (a.p_q as string | null) ?? null,
        limit: a.p_limit as number,
        offset: a.p_offset as number,
        rankAt: (a.p_rank_at as string | null) ?? null,
      }),
    buzz_v2_meta: (a) => api.meta(a.p_scope as "campus" | "global"),
    buzz_v2_thread: (a) => api.thread(String(a.p_thread), a.p_limit as number),
    buzz_v2_replies: (a) => api.replies(String(a.p_thread), a.p_offset as number, a.p_limit as number),
    buzz_v2_mine: (a) => api.mine(a.p_kind as "threads" | "replies", a.p_offset as number),
    buzz_v2_karma: () => api.karma(),
    buzz_v2_posting_status: () => api.postingStatus(),
    buzz_v2_vote: (a) => api.vote(String(a.p_id), a.p_value as -1 | 0 | 1),
    buzz_v2_poll_vote: (a) => api.pollVote(String(a.p_thread), String(a.p_option)),
    buzz_v2_delete: (a) => api.remove(String(a.p_id)).then(() => null),
    buzz_v2_hide_thread: (a) => api.hideThread(String(a.p_thread), a.p_hide !== false).then(() => null),
    buzz_v2_hide_author: (a) => api.hideAuthor(String(a.p_id)).then(() => null),
    buzz_v2_report: (a) => api.report(String(a.p_id), a.p_reason as never, (a.p_note as string | null) ?? null),
    // Account status (Trust & Safety): a clean record.
    my_sanctions: async () => [],
    ack_sanction: async () => null,
    submit_appeal: async () => null,
    ts_staff_role: async () => null,
  };
}

/** The website's `POST /api/buzz` and `POST /api/buzz/:id/replies`, answered in memory with the same JSON. */
function writeApi(api: BuzzFixtureApi): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}"));
    const reply = /\/api\/buzz\/([^/]+)\/replies$/.exec(url);
    try {
      const item = reply ? await api.reply(decodeURIComponent(reply[1]!), body) : await api.create(body);
      return new Response(JSON.stringify(item), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      const err = e instanceof BuzzError ? e : new BuzzError("unknown", "Something went wrong. Try again.", 500);
      return new Response(JSON.stringify({ error: { code: err.code, message: err.message, details: err.details } }), {
        status: err.status || 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}

/** Answers the Buzz calls of `client` from sample data. Other calls go through untouched. */
export function installBuzzFixtures(client: { rpc: unknown }, variant: string): void {
  const api = createBuzzFixtures(variant);
  const answer = handlers(api);
  const real = (client.rpc as (...args: unknown[]) => unknown).bind(client);
  client.rpc = (fn: string, args?: Args, options?: unknown) => {
    const handle = answer[fn];
    if (!handle) return real(fn, args, options);
    return handle(args ?? {}).then(
      (data) => ({ data, error: null }),
      (error: unknown) => ({ data: null, error }),
    );
  };
  devOverrides.buzzFixtures = variant;
  devOverrides.buzzFetch = writeApi(api);
  console.log(`[buzz] sample data on (EXPO_PUBLIC_BUZZ_FIXTURES=${variant}): Buzz never reaches the backend`);
}

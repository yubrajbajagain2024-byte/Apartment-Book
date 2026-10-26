import "server-only";

import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import type { Database } from "@apartment-book/shared";
import { getRequestUser } from "@/lib/request-user";
import { consoleRequestLog, consoleWarn } from "./log";
import type { BuzzServerDeps, RpcClient } from "./types";

/**
 * The real dependencies of the Buzz write API on the website (route handlers only).
 *
 * The service-role client is built from `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL`, never carries a user
 * session, and is the only way `buzz_v2_create` / `buzz_v2_reply` / `ts_writer_context` / `ts_record_blocked` can be
 * called (the database grants them to `service_role` only). Without the key the API answers 503 `unavailable`.
 */

type UntypedRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string | null } | null }>;

let cached: { url: string; key: string; client: RpcClient } | null = null;

export function serviceRoleClient(): RpcClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  if (cached && cached.url === url && cached.key === key) return cached.client;
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const rpc = (supabase.rpc as unknown as UntypedRpc).bind(supabase);
  cached = { url, key, client: { rpc: (fn, args) => rpc(fn, args) } };
  return cached.client;
}

export function buzzServerDeps(): BuzzServerDeps {
  return {
    async getUserId(request) {
      const auth = await getRequestUser(request);
      return auth?.user.id ?? null;
    },
    serviceClient: serviceRoleClient,
    log: consoleRequestLog,
    warn: consoleWarn,
    defer: (task) => after(task),
  };
}

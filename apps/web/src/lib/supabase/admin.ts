import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Client, Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";

/**
 * The service-role client, for the few writes only the server may make (a video's processing details, migration 55), or
 * null when SUPABASE_SERVICE_ROLE_KEY is not set. Never carries a user's session; never reaches a browser.
 */
export function createAdminClient(): Client | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  const { url } = getSupabaseEnv();
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

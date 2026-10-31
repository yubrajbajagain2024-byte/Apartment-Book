import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Client, Database } from "@apartment-book/shared";
import { getServiceRoleKey, getSupabaseEnv } from "@/lib/env";

/**
 * SERVICE-ROLE client for the media worker only. It bypasses row-level security, so it
 * is created on the server, never imported from a client component, and used for the
 * media queue functions (media_jobs_claim/done/failed) and storage moves alone.
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function createServiceClient(): Client | null {
  const key = getServiceRoleKey();
  if (!key) return null;
  const { url } = getSupabaseEnv();
  return createSupabaseClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

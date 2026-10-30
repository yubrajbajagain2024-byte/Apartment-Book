import { createBrowserClient } from "@supabase/ssr";
import type { Client, Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";

/** Supabase client for Client Components (browser), used for "load older" paging. */
export function createClient(): Client {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}

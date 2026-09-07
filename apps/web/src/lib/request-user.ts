import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import type { Client, Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the caller of an API route: the website sends the session cookie,
 * the mobile app sends `Authorization: Bearer <access token>`. Either way the
 * returned client runs queries as that user, so row-level security applies.
 */
export async function getRequestUser(request: Request): Promise<{ user: User; supabase: Client } | null> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    const { url, anonKey } = getSupabaseEnv();
    const supabase = createSupabaseClient<Database>(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { user: data.user, supabase };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { user, supabase } : null;
}

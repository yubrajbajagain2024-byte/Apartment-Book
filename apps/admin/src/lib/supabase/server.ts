import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Client, Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, acting as
 * the signed-in staff member (anon key + their session). Create a new one per request.
 */
export async function createClient(): Promise<Client> {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component where cookies are read-only; the proxy refreshes sessions.
        }
      },
    },
  });
}

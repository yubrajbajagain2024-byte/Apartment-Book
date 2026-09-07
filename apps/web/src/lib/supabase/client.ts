import { createBrowserClient } from "@supabase/ssr";
import type { Client, Database } from "@apartment-book/shared";
import { getSupabaseEnv } from "@/lib/env";

/** Supabase client for Client Components (browser). Reused across calls. */
export function createClient(): Client {
  const { url, anonKey } = getSupabaseEnv();
  const client = createBrowserClient<Database>(url, anonKey);
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    // Handy for debugging realtime in the browser console: window.__supabase.realtime.channels
    (window as unknown as { __supabase?: Client }).__supabase = client;
  }
  return client;
}

/**
 * Realtime channel names must be unique per subscription. The browser client is a
 * singleton and `supabase.channel(name)` returns an existing channel with the same
 * name, including one that is still being torn down (React runs effects twice in
 * development), so every effect run gets a fresh name.
 */
export function uniqueChannelName(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Make sure the realtime socket carries the user's JWT before a channel joins.
 * On a fresh page load the cookie session resolves asynchronously; a channel that
 * subscribes before that joins anonymously and row-level security then hides
 * every event from it. Await this right before `channel.subscribe()`.
 */
export async function ensureRealtimeAuth(supabase: Client): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return false;
  await supabase.realtime.setAuth(session.access_token);
  return true;
}

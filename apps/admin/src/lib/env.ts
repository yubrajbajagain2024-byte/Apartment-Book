export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Copy apps/admin/.env.example to apps/admin/.env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { url, anonKey };
}

/** Public URL of this admin app (auth redirects come back here). */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3001";
}

/** Public URL of the student website, for "open on site" links. */
export function getMainSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** The service-role key for the media worker, or null when it is not configured. Server only. */
export function getServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/** Which parts of the media worker can run with the current environment. Server only. */
export function workerStatus(): { storage: boolean; mux: boolean; cron: boolean } {
  return {
    storage: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    mux: Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET),
    cron: Boolean(process.env.CRON_SECRET),
  };
}

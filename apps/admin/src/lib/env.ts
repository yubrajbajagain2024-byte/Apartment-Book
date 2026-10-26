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

/** The service-role key (invitation emails, and the media worker when switched on), or null. Server only. */
export function getServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/**
 * The media worker moves and deletes files, so it runs only when switched on explicitly:
 * MEDIA_WORKER_ENABLED=true AND the service-role key. The key alone (which invitation
 * emails need) never turns it on. Server only.
 */
export function mediaWorkerEnabled(): boolean {
  return process.env.MEDIA_WORKER_ENABLED === "true" && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Whether this app can ask Supabase Auth to send invitation emails (needs the service-role key). Server only. */
export function invitationEmailsConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Which parts of the media worker can run with the current environment. Server only. */
export function workerStatus(): { enabled: boolean; switchOn: boolean; storage: boolean; mux: boolean; cron: boolean } {
  return {
    enabled: mediaWorkerEnabled(),
    switchOn: process.env.MEDIA_WORKER_ENABLED === "true",
    storage: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    mux: Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET),
    cron: Boolean(process.env.CRON_SECRET),
  };
}

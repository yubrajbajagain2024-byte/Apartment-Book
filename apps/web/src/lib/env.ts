export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Copy apps/web/.env.example to apps/web/.env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { url, anonKey };
}

export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Where the business portal lives: its own address (NEXT_PUBLIC_BUSINESS_SITE_URL, e.g. https://business.campconnect.com,
 * served from that host's root), or /business on the site itself when none is set (local work, previews).
 */
export function getBusinessSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BUSINESS_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return `${getSiteUrl()}/business`;
}

/** The host the portal answers on at its root, lower case and without a port; null when it has no address of its own. */
export function getBusinessHost(): string | null {
  const configured = process.env.NEXT_PUBLIC_BUSINESS_SITE_URL;
  if (!configured) return null;
  try {
    return new URL(configured).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts next.config.ts allows on any path: Google account avatars, the design preview's sample photos, video poster frames. */
const HOSTS = new Set(["lh3.googleusercontent.com", "picsum.photos", "image.mux.com"]);
/** Hosted Supabase Storage (*.supabase.co, *.supabase.in), allowed for public buckets only. */
const SUPABASE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.supabase\.(co|in)$/;
const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";
/** The project's own host, allowed on any path. A localhost project is allowed over http only, so it never counts here. */
const PROJECT_HOST = (() => {
  try {
    const host = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null;
    return host && !host.includes("localhost") && host !== "127.0.0.1" ? host : null;
  } catch {
    return null;
  }
})();

/**
 * Can next/image serve this picture? Only an https address that images.remotePatterns in next.config.ts allows (its
 * http entries are for a local Supabase). Anything else, such as a URL read from stored data like a shared post's
 * snapshot, belongs in a plain <img>: next/image throws in development for a host it does not know, and the optimizer
 * answers 400 in production. Keep in step with next.config.ts.
 */
export function isOptimizableImage(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname === PROJECT_HOST || HOSTS.has(parsed.hostname)) return true;
  return SUPABASE_HOST.test(parsed.hostname) && parsed.pathname.startsWith(SUPABASE_PUBLIC_PATH);
}

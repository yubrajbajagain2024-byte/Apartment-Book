/**
 * Development-only switches other modules check. Kept free of imports so a production bundle carries nothing extra:
 * `lib/buzz-fixtures` fills them in, and only in development (see lib/supabase).
 */
export const devOverrides: {
  /** The Buzz fixture variant in use (EXPO_PUBLIC_BUZZ_FIXTURES), or null. */
  buzzFixtures: string | null;
  /** Stands in for the website's Buzz write API while fixtures are on. */
  buzzFetch: typeof fetch | null;
} = { buzzFixtures: null, buzzFetch: null };

import { Linking } from "react-native";

/** The project's storage host (EXPO_PUBLIC_SUPABASE_URL) and the video provider's posters: the only places a business's images load from. */
const ALLOWED = new Set(
  [
    (() => {
      try {
        return process.env.EXPO_PUBLIC_SUPABASE_URL ? new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname : null;
      } catch {
        return null;
      }
    })(),
    "image.mux.com",
  ].filter((h): h is string => Boolean(h)),
);

/**
 * A business's image (an ad's photo, a post's cover, a logo), or null when it is not from UniBuzz's own storage or the
 * video provider. The app fetches images itself, so a picture on a business's own server would tell it who looked.
 */
export function safeBusinessImage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED.has(u.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Opens a web address a business gave (its website, a post's link) only when it is one: http or https, nothing else. */
export function openBusinessLink(url: string | null | undefined): void {
  if (!url || !/^https?:\/\//i.test(url)) return;
  void Linking.openURL(url).catch(() => {});
}

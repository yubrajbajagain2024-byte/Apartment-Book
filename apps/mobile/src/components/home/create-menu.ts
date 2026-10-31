import { useRouter } from "expo-router";
import { openCompose } from "@/lib/compose-nav";
import { useSession } from "@/lib/session";

/**
 * What every create button on Home does: opens the live camera at once (app/compose), TikTok's way, starting a post;
 * SNAP, REEL and BUZZ (an anonymous thread, written right on the stage) sit beside POST along its bottom, and Upload
 * opens the library (`upload`: straight onto it). Signed out it goes to the login screen instead. Shared by Orbit's
 * floating "+" and Upload in the menu under your photo (ProfileMenuSheet); the "+" Home's top bar shows over the Reels
 * video opens the camera on REEL (the bottom bar has no "+").
 */
export function useCreateMenu(): (opts?: unknown) => void {
  const router = useRouter();
  const { user } = useSession();
  // Often an onPress itself, so `opts` may be a press event: only an explicit { upload: true } opens the library.
  return (opts) => {
    if (!user) return router.push("/(auth)/login");
    const upload = typeof opts === "object" && opts !== null && (opts as { upload?: unknown }).upload === true;
    openCompose(router, "post", { upload });
  };
}

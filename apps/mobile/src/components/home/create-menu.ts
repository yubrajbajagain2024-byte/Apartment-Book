import { useRouter } from "expo-router";
import { openCompose } from "@/lib/compose-nav";
import { useSession } from "@/lib/session";

/**
 * What every create button on Home does: opens the live camera at once (app/compose), TikTok's way, starting a post;
 * SNAP, REEL and BUZZ (an anonymous thread, written right on the stage) sit beside POST along its bottom, and Upload
 * opens the library. Signed out it goes to the login screen instead. Shared by the "+" in the middle of the bottom bar
 * and the "+" badge on your photo in Home's top bar (the Reels page's "+" opens the camera on REEL).
 */
export function useCreateMenu(): () => void {
  const router = useRouter();
  const { user } = useSession();
  return () => {
    if (!user) return router.push("/(auth)/login");
    openCompose(router, "post");
  };
}

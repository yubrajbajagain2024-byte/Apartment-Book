import { useRouter } from "expo-router";
import { useActionSheet } from "@/components/action-sheet";
import { openBuzzComposerFromAnywhere } from "@/components/buzz/open-composer";
import { useSession } from "@/lib/session";

/**
 * What every create button on Home opens: the "What would you like to share?" sheet with Post, Reel, Buzz (anonymous)
 * and Snap (the camera, then Send To: see app/snap). Signed out it goes to the login screen instead. Shared by the "+" in the middle of the bottom bar, the "+" badge on
 * your photo in Home's top bar and the "+" that bar shows over the Reels video.
 */
export function useCreateMenu(): () => void {
  const router = useRouter();
  const show = useActionSheet();
  const { user } = useSession();
  return () => {
    if (!user) return router.push("/(auth)/login");
    show(
      [
        { label: "Post", icon: "create-outline", onPress: () => router.push("/create/post" as never) },
        { label: "Reel", icon: "videocam-outline", onPress: () => router.push("/create/reel" as never) },
        // The Buzz composer is a sheet on Home's Buzz page: Home moves there and it opens (after the guidelines gate).
        { label: "Buzz (anonymous)", icon: "chatbubbles-outline", onPress: () => openBuzzComposerFromAnywhere(router) },
        { label: "Snap", icon: "camera-outline", onPress: () => router.push("/snap" as never) },
      ],
      "What would you like to share?",
    );
  };
}

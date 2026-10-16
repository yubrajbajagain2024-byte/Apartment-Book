import { useRouter } from "expo-router";
import { useActionSheet } from "@/components/action-sheet";
import { useSession } from "@/lib/session";

/**
 * What every create button on Home opens: the "What would you like to share?" sheet with Post, Reel and Buzz (anonymous).
 * Signed out it goes to the login screen instead. Shared by the floating "+ New post" pill over the feed and the "+" the top
 * bar shows over the Reels video.
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
        { label: "Buzz (anonymous)", icon: "chatbubbles-outline", onPress: () => router.push("/create/buzz" as never) },
      ],
      "What would you like to share?",
    );
  };
}

import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { compose } from "@/lib/compose-store";

/**
 * /create/reel: kept for links and older builds. Reels are made in the create flow now (app/compose: TikTok's camera →
 * editor → publish screen); this screen hands over to it at once, on REEL.
 */
export default function CreateReelRoute() {
  const router = useRouter();
  useEffect(() => {
    compose.start("reel");
    router.replace({ pathname: "/compose", params: { mode: "reel" } } as never);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={{ flex: 1, backgroundColor: "#000" }} />;
}

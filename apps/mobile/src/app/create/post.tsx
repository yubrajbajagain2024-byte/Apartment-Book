import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { compose } from "@/lib/compose-store";

/**
 * /create/post: kept for links and older builds. Posts are made in the create flow now (app/compose: TikTok's camera →
 * editor → publish screen); this screen hands over to it at once, on POST.
 */
export default function CreatePostRoute() {
  const router = useRouter();
  useEffect(() => {
    compose.start("post");
    router.replace({ pathname: "/compose", params: { mode: "post" } } as never);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={{ flex: 1, backgroundColor: "#000" }} />;
}

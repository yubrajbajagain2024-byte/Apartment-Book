import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { dropUploads } from "@/lib/compose-media";
import { compose } from "@/lib/compose-store";

/**
 * /create/item: Explore's + for a Marketplace item. Listings are made in the create flow now (app/compose: the camera
 * and the editor, then the listing's details, form and preview); this screen hands over to it at once.
 */
export default function CreateItemRoute() {
  const router = useRouter();
  useEffect(() => {
    dropUploads();
    compose.start("item");
    router.replace({ pathname: "/compose", params: { mode: "item" } } as never);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={{ flex: 1, backgroundColor: "#000" }} />;
}

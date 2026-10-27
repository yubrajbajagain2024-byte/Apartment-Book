import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { dropUploads } from "@/lib/compose-media";
import { compose } from "@/lib/compose-store";

/**
 * /create/roommate: Explore's + for a roommate post. Listings are made in the create flow now (app/compose: the camera
 * and the editor, then the listing's details, form and preview); this screen hands over to it at once.
 */
export default function CreateRoommateRoute() {
  const router = useRouter();
  useEffect(() => {
    dropUploads();
    compose.start("roommate");
    router.replace({ pathname: "/compose", params: { mode: "roommate" } } as never);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={{ flex: 1, backgroundColor: "#000" }} />;
}

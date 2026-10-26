import { useEffect } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { openBuzzComposerFromAnywhere } from "@/components/buzz/open-composer";
import { phosphor } from "@/lib/palette";

/**
 * /create/buzz: kept for links and older builds. The composer itself is a sheet on Home's Buzz page (see BuzzSection);
 * this screen hands over to it at once (with `?prompt=<id>` to answer today's prompt).
 */
export default function CreateBuzzRoute() {
  const router = useRouter();
  const { prompt } = useLocalSearchParams<{ prompt?: string }>();
  useEffect(() => {
    openBuzzComposerFromAnywhere(router, { promptId: prompt ?? null, fromStack: true });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <Stack.Screen options={{ headerShown: false, animation: "none", contentStyle: { backgroundColor: phosphor.canvas } }} />
      <View style={{ flex: 1, backgroundColor: phosphor.canvas }} />
    </>
  );
}

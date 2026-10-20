import { Stack } from "expo-router";
import { BuzzSearchScreen } from "@/components/buzz/search-screen";
import { phosphor } from "@/lib/palette";

/** /buzz/search: Search Buzz, opened from the search pill on Home's Buzz page. */
export default function BuzzSearchRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: phosphor.canvas } }} />
      <BuzzSearchScreen />
    </>
  );
}

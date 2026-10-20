import { Stack } from "expo-router";
import { BuzzMineScreen } from "@/components/buzz/mine-screen";
import { phosphor } from "@/lib/palette";

/** /buzz/mine: My buzzes, the private list of your own threads and replies (linked from Settings, never from Home). */
export default function BuzzMineRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: phosphor.canvas } }} />
      <BuzzMineScreen />
    </>
  );
}

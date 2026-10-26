import { Stack, useLocalSearchParams } from "expo-router";
import { BuzzThreadScreen } from "@/components/buzz/thread-screen";
import { phosphor } from "@/lib/palette";

/** /buzz/<id>: one anonymous thread (the same address the website and Buzz notifications use). */
export default function BuzzThreadRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: phosphor.canvas } }} />
      <BuzzThreadScreen key={id} threadId={id} />
    </>
  );
}

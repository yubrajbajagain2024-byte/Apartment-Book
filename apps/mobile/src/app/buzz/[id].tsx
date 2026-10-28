import { Stack, useLocalSearchParams } from "expo-router";
import { BuzzThreadScreen } from "@/components/buzz/thread-screen";
import { phosphor } from "@/lib/palette";

/**
 * /buzz/<id>: one anonymous thread (the same address the website and Buzz notifications use); /buzz/<id>?reply=<reply id>
 * opens it at that reply (a feed card's "Top reply").
 */
export default function BuzzThreadRoute() {
  const { id, reply } = useLocalSearchParams<{ id: string; reply?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: phosphor.canvas } }} />
      <BuzzThreadScreen key={id} threadId={id} replyId={reply ?? null} />
    </>
  );
}

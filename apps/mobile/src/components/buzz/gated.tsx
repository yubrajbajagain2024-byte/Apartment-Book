import { useCallback, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { BUZZ_FEED_COPY } from "@apartment-book/shared";
import { CARD_GAP, BuzzCardSkeleton } from "./card";
import { BuzzGatePanel, BuzzSignedOutPanel, useBuzzGate } from "./gate";
import { ErrorState, GUTTER, P, PageHeader } from "./ui";
import { useSession } from "@/lib/session";

/**
 * A pushed Buzz screen (Search Buzz, My buzzes) that waits for the guidelines gate: signed out, the sign-in prompt;
 * not accepted, the gate panel with Back; accepted, the screen itself. Phosphor, light status bar. `fallback` is where
 * Back goes when there is nothing to go back to (a link opened cold).
 */
export function GatedBuzzScreen({ title, fallback = "/(tabs)", children }: { title: string; fallback?: Href; children: (onBack: () => void) => ReactNode }) {
  const router = useRouter();
  const { user, loading } = useSession();
  const gate = useBuzzGate();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace(fallback)), [router, fallback]);
  if (gate.status === "accepted" && user) return <>{children(back)}</>;
  let body;
  if (!loading && !user) body = <BuzzSignedOutPanel />;
  else if (gate.status === "required") body = <BuzzGatePanel variant="page" onDismiss={back} />;
  else if (gate.status === "error") body = <ErrorState title={BUZZ_FEED_COPY.loadError} message={gate.error} onRetry={gate.retry} />;
  else
    body = (
      <View style={{ paddingHorizontal: GUTTER, gap: CARD_GAP }}>
        <BuzzCardSkeleton />
      </View>
    );
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <PageHeader title={title} onBack={back} />
      <View style={{ paddingTop: 12 }}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: P.canvas },
});

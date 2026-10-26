import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { acceptBuzzGate, BUZZ_GATE_COPY, BUZZ_GUIDELINES_VERSION, buzzErrorMessage, getBuzzGate } from "@apartment-book/shared";
import { buzzState, gateFromServer, getBuzzState, useBuzzState, type BuzzUiState, type GateStatus } from "@/lib/buzz-store";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { MaskDisc, P, PButton, R, T } from "./ui";

/*
 * The Buzz guidelines gate (UniVerse SPEC §5.3, safety §1.1): an INLINE panel, never a sheet or a modal. Until the person
 * accepts the current version, Buzz makes no request for posts at all (only this gate's own check), the Home pager keeps
 * swiping through, and "Not now" goes back to the section they came from; a thread, Search or My buzzes shows it with
 * "Back" instead. A `buzz_gate_required` from any Buzz call (a new version mid-session) brings it back.
 */

const selectGate = (s: BuzzUiState) => s.gate;

/** Where the gate stands for the signed-in person; asks the server once per session (and again after `retry`). */
export function useBuzzGate(): { signedIn: boolean; status: GateStatus; error: string | null; retry: () => void } {
  const { user, loading } = useSession();
  const gate = useBuzzState(selectGate);
  const signedIn = Boolean(user);
  const check = useCallback(() => {
    buzzState.setGate("loading");
    getBuzzGate(supabase).then(
      (state) => buzzState.setGate(gateFromServer(state)),
      (e: unknown) => buzzState.setGate("error", buzzErrorMessage(e)),
    );
  }, []);
  useEffect(() => {
    // Several Buzz surfaces can mount at once (Home's page, a thread over it): only the first asks.
    if (!loading && signedIn && getBuzzState().gate.status === "unknown") check();
  }, [loading, signedIn, gate.status, check]);
  return { signedIn, status: signedIn ? gate.status : "unknown", error: gate.error, retry: check };
}

/** "Before your first buzz": the three rules, the accountability line, [I understand] and [Not now] (or [Back]). */
export function BuzzGatePanel({ variant, onDismiss }: { variant: "pane" | "page"; onDismiss: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      buzzState.setGate(gateFromServer(await acceptBuzzGate(supabase, BUZZ_GUIDELINES_VERSION)));
    } catch (e) {
      setError(buzzErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.panel} accessibilityLabel={BUZZ_GATE_COPY.title}>
      <View style={styles.head}>
        <MaskDisc size={44} glyph={22} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[T.title3, { color: P.ink }]} accessibilityRole="header">
            {BUZZ_GATE_COPY.title}
          </Text>
          <Text style={[T.caption, { color: P.ink3 }]}>{BUZZ_GATE_COPY.subtitle}</Text>
        </View>
      </View>
      <View style={styles.rules}>
        {BUZZ_GATE_COPY.rules.map((rule, i) => (
          <View key={rule} style={styles.rule} accessible accessibilityLabel={`${i + 1}. ${rule}`}>
            <View style={styles.number}>
              <Text style={[T.micro, { color: P.accentInk }]}>{i + 1}</Text>
            </View>
            <Text style={[T.body, styles.flex, { color: P.ink2 }]}>{rule}</Text>
          </View>
        ))}
      </View>
      <Text style={[T.footnote, { color: P.ink3 }]}>
        {BUZZ_GATE_COPY.footnote}{" "}
        <Text style={{ color: P.accentInk }} onPress={() => router.push("/settings/buzz-anonymity" as never)} accessibilityRole="link">
          {BUZZ_GATE_COPY.learnMore}
        </Text>
      </Text>
      {error ? <Text style={[T.footnote, { color: P.danger }]}>{error}</Text> : null}
      <View style={styles.actions}>
        <PButton title={BUZZ_GATE_COPY.accept} size="lg" fullWidth loading={busy} onPress={() => void accept()} />
        <PButton title={variant === "page" ? BUZZ_GATE_COPY.back : BUZZ_GATE_COPY.notNow} variant="ghost" fullWidth icon={variant === "page" ? "arrow-back" : undefined} onPress={onDismiss} />
      </View>
    </View>
  );
}

/** Signed out: Buzz is for signed-in students only (every Buzz read needs an account and an accepted gate). */
export function BuzzSignedOutPanel() {
  const router = useRouter();
  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <MaskDisc size={44} glyph={22} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[T.title3, { color: P.ink }]} accessibilityRole="header">
            Buzz is anonymous campus talk
          </Text>
          <Text style={[T.caption, { color: P.ink3 }]}>{BUZZ_GATE_COPY.subtitle}</Text>
        </View>
      </View>
      <Text style={[T.body, { color: P.ink2 }]}>Log in to read what your campus is saying and to post without your name or photo.</Text>
      <View style={styles.actions}>
        <PButton title="Log in" size="lg" fullWidth onPress={() => router.push("/(auth)/login")} />
        <PButton title="Create an account" variant="ghost" fullWidth onPress={() => router.push("/(auth)/signup")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: { marginHorizontal: 16, gap: 20, padding: 20, borderRadius: R.lg, borderCurve: "continuous", borderWidth: 1, borderColor: P.accentLine, backgroundColor: P.surface1 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  rules: { gap: 12 },
  rule: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  number: { width: 24, height: 24, borderRadius: 12, marginTop: 1, backgroundColor: P.accentSoft, alignItems: "center", justifyContent: "center" },
  actions: { gap: 6 },
});

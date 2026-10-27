import { StyleSheet, Text, TextInput, View } from "react-native";
import { BUZZ_COMPOSER_COPY, BUZZ_LIMITS, BUZZ_POLL_DURATIONS } from "@apartment-book/shared";
import { buzzState, useBuzzState, type BuzzUiState } from "@/lib/buzz-store";
import { Chip, P, PButton, PIconButton, R, T } from "./ui";

const selectDraft = (s: BuzzUiState) => s.draft;

/**
 * The draft's poll, as every Buzz composer edits it: two to four options (each up to the option limit) and how long it
 * stays open (1, 3 or 7 days). Reads and writes the draft in the Buzz store.
 */
export function BuzzPollEditor() {
  const draft = useBuzzState(selectDraft);
  const setOption = (i: number, v: string) => buzzState.setDraft({ options: draft.options.map((o, k) => (k === i ? v : o)) });
  const addOption = () => {
    if (draft.options.length < BUZZ_LIMITS.pollMaxOptions) buzzState.setDraft({ options: [...draft.options, ""] });
  };
  const removeOption = (i: number) => {
    if (draft.options.length > BUZZ_LIMITS.pollMinOptions) buzzState.setDraft({ options: draft.options.filter((_, k) => k !== i) });
  };
  return (
    <View style={styles.pollCard}>
      <View style={styles.pollHead}>
        <Text style={[T.labelSm, { color: P.ink }]}>Poll</Text>
        <Text style={[T.caption, { color: P.ink3 }]}>{BUZZ_COMPOSER_COPY.pollHint}</Text>
      </View>
      {draft.options.map((o, i) => (
        <View key={i} style={styles.optionRow}>
          <TextInput
            value={o}
            onChangeText={(v) => setOption(i, v)}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor={P.ink4}
            keyboardAppearance="dark"
            maxLength={BUZZ_LIMITS.pollOptionText}
            style={[T.body, styles.option]}
            accessibilityLabel={`Option ${i + 1}`}
          />
          {draft.options.length > BUZZ_LIMITS.pollMinOptions ? <PIconButton icon="close" label={`Remove option ${i + 1}`} onPress={() => removeOption(i)} size={36} iconSize={16} /> : null}
        </View>
      ))}
      {draft.options.length < BUZZ_LIMITS.pollMaxOptions ? <PButton title="Add option" icon="add" variant="ghost" size="sm" onPress={addOption} style={styles.addOption} /> : null}
      <View style={styles.durations} accessibilityLabel="Poll duration">
        {BUZZ_POLL_DURATIONS.map((n) => (
          <Chip key={n} label={n === 1 ? "1 day" : `${n} days`} selected={draft.durationDays === n} onPress={() => buzzState.setDraft({ durationDays: n })} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pollCard: { gap: 12, padding: 14, borderRadius: R.lg, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: P.line, backgroundColor: P.canvas },
  pollHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  option: { flex: 1, height: 48, color: P.ink, paddingHorizontal: 14, borderRadius: R.md, borderCurve: "continuous", borderWidth: 1, borderColor: P.line, backgroundColor: P.surface2 },
  addOption: { alignSelf: "flex-start" },
  durations: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

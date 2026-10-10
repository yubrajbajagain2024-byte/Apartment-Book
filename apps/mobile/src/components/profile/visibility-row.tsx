import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ownSectionNote, PROFILE_SECTION_NOUNS, PROFILE_VISIBILITY_OPTIONS, type ProfileSection, type ProfileVisibility } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { colors, radius, space } from "@/lib/theme";

export const VISIBILITY_ICONS: Record<ProfileVisibility, keyof typeof Ionicons.glyphMap> = { public: "earth-outline", friends: "people-outline", private: "lock-closed-outline" };

/** "Who can see your saved posts": the question each setting answers, in the settings and on the Change button. */
export function visibilityQuestion(section: ProfileSection): string {
  return `Who can see your ${PROFILE_SECTION_NOUNS[section]}`;
}

/**
 * The owner's line at the top of Classes, Saved and Liked: a globe, people or lock, "Only you can see your saved posts",
 * and Change, which offers Everyone, Friends and Only me (the current one ticked where the sheet can show it).
 */
export function VisibilityRow({ section, value, busy, onChange }: { section: ProfileSection; value: ProfileVisibility; busy?: boolean; onChange: (value: ProfileVisibility) => void }) {
  const show = useActionSheet();
  const question = visibilityQuestion(section);
  function change() {
    show(
      PROFILE_VISIBILITY_OPTIONS.map((o) => ({
        label: o.label,
        icon: o.value === value ? ("checkmark" as const) : undefined,
        onPress: () => {
          if (o.value !== value) onChange(o.value);
        },
      })),
      `${question}?`,
    );
  }
  return (
    <View style={styles.row}>
      <Ionicons name={VISIBILITY_ICONS[value]} size={16} color={colors.muted} />
      <Text style={styles.note}>{ownSectionNote(section, value)}</Text>
      <Pressable onPress={change} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel={question} accessibilityState={{ disabled: Boolean(busy), busy: Boolean(busy) }} style={({ pressed }) => [styles.change, pressed && { opacity: 0.6 }]}>
        {busy ? <ActivityIndicator size="small" color={colors.brand} /> : <Text style={styles.changeText}>Change</Text>}
      </Pressable>
    </View>
  );
}

/** What a visitor sees on a tab they may not open: a lock and "Only Sunil's friends can see their classes". */
export function LockedNotice({ message }: { message: string }) {
  return (
    <View style={styles.locked} accessible accessibilityLabel={message}>
      <View style={styles.lockCircle}>
        <Ionicons name="lock-closed" size={24} color={colors.text} />
      </View>
      <Text style={styles.lockedText}>{message}</Text>
    </View>
  );
}

/**
 * Settings → Privacy: one question with Everyone / Friends / Only me side by side, and a line under them saying what the
 * chosen one means.
 */
export function VisibilityPicker({ section, value, onChange }: { section: ProfileSection; value: ProfileVisibility; onChange: (value: ProfileVisibility) => void }) {
  const question = visibilityQuestion(section);
  const chosen = PROFILE_VISIBILITY_OPTIONS.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.pickerLabel}>{question}</Text>
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={question}>
        {PROFILE_VISIBILITY_OPTIONS.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityHint={question}
              accessibilityState={{ checked: selected }}
              style={[styles.segment, selected && styles.segmentOn]}
            >
              <Ionicons name={VISIBILITY_ICONS[o.value]} size={14} color={selected ? colors.brand : colors.muted} />
              <Text style={[styles.segmentText, selected && { color: colors.brand }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {chosen ? <Text style={styles.pickerHint}>{chosen.description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  note: { flex: 1, fontSize: 13, color: colors.muted },
  change: { minWidth: 64, minHeight: 30, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  changeText: { fontSize: 13, fontWeight: "700", color: colors.text },
  locked: { alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingVertical: 40 },
  lockCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: colors.text, alignItems: "center", justifyContent: "center" },
  lockedText: { fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
  pickerLabel: { fontSize: 13, fontWeight: "600", color: colors.muted },
  segments: { flexDirection: "row", gap: space.sm },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  segmentOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  pickerHint: { fontSize: 12, color: colors.muted },
});

import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "@/lib/theme";

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <View style={styles.segment}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segmentItem, value === o.value && styles.segmentActive]} accessibilityRole="radio" accessibilityState={{ checked: value === o.value }}>
          <Text style={[styles.segmentText, value === o.value && { color: "#fff" }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
      <Ionicons name={value ? "checkbox" : "square-outline"} size={22} color={value ? colors.brand : colors.muted} />
      <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", backgroundColor: colors.input, borderRadius: radius.md, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.brand },
  segmentText: { fontWeight: "700", color: colors.muted, fontSize: 13 },
  section: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
});

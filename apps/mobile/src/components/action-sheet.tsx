import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "@/lib/theme";

export type SheetOption = { label: string; icon?: keyof typeof Ionicons.glyphMap; destructive?: boolean; onPress: () => void };
type Show = (options: SheetOption[], title?: string) => void;
const Ctx = createContext<Show>(() => {});

/** Native action sheet on iOS, a bottom sheet elsewhere (Android, web). */
export function ActionSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: SheetOption[]; title?: string } | null>(null);
  const show = useCallback<Show>((options, title) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length, destructiveButtonIndex: options.map((o, i) => (o.destructive ? i : -1)).filter((i) => i >= 0) },
        (i) => options[i]?.onPress(),
      );
      return;
    }
    setState({ options, title });
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal visible={state !== null} transparent animationType="fade" onRequestClose={() => setState(null)}>
        <Pressable style={styles.backdrop} onPress={() => setState(null)} accessibilityLabel="Close menu">
          <Pressable style={styles.sheet} onPress={() => {}}>
            {state?.title ? <Text style={styles.title}>{state.title}</Text> : null}
            {state?.options.map((o) => (
              <Pressable
                key={o.label}
                accessibilityRole="menuitem"
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.bg }]}
                onPress={() => {
                  setState(null);
                  o.onPress();
                }}
              >
                {o.icon ? <Ionicons name={o.icon} size={20} color={o.destructive ? colors.red : colors.text} /> : null}
                <Text style={[styles.itemText, o.destructive && { color: colors.red }]}>{o.label}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.item, { justifyContent: "center" }]} onPress={() => setState(null)}>
              <Text style={[styles.itemText, { color: colors.muted }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Ctx.Provider>
  );
}

export function useActionSheet(): Show {
  return useContext(Ctx);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 8, paddingBottom: 24, gap: 2 },
  title: { textAlign: "center", color: colors.muted, fontSize: 13, paddingVertical: 8 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: radius.md },
  itemText: { fontSize: 16, fontWeight: "600", color: colors.text },
});
